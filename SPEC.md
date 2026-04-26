# cybus-arcade — architecture spec

Last updated 2026-04-25. Scope: 10-hour OpenClaw hackathon build. Theme: "build cool shit that works."

## 1. The pitch in one sentence

Email a Roblox game request to `build@cybus.to`. A multi-agent fleet (one orchestrator + 5 specialist agents) builds a playable place in ≤90 seconds inside a real Roblox Studio session, fed by Nia retrieval and watched live on a wall, while a benchmark script proves head-to-head superiority over Claude Opus 4.6 single-shot.

## 2. Hard constraints

- Repo size: < 50 source files, < 3,000 LOC hand-written
- Wall bundle: < 200 KB gzipped
- End-to-end latency: ≤ 90 s email → playable place
- GPU spend cap: ~$50 finetune + ~$32 serving = ~$82
- API spend (sponsored Anthropic key): synth ~$1.6K + demo ~$25 = ~$1.6K total, no cap
- All sponsor APIs (Nia, AgentMail) must be load-bearing — the demo must break if either is unplugged

## 3. Repo layout

```
cybus-arcade/
├─ packages/
│  ├─ core/                 # shared types — 1 file
│  ├─ orchestrator/         # Bun + Hono webhook + multi-agent dispatcher
│  └─ wall/                 # Preact arcade UI
├─ scripts/
│  ├─ synth_gen.py          # synthetic data harness (Anthropic-driven)
│  ├─ train.py              # parameterized LoRA SFT
│  ├─ index_corpus.ts       # one-shot Nia ingest of Roblox API + your 428 chunks
│  └─ bench.ts              # head-to-head vs Opus 4.6
├─ infra/
│  └─ vast/
│     ├─ up_train.sh        # 8×H200 finetune launcher
│     ├─ up_serve.sh        # 4×A100 SXM serving launcher
│     └─ down.sh            # tear down all instances
├─ prompts/
│  ├─ scheduler.md
│  ├─ indexer.md
│  ├─ builder.md
│  ├─ debugger.md
│  └─ designer.md
├─ datasets/                # gitignored — JSONL output of synth_gen
├─ SPEC.md
└─ package.json
```

LOC budget by package:

| Package | Files | LOC budget |
|---|---|---|
| `core/` | 1 | 60 |
| `orchestrator/` | 10 | 700 |
| `wall/` | 10 | 450 |
| `scripts/` | 4 | 800 |
| `infra/` | 3 | 100 |
| `prompts/` | 5 | 800 (text, not code) |
| **Total code** | **28** | **~2,100** |

## 4. The agent fleet

| Agent | Model on disk | Endpoint | System prompt | Finetune? |
|---|---|---|---|---|
| Scheduler | `Qwen/Qwen3-7B` + `cybus-arcade-scheduler-lora` | `:8002/v1` | `prompts/scheduler.md` | LoRA r=64, ~200-400 traces |
| Indexer | `Qwen/Qwen3-7B` + `cybus-arcade-indexer-lora` | `:8003/v1` | `prompts/indexer.md` | LoRA r=64, ~400-700 traces |
| Builder | `squaredcuber/cybus-luau-qwen3p5-v6-sft` | `:8001/v1` | `prompts/builder.md` | already done — v6 |
| Debugger | same Builder endpoint, prompt swap | `:8001/v1` | `prompts/debugger.md` | none |
| Designer | `Qwen/Qwen3.5-27B` (base, no LoRA) | `:8004/v1` | `prompts/designer.md` | **prompted base** — no finetune |

**2 LoRAs, 3 base models.** Designer uses base Qwen3.5-27B with the system prompt at inference (game-feel taste is well-handled by frontier-scale instruction-following; small synthetic dataset wasn't enough for a reliable LoRA on a 27B). Builder is shared by Builder+Debugger via prompt swap.

## 5. Event protocol (the entire shared contract)

All events flow over a single websocket from `orchestrator → wall + Cybus Chat plugin`. Defined once in `packages/core/src/events.ts`:

```ts
export type SessionId = string;     // one per inbound email
export type AgentId = 'scheduler' | 'indexer' | 'builder' | 'debugger' | 'designer';

export type Event =
  | { t: 'session.start';   sid: SessionId; from: string; subject: string; body: string; ts: number }
  | { t: 'place.reset';     sid: SessionId }
  | { t: 'agent.thinking';  sid: SessionId; agent: AgentId; tokens: string }
  | { t: 'agent.tool_call'; sid: SessionId; agent: AgentId; tool: string; args: unknown }
  | { t: 'agent.result';    sid: SessionId; agent: AgentId; ok: boolean; summary: string }
  | { t: 'patch.applied';   sid: SessionId; lines: number; files: string[] }
  | { t: 'studio.error';    sid: SessionId; trace: string }
  | { t: 'critique';        sid: SessionId; text: string; patch_lines: number }
  | { t: 'session.end';     sid: SessionId; ok: boolean; share_url?: string; iters: number; ms: number };
```

That's the entire interface. Wall renders, Cybus Chat plugin renders, bench script consumes. ~25 lines of types.

## 6. Inbound flow (per email)

```
AgentMail webhook (Svix-verified)
  └─> orchestrator/webhook.ts — enqueue Job{ sid, from, subject, body }
        └─> orchestrator/dispatcher.ts — pull job, emit session.start
              ├─> emit place.reset → Studio Bridge clears Workspace, restores baseplate
              ├─> Scheduler.run(body) → returns DAG of subtasks
              │     for each subtask:
              │       ├─> Indexer.run(subtask) → Nia query, returns code patterns
              │       ├─> Builder.run(subtask, patterns) → Luau patch
              │       └─> Studio Bridge applies → success or studio.error
              │             on error → Debugger.run(error) → patch retry (max 3)
              ├─> Designer.run(final_state) → critique + polish patch → apply
              └─> emit session.end with share_url
```

## 7. Baseplate reset protocol

On `place.reset`, the Cybus Studio Worker (existing, in `roblox-studio-mcp/`) does:

```lua
-- workspace clear, retain only Camera + Terrain
for _, c in ipairs(Workspace:GetChildren()) do
  if c ~= Workspace.Camera and c ~= Workspace.Terrain then c:Destroy() end
end
-- restore baseplate
local bp = Instance.new("Part", Workspace)
bp.Name, bp.Size, bp.Anchored = "Baseplate", Vector3.new(2048, 4, 2048), true
bp.Position, bp.Material = Vector3.new(0, -2, 0), Enum.Material.Plastic
-- restore SpawnLocation
local sl = Instance.new("SpawnLocation", Workspace)
sl.Anchored, sl.Position = true, Vector3.new(0, 4, 0)
-- clear scripts in ServerScriptService (except Cybus harness)
for _, c in ipairs(ServerScriptService:GetChildren()) do
  if not c.Name:match("^Cybus") then c:Destroy() end
end
```

Trigger time: < 200 ms. The Cybus Chat plugin shows a "🧹 reset" line at the top of the new session thread.

## 8. Cybus Chat plugin upgrade

Backward-compatible. Existing long-poll on Studio Bridge port 38080 stays. New work:

- Add `agent` field on every event message. Plugin UI groups events by agent under one collapsible session header.
- New event types: `place.reset`, `agent.thinking`, `agent.tool_call`, `critique`. Plugin renders them as distinct UI rows with icons.
- Plugin keeps its existing manual chat input as a fallback debug channel.
- The new "session header" line shows: `📧 from <user> — <subject>` so it's obvious where the prompt came from.

Plugin code lives in `roblox-studio-mcp/packages/plugin/`. Only ~6 Lua files exist there; the upgrade is ~80 lines added to `MainController.lua` + `MessageRow.lua`.

## 9. Orchestrator package

```
packages/orchestrator/
├─ src/
│  ├─ index.ts            # Bun.serve + Hono mount + ws upgrade
│  ├─ webhook.ts          # AgentMail Svix verify, push to queue
│  ├─ dispatcher.ts       # pulls job, runs the multi-agent loop
│  ├─ broadcast.ts        # ws fan-out, single Set<WebSocket>
│  ├─ db.ts               # bun:sqlite — sessions, events, votes
│  ├─ studio_bridge.ts    # POST to existing Studio Bridge endpoints
│  ├─ agents/
│  │  ├─ scheduler.ts     # OpenAI SDK → Vast :8002 with tools
│  │  ├─ indexer.ts       # OpenAI SDK → Vast :8003 with Nia tool
│  │  ├─ builder.ts       # OpenAI SDK → Vast :8001 with builder prompt
│  │  ├─ debugger.ts      # OpenAI SDK → Vast :8001 with debugger prompt
│  │  └─ designer.ts      # OpenAI SDK → Vast :8004 multimodal
│  └─ tools/
│     ├─ nia.ts           # Nia REST wrapper
│     └─ apply_patch.ts   # studio_bridge dispatch
└─ package.json
```

Total ~700 LOC. Each agent file ≤ 80 LOC — they're thin wrappers over the OpenAI-compat endpoint with role-specific tools.

## 10. Wall package

Preact + Signals + plain CSS. One screen, three regions: live "Now Building" (top, current session events streaming), arcade tile grid (middle, completed places with QR codes + share links), bench leaderboard (bottom right corner, GameCoder-arcade-fleet vs Opus 4.6 win rate).

```
packages/wall/
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ stage.tsx          # Now Building section
│  ├─ tile.tsx           # one game tile
│  ├─ grid.tsx           # tile grid
│  ├─ scoreboard.tsx     # bench result widget
│  ├─ ws.ts              # signal-driven event consumer
│  ├─ qr.ts              # 60-line vanilla QR encoder
│  └─ tokens.css         # design tokens — neon arcade aesthetic
├─ index.html
├─ vite.config.ts
└─ package.json
```

## 11. Synth-gen harness (`scripts/synth_gen.py`)

Drives Sonnet 4.6 in 4 different role-shaped prompts against the existing mock Roblox env (9,278 mock setups in `roblox-studio-mcp/`). One run produces three datasets.

```
for each of N mock setups (parallel × 50 via asyncio):
  prompt = render_user_prompt(setup)            # templated
  trace_so_far = []

  # Scheduler turn
  plan = sonnet_play_role('scheduler', prompt, system=load('prompts/scheduler.md'))
  trace_so_far.append({role:'scheduler', input:prompt, output:plan})

  # For each subtask in plan
  for subtask in plan.subtasks:
    # Indexer turn — REAL Nia API call with Sonnet's queries
    nia_results = real_nia_search(sonnet_play_role('indexer', subtask, ...))
    trace_so_far.append({role:'indexer', subtask, queries, results:nia_results})

    # Builder turn — emits Luau
    luau = sonnet_play_role('builder', subtask, refs=nia_results, ...)
    apply_to_mock_env(luau)                     # uses existing mock setup
    if mock_error:
      fix = sonnet_play_role('debugger', mock_error, last_luau=luau, ...)
      apply_to_mock_env(fix)

  # Designer turn — looks at final state
  final_state = describe_state(mock_env)
  critique = sonnet_play_role('designer', final_state, ...)
  apply_critique_patch(critique)

  # Filter: did the trajectory converge cleanly?
  judge_score = haiku_judge(full_trajectory)
  if judge_score >= 7:
    write_per_agent_slices_to_jsonl(trajectory)  # 3 files: scheduler, indexer, designer
```

Outputs three JSONL files in `datasets/`:

| File | Examples target | Avg tokens | Total |
|---|---|---|---|
| `scheduler_traces.jsonl` | 25K | 6K | 150M |
| `indexer_traces.jsonl` | 10K | 3K | 30M |
| `designer_traces.jsonl` | 8K | 4K | 32M |

Note: no `builder_traces.jsonl` since Builder ships v6 unchanged.

Anthropic spend (sponsored key, no cap): ~$1.5K (Sonnet 4.6 generation) + ~$120 (Haiku 4.5 judging) = **~$1.6K**.
Wallclock: ~3 hr at 100 concurrent calls.

## 12. Training (`scripts/train.py`)

Single script, role parameter, runs on the 8×H200 vast instance. Uses `transformers` + `peft` + `accelerate` with FSDP zero-3.

```bash
python scripts/train.py --role scheduler --base Qwen/Qwen3-7B \
  --data datasets/scheduler_traces.jsonl --epochs 3 --rank 64 \
  --output checkpoints/scheduler-lora

python scripts/train.py --role indexer --base Qwen/Qwen3-7B ...
python scripts/train.py --role designer --base Qwen/Qwen3.5-27B \
  --freeze-vision-encoder ...     # critical — preserve multimodal capability
```

Hyperparams (locked):
- LR 1e-4 cosine, warmup 100 steps
- bf16 mixed precision
- LoRA r=64 alpha=128, target modules q/k/v/o/gate/up/down
- batch=4 per device × 8 GPUs × grad accum 2 = effective 64
- 3 epochs (scheduler/indexer), 2 epochs (designer)

Wallclock per role on 8×H200 (5× data scale-up):

| Role | Tokens | Wallclock | GPU $ |
|---|---|---|---|
| Scheduler | 450M (3 ep × 25K examples) | ~50 min | $25 |
| Indexer | 90M (3 ep × 10K examples) | ~25 min | $13 |
| Designer | 64M (2 ep × 8K examples) | ~40 min | $20 |
| **Total** | — | **~2 hr train + 30 min eval/save** | **$60** |

Plus ~$15 instance idle while data uploads. **Round to $80.**

Each LoRA saved to HF as `squaredcuber/cybus-arcade-{role}-lora` for vLLM `--enable-lora` consumption.

## 13. Vast deployment

`infra/vast/up_serve.sh` brings up one **4×A100-80GB SXM** instance running 4 vLLM servers behind nginx:

| Port | Model | LoRA adapter | GPUs |
|---|---|---|---|
| 8001 | `squaredcuber/cybus-luau-qwen3p5-v6-sft` (Builder/Debugger) | none | 0,1 (TP=2) |
| 8002 | `Qwen/Qwen3-7B` | `cybus-arcade-scheduler-lora` | 2 |
| 8003 | `Qwen/Qwen3-7B` | `cybus-arcade-indexer-lora` | 2 (shared, fits in same GPU with multi-LoRA) |
| 8004 | `Qwen/Qwen3.5-27B` | `cybus-arcade-designer-lora` | 3 |

vLLM 0.15+ supports `--enable-lora --max-loras 4 --max-lora-rank 64` to multiplex Scheduler + Indexer on the same GPU. That frees GPU 1 of the pair for KV headroom.

Cost: ~$4/hr × 8 hr = **$32** for the demo window.

## 14. Bench script (`scripts/bench.ts`)

10 fixed Roblox prompts, runs each through both pipelines:

```ts
const PROMPTS = [/* tower_defense, obby, racing, fps, party_game, sandbox, … */];
for (const p of PROMPTS) {
  const [ours, opus] = await Promise.all([
    pipeline.run(p),                               // full multi-agent
    opusSingleShot(p),                             // Opus 4.6 single call
  ]);
  // Score: build_health (boots, no errors) + visual_usability (Designer judge) + intent_alignment (Designer judge)
  results.push({ p, ours_score: ours.score, opus_score: opus.score,
                 ours_ms: ours.ms, opus_ms: opus.ms });
}
```

Run once before the demo, cache results in `datasets/bench_results.json`. Wall reads + animates them on the scoreboard. If the bench is being live-rerun on stage, throttle to 3 prompts so it finishes in under 5 min.

## 15. Environment variables (the full set)

```bash
# Already in ~/.bashrc / ~/.zshrc
NIA_API_KEY=nk_…
AGENTMAIL_API_KEY=am_us_…
ANTHROPIC_API_KEY=sk-ant-api03-…
HF_TOKEN=hf_FopUDNPgtbb…

# Filled at runtime by infra scripts
VAST_TRAIN_INSTANCE_ID=…
VAST_SERVE_INSTANCE_ID=…
VAST_SERVE_PUBLIC_URL=http://…:8001
OPENAI_BASE_URL_BUILDER=http://…:8001/v1
OPENAI_BASE_URL_SCHED=http://…:8002/v1
OPENAI_BASE_URL_INDEXER=http://…:8003/v1
OPENAI_BASE_URL_DESIGNER=http://…:8004/v1

# Set per the deployment
AGENTMAIL_INBOX=build@cybus.to
AGENTMAIL_WEBHOOK_SECRET=whsec_…
ROBLOX_PLACE_ID=…
ROBLOX_SHARE_URL=https://www.roblox.com/games/…
STUDIO_BRIDGE_URL=http://localhost:38081     # or tunnel
```

## 16. Failure modes & fallbacks

| Failure | Fallback | Trigger |
|---|---|---|
| Vast 4×A100 instance dies mid-demo | flip env: `OPENAI_BASE_URL_*=https://api.together.ai/v1` (Qwen models hosted there) | health check fails 3× in 30s |
| Scheduler/Designer LoRA misbehaves | drop LoRA, run base Qwen3-7B / Qwen3.5-27B with system prompt only | dispatcher hot-flag |
| Studio Bridge offline | dispatch to local mock environment, share screenshot instead of joinable place | bridge POST returns 502 |
| AgentMail webhook drops | poll `messages.list(labels=["unread"])` every 10s as backup | always on |
| Nia rate-limit | cache the 100 most-common queries in SQLite, serve from cache | on first 429 |

## 17. Demo arc (3 minutes on stage)

1. (00:00–00:15) Empty Roblox place on screen + share QR. "Email build@cybus.to."
2. (00:15–01:30) You email "tower defense with three enemy types and a final boss." Wall lights up: scheduler decomposing → indexer pulling Roblox patterns → builder shipping Luau → debugger fixes one runtime → designer suggests "boss too small, lighting flat" → builder applies polish. Place fills with parts + scripts in real time.
3. (01:30–02:15) "Now you all play it." Room scans the QR, joins as Roblox players, multiplayer game running.
4. (02:15–02:45) Switch to scoreboard panel: cybus-arcade fleet vs Opus 4.6 head-to-head, 7-3 win rate, 1/12th the API cost.
5. (02:45–03:00) "Open weights, open repo, $30 of GPU. Email a request — we'll build you a place all night."

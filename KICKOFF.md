# KICKOFF — cybus-arcade

10-hour hackathon, 5 parallel CLI subs, 1 spec, 1 repo. **Read `SPEC.md` first.**

## Order of launch

Three phases. Each agent kicks off in the phase shown — don't wait for the previous phase to finish unless flagged.

```
PHASE 1 (immediate, run all 3 in parallel)
├─ opencode  → infra prep + AgentMail webhook + Nia ingest        (1-2 hr)
├─ Codex     → Studio Bridge upgrade + Cybus Chat plugin           (3-4 hr)
└─ Cursor    → wall UI with mock events                            (4-6 hr)

PHASE 2 (start when PHASE 1 has Nia indexed)
├─ Claude #2 → synth_gen.py runs (~3 hr) → train.py runs (~2.5 hr)  (5-6 hr total)
└─ Claude #1 → orchestrator with stubbed agents → integration tests (3-4 hr)

PHASE 3 (start when PHASE 2 LoRAs are on HF)
├─ opencode  → up_serve.sh deploys 4×A100 SXM fleet                (30 min)
├─ Claude #1 → swap stubs for real endpoints + run bench           (1 hr)
└─ all       → demo rehearsal + PRE_DEMO.md walkthrough            (1 hr)
```

Total critical path: synth → train → deploy → bench ≈ 7 hr. Wall + Studio Bridge run alongside.

## How to launch each sub

Open the appropriate CLI and paste **the entire contents** of the file as the first message:

| Sub | File to paste | Working dir |
|---|---|---|
| **Claude Code #1** | `prompts/kickoff_claude1_orchestrator.md` | `cybus-arcade/` |
| **Claude Code #2** | `prompts/kickoff_claude2_synthgen_train.md` | `cybus-arcade/` |
| **Codex** | `prompts/kickoff_codex_studio_plugin.md` | **`roblox-studio-mcp/`** ← different repo |
| **Cursor** | `prompts/kickoff_cursor_wall.md` | `cybus-arcade/` |
| **opencode** | `prompts/kickoff_opencode_infra.md` | `cybus-arcade/` |

## Pre-launch checklist (do this first, ~10 min)

```bash
cd C:/Users/sarta/cybus-arcade

# 1. Verify env vars are loaded
echo "$NIA_API_KEY" "$AGENTMAIL_API_KEY" "$ANTHROPIC_API_KEY" "$HF_TOKEN" | tr ' ' '\n' | wc -l    # expect 4

# 2. Install root deps for the workspace
bun install

# 3. Smoke test each API key (they're already saved to ~/.bashrc)
curl -sf "https://apigcp.trynia.ai/v2/sources" -H "Authorization: Bearer $NIA_API_KEY" >/dev/null && echo "nia ok"
curl -sf "https://api.agentmail.to/v0/inboxes" -H "Authorization: Bearer $AGENTMAIL_API_KEY" >/dev/null && echo "agentmail ok"
curl -sf -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":4,"messages":[{"role":"user","content":"hi"}]}' >/dev/null && echo "anthropic ok"
huggingface-cli whoami 2>/dev/null && echo "hf ok"
```

## Data + spend targets (sponsored Anthropic key — go wild)

| Dataset | Examples | Tokens | Anthropic $ |
|---|---|---|---|
| Scheduler | 25,000 | ~150M | ~$900 |
| Indexer | 10,000 | ~30M | ~$200 |
| Designer | 8,000 | ~32M | ~$300 |
| Haiku judging | — | — | ~$120 |
| **Total synth-gen** | **43K traces** | — | **~$1.5K** |

Wallclock: ~3 hr at 100 concurrent (bump to 150 if no RPM 429s).

## GPU spend (Vast.ai)

| Job | GPU | Hr | $ |
|---|---|---|---|
| Training all 3 LoRAs | 8×H200 SXM | ~2.5 | ~$80 |
| Serving fleet (Builder/Sched/Idx/Designer) | 4×A100 SXM | 8 | ~$32 |
| **GPU total** | — | — | **~$112** |

## Critical contracts (don't break)

1. **`packages/core/src/index.ts`** — the entire shared protocol. NEVER edit without touching SPEC.md and notifying every other sub.
2. **`prompts/{scheduler,indexer,builder,debugger,designer}.md`** — the role system prompts. These are baked into the LoRA training data; changing them after synth-gen invalidates the dataset.
3. **`OPENAI_BASE_URL_*` env vars** — the orchestrator + bench script + wall all read these. Set once in `.env` after `up_serve.sh`.
4. **`STUDIO_BRIDGE_URL`** — Codex sets this when Studio Bridge upgrades land. Orchestrator reads it.

## Definition of "demo ready"

- [ ] One real email to `build@cybus.to` triggers a full multi-agent loop
- [ ] Place resets to baseplate, agents apply patches, place becomes joinable
- [ ] Wall shows live agent threads + completed tile + scoreboard
- [ ] Bench has been run, results cached in `datasets/bench_results.json`
- [ ] Cybus Chat plugin in Studio shows the same flow with agent icons
- [ ] PRE_DEMO.md walkthrough complete, fallback recording on disk

## When something breaks

- Vast instance dies → opencode flips `OPENAI_BASE_URL_*` to Together / Fireworks (Qwen models hosted there) until back up
- Webhook drops → poll `messages.list(labels=["unread"])` every 10s as orchestrator backup (already in spec §16)
- Synth-gen rejects too many → loosen Haiku judge or fix the most-failing role prompt; restart with `--scheduler 25000` etc. (resume-on-crash already implemented)
- LoRA breaks schema compliance → drop LoRA env flag, run base Qwen with system prompt only

Don't ask clarifying questions during the build. Make the call, write it to your sub's `DECISIONS.md`, keep moving.

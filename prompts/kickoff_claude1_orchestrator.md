# Kickoff prompt — Claude Code #1 (Orchestrator + DB + Studio Bridge)

You are building the **orchestrator** for `cybus-arcade`, a multi-agent Roblox game generator. Read `SPEC.md` first — it has the full architecture. Your scope is `packages/orchestrator/` plus the SQLite-backed event store. Other agents own the wall UI, the synth-gen scripts, the engine pipeline file, and the Cybus Chat plugin upgrade — DO NOT touch their files.

## Your deliverables

1. `packages/orchestrator/package.json` with deps: `hono`, `svix`, `agentmail`, `@anthropic-ai/sdk`, `openai`, `bun:sqlite` (built-in). devDeps: `typescript`, `@types/bun`.
2. `packages/orchestrator/src/index.ts` — Bun.serve + Hono routes + ws upgrade. Routes:
   - `POST /webhook/agentmail` → `webhook.ts`
   - `GET  /events` → upgrade to ws
   - `GET  /healthz` → 200 ok
3. `packages/orchestrator/src/webhook.ts` — Svix verify with raw body, parse the AgentMail payload, push a `Job` to the queue, ack 200.
4. `packages/orchestrator/src/db.ts` — bun:sqlite with two tables: `sessions(sid PRIMARY, from, subject, body, started_at, ended_at, ok, share_url)` and `events(sid, t, agent, payload_json, ts)`. ~50 LOC of prepared statements.
5. `packages/orchestrator/src/queue.ts` — async FIFO over SQLite (one `pending` job pulled per loop iter). Single consumer.
6. `packages/orchestrator/src/dispatcher.ts` — the **multi-agent loop**. Takes a Job, emits `session.start` + `place.reset`, calls Scheduler → for each subtask calls Indexer/Builder/Designer in dependency order, applies patches via `studio_bridge.ts`, runs Debugger on errors (max 3 retries), emits `session.end`. Export `runPipeline(job): Promise<{ok, share_url, ms, iters, state}>` so `bench.ts` can call it directly.
7. `packages/orchestrator/src/broadcast.ts` — single `Set<WebSocket>`, `emit(event)` fans out + writes to db.
8. `packages/orchestrator/src/studio_bridge.ts` — POSTs to `${STUDIO_BRIDGE_URL}/dispatch` with `{sid, action: "reset"|"apply_patches"|"snapshot", payload}`. Long-poll for the response on `/result/${sid}`. Existing Studio Bridge is at `roblox-studio-mcp/packages/server` — its API is in that repo's README.
9. `packages/orchestrator/src/agents/{scheduler,indexer,builder,debugger,designer}.ts` — each is a thin wrapper. Reads its system prompt from `prompts/${role}.md`. Uses `OpenAI` SDK with `OPENAI_BASE_URL_*` env var per role. Each exports an async function returning the parsed JSON output. Indexer additionally has a `nia_search` tool wrapper that hits `https://apigcp.trynia.ai/v2/search` with `Authorization: Bearer $NIA_API_KEY`.
10. `packages/orchestrator/src/tools/nia.ts` — 30-line wrapper, used by `agents/indexer.ts`.

## Hard rules

- **Strict TypeScript.** No `any` except at the AgentMail SDK boundary (its types are generic).
- **No frameworks beyond Hono and Bun.** No express, no fastify, no socket.io.
- **Read system prompts from `prompts/${role}.md` at boot.** Cache them in memory. They're the contract.
- **Every state transition emits exactly one `Event`.** No skipping. The wall and the Cybus Chat plugin both subscribe.
- **Strict JSON parsing of agent outputs.** If parsing fails, log + emit `agent.result {ok:false}`, don't crash.
- **Place reset before every session.** Always.
- **LOC budget for all of `packages/orchestrator/src`: 700.** Stay under it.
- **Imports from core:** only `import type { Event, AgentId, SessionId, Job } from "../../core/src/index.ts"`. The shared protocol is fixed.

## Env vars you read

```
NIA_API_KEY
AGENTMAIL_API_KEY
AGENTMAIL_WEBHOOK_SECRET
ANTHROPIC_API_KEY        # used only by Designer if you add an Opus fallback path
OPENAI_BASE_URL_BUILDER  # http://<vast-ip>:8001/v1
OPENAI_BASE_URL_SCHED    # http://<vast-ip>:8002/v1   model: cybus-arcade-scheduler-lora
OPENAI_BASE_URL_INDEXER  # http://<vast-ip>:8002/v1   model: cybus-arcade-indexer-lora
OPENAI_BASE_URL_DESIGNER # http://<vast-ip>:8004/v1   model: cybus-arcade-designer-lora
STUDIO_BRIDGE_URL        # http://localhost:38081 or tunnel URL
ROBLOX_PLACE_ID
ROBLOX_SHARE_URL
PORT                     # default 8787
```

## Order of work

1. `core/src/index.ts` already exists — read it, never modify.
2. `db.ts` first (everything writes events).
3. `broadcast.ts` (everyone emits).
4. Stub each agent file with hard-coded outputs so the dispatcher loop runs end-to-end without LLM. Then wire real endpoints.
5. `webhook.ts` last — wire it to the queue once dispatcher is green.
6. Add an integration test in `packages/orchestrator/test/` that fires a fake email payload and asserts a `session.end` event arrives within 30s using mocked agents.

## Done criteria

- `bun run dev` from repo root boots the orchestrator on `:8787`
- `curl -d @test/fixtures/email.json :8787/webhook/agentmail` returns 200 and emits 6+ events
- `bench.ts` can `import { runPipeline }` from your dispatcher and execute it
- Strict tsc passes
- All file changes confined to `packages/orchestrator/`

Ship it. Commit after each major file group lands. Don't ask clarifying questions — make the call and document it in `packages/orchestrator/README.md`.

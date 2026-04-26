# Kickoff prompt — opencode (Infra + DevX + end-to-end smoke test)

You own the **infrastructure glue** for `cybus-arcade`. Read `SPEC.md` first. Your scope: deployment scripts (already have skeletons in `infra/vast/`), AgentMail webhook tunnel, Nia ingestion, env wiring, and the end-to-end smoke test that proves a fake email produces a Roblox patch.

## Scope

1. **AgentMail webhook setup**:
   - Provision the inbox `build@cybus.to` (or whatever's available).
   - Run `cloudflared tunnel` or `ngrok` from your laptop to expose `localhost:8787` publicly.
   - Register the webhook via AgentMail API: `POST /v0/webhooks {url: "<tunnel-url>/webhook/agentmail", event_types: ["message.received"]}`.
   - Save the `whsec_…` to `~/.config/agentmail/webhook_secret` and `.env`.

2. **Nia ingestion**:
   - Run `bun run scripts/index_corpus.ts` which already exists. Verify both Roblox documentation sources reach `status: ready` (~2-5 min each).
   - If the existing 428-chunk RAG is on disk at `roblox-studio-mcp/packages/server/data/api_chunks.jsonl`, either upload as gist + re-call the index script with the gist URL, or upload directly via Nia file upload if available.
   - Verify with a sample query: `curl POST /v2/search '{mode:"universal",query:"Humanoid:MoveTo waypoint"}'` returns chunks from your sources.

3. **Vast scripts review + drive**:
   - `up_train.sh` and `up_serve.sh` already exist. Read them, fix anything broken, run them. Don't rewrite — extend.
   - Add a `infra/vast/health.sh` that pings all 4 vLLM endpoints and prints OK/FAIL.
   - Verify the `OPENAI_BASE_URL_*` env vars are written into the orchestrator's `.env` after `up_serve.sh` returns.

4. **Env wiring** (`.env.example` in repo root):
   - Document every env var needed (already listed in SPEC.md §15).
   - Provide a `cp .env.example .env && $EDITOR .env` flow.
   - Verify on a fresh checkout that running everything in order gets to a green smoke test.

5. **End-to-end smoke test** (`scripts/e2e_smoke.ts`):
   - Sends a fixture email to the orchestrator's webhook endpoint.
   - Asserts `session.end` event arrives with `ok=true` within 90s.
   - Asserts at least one `patch.applied` event fired.
   - Asserts share_url is set.
   - Asserts the bench result file populated by the orchestrator dispatcher matches the expected shape.
   - Run on every change in CI? Or at least via `bun run smoke` before the demo.

6. **Pre-demo checklist** (`PRE_DEMO.md`):
   - 30-step checklist the night before the hackathon. Includes: keys present, sources indexed, vast instances up, bench cached, cloudflared tunnel stable, plugin loaded in Studio, place reset works, demo mode on the wall works, fallback recorded video on disk.

## Hard rules

- **No new repo code outside `infra/`, `scripts/e2e_smoke.ts`, `.env.example`, `PRE_DEMO.md`.** Do not edit `packages/`.
- **Idempotent scripts.** Running `up_train.sh` twice should not create two instances; check `.vast-state.json` first.
- **Fail-fast.** If any step in `e2e_smoke.ts` fails, exit 1 with the failing step name in the error message.
- **No secrets in any committed file.** `.env` and `.vast-state.json` stay gitignored (already done).
- **All scripts are POSIX bash + Python 3.11+ + Bun.** No PowerShell, no Windows-isms (the user is on Windows but scripts run via bash).

## Failure mode you must prevent

The single biggest demo-killer is "the AgentMail webhook works at H-12 but expires at H+2 because the tunnel rotated." Mitigate by: (a) using a stable cloudflared named tunnel, not the default ephemeral; (b) `e2e_smoke.ts` re-tests the public webhook URL specifically, not just localhost; (c) `PRE_DEMO.md` step "test the webhook from your phone hotspot, not the venue WiFi."

## Done criteria

- `bun run smoke` returns 0 with all assertions green
- AgentMail webhook live, signed, accepting traffic from public internet
- 2 Nia sources `status: ready`, sample query returns relevant chunks
- 1 Vast 4×A100 SXM serving instance live, all 4 endpoints respond to `/v1/models`
- `.env` documented and complete
- `PRE_DEMO.md` reviewed and ticked through

Without your work the demo doesn't happen. Bias toward boring, reliable, dogfood-tested infra over clever automation.

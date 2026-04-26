# Kickoff prompt — Codex (Studio Bridge upgrade + Cybus Chat plugin upgrade + place-reset)

You own the **Roblox-side integration** for `cybus-arcade`. Read `SPEC.md` first, especially §7 (baseplate reset) and §8 (Cybus Chat plugin upgrade). Your scope is in the **separate** `roblox-studio-mcp/` repo at `C:/Users/sarta/roblox-studio-mcp/`, NOT in `cybus-arcade/`. You modify the existing Studio Bridge server + Studio plugin to support the new event protocol.

## Scope

1. **Studio Bridge server** (`roblox-studio-mcp/packages/server/src/`):
   - Add `POST /dispatch` endpoint that accepts `{sid, action, payload}` from cybus-arcade orchestrator and queues it for the long-poll plugin to fetch.
   - Add `GET /result/:sid` long-poll endpoint that the orchestrator hits to get apply-patch results back.
   - Add forwarding of all events from the plugin to a websocket clients endpoint at `GET /events?sid=...` — this lets the cybus-arcade wall subscribe to a single Studio session's stream.

2. **Cybus Studio Worker** (`roblox-studio-mcp/packages/plugin/`):
   - Implement `place_reset` action: Workspace cleanup + baseplate restore (exact Lua snippet is in `cybus-arcade/SPEC.md` §7). Call from the action dispatcher when payload kind is `reset`.
   - Implement `apply_patches`: iterate the patch array, route to `create_part` / `create_script` / `create_instance` / `set_property` handlers (most exist already). Return success/error.
   - Implement `snapshot`: return current Workspace state as the structured `state` object Designer expects (see `prompts/designer.md` for schema).

3. **Cybus Chat plugin UI** (`roblox-studio-mcp/packages/plugin/MainController.lua` and friends):
   - Add session header rendering: `📧 from <user> — <subject>`
   - Add per-agent thread grouping: each agent's events (`agent.thinking`, `agent.tool_call`, `agent.result`) collapse under that agent's row inside the session.
   - Add icons + colors per agent: 🧭 Scheduler (cyan), 📚 Indexer (yellow), 🔨 Builder (orange), 🐛 Debugger (red), 🎨 Designer (magenta).
   - Add a "🧹 reset" line at the top of every new session.
   - Existing manual chat input stays as a fallback.

## Hard rules

- **Backward compatible.** Existing plugin behavior with manual chat input must keep working. Don't break Cybus v6 deployments.
- **Long-poll port 38080 stays the contract.** Don't switch to ws/sse — the plugin's HttpService implementation depends on long-poll.
- **No external Lua deps.** Everything ships in the existing plugin bundle.
- **Place reset must be idempotent and < 200 ms.** Test with 10 rapid resets in a row.
- **No `loadstring`, no `getfenv`, no `_G`.** The cybus runtime sandbox rejects them.
- **Anchored = true** on every Part the worker creates unless the patch explicitly sets `Anchored: false`.
- **Patches that target classes outside the allowed set must be rejected with a clear error**, not silently dropped. Allowed classes are listed in `cybus-arcade/scripts/synth_gen.py:MockEnv.allowed_classes`.

## Done criteria

- Orchestrator can `POST /dispatch {action:'reset'}` and within 1s the place is back to baseplate
- Orchestrator can `POST /dispatch {action:'apply_patches', payload:[...]}` and get success/error in `GET /result/:sid` within 5s
- Orchestrator can `POST /dispatch {action:'snapshot'}` and get back a state object matching Designer's input schema
- Plugin UI shows 5-agent threaded view with icons when events flow through
- Manual chat input still works when no orchestrator is connected
- Existing roblox-studio-mcp test suite still passes (`pnpm test`)

## Order of work

1. Add `/dispatch` and `/result/:sid` to the server first. Mock plugin behavior with a hardcoded responder until plugin work catches up.
2. Plugin: place reset action.
3. Plugin: apply_patches dispatcher (most code paths exist; add the `create_part` and `set_property` paths if missing).
4. Plugin: snapshot serializer.
5. Plugin UI: per-agent thread grouping (~80 lines added across MainController + MessageRow).
6. Wire the cybus-arcade orchestrator's `studio_bridge.ts` (Claude #1 owns that file) by giving them the curl examples in your README updates.

Commit on the `cybus-arcade-integration` branch in `roblox-studio-mcp`. Don't merge to main without sign-off.

import type { SessionId } from "../../core/src/index.ts";

const BRIDGE = process.env.STUDIO_BRIDGE_URL ?? "http://localhost:38081";

interface DispatchResult { ok: boolean; data?: unknown; error?: string }

async function dispatch(sid: SessionId, action: string, payload: unknown): Promise<DispatchResult> {
  // wait:false → bridge enqueues the command for the Studio plugin to long-poll.
  // We treat a 200/202 receipt as "applied" optimistically; orchestrator continues.
  // Real apply-result is mirrored via /result/:sid which the wall can subscribe to.
  try {
    const r = await fetch(`${BRIDGE}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid, action, payload, wait: false }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { ok: false, error: `${r.status} ${await r.text()}` };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const studio = {
  reset: (sid: SessionId) => dispatch(sid, "reset", {}),
  applyPatches: (sid: SessionId, patches: unknown[]) => dispatch(sid, "apply_patches", patches),
  snapshot: (sid: SessionId) => dispatch(sid, "snapshot", {}),
};

export function shareUrl(): string {
  return process.env.ROBLOX_SHARE_URL ?? "https://www.roblox.com/games/0/cybus-arcade";
}

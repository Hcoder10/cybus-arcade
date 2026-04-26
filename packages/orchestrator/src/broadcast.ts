import type { Event } from "../../core/src/index.ts";
import { recordEvent } from "./db.ts";

const clients = new Set<{ send(s: string): void; close?(): void }>();
const BRIDGE = (process.env.STUDIO_BRIDGE_URL ?? "http://localhost:38081").replace(/\/+$/, "");

export function addClient(c: { send(s: string): void }) { clients.add(c); }
export function removeClient(c: { send(s: string): void }) { clients.delete(c); }

export function emit(e: Event) {
  recordEvent(e);
  const s = JSON.stringify(e);
  for (const c of clients) {
    try { c.send(s); } catch { /* noop */ }
  }
  fetch(`${BRIDGE}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: e, sid: e.sid }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

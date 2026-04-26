/// <reference types="vite/client" />
import type { Event } from "../../core/src/index.ts";
import { applyEvent } from "./store";
import { startMock } from "./mock";

const URL = (import.meta.env.VITE_WS_URL as string) || "ws://localhost:8787/events";

export function connect() {
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") { startMock(); return; }
  let backoff = 1000;
  const attempt = () => {
    const ws = new WebSocket(URL);
    ws.onopen    = () => { backoff = 1000; console.log("[ws] connected"); };
    ws.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as Event;
        if ((e as any).t === "hello") return;
        applyEvent(e);
      } catch { /* noop */ }
    };
    ws.onclose = () => {
      console.warn("[ws] closed, reconnect in", backoff);
      setTimeout(attempt, backoff);
      backoff = Math.min(backoff * 2, 15000);
    };
    ws.onerror = () => ws.close();
  };
  attempt();
}

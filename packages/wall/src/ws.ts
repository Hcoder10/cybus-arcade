/// <reference types="vite/client" />
import type { Event } from "../../core/src/index.ts";
import { applyEvent } from "./store";
import { startMock } from "./mock";

const URL = (import.meta.env.VITE_WS_URL as string) || "ws://localhost:8787/events";

export function connect(): () => void {
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") {
    startMock();
    return () => {};
  }

  let backoff = 1000;
  let closed = false;
  let ws: WebSocket | null = null;
  let timer: number | undefined;

  const attempt = () => {
    if (closed) return;
    ws = new WebSocket(URL);
    ws.onopen = () => { backoff = 1000; };
    ws.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as Event | { t?: string };
        if (e.t === "hello") return;
        applyEvent(e as Event);
      } catch {
        return;
      }
    };
    ws.onclose = () => {
      if (closed) return;
      timer = window.setTimeout(attempt, backoff);
      backoff = Math.min(backoff * 2, 15000);
    };
    ws.onerror = () => ws?.close();
  };

  attempt();
  return () => {
    closed = true;
    if (timer) window.clearTimeout(timer);
    ws?.close();
  };
}

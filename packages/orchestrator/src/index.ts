import { Hono } from "hono";
import { handleWebhook } from "./webhook.ts";
import { addClient, removeClient } from "./broadcast.ts";
import { startConsumer } from "./queue.ts";
import { db } from "./db.ts";

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, ts: Date.now() }));
app.post("/webhook/agentmail", handleWebhook);

app.get("/sessions/:sid/events", (c) => {
  const rows = db.prepare("SELECT t, agent, payload, ts FROM events WHERE sid=? ORDER BY ts ASC").all(c.req.param("sid"));
  return c.json(rows);
});

const PORT = parseInt(process.env.PORT ?? "8787", 10);

startConsumer();

Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/events") {
      if (server.upgrade(req)) return undefined;
      return new Response("ws upgrade required", { status: 426 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) { addClient(ws as any); ws.send(JSON.stringify({ t: "hello" })); },
    close(ws) { removeClient(ws as any); },
    message() { /* clients are read-only */ },
  },
});

console.log(`[orchestrator] up on :${PORT}`);
console.log(`  webhook:  POST /webhook/agentmail`);
console.log(`  ws:       GET /events`);
console.log(`  health:   GET /healthz`);

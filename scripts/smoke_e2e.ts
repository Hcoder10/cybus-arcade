// End-to-end smoke: fire a fake AgentMail webhook into the local orchestrator,
// assert a session.end event arrives within 90s, print summary.
//
// Pre-req: orchestrator running on $PORT (default 8787) with all OPENAI_BASE_URL_*
//          env vars pointing at the live vast serve fleet.
//
// Usage:  bun run scripts/smoke_e2e.ts

const PORT = parseInt(process.env.PORT ?? "8787", 10);
const URL = `http://localhost:${PORT}`;
const TIMEOUT_MS = 360_000;

async function main() {
  // 1. health
  const h = await fetch(`${URL}/healthz`).then(r => r.ok).catch(() => false);
  if (!h) { console.error("orchestrator not healthy"); process.exit(1); }
  console.log("[1/4] orchestrator /healthz OK");

  // 2. fire webhook
  const subject = "tower defense with three enemy types and a final boss";
  const body = "Build a Roblox tower defense game with three enemy types and a final boss. The boss should be intimidating.";
  const res = await fetch(`${URL}/webhook/agentmail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_type: "message.received",
      data: {
        from: "smoke@local.test",
        subject, extracted_text: body,
        message_id: "<smoke-001@local>",
        inbox_id: "cybus-arcade@agentmail.to",
      },
    }),
  });
  const j = await res.json().catch(() => null) as any;
  if (!j?.sid) { console.error("webhook did not return sid", j); process.exit(2); }
  const sid = j.sid as string;
  console.log(`[2/4] webhook accepted, sid=${sid}`);

  // 3. open ws and watch for session.end
  console.log("[3/4] opening ws and waiting for session.end...");
  const ws = new WebSocket(`ws://localhost:${PORT}/events`);
  const seen: string[] = [];
  let done = false;
  let ok = false;
  let shareUrl: string | undefined;
  let iters = 0;
  let ms = 0;
  const t0 = Date.now();

  const close = () => { try { ws.close(); } catch {} };

  ws.addEventListener("message", (m: MessageEvent) => {
    let e: any; try { e = JSON.parse(m.data as string); } catch { return; }
    if ((e as any).t === "hello") return;
    if (e.sid === sid) {
      seen.push(`${e.t}${e.agent ? `:${e.agent}` : ""}`);
      if (e.t === "session.end") {
        done = true; ok = !!e.ok; shareUrl = e.share_url; iters = e.iters; ms = e.ms;
        close();
      }
    }
  });

  await new Promise<void>(resolve => {
    const t = setInterval(() => {
      if (done) { clearInterval(t); resolve(); return; }
      if (Date.now() - t0 > TIMEOUT_MS) {
        console.error(`[fail] timeout after ${TIMEOUT_MS / 1000}s`);
        console.error("events seen:", seen.join(", "));
        clearInterval(t); resolve();
      }
    }, 500);
  });

  if (!done) { close(); process.exit(3); }

  console.log(`[4/4] session.end ok=${ok} iters=${iters} ms=${ms}`);
  console.log(`     share_url: ${shareUrl}`);
  console.log(`     events:    ${seen.join(", ")}`);
  if (!ok) process.exit(4);
}

main().catch(e => { console.error(e); process.exit(99); });

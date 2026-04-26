import type { Context } from "hono";
import { Webhook, WebhookVerificationError } from "svix";
import { enqueue } from "./db.ts";
import type { Job } from "../../core/src/index.ts";

const SECRET = process.env.AGENTMAIL_WEBHOOK_SECRET ?? "";
const wh = SECRET ? new Webhook(SECRET) : null;

function nanoid(n = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function handleWebhook(c: Context): Promise<Response> {
  const raw = await c.req.text();
  let payload: any;
  if (wh) {
    try {
      payload = wh.verify(raw, Object.fromEntries(c.req.raw.headers));
    } catch (e) {
      if (e instanceof WebhookVerificationError) return c.text("bad signature", 400);
      throw e;
    }
  } else {
    payload = JSON.parse(raw);
    console.warn("[webhook] AGENTMAIL_WEBHOOK_SECRET unset — accepting unsigned payload (dev only)");
  }
  if (payload.event_type !== "message.received") return c.text("ignored", 202);
  const d = payload.data ?? {};
  const job: Job = {
    sid: `s_${nanoid(10)}`,
    from: d.from ?? "unknown@unknown",
    subject: d.subject ?? "(no subject)",
    body: d.extracted_text ?? d.text ?? d.body ?? "",
    receivedAt: Date.now(),
  };
  enqueue(job);
  return c.json({ ok: true, sid: job.sid });
}

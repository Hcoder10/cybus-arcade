import { pullPending, finishJob } from "./db.ts";
import { runPipeline } from "./dispatcher.ts";

let running = false;

export function startConsumer(intervalMs = 1500) {
  if (running) return;
  running = true;
  const tick = async () => {
    while (running) {
      const job = pullPending();
      if (!job) { await Bun.sleep(intervalMs); continue; }
      try { await runPipeline(job); }
      catch (e) { console.error("[queue] pipeline crash", job.sid, e); }
      finally { finishJob(job.sid); }
    }
  };
  void tick();
}

export function stopConsumer() { running = false; }

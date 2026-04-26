import type { Event, Job, SessionId, AgentId } from "../../core/src/index.ts";
import { emit } from "./broadcast.ts";
import { plan, type SchedulerPlan } from "./agents/scheduler.ts";
import { index, type IndexerOutput } from "./agents/indexer.ts";
import { build, type BuilderOutput } from "./agents/builder.ts";
import { fix, type DebuggerOutput } from "./agents/debugger.ts";
import { critique } from "./agents/designer.ts";
import { curate } from "./agents/curator.ts";
import { ingestToNia } from "./tools/nia_ingest.ts";
import { studio, shareUrl } from "./studio_bridge.ts";

const MAX_DEBUG = 3;

function ev(e: Event) { emit(e); }

function summarize(o: unknown, n = 100): string {
  return JSON.stringify(o).slice(0, n);
}

export async function runPipeline(job: Job): Promise<{ ok: boolean; share_url?: string; ms: number; iters: number; state: unknown }> {
  const t0 = Date.now();
  let iters = 0;
  ev({ t: "session.start", sid: job.sid, from: job.from, subject: job.subject, body: job.body, ts: t0 });

  // 1. Reset place
  const reset = await studio.reset(job.sid);
  ev({ t: "place.reset", sid: job.sid });
  if (!reset.ok) console.warn("[dispatcher] reset failed:", reset.error);

  // 2. Scheduler
  ev({ t: "agent.thinking", sid: job.sid, agent: "scheduler", tokens: "decomposing request…" });
  const planObj: SchedulerPlan = await plan(job.body);
  ev({ t: "agent.result", sid: job.sid, agent: "scheduler", ok: true, summary: `${planObj.subtasks.length} subtasks (${planObj.genre})` });

  const indexCache: Record<string, IndexerOutput> = {};
  let lastIndexer: IndexerOutput | null = null;

  // 3. Walk subtasks in order (depends_on assumed pre-sorted; trust scheduler)
  for (const sub of planObj.subtasks) {
    iters++;
    if (sub.agent === "indexer") {
      ev({ t: "agent.thinking", sid: job.sid, agent: "indexer", tokens: `searching: ${sub.instruction.slice(0, 80)}` });
      try {
        const out = await index(sub);
        indexCache[sub.id] = out;
        lastIndexer = out;
        for (const q of out.queries_issued) {
          ev({ t: "agent.tool_call", sid: job.sid, agent: "indexer", tool: "nia_search", args: { q } });
        }
        ev({ t: "agent.result", sid: job.sid, agent: "indexer", ok: true, summary: `${out.chunks.length} chunks, ${out.queries_issued.length} queries` });
      } catch (e) {
        ev({ t: "agent.result", sid: job.sid, agent: "indexer", ok: false, summary: String(e).slice(0, 120) });
      }

    } else if (sub.agent === "builder") {
      ev({ t: "agent.thinking", sid: job.sid, agent: "builder", tokens: sub.instruction.slice(0, 100) });
      let last: BuilderOutput | null = null;
      try {
        last = await build(sub, lastIndexer);
      } catch (e) {
        ev({ t: "agent.result", sid: job.sid, agent: "builder", ok: false, summary: String(e).slice(0, 120) });
        continue;
      }
      if (!last) { ev({ t: "agent.result", sid: job.sid, agent: "builder", ok: false, summary: "parse fail" }); continue; }

      // apply, debug-loop on error
      let attempt = 0;
      while (attempt <= MAX_DEBUG) {
        const r = await studio.applyPatches(job.sid, last.patches);
        if (r.ok) {
          ev({ t: "patch.applied", sid: job.sid, lines: last.patches.length, files: last.patches.map((p: any) => p.name ?? p.target_path ?? "?") });
          ev({ t: "agent.result", sid: job.sid, agent: "builder", ok: true, summary: last.explain });
          break;
        }
        const errTrace = r.error ?? "unknown studio error";
        ev({ t: "studio.error", sid: job.sid, trace: errTrace });
        if (attempt === MAX_DEBUG) {
          ev({ t: "agent.result", sid: job.sid, agent: "debugger", ok: false, summary: "max retries" });
          break;
        }
        ev({ t: "agent.thinking", sid: job.sid, agent: "debugger", tokens: errTrace.slice(0, 100) });
        const dbg: DebuggerOutput | null = await fix(sub.id, errTrace, last).catch(() => null);
        if (!dbg) { ev({ t: "agent.result", sid: job.sid, agent: "debugger", ok: false, summary: "parse fail" }); break; }
        ev({ t: "agent.result", sid: job.sid, agent: "debugger", ok: true, summary: dbg.root_cause });
        last = { subtask_id: sub.id, patches: dbg.patches, explain: dbg.explain };
        attempt++;
        iters++;
      }

    } else if (sub.agent === "designer") {
      const snap = await studio.snapshot(job.sid);
      const state = snap.ok ? snap.data : {};
      ev({ t: "agent.thinking", sid: job.sid, agent: "designer", tokens: "evaluating game feel…" });
      const crit = await critique({
        session_subject: job.subject,
        genre_inferred: planObj.genre,
        state,
      }).catch(() => null);
      if (!crit) { ev({ t: "agent.result", sid: job.sid, agent: "designer", ok: false, summary: "parse fail" }); continue; }
      ev({ t: "critique", sid: job.sid, text: crit.critique, patch_lines: crit.patch.length });
      const r = await studio.applyPatches(job.sid, crit.patch);
      ev({ t: "agent.result", sid: job.sid, agent: "designer", ok: r.ok, summary: r.ok ? "polish applied" : (r.error ?? "apply failed").slice(0, 120) });
    }
  }

  // 4. Final snapshot for state return
  const final = await studio.snapshot(job.sid);
  const ms = Date.now() - t0;
  const url = shareUrl();
  ev({ t: "session.end", sid: job.sid, ok: true, share_url: url, iters, ms });

  // 5. Curate + ingest into Nia for future retrieval — fire-and-forget, don't block return
  void (async () => {
    try {
      const stateAny: any = final.data ?? {};
      const md = await curate({
        session_subject: job.subject,
        session_prompt: job.body,
        genre_inferred: planObj.genre,
        iters, ms,
        state: stateAny,
        scripts: stateAny?.scripts ?? [],
        designer_critique: stateAny?.last_critique ?? "",
        designer_patches_summary: stateAny?.last_critique_patches_summary ?? "",
      });
      if (!md) return;
      const title = `${planObj.title || job.subject || "untitled"}`;
      const r = await ingestToNia(title, md);
      if (r.ok && r.source_id) {
        ev({ t: "nia.indexed", sid: job.sid, title, source_id: r.source_id, gist_url: r.gist_url });
      } else {
        console.warn("[curator/ingest] failed:", r.error);
      }
    } catch (e) {
      console.warn("[curator/ingest] crashed:", String(e).slice(0, 160));
    }
  })();

  return { ok: true, share_url: url, ms, iters, state: final.data ?? {} };
}

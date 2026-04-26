import { applyEvent } from "./store";
import type { Event } from "../../core/src/index.ts";

type DistributedOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type Step = DistributedOmit<Event, "sid"> & { delay: number };

const SCRIPTS: Step[][] = [
  [
    { delay: 0,    t: "session.start", from: "judge@anthropic.com", subject: "tower defense with a final boss", body: "tower defense with a final boss", ts: Date.now() },
    { delay: 400,  t: "place.reset" },
    { delay: 200,  t: "agent.thinking", agent: "scheduler", tokens: "decomposing into 6 subtasks…" },
    { delay: 1100, t: "agent.result",   agent: "scheduler", ok: true, summary: "6 subtasks (tower_defense)" },
    { delay: 200,  t: "agent.thinking", agent: "indexer",   tokens: "Roblox waypoint follow + RemoteEvent patterns" },
    { delay: 600,  t: "agent.tool_call", agent: "indexer", tool: "nia_search", args: { q: "Humanoid:MoveTo waypoints" } },
    { delay: 800,  t: "agent.result",   agent: "indexer", ok: true, summary: "8 chunks, 3 queries" },
    { delay: 200,  t: "agent.thinking", agent: "builder",   tokens: "spawning enemies + path-follow logic" },
    { delay: 1500, t: "patch.applied",  lines: 14, files: ["EnemySpawner","PathFollow","TowerLogic"] },
    { delay: 200,  t: "agent.result",   agent: "builder", ok: true, summary: "core loop online" },
    { delay: 400,  t: "studio.error",   trace: "attempt to index nil with 'Humanoid'" },
    { delay: 600,  t: "agent.result",   agent: "debugger", ok: true, summary: "missing :WaitForChild" },
    { delay: 1200, t: "patch.applied",  lines: 1, files: ["EnemySpawner"] },
    { delay: 800,  t: "agent.thinking", agent: "designer",  tokens: "boss reads as a red cube — too small, no atmosphere" },
    { delay: 1100, t: "critique", text: "Boss too small. Lighting is flat noon. No audio = sterile.", patch_lines: 5 },
    { delay: 600,  t: "agent.result",   agent: "designer", ok: true, summary: "polish applied" },
    { delay: 400,  t: "session.end", ok: true, share_url: "https://www.roblox.com/games/0/cybus-arcade", iters: 7, ms: 88_000 },
  ],
];

function genSid() { return "demo_" + Math.random().toString(36).slice(2, 8); }

export function startMock() {
  console.log("[mock] demo mode on");
  let i = 0;
  const runOne = async () => {
    const sid = genSid();
    const seq = SCRIPTS[i % SCRIPTS.length]!;
    i++;
    for (const ev of seq) {
      await new Promise((r) => setTimeout(r, ev.delay));
      const out = { ...ev, sid } as unknown as Event;
      delete (out as any).delay;
      applyEvent(out);
    }
    setTimeout(runOne, 2000);
  };
  void runOne();
}

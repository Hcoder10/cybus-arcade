import { SYSTEM, MODEL, schedClient, tryParseJSON } from "./common.ts";

export interface SchedulerSubtask {
  id: string;
  depends_on: string[];
  agent: "indexer" | "builder" | "designer";
  instruction: string;
  expects: "api_chunks" | "luau_patch" | "critique_patch";
}

export interface SchedulerPlan {
  title: string;
  genre: string;
  subtasks: SchedulerSubtask[];
}

const FALLBACK: SchedulerPlan = {
  title: "Default Obby",
  genre: "obby",
  subtasks: [
    { id: "docs", depends_on: [], agent: "indexer", instruction: "Roblox checkpoint patterns and SpawnLocation usage", expects: "api_chunks" },
    { id: "core", depends_on: ["docs"], agent: "builder", instruction: "Build a 6-stage obby with checkpoints and a finish line", expects: "luau_patch" },
    { id: "polish", depends_on: ["core"], agent: "designer", instruction: "Critique and polish game feel", expects: "critique_patch" },
  ],
};

export async function plan(prompt: string): Promise<SchedulerPlan> {
  try {
    const r = await schedClient.chat.completions.create({
      model: MODEL.sched,
      max_tokens: 8000,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM.scheduler },
        { role: "user", content: prompt },
      ],
    });
    const txt = r.choices[0]?.message?.content ?? "";
    const parsed = tryParseJSON<SchedulerPlan>(txt);
    if (!parsed || !Array.isArray(parsed.subtasks)) return FALLBACK;
    return parsed;
  } catch (e) {
    console.warn("[scheduler] error, using fallback", e);
    return FALLBACK;
  }
}

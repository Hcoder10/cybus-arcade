import { SYSTEM, MODEL, builderClient, tryParseJSON } from "./common.ts";
import type { BuilderOutput, Patch } from "./builder.ts";

export interface DebuggerOutput {
  subtask_id: string;
  patches: Patch[];
  explain: string;
  root_cause: string;
}

export async function fix(subtaskId: string, errorTrace: string, lastPatch: BuilderOutput): Promise<DebuggerOutput | null> {
  const r = await builderClient.chat.completions.create({
    model: MODEL.builder,
    max_tokens: 8000,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM.debugger },
      { role: "user", content: JSON.stringify({ subtask_id: subtaskId, error: errorTrace, last_patch: lastPatch }) },
    ],
  });
  return tryParseJSON<DebuggerOutput>(r.choices[0]?.message?.content ?? "");
}

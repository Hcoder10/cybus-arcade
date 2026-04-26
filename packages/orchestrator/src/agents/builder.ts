import { SYSTEM, MODEL, builderClient, tryParseJSON } from "./common.ts";
import type { IndexerOutput } from "./indexer.ts";

export interface Patch {
  kind: "create_script" | "create_part" | "create_instance" | "set_property";
  [k: string]: unknown;
}

export interface BuilderOutput {
  subtask_id: string;
  patches: Patch[];
  explain: string;
}

export async function build(subtask: { id: string; instruction: string }, refs: IndexerOutput | null): Promise<BuilderOutput | null> {
  const userPayload = {
    subtask,
    refs: refs?.chunks?.slice(0, 5) ?? [],
  };
  const r = await builderClient.chat.completions.create({
    model: MODEL.builder,
    max_tokens: 8000,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM.builder },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });
  return tryParseJSON<BuilderOutput>(r.choices[0]?.message?.content ?? "");
}

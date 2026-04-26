import { SYSTEM, MODEL, designerClient, tryParseJSON } from "./common.ts";
import type { Patch } from "./builder.ts";

export interface DesignerOutput {
  critique: string;
  patch: Patch[];
  rationale: string;
  skip_if?: string | null;
}

export async function critique(input: { session_subject: string; genre_inferred: string; state: unknown; screenshot_url?: string }): Promise<DesignerOutput | null> {
  const r = await designerClient.chat.completions.create({
    model: MODEL.designer,
    max_tokens: 8000,
    temperature: 0.4,
    messages: [
      { role: "system", content: SYSTEM.designer },
      { role: "user", content: JSON.stringify(input) },
    ],
  });
  return tryParseJSON<DesignerOutput>(r.choices[0]?.message?.content ?? "");
}

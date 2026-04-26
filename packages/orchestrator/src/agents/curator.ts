import OpenAI from "openai";
import { SYSTEM as _SYS } from "./common.ts";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..", "..", "..");
const CURATOR_PROMPT = readFileSync(resolve(ROOT, "prompts/curator.md"), "utf8");

// Curator runs on the same sched/idx endpoint (port 8002) but uses BASE Qwen3.5-9B,
// no LoRA — task is mechanical formatting and base model handles it cleanly.
const curatorClient = new OpenAI({
  apiKey: "EMPTY",
  baseURL: process.env.OPENAI_BASE_URL_CURATOR ?? process.env.OPENAI_BASE_URL_SCHED ?? "http://localhost:8002/v1",
});

const MODEL = process.env.MODEL_CURATOR ?? "Qwen/Qwen3.5-9B";

export interface CuratorInput {
  session_subject: string;
  session_prompt: string;
  genre_inferred: string;
  iters: number;
  ms: number;
  state: unknown;
  scripts: Array<{ path: string; class: string; source: string }>;
  designer_critique: string;
  designer_patches_summary: string;
}

export async function curate(input: CuratorInput): Promise<string | null> {
  try {
    const r = await curatorClient.chat.completions.create({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0.3,
      messages: [
        { role: "system", content: CURATOR_PROMPT },
        { role: "user", content: JSON.stringify(input) },
      ],
    });
    return r.choices[0]?.message?.content ?? null;
  } catch (e) {
    console.warn("[curator] failed:", String(e).slice(0, 160));
    return null;
  }
}

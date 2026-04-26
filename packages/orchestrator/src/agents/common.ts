import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..", "..", "..");

export const SYSTEM = {
  scheduler: readFileSync(resolve(ROOT, "prompts/scheduler.md"), "utf8"),
  indexer:   readFileSync(resolve(ROOT, "prompts/indexer.md"), "utf8"),
  builder:   readFileSync(resolve(ROOT, "prompts/builder.md"), "utf8"),
  debugger:  readFileSync(resolve(ROOT, "prompts/debugger.md"), "utf8"),
  designer:  readFileSync(resolve(ROOT, "prompts/designer.md"), "utf8"),
};

const apiKey = "EMPTY"; // vLLM OpenAI server doesn't need a real key

// Builder runs on TWO endpoints (one model per A100 GPU) so the multi-agent
// loop can fan out parallel build/debug calls. Round-robin per call.
const builderUrls = (process.env.OPENAI_BASE_URL_BUILDER ?? "http://localhost:8001/v1,http://localhost:8011/v1")
  .split(",").map(s => s.trim()).filter(Boolean);
const builderPool = builderUrls.map(u => new OpenAI({ apiKey, baseURL: u }));
let builderRR = 0;
export const builderClient = new Proxy({} as OpenAI, {
  get(_t, prop) {
    const c = builderPool[builderRR % builderPool.length]!;
    builderRR++;
    return (c as any)[prop];
  },
});

export const schedClient     = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL_SCHED     ?? "http://localhost:8002/v1" });
export const indexerClient   = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL_INDEXER   ?? "http://localhost:8002/v1" });
export const designerClient  = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL_DESIGNER  ?? "http://localhost:8004/v1" });

export const MODEL = {
  builder:  process.env.MODEL_BUILDER  ?? "cybus-builder",  // LoRA name registered on builder endpoints
  sched:    process.env.MODEL_SCHED    ?? "cybus-arcade-scheduler-lora",
  indexer:  process.env.MODEL_INDEXER  ?? "cybus-arcade-indexer-lora",
  designer: process.env.MODEL_DESIGNER ?? "Qwen/Qwen3.5-27B",
};

export function tryParseJSON<T = unknown>(s: string): T | null {
  // tolerate JSON with surrounding fences / leading text
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

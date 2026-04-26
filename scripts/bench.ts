// Head-to-head bench: cybus-arcade fleet vs Claude Opus 4.6 single-shot.
// Runs 10 fixed Roblox prompts through both pipelines, scores each on
// build_health (boots, no errors), visual_usability (Designer judge),
// intent_alignment (Designer judge). Caches results in datasets/bench_results.json.
//
// Usage: bun run scripts/bench.ts

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { writeFileSync, readFileSync } from "node:fs";
import { runPipeline } from "../packages/orchestrator/src/dispatcher.ts";
import type { BenchRow } from "../packages/core/src/index.ts";

const PROMPTS = [
  "tower defense with 3 enemy types and a final boss",
  "obby with 8 stages, the last one is a maze",
  "racing game with 4 cars on an oval track",
  "fps where bullets bounce off walls",
  "sandbox where players spawn cubes by clicking",
  "party game: last one standing on the shrinking platform wins",
  "rpg with 3 classes, hp bars, and an xp system",
  "horror game with one monster that hunts the player in fog",
  "puzzle where you push blocks onto pressure plates",
  "platformer where you can stop time briefly",
];

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function opusSingleShot(prompt: string) {
  const t0 = Date.now();
  const sys = readFileSync("prompts/builder.md", "utf8");
  const m = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8000,
    system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Build a Roblox game: ${prompt}` }],
  });
  const text = (m.content[0] as any).text ?? "";
  let parsed: any = null;
  try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch {}
  return { ok: !!parsed?.patches, raw: parsed, ms: Date.now() - t0 };
}

async function judgeWithDesigner(state: unknown, prompt: string) {
  const designer = new OpenAI({
    apiKey: "EMPTY",
    baseURL: process.env.OPENAI_BASE_URL_DESIGNER!,
  });
  const r = await designer.chat.completions.create({
    model: "cybus-arcade-designer-lora",
    max_tokens: 600,
    messages: [
      { role: "system", content: "You are a Roblox game judge. Output JSON: {build_health:0-10, visual_usability:0-10, intent_alignment:0-10}" },
      { role: "user", content: `Prompt: ${prompt}\nGame state:\n${JSON.stringify(state).slice(0, 6000)}` },
    ],
  });
  const txt = r.choices[0].message.content ?? "{}";
  try {
    const o = JSON.parse(txt.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return ((o.build_health ?? 0) + (o.visual_usability ?? 0) + (o.intent_alignment ?? 0)) / 3;
  } catch { return 0; }
}

async function main() {
  const rows: BenchRow[] = [];
  for (const p of PROMPTS) {
    console.log(`\n→ ${p}`);
    const [ours, opus] = await Promise.all([
      runPipeline({ from: "bench@local", subject: "bench", body: p })
        .catch(e => ({ score: 0, ms: 0, ok: false, state: { error: String(e) } })),
      opusSingleShot(p)
        .catch(e => ({ ok: false, raw: { error: String(e) }, ms: 0 })),
    ]);
    const oursScore = await judgeWithDesigner(ours.state ?? ours, p).catch(() => 0);
    const opusScore = await judgeWithDesigner(opus.raw ?? opus, p).catch(() => 0);
    rows.push({
      prompt: p,
      ours: { score: oursScore, ms: ours.ms ?? 0, ok: ours.ok ?? false },
      opus: { score: opusScore, ms: opus.ms ?? 0, ok: opus.ok ?? false },
      winner: oursScore > opusScore + 0.5 ? "ours" :
              opusScore > oursScore + 0.5 ? "opus" : "tie",
    });
    console.log(`  ours=${oursScore.toFixed(1)}/10 (${(ours.ms/1000).toFixed(1)}s) ` +
                `vs opus=${opusScore.toFixed(1)}/10 (${(opus.ms/1000).toFixed(1)}s) ` +
                `→ ${rows.at(-1)!.winner}`);
  }
  writeFileSync("datasets/bench_results.json", JSON.stringify(rows, null, 2));
  const oursWins = rows.filter(r => r.winner === "ours").length;
  const opusWins = rows.filter(r => r.winner === "opus").length;
  console.log(`\n=== final ===  ours ${oursWins}  /  opus ${opusWins}  /  tie ${rows.length - oursWins - opusWins}`);
}

main().catch(e => { console.error(e); process.exit(1); });

import { SYSTEM, MODEL, indexerClient, tryParseJSON } from "./common.ts";
import { niaSearch } from "../tools/nia.ts";

export interface IndexerOutput {
  subtask_id: string;
  queries_issued: string[];
  chunks: Array<{ title: string; source: string; snippet: string; why: string }>;
  warnings: string[];
}

export async function index(subtask: { id: string; instruction: string }): Promise<IndexerOutput> {
  let queries: string[];
  try {
    const r = await indexerClient.chat.completions.create({
      model: MODEL.indexer,
      max_tokens: 8000,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM.indexer },
        { role: "user", content: JSON.stringify(subtask) },
      ],
    });
    const out = tryParseJSON<IndexerOutput>(r.choices[0]?.message?.content ?? "");
    queries = out?.queries_issued?.slice(0, 4) ?? [];
  } catch {
    queries = [];
  }
  queries = [...new Set([subtask.instruction, ...queries])].slice(0, 4);
  if (queries.length === 1) queries.push(`${subtask.instruction} Roblox API example`);

  const warnings: string[] = [];
  const groups = await Promise.all(queries.map(async (q) => {
    try {
      const res = await niaSearch(q, "universal", 6);
      return res.results.slice(0, 3).map((r) => ({
        title: r.source.display_name,
        source: "creator-docs",
        snippet: r.content.slice(0, 600),
        why: `relevant to: ${q}`,
      }));
    } catch (e) {
      warnings.push(`nia query failed: ${q} (${String(e).slice(0, 80)})`);
      return [];
    }
  }));
  const chunks = groups.flat();
  return { subtask_id: subtask.id, queries_issued: queries, chunks: chunks.slice(0, 8), warnings };
}

// One-shot Nia ingest: pulls Roblox Creator Docs + the existing 428-chunk
// cybus RAG corpus into Nia as a "documentation" source. Indexer queries it.
//
// Usage: bun run scripts/index_corpus.ts

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const NIA = "https://apigcp.trynia.ai/v2";
const KEY = process.env.NIA_API_KEY!;
const H = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function createSource(body: object) {
  const r = await fetch(`${NIA}/sources`, {
    method: "POST", headers: H, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<{ id: string; status: string }>;
}

async function poll(id: string) {
  for (let i = 0; i < 240; i++) {
    const r = await fetch(`${NIA}/sources/${id}`, { headers: H });
    const s = await r.json() as any;
    if (s.status === "ready" || s.status === "failed") return s;
    if (i % 5 === 0) console.log(`  [${id}] ${s.status} (${(i*4)}s)`);
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error("indexing timeout");
}

async function main() {
  console.log("indexing Roblox Creator Docs site");
  const docs = await createSource({
    type: "documentation",
    url: "https://create.roblox.com/docs",
    only_main_content: true,
    max_depth: 3,
    check_llms_txt: true,
    display_name: "roblox-creator-docs",
  });
  console.log("indexing Roblox API reference");
  const api = await createSource({
    type: "documentation",
    url: "https://create.roblox.com/docs/reference/engine",
    only_main_content: true,
    max_depth: 3,
    display_name: "roblox-api-reference",
  });

  const cybusRag = resolve(process.env.HOME ?? "", "roblox-studio-mcp/packages/server/data/api_chunks.jsonl");
  if (existsSync(cybusRag)) {
    console.log(`uploading existing 428-chunk RAG from ${cybusRag}`);
    // Concat all chunks into a single .md file Nia can ingest as a research_paper.
    const chunks = readFileSync(cybusRag, "utf8")
      .split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean) as Array<{ title?: string; text: string }>;
    const md = chunks.map(c => `## ${c.title ?? ""}\n\n${c.text}\n`).join("\n---\n\n");
    // Nia accepts markdown via the documentation type with a data URL is not
    // supported; cleanest path: upload to a gist or s3, reference URL.
    // For hackathon, just print where to upload manually.
    console.log("[manual] upload this file as a Nia source:");
    console.log("  POST /sources {type:'documentation', url:'<your-gist-url>', display_name:'cybus-rag-428'}");
  } else {
    console.log(`[skip] cybus RAG not at ${cybusRag}`);
  }

  console.log("polling for ready");
  await Promise.all([poll(docs.id), poll(api.id)]);
  console.log("done. sources:");
  console.log(`  ${docs.id}  roblox-creator-docs`);
  console.log(`  ${api.id}   roblox-api-reference`);
}

main().catch(e => { console.error(e); process.exit(1); });

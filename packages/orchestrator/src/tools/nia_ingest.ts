// Ingest a curated markdown chunk into Nia as a documentation source so future
// Indexer queries surface it. Uses GitHub Gist as the URL host since Nia's
// /sources endpoint accepts a URL, not raw content.

const NIA_BASE = "https://apigcp.trynia.ai/v2";
const NIA_KEY = process.env.NIA_API_KEY!;
const GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";

interface IngestResult {
  ok: boolean;
  source_id?: string;
  gist_url?: string;
  error?: string;
}

async function createGist(filename: string, content: string): Promise<string | null> {
  if (!GH_TOKEN) {
    // fall back to anonymous gist via gist.githubusercontent? not feasible — return null
    return null;
  }
  try {
    const r = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: `cybus-arcade game knowledge: ${filename}`,
        public: true,
        files: { [filename]: { content } },
      }),
    });
    if (!r.ok) return null;
    const j = await r.json() as { html_url: string; files: Record<string, { raw_url: string }> };
    const f = Object.values(j.files)[0];
    return f?.raw_url ?? j.html_url;
  } catch { return null; }
}

export async function ingestToNia(title: string, markdown: string): Promise<IngestResult> {
  // Sanitize title for filename
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const filename = `cybus-${slug}-${Date.now()}.md`;

  // 1. Host on Gist
  const url = await createGist(filename, markdown);
  if (!url) {
    return { ok: false, error: "no GH_TOKEN — cannot host markdown for Nia ingestion" };
  }

  // 2. Tell Nia to ingest it as a documentation source
  try {
    const r = await fetch(`${NIA_BASE}/sources`, {
      method: "POST",
      headers: { Authorization: `Bearer ${NIA_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "documentation",
        url,
        only_main_content: true,
        max_depth: 1,
        display_name: `cybus-arcade: ${title}`,
      }),
    });
    if (!r.ok) return { ok: false, error: `nia /sources ${r.status}: ${await r.text()}` };
    const j = await r.json() as { id: string; status: string };
    return { ok: true, source_id: j.id, gist_url: url };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

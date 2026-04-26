const NIA_BASE = "https://apigcp.trynia.ai/v2";
const NIA_KEY = process.env.NIA_API_KEY ?? "";
const GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";

interface IngestResult {
  ok: boolean;
  source_id?: string;
  gist_url?: string;
  error?: string;
}

async function createGist(filename: string, content: string): Promise<string | null> {
  if (!GH_TOKEN) return null;
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
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const j = await r.json() as { html_url: string; files: Record<string, { raw_url: string }> };
    const f = Object.values(j.files)[0];
    return f?.raw_url ?? j.html_url;
  } catch {
    return null;
  }
}

export async function ingestToNia(title: string, markdown: string): Promise<IngestResult> {
  if (!NIA_KEY) return { ok: false, error: "NIA_API_KEY is not set" };

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const filename = `cybus-${slug || "untitled"}-${Date.now()}.md`;
  const url = await createGist(filename, markdown);
  if (!url) return { ok: false, error: "GH_TOKEN is not set" };

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
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { ok: false, error: `nia /sources ${r.status}: ${await r.text()}` };
    const j = await r.json() as { id: string; status: string };
    return { ok: true, source_id: j.id, gist_url: url };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

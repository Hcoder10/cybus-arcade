const BASE = "https://apigcp.trynia.ai/v2";
const KEY = process.env.NIA_API_KEY ?? "";

export interface NiaResult {
  results: Array<{ content: string; score: number; source: { display_name: string; url?: string } }>;
}

export async function niaSearch(query: string, mode: "universal" | "query" | "web" = "universal", topK = 8): Promise<NiaResult> {
  if (!KEY) throw new Error("NIA_API_KEY is not set");
  const body: Record<string, unknown> = { mode, query, top_k: topK };
  if (mode === "universal") Object.assign(body, { include_repos: true, include_docs: true, alpha: 0.7 });
  const r = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`nia ${r.status} ${await r.text()}`);
  return r.json() as Promise<NiaResult>;
}

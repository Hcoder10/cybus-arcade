import { SYSTEM, MODEL, builderClient } from "./common.ts";
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

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

const TOOL_SCHEMA = [
  {
    type: "function",
    function: {
      name: "grep_search",
      description: "Search script sources for a literal pattern",
      parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a script source. Path example: ServerScriptService.Foo",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "multi_edit",
      description: "Create or update multiple scripts",
      parameters: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                new_source: { type: "string" },
                create: { type: "boolean" },
                script_type: { type: "string", enum: ["Script", "LocalScript", "ModuleScript"] },
              },
              required: ["path", "new_source"],
            },
          },
        },
        required: ["edits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_luau",
      description: "Run Luau code in the live DataModel",
      parameters: {
        type: "object",
        properties: { code: { type: "string" }, timeout: { type: "number" } },
        required: ["code"],
      },
    },
  },
] as const;

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseXmlToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  const callRe = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    const body = m[1] ?? "";
    const fn = body.match(/<function=([^>]+)>/);
    if (!fn) continue;
    const args: Record<string, unknown> = {};
    const paramRe = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let p: RegExpExecArray | null;
    while ((p = paramRe.exec(body)) !== null) {
      const key = p[1]!.trim();
      const raw = p[2]!.trim();
      try { args[key] = JSON.parse(raw); } catch { args[key] = raw; }
    }
    out.push({ name: fn[1]!.trim(), args });
  }
  return out;
}

function toolCallsToPatches(calls: ToolCall[]): Patch[] {
  const patches: Patch[] = [];
  for (const c of calls) {
    if (c.name === "multi_edit" && Array.isArray(c.args.edits)) {
      for (const item of c.args.edits) {
        if (!item || typeof item !== "object") continue;
        const edit = item as Record<string, unknown>;
        if (!edit.path || typeof edit.new_source !== "string") continue;
        const parts = String(edit.path).split(".");
        const name = parts.pop() ?? "Script";
        const parent_path = parts.join(".") || "ServerScriptService";
        patches.push({
          kind: "create_script",
          parent_path,
          name,
          script_type: edit.script_type ?? "Script",
          source: edit.new_source,
        });
      }
    } else if (c.name === "execute_luau" && typeof c.args.code === "string") {
      const idx = patches.length + 1;
      patches.push({
        kind: "create_script",
        parent_path: "ServerScriptService",
        name: "_Bootstrap" + idx,
        script_type: "Script",
        source: c.args.code,
      });
    }
  }
  return patches;
}

export async function build(
  subtask: { id: string; instruction: string },
  refs: IndexerOutput | null,
): Promise<BuilderOutput | null> {
  const userMsg = JSON.stringify({
    subtask,
    api_chunks: refs?.chunks?.slice(0, 5) ?? [],
  });
  const r = await builderClient.chat.completions.create({
    model: MODEL.builder,
    max_tokens: 8000,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM.builder },
      { role: "user", content: userMsg },
    ],
    tools: TOOL_SCHEMA as any,
    tool_choice: "auto" as any,
  });
  const choice = r.choices[0];
  if (!choice) return null;

  let calls: ToolCall[] = [];
  const native = choice.message?.tool_calls;
  if (Array.isArray(native) && native.length > 0) {
    for (const tc of native) {
      const rawArgs = tc.function?.arguments;
      const args = typeof rawArgs === "string"
        ? parseJsonObject(rawArgs)
        : rawArgs && typeof rawArgs === "object"
          ? rawArgs as Record<string, unknown>
          : {};
      calls.push({ name: tc.function?.name ?? "", args });
    }
  } else {
    calls = parseXmlToolCalls(choice.message?.content ?? "");
  }

  const patches = toolCallsToPatches(calls);
  if (patches.length === 0) return null;
  return {
    subtask_id: subtask.id,
    patches,
    explain: `multi_edit with ${patches.length} script(s)`,
  };
}

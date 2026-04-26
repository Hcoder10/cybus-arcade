import { SYSTEM, MODEL, builderClient } from "./common.ts";
import type { BuilderOutput, Patch } from "./builder.ts";

export interface DebuggerOutput {
  subtask_id: string;
  patches: Patch[];
  explain: string;
  root_cause: string;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

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
    if (c.name !== "multi_edit" || !Array.isArray(c.args.edits)) continue;
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
  }
  return patches;
}

export async function fix(
  subtaskId: string,
  errorTrace: string,
  lastPatch: BuilderOutput,
): Promise<DebuggerOutput | null> {
  const userMsg = JSON.stringify({
    subtask_id: subtaskId,
    error: errorTrace,
    last_edits: (lastPatch.patches ?? []).filter((p) => p.kind === "create_script").slice(0, 8),
  });
  const r = await builderClient.chat.completions.create({
    model: MODEL.builder,
    max_tokens: 8000,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM.debugger },
      { role: "user", content: userMsg },
    ],
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
    subtask_id: subtaskId,
    patches,
    explain: `debugger fix: ${patches.length} script edit(s)`,
    root_cause: "runtime_error",
  };
}

import type { ThreadState } from "./store";

const ICON: Record<string, string> = {
  scheduler: "SCH",
  indexer: "IDX",
  builder: "BLD",
  debugger: "DBG",
  designer: "DSN",
};

export function Thread({ s }: { s: ThreadState }) {
  return (
    <div class={`thread color-${s.agent} ${s.active ? "active" : ""} ${s.done ? "done" : ""}`}>
      <div class="icon">{ICON[s.agent]}</div>
      <div class="name">{s.agent.toUpperCase()}</div>
      <div class="body">{s.body || (s.active ? "..." : "-")}</div>
    </div>
  );
}

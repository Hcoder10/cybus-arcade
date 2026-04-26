import { currentSession } from "./store";
import type { AgentId } from "../../core/src/index.ts";
import { Thread } from "./thread";

const ORDER: AgentId[] = ["scheduler", "indexer", "builder", "debugger", "designer"];

export function Stage() {
  const s = currentSession.value;
  if (!s) {
    return (
      <div class="region">
        <h2>Now Building</h2>
        <div class="dim" style={{ marginTop: 12, fontSize: 14 }}>idle — email cybus-arcade@agentmail.to to build a Roblox game</div>
      </div>
    );
  }
  return (
    <div class="region">
      <h2>Now Building</h2>
      <div class="stage-subject glow">📧 {s.subject}</div>
      <div class="stage-meta">from {s.from} · {((Date.now() - s.startedAt) / 1000).toFixed(0)}s elapsed</div>
      <div class="threads">
        {ORDER.map((a) => <Thread key={a} s={s.threads[a]} />)}
      </div>
    </div>
  );
}

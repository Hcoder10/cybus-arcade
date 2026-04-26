import { useEffect } from "preact/hooks";
import { Stage } from "./stage";
import { Grid } from "./grid";
import { Scoreboard } from "./scoreboard";
import { connect } from "./ws";
import { benchScore } from "./store";

async function loadBench() {
  try {
    const r = await fetch("/datasets/bench_results.json");
    if (!r.ok) return;
    const rows = await r.json() as Array<{ winner: "ours" | "opus" | "tie" }>;
    let ours = 0, opus = 0, tie = 0;
    for (const r of rows) { if (r.winner === "ours") ours++; else if (r.winner === "opus") opus++; else tie++; }
    benchScore.value = { ours, opus, tie };
  } catch { /* no bench yet */ }
}

export function App() {
  useEffect(() => {
    connect();
    void loadBench();
    const t = setInterval(loadBench, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div class="layout">
      <Stage />
      <Grid />
      <Scoreboard />
    </div>
  );
}

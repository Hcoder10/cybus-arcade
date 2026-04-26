import { benchScore } from "./store";

export function Scoreboard() {
  const b = benchScore.value;
  return (
    <div class="region scoreboard">
      <div>
        <div class="score-label">cybus-arcade fleet</div>
        <div class="score-num ours glow">{b.ours}</div>
      </div>
      <div class="score-vs">vs</div>
      <div>
        <div class="score-label">claude opus 4.6</div>
        <div class="score-num opus glow">{b.opus}</div>
      </div>
      <div class="score-tag">tie {b.tie} · sponsored stack</div>
    </div>
  );
}

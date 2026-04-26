import { completedSorted } from "./store";
import { Tile } from "./tile";

export function Grid() {
  const items = completedSorted.value.slice(0, 16);
  return (
    <div class="region">
      <h2>Arcade / Built Tonight</h2>
      {items.length === 0
        ? <div class="dim" style={{ marginTop: 12, fontSize: 14 }}>no places yet - first email starts the night</div>
        : <div class="grid">{items.map((s) => <Tile key={s.sid} s={s} />)}</div>}
    </div>
  );
}

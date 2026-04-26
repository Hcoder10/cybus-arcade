import type { SessionView } from "./store";
import { qrUrl } from "./qr";

export function Tile({ s }: { s: SessionView }) {
  const url = s.shareUrl ?? "https://www.roblox.com/games";
  return (
    <div class="tile">
      <div class="subject">{s.subject}</div>
      <div class="from">from {s.from.split("@")[0]}</div>
      <img class="qr" src={qrUrl(url, 100)} width={100} height={100} alt="QR" />
      <a class="join" href={url} target="_blank" rel="noreferrer">JOIN PLACE</a>
    </div>
  );
}

// Tiny QR code via Google Charts API as data URL (no extra dep, ~$free).
// Falls back to text if offline.
export function qrUrl(text: string, size = 120): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}

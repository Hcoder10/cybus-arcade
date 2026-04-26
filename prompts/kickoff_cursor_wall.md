# Kickoff prompt — Cursor (Arcade Wall — the live demo screen)

You are building the **wall UI** for `cybus-arcade`, the live screen the audience watches during the OpenClaw hackathon demo. Read `SPEC.md` §10 first. Your scope is `packages/wall/` only — DO NOT touch orchestrator, scripts, or infra.

The wall is the demo's face. Make it look incredible. Stack: Vite + Preact + Signals + plain CSS. < 200 KB gzipped.

## What the wall shows

Three regions on a single 1920×1080 screen, no scrolling:

1. **Top — "Now Building"** (40% height): the currently-active session. Big email subject in neon. Below it, agent threads streaming in real time: 🧭 Scheduler decomposing → 📚 Indexer querying Nia → 🔨 Builder shipping Luau (with line counts ticking up) → 🐛 Debugger if errors → 🎨 Designer critique. Each agent has a row with a colored bar that pulses when it's active. Tokens stream into a thought bubble.

2. **Middle — Arcade tile grid** (45% height): completed places. Each tile shows the email subject, the prompter's name, a QR code, and a "▶ Join place" button linking to `ROBLOX_SHARE_URL`. Tiles fade in as `session.end` events arrive. If we get >12 tiles, scroll horizontally.

3. **Bottom-right corner — Bench scoreboard** (15% height + sidebar): live W/L count vs Opus 4.6 from `datasets/bench_results.json`. Big "ours: 7  opus: 3" with the cybus logo glowing.

## Aesthetic

Neon arcade. CRT scanlines on top of everything (via a fixed pseudo-element). Color palette:

- Bg: `#0a0014` deep purple-black
- Primary: `#00ffe1` cyan neon
- Accent: `#ff2bd6` magenta
- Warn: `#ffd60a` yellow
- Glow: text-shadow + box-shadow with the same color as the element
- Font: `JetBrains Mono` everywhere

CSS-only animations. No motion library. Use `@keyframes` for pulses, fade-ins, and the streaming-tokens cursor blink.

## Files

```
packages/wall/
├─ index.html           # one element: <div id="root">
├─ src/
│  ├─ main.tsx          # mount Preact
│  ├─ App.tsx           # 3-region layout
│  ├─ stage.tsx         # "Now Building"
│  ├─ thread.tsx        # one agent's row in the stage
│  ├─ grid.tsx          # tile grid
│  ├─ tile.tsx          # one game tile
│  ├─ scoreboard.tsx    # bottom-right bench widget
│  ├─ ws.ts             # signal-driven event consumer
│  ├─ qr.ts             # 60-line vanilla QR encoder (or use `qrcode` 5KB dep)
│  └─ tokens.css        # design tokens + scanlines + animations
├─ vite.config.ts       # preact plugin only
└─ package.json
```

## Hard rules

- **< 200 KB gzip total.** Run `bun run build && du -sh dist/` and the JS+CSS bundle must come in under that.
- **Preact + Signals only.** No React, no Zustand, no Tailwind, no Framer Motion, no Three.js.
- **Type contracts come from `packages/core/src/index.ts`.** Import `Event`, `AgentId`, `SessionId`. NEVER redefine.
- **WS is the only data source.** Connect to `${VITE_WS_URL || "ws://localhost:8787/events"}`. Hold mock event data for dev/storybook in `src/mock.ts`, but production reads ws.
- **Each tile owns its own signal.** Don't re-render the whole grid on every event. When a `session.end` arrives, push to the grid signal once; tiles already mounted don't re-render.
- **No client-side routing.** Single page.
- **Off-screen GIFs lazy-load** (`loading="lazy" decoding="async"`).
- **A11y: don't strobe.** Pulses ≤ 1 Hz; if the user `prefers-reduced-motion`, kill the scanlines.

## Production demo mode

Add `?demo=1` query param: spawns mock events on a 2.5s loop so the screen has constant motion when no real session is running. Useful between live demos.

Add `?bench=1` query param: replaces the stage with a fullscreen scoreboard for the "head-to-head" closing slide.

## Done criteria

- `bun run dev` opens at localhost:5173 with mock events streaming
- `bun run build` produces `dist/` under 200 KB gzipped (verify with `gzip -c dist/assets/*.js | wc -c`)
- Real ws connection to a running orchestrator (Claude #1's work) shows live events
- `?demo=1` keeps the screen alive with no real backend
- `?bench=1` shows a clean scoreboard view
- Static export works — `npx serve dist/` is the demo deploy target

Ship the polish. This is the demo's face — give it the most polish hours of any package. The judges will photograph this.

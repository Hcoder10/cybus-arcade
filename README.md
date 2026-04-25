# cybus-arcade

Multi-agent Roblox game generator. Email a request, watch agents build a playable place in 90 seconds.

**Stack**

- AgentMail — email is the only input surface
- Nia (Nozomio) — Roblox API + Creator Docs index, queried by every Indexer step
- Anthropic API — powers the Designer agent (multimodal critique) + the synthetic data harness
- Open weights — three finetuned agents on Vast.ai

**The fleet**

| Agent | Model | Status |
|---|---|---|
| Scheduler | Qwen3-7B + LoRA | trained on synth decompositions |
| Indexer | Qwen3-7B + LoRA | trained on Nia tool-call traces |
| Builder | `squaredcuber/cybus-luau-qwen3p5-v6-sft` | already done — v6 ships as-is |
| Debugger | same model as Builder, prompt swap | no separate weights |
| Designer | Qwen3.5-27B + LoRA | trained on (game-state → critique + patch) pairs |

**Demo arc**

1. Email `build@cybus.to` with a Roblox game request.
2. Place resets to baseplate. Cybus Chat plugin shows the live multi-agent flow.
3. Scheduler decomposes → Indexer pulls Roblox API patterns from Nia → Builder writes Luau → Studio Bridge applies it → Debugger fixes runtime errors → Designer critiques game feel → Builder applies the polish patch.
4. Room joins via share link, plays the place.
5. `scripts/bench.ts` shows head-to-head vs Claude Opus 4.6 single-shot, live.

See `SPEC.md` for the full architecture.

License: MIT

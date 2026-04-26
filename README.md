# cybus-arcade

Multi-agent Roblox game generator. Email a request, watch the build process, and open the resulting place.

**Stack**

- AgentMail for inbound requests
- Nia for Roblox API and Creator Docs retrieval
- OpenAI-compatible model endpoints for the agent fleet
- Roblox Studio Bridge for place edits

**Agents**

| Agent | Model | Status |
|---|---|---|
| Scheduler | Qwen3-7B + LoRA | request decomposition |
| Indexer | Qwen3-7B + LoRA | Roblox API retrieval |
| Builder | `squaredcuber/cybus-luau-qwen3p5-v6-sft` | Luau patch generation |
| Debugger | same model as Builder | Studio error repair |
| Designer | Qwen3.5-27B + LoRA | game-state critique and polish patches |

**Flow**

1. Email `build@cybus.to` with a Roblox game request.
2. Studio Bridge resets the place and streams progress.
3. Scheduler decomposes the request.
4. Indexer pulls Roblox API patterns from Nia.
5. Builder writes Luau patches and Studio Bridge applies them.
6. Debugger handles Studio errors.
7. Designer critiques game feel and applies polish.
8. The wall UI shows completed sessions and join links.

License: MIT

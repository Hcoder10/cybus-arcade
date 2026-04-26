# Kickoff prompt — Claude Code #2 (Synth-gen + LoRA training pipeline)

You are running the **data + training pipeline** for `cybus-arcade`. Read `SPEC.md` and `scripts/synth_gen.py` first — both already exist with a working skeleton. Your job: make `synth_gen.py` actually produce 3 high-quality datasets, then run training on a Vast 8×H200.

## Scope

- Polish `scripts/synth_gen.py` — fix bugs, tighten the loop, add resume-on-crash, add cost tracking, raise convergence rate.
- Polish `scripts/train.py` — verify it runs cleanly on multi-GPU, fix any FSDP issues, validate the eval loop.
- Drive the Vast 8×H200 instance via `infra/vast/up_train.sh` — make sure it actually works end-to-end.
- After training, push 3 LoRA adapters to HF as `squaredcuber/cybus-arcade-{role}-lora`.

DO NOT touch:
- `packages/orchestrator/`, `packages/wall/`, `packages/core/`, `infra/vast/up_serve.sh`, `infra/vast/down.sh`, the `prompts/{scheduler,indexer,builder,debugger,designer}.md` role prompts.

## Hard rules

- **Sonnet 4.6 for generation, Haiku 4.5 for filtering.** Never call Opus from synth_gen.
- **Parallel asyncio fanout, 100 concurrent.** Bump to 150 if you don't hit RPM caps. The Anthropic key is sponsored — go wild on data volume.
- **Real Nia API in the loop** for Indexer traces. The dataset is worthless if Nia results are mocked.
- **Reject rate target: ≥40%.** If rejection rate is below 40%, the Haiku judge is too lenient — tighten the rubric. If above 75%, tighten the role prompts so models converge more often.
- **Targets: 25K scheduler / 10K indexer / 8K designer traces.** Wallclock cap 4 hr. Stop at cap even if quotas aren't hit.
- **Track spend in `datasets/spend.json` after every 500 traces** for visibility. No hard cap — sponsor key.
- **No `time.sleep` in async code.** Use `asyncio.sleep`.
- **Resume on crash.** Append-only writes to JSONL. On restart, count existing lines per file and skip already-done counts.

## Pre-flight

1. Verify `MOCK_SETUPS_DIR` env is set to a real path with mock JSON setups. If user's existing 9,278 mocks aren't accessible, the script falls back to synthetic stubs (already coded).
2. Verify `ANTHROPIC_API_KEY` and `NIA_API_KEY` work — make one test call to each before launching at scale.
3. Verify the role prompts parse the JSON outputs you actually get from Sonnet. Run `synth_gen.py --scheduler 5 --indexer 5 --designer 5 --concurrency 2` first as a smoke test.

## Training run

After datasets land:

```bash
cd infra/vast && ./up_train.sh
```

The script (already written) provisions an 8×H200 instance, uploads code + datasets, runs `train.py` for each role sequentially, pushes adapters to HF.

**Verify after training:**
- Each adapter directory has `adapter_config.json` + `adapter_model.safetensors`
- Adapter rank is 64 as configured
- `huggingface_hub` shows 3 new repos under `squaredcuber`
- Sample inference: load base + adapter, prompt with `prompts/scheduler.md` + a test user query, confirm the model outputs valid JSON in the expected schema

## Eval after training

Add `scripts/eval_lora.py` (~100 LOC) that takes 100 held-out examples per role and reports:
- Schema compliance rate (output is valid JSON matching the role's schema)
- Mean output length
- Mean Haiku judge score on outputs

If schema compliance < 85% for any role, reject that LoRA and rerun training with looser regularization or more epochs. **Don't ship a broken adapter** — orchestrator will crash on JSON parse failure.

## Done criteria

- 3 JSONL files in `datasets/` with sizes ≥ 90% of targets (4500/1800/1350)
- `datasets/spend.json` shows total Anthropic spend
- 3 LoRA adapters pushed to HF, all loadable by vLLM
- Schema compliance ≥ 85% per role on eval
- Repo size of `datasets/` is gitignored (already done)

Ship it. The serve fleet (Claude #1's domain via `up_serve.sh`) cannot launch until your adapters are on HF.

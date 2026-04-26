"""
Eval the trained LoRAs against held-out prompts. The metric that actually
matters: does the model output valid, schema-correct JSON?

Compares LoRA vs base on the same prompts. If LoRA is worse, drop the LoRA
and serve base + system prompt instead.

Usage (run on the vast training instance, after scheduler-lora + indexer-lora
exist in checkpoints/):
    python scripts/eval_lora.py --base Qwen/Qwen3.5-9B \
        --scheduler-lora checkpoints/scheduler-lora \
        --indexer-lora   checkpoints/indexer-lora

Outputs:
    - Per-role: parse rate, schema compliance rate, mean output length
    - Recommendation: ship LoRA / ship base / mixed
"""
from __future__ import annotations
import argparse, json, os, sys, time
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

# 10 held-out prompts (none used in synth-gen)
EVAL_PROMPTS = [
    "Build a Roblox lava bridge obby with 5 rising lava platforms and a finish bell.",
    "Make a 1v1 sword duel arena with respawn and round timer.",
    "Tower defense where towers can be upgraded twice with gold.",
    "A racing game with 3 lanes and pickup boost pads.",
    "Co-op puzzle: two players must press buttons simultaneously to open doors.",
    "Snowball fight with destructible snow forts.",
    "Pet egg hatching with 5 rarity tiers.",
    "Color tag where touching a player swaps your team.",
    "Fishing minigame with a power meter and 8 fish species.",
    "Endless runner with sliding under obstacles and double jump.",
]

INDEXER_INPUTS = [
    {"id": "core", "instruction": "Spawn 3 enemy types with waypoint follow logic"},
    {"id": "ui",   "instruction": "ScreenGui HUD with HP bar and score TextLabel"},
    {"id": "vehicle", "instruction": "VehicleSeat with WASD throttle and turning"},
    {"id": "audio", "instruction": "Background music loop in SoundService with volume control"},
    {"id": "tween", "instruction": "Tween a Part along a CFrame path over 5 seconds"},
    {"id": "remote", "instruction": "RemoteEvent server-auth player click handler"},
    {"id": "physics", "instruction": "LinearVelocity push player when stepping on a Part"},
    {"id": "particles", "instruction": "ParticleEmitter burst on hit, 12 particles, fade out"},
    {"id": "checkpoint", "instruction": "Save player position on checkpoint and respawn there"},
    {"id": "leaderboard", "instruction": "leaderstats Money IntValue persists per session"},
]


def load_role_prompt(role: str) -> str:
    return (PROMPTS_DIR / f"{role}.md").read_text(encoding="utf-8")


def gen_one(model, tok, system: str, user: str, max_new: int = 1024) -> str:
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    enc = tok(text, return_tensors="pt", truncation=True, max_length=4096).to(model.device)
    with torch.no_grad():
        out = model.generate(
            **enc, max_new_tokens=max_new, temperature=0.1, do_sample=True,
            pad_token_id=tok.pad_token_id or tok.eos_token_id,
        )
    decoded = tok.decode(out[0][enc.input_ids.shape[1]:], skip_special_tokens=True)
    return decoded.strip()


def extract_json(text: str) -> dict | None:
    dec = json.JSONDecoder()
    m = text.find("{")
    if m < 0: return None
    try:
        obj, _ = dec.raw_decode(text[m:])
        return obj
    except Exception:
        return None


SCHEDULER_KEYS = {"title", "genre", "subtasks"}
SCHEDULER_SUBTASK_KEYS = {"id", "depends_on", "agent", "instruction", "expects"}

INDEXER_KEYS = {"subtask_id", "queries_issued", "chunks", "warnings"}
INDEXER_CHUNK_KEYS = {"title", "source", "snippet", "why"}


def check_scheduler(obj: dict | None) -> tuple[bool, list[str]]:
    issues: list[str] = []
    if obj is None: return False, ["no_json"]
    if not SCHEDULER_KEYS.issubset(obj.keys()):
        issues.append(f"missing_top_keys:{sorted(SCHEDULER_KEYS - obj.keys())}")
    subs = obj.get("subtasks", [])
    if not isinstance(subs, list) or not subs: issues.append("no_subtasks")
    else:
        for i, st in enumerate(subs):
            if not isinstance(st, dict) or not SCHEDULER_SUBTASK_KEYS.issubset(st.keys()):
                issues.append(f"subtask[{i}]_bad")
                break
        agents = [s.get("agent") for s in subs if isinstance(s, dict)]
        if "indexer" not in agents: issues.append("no_indexer")
        if "designer" not in agents: issues.append("no_designer")
    return (not issues), issues


def check_indexer(obj: dict | None) -> tuple[bool, list[str]]:
    issues: list[str] = []
    if obj is None: return False, ["no_json"]
    if not INDEXER_KEYS.issubset(obj.keys()):
        issues.append(f"missing_top_keys:{sorted(INDEXER_KEYS - obj.keys())}")
    chunks = obj.get("chunks", [])
    if not isinstance(chunks, list) or not chunks: issues.append("no_chunks")
    else:
        bad = sum(1 for c in chunks if not (isinstance(c, dict) and INDEXER_CHUNK_KEYS.issubset(c.keys())))
        if bad: issues.append(f"bad_chunks:{bad}/{len(chunks)}")
    return (not issues), issues


def evaluate(model, tok, role: str, prompts: list, label: str):
    system = load_role_prompt(role)
    parse_ok = schema_ok = 0
    lengths: list[int] = []
    issue_counts: dict[str, int] = {}
    for i, p in enumerate(prompts):
        user = p if isinstance(p, str) else json.dumps(p)
        try:
            out = gen_one(model, tok, system, user, max_new=1024)
        except Exception as e:
            print(f"  [{label}][{i}] gen_err: {e}")
            issue_counts["gen_err"] = issue_counts.get("gen_err", 0) + 1
            continue
        lengths.append(len(out))
        obj = extract_json(out)
        if obj is not None: parse_ok += 1
        check_fn = check_scheduler if role == "scheduler" else check_indexer
        ok, issues = check_fn(obj)
        if ok: schema_ok += 1
        for iss in issues:
            issue_counts[iss] = issue_counts.get(iss, 0) + 1
    n = len(prompts)
    avg_len = sum(lengths) / max(1, len(lengths))
    print(f"  [{label}] parse_ok={parse_ok}/{n}  schema_ok={schema_ok}/{n}  avg_len={avg_len:.0f}")
    if issue_counts: print(f"    issues: {issue_counts}")
    return {"parse": parse_ok / n, "schema": schema_ok / n, "len": avg_len, "issues": issue_counts}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="Qwen/Qwen3.5-9B")
    ap.add_argument("--scheduler-lora", default="checkpoints/scheduler-lora")
    ap.add_argument("--indexer-lora", default="checkpoints/indexer-lora")
    ap.add_argument("--skip-base", action="store_true", help="skip base eval (faster)")
    args = ap.parse_args()

    print(f"[load] tokenizer + base {args.base}")
    tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    if tok.pad_token is None: tok.pad_token = tok.eos_token

    base_model = AutoModelForCausalLM.from_pretrained(
        args.base, torch_dtype=torch.bfloat16, device_map="auto", trust_remote_code=True,
    )
    base_model.eval()

    results: dict = {}

    # === Scheduler ===
    print("\n=== SCHEDULER ===")
    if not args.skip_base:
        print("[eval] base")
        results["scheduler_base"] = evaluate(base_model, tok, "scheduler", EVAL_PROMPTS, "base")

    print(f"[load] scheduler LoRA from {args.scheduler_lora}")
    from peft import PeftModel
    sched_model = PeftModel.from_pretrained(base_model, args.scheduler_lora)
    sched_model.eval()
    print("[eval] scheduler-lora")
    results["scheduler_lora"] = evaluate(sched_model, tok, "scheduler", EVAL_PROMPTS, "lora")
    sched_model.unload()
    del sched_model
    torch.cuda.empty_cache()

    # === Indexer ===
    print("\n=== INDEXER ===")
    if not args.skip_base:
        print("[eval] base")
        results["indexer_base"] = evaluate(base_model, tok, "indexer", INDEXER_INPUTS, "base")

    print(f"[load] indexer LoRA from {args.indexer_lora}")
    idx_model = PeftModel.from_pretrained(base_model, args.indexer_lora)
    idx_model.eval()
    print("[eval] indexer-lora")
    results["indexer_lora"] = evaluate(idx_model, tok, "indexer", INDEXER_INPUTS, "lora")

    # === Verdict ===
    print("\n=== VERDICT ===")
    out_path = Path("checkpoints/eval_results.json")
    out_path.parent.mkdir(exist_ok=True, parents=True)
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

    def verdict(role: str):
        b, l = results.get(f"{role}_base"), results[f"{role}_lora"]
        if b is None:
            return f"  {role}: LoRA schema={l['schema']*100:.0f}% (no base comparison)"
        delta = l["schema"] - b["schema"]
        rec = "SHIP LoRA" if delta >= 0 else "SHIP BASE (LoRA regresses)"
        return f"  {role}: base={b['schema']*100:.0f}% lora={l['schema']*100:.0f}% delta={delta*100:+.0f}pp -> {rec}"

    print(verdict("scheduler"))
    print(verdict("indexer"))
    print(f"\n[save] {out_path}")


if __name__ == "__main__":
    main()

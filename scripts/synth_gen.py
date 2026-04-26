"""
Synthetic data harness for cybus-arcade.

Drives Sonnet 4.6 in 4 different role-shaped prompts against the existing
mock Roblox env (9,278 mock setups in roblox-studio-mcp/), captures clean
multi-agent trajectories, and emits 3 per-agent JSONL datasets.

Outputs:
  datasets/scheduler_traces.jsonl
  datasets/indexer_traces.jsonl
  datasets/designer_traces.jsonl

Anthropic spend: ~$310 (Sonnet generation + Haiku judging)
Wallclock: ~50 min at 50 concurrent calls.

Usage:
  uv run scripts/synth_gen.py --target 5000 --concurrency 50

Env required:
  ANTHROPIC_API_KEY, NIA_API_KEY, MOCK_SETUPS_DIR (path to existing 9278 mocks)
"""

from __future__ import annotations
import os, json, asyncio, argparse, hashlib, random, time, pathlib, sys
from typing import Any
import anthropic
import httpx

ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]
NIA_KEY = os.environ["NIA_API_KEY"]
MOCKS = pathlib.Path(os.environ.get("MOCK_SETUPS_DIR", "../roblox-studio-mcp/mock_setups"))
PROMPTS_DIR = pathlib.Path(__file__).parent.parent / "prompts"
OUT_DIR = pathlib.Path(__file__).parent.parent / "datasets"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL_GEN = os.environ.get("SYNTH_MODEL_GEN", "claude-sonnet-4-6")
MODEL_JUDGE = os.environ.get("SYNTH_MODEL_JUDGE", "claude-haiku-4-5-20251001")
NIA_BASE = "https://apigcp.trynia.ai/v2"

ROLE_PROMPTS = {r: (PROMPTS_DIR / f"{r}.md").read_text(encoding="utf-8")
                for r in ("scheduler", "indexer", "builder", "debugger", "designer")}

ASYNC_CLIENT = anthropic.AsyncAnthropic(api_key=ANTHROPIC_KEY)
HTTPX = httpx.AsyncClient(timeout=60.0)


# helpers

PROMPT_TEMPLATES = [
    "Build a {genre} game where the player {twist}.",
    "Make me a {genre} where {twist}.",
    "I want a Roblox {genre} that has {twist}.",
    "Quick {genre} game - {twist}.",
]
GENRES = ["tower defense", "obby", "racing", "fps", "sandbox",
          "party game", "rpg", "horror", "puzzle", "platformer", "survival"]
TWISTS = [
    "every wave the difficulty doubles", "you control gravity",
    "the map shrinks every 30s", "all enemies are sentient cubes",
    "there's a final boss with three phases", "every player has a unique power",
    "the world is in low-gravity space", "color matters - match or die",
    "checkpoints heal you", "collecting coins triples your speed",
    "obstacles speak to you", "a clock ticks down to chaos",
]


def synth_user_prompt(setup: dict) -> str:
    """Templated prompt rendered from a mock setup."""
    g = setup.get("hint_genre") or random.choice(GENRES)
    t = random.choice(TWISTS)
    return random.choice(PROMPT_TEMPLATES).format(genre=g, twist=t)


def trace_id(setup_id: str, prompt: str) -> str:
    return hashlib.sha1(f"{setup_id}|{prompt}".encode()).hexdigest()[:12]


# Anthropic role play

_DEC = json.JSONDecoder()

def _extract_json(text: str) -> str:
    """Pull the first valid {...} block from a response. Uses the actual JSON
    decoder so braces inside string literals (e.g. Luau source) don't confuse it."""
    # strip ```json fences if present
    if "```" in text:
        for chunk in text.split("```"):
            chunk = chunk.lstrip("json").lstrip()
            if chunk.startswith("{"):
                text = chunk
                break
    m = text.find("{")
    if m < 0: return text
    try:
        obj, end = _DEC.raw_decode(text[m:])
        return text[m:m+end]
    except Exception:
        return text[m:]


async def play_role(role: str, user_msg: str, *, json_mode: bool = True,
                    extra_messages: list[dict] | None = None,
                    max_tokens: int = 4096) -> str:
    sys_prompt = ROLE_PROMPTS[role]
    msgs = list(extra_messages or [])
    msgs.append({"role": "user", "content": user_msg})
    # retry with backoff on 429 / 529
    for attempt in range(5):
        try:
            resp = await ASYNC_CLIENT.messages.create(
                model=MODEL_GEN,
                max_tokens=max_tokens,
                system=[{"type": "text", "text": sys_prompt,
                         "cache_control": {"type": "ephemeral"}}],
                messages=msgs,
            )
            break
        except anthropic.RateLimitError:
            await asyncio.sleep(min(2 ** attempt + random.random(), 15))
        except anthropic.APIStatusError as e:
            if e.status_code in (529, 503): await asyncio.sleep(2 ** attempt)
            else: raise
    else:
        return ""
    # find the last text block (Sonnet 4.6 may return thinking blocks first)
    text = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text" and getattr(block, "text", ""):
            text = block.text
    return _extract_json(text) if json_mode else text


async def haiku_judge(traj: dict) -> int:
    """Score a full trajectory 0-10 for: convergence, no hallucinated APIs,
    Builder-Debugger loop bounded, Designer adds value. Return int."""
    prompt = (
        "Score this multi-agent Roblox build trajectory 0-10 on:\n"
        " - Did the build converge to a runnable state? (most weight)\n"
        " - Were Roblox APIs used correctly?\n"
        " - Did the Designer critique add real game-feel value?\n"
        " - Was the Debugger called <=3 times?\n"
        "Output ONLY a single integer 0-10.\n\n"
        f"```json\n{json.dumps(traj, ensure_ascii=False)[:18000]}\n```"
    )
    resp = await ASYNC_CLIENT.messages.create(
        model=MODEL_JUDGE, max_tokens=8,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = ""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            raw = block.text.strip()
    digits = "".join(c for c in raw if c.isdigit())
    return int(digits[:2] or "0")


# Nia tool

async def nia_search(query: str, mode: str = "universal", top_k: int = 8) -> dict:
    body: dict[str, Any] = {"mode": mode, "query": query, "top_k": top_k}
    if mode == "universal":
        body |= {"include_repos": True, "include_docs": True, "alpha": 0.7}
    r = await HTTPX.post(f"{NIA_BASE}/search",
                         headers={"Authorization": f"Bearer {NIA_KEY}",
                                  "Content-Type": "application/json"},
                         json=body)
    r.raise_for_status()
    return r.json()


# mock env

class MockEnv:
    """Replicates what Studio Bridge would do. Uses your existing
    cybus mock_setups for property validation."""
    def __init__(self, setup: dict):
        self.workspace: dict[str, dict] = {}     # path to properties
        self.scripts: dict[str, str] = {}        # path to source
        self.allowed_classes: set[str] = setup.get("allowed_classes",
            {"Part","Script","LocalScript","ModuleScript","RemoteEvent",
             "BindableEvent","Folder","ScreenGui","TextLabel","TextButton",
             "Frame","ParticleEmitter","Sound","PointLight","Trail",
             "SpawnLocation","Humanoid"})

    def apply(self, patches: list[dict]) -> tuple[bool, str]:
        for p in patches:
            kind = p.get("kind")
            if kind == "create_part":
                key = f"{p['parent_path']}.{p['name']}"
                self.workspace[key] = p.get("properties", {})
            elif kind in ("create_script",):
                key = f"{p['parent_path']}.{p['name']}"
                src = p.get("source", "")
                if "loadstring" in src or "getfenv" in src:
                    return False, f"unsafe call in script {key}"
                self.scripts[key] = src
            elif kind == "create_instance":
                cls = p.get("class_name", "")
                if cls not in self.allowed_classes:
                    return False, f"class {cls} not allowed"
                self.workspace[f"{p['parent_path']}.{p['name']}"] = p.get("properties", {})
            elif kind == "set_property":
                tgt = p.get("target_path", "")
                if tgt not in self.workspace and tgt != "Lighting":
                    return False, f"set_property on missing target {tgt}"
            else:
                return False, f"unknown kind: {kind}"
        return True, ""

    def state_snapshot(self, subject: str, genre: str) -> dict:
        parts = [k for k in self.workspace if "Part" in self.workspace.get(k,{}).get("_class","Part") or "Workspace" in k]
        return {
            "session_subject": subject,
            "genre_inferred": genre,
            "state": {
                "parts": len(self.workspace),
                "scripts": len(self.scripts),
                "palette": list({self.workspace[k].get("Color","#888888") for k in self.workspace})[:6],
                "lighting": {"Brightness":1.0, "Ambient":"[100,100,100]", "ClockTime":14.0},
                "mechanics_present": list(self.scripts.keys())[:8],
                "mechanics_missing_from_genre_norms": [],
                "audio": {"music": False, "sfx_count": 0},
                "ui": {"screenguis": sum(1 for k in self.workspace if "Gui" in k), "has_hud": False},
                "notable_parts": [],
            },
        }


# one trajectory

async def run_one(setup: dict) -> dict | None:
    prompt = synth_user_prompt(setup)
    tid = trace_id(setup["id"], prompt)
    env = MockEnv(setup)
    trace: dict[str, Any] = {"tid": tid, "prompt": prompt, "steps": []}

    # 1. Scheduler
    plan_raw = await play_role("scheduler", prompt)
    try:
        plan = json.loads(plan_raw)
    except Exception as e:
        print(f"[reject:scheduler-parse] {plan_raw[:300]}", file=sys.stderr, flush=True)
        return None
    if "error" in plan:
        print(f"[reject:scheduler-error] {plan}", file=sys.stderr, flush=True)
        return None
    trace["steps"].append({"role":"scheduler","input":prompt,"output":plan})

    nia_chunk_cache: dict[str, dict] = {}

    # 2. For each subtask in dependency order
    for sub in plan.get("subtasks", []):
        agent = sub.get("agent")
        if agent == "indexer":
            idx_raw = await play_role("indexer", json.dumps(sub))
            try:
                idx_out = json.loads(idx_raw)
            except Exception:
                print(f"[reject:indexer-parse] {idx_raw[:200]}", file=sys.stderr, flush=True)
                return None
            for q in idx_out.get("queries_issued", [])[:3]:
                if q not in nia_chunk_cache:
                    try:
                        nia_chunk_cache[q] = await nia_search(q)
                    except Exception:
                        nia_chunk_cache[q] = {"results": []}
            trace["steps"].append({"role":"indexer","input":sub,"output":idx_out,
                                   "nia": list(nia_chunk_cache.values())[-3:]})

        elif agent == "builder":
            refs = list(nia_chunk_cache.values())[-3:] if nia_chunk_cache else []
            build_input = json.dumps({"subtask": sub, "refs": refs})[:8000]
            patch_raw = await play_role("builder", build_input, max_tokens=8000)
            try:
                patch = json.loads(patch_raw)
            except Exception:
                print(f"[reject:builder-parse] {patch_raw[:200]}", file=sys.stderr, flush=True)
                return None
            ok, err = env.apply(patch.get("patches", []))
            trace["steps"].append({"role":"builder","input":sub,"output":patch,"ok":ok,"err":err})
            # Debugger loop
            tries = 0
            while not ok and tries < 3:
                dbg_input = json.dumps({"subtask": sub, "error": err, "last_patch": patch})
                fix_raw = await play_role("debugger", dbg_input, max_tokens=4000)
                try: fix = json.loads(fix_raw)
                except Exception: break
                ok, err = env.apply(fix.get("patches", []))
                trace["steps"].append({"role":"debugger","input":{"err":err,"sub":sub},
                                       "output":fix,"ok":ok})
                tries += 1
            if not ok:
                print(f"[reject:builder-unconverged] {err[:140]}", file=sys.stderr, flush=True)
                return None  # unconverged

        elif agent == "designer":
            snap = env.state_snapshot(prompt[:60], plan.get("genre","other"))
            crit_raw = await play_role("designer", json.dumps(snap), max_tokens=4000)
            try:
                crit = json.loads(crit_raw)
            except Exception:
                print(f"[reject:designer-parse] {crit_raw[:200]}", file=sys.stderr, flush=True)
                return None
            ok, _ = env.apply(crit.get("patch", []))
            trace["steps"].append({"role":"designer","input":snap,"output":crit,"ok":ok})

    # 3. Judge
    score = await haiku_judge(trace)
    trace["judge_score"] = score
    if score < 7:
        print(f"[reject:judge-low] score={score}", file=sys.stderr, flush=True)
        return None

    return trace


# per-agent slices

def slice_trace(trace: dict) -> dict[str, list[dict]]:
    out = {"scheduler": [], "indexer": [], "designer": []}
    for step in trace["steps"]:
        r = step["role"]
        if r == "scheduler":
            out["scheduler"].append({
                "messages": [
                    {"role":"system", "content": ROLE_PROMPTS["scheduler"]},
                    {"role":"user", "content": step["input"]},
                    {"role":"assistant", "content": json.dumps(step["output"], ensure_ascii=False)},
                ]
            })
        elif r == "indexer":
            out["indexer"].append({
                "messages": [
                    {"role":"system", "content": ROLE_PROMPTS["indexer"]},
                    {"role":"user", "content": json.dumps(step["input"], ensure_ascii=False)},
                    {"role":"assistant", "content": json.dumps(step["output"], ensure_ascii=False)},
                ]
            })
        elif r == "designer":
            out["designer"].append({
                "messages": [
                    {"role":"system", "content": ROLE_PROMPTS["designer"]},
                    {"role":"user", "content": json.dumps(step["input"], ensure_ascii=False)},
                    {"role":"assistant", "content": json.dumps(step["output"], ensure_ascii=False)},
                ]
            })
    return out


# main

async def producer(queue: asyncio.Queue, setups: list[dict]):
    for s in setups:
        await queue.put(s)
    for _ in range(int(os.environ.get("CONCURRENCY", 50))):
        await queue.put(None)


async def worker(queue: asyncio.Queue, files: dict, counts: dict, limits: dict):
    while True:
        s = await queue.get()
        if s is None: return
        try:
            trace = await run_one(s)
        except Exception as e:
            print(f"[err] {type(e).__name__}: {str(e)[:200]}", file=sys.stderr, flush=True)
            queue.task_done()
            continue
        if not trace:
            print("[reject] trace dropped (parse fail / unconverged / low judge)", file=sys.stderr, flush=True)
            queue.task_done()
            continue
        slices = slice_trace(trace)
        for role in ("scheduler","indexer","designer"):
            if counts[role] >= limits[role]:
                continue
            for ex in slices[role]:
                files[role].write(json.dumps(ex, ensure_ascii=False) + "\n")
                files[role].flush()
                counts[role] += 1
        queue.task_done()
        if all(counts[r] >= limits[r] for r in counts):
            return


def load_setups() -> list[dict]:
    """Try to load from MOCK_SETUPS_DIR. If missing, return synthesized stubs."""
    if MOCKS.exists():
        files = sorted(MOCKS.glob("*.json"))[:20000]
        return [json.loads(p.read_text(encoding="utf-8")) for p in files]
    print(f"[warn] mock setups not found at {MOCKS}; using synthetic stubs", file=sys.stderr)
    return [{"id": f"stub-{i}", "allowed_classes": list({"Part","Script","RemoteEvent","Folder","ScreenGui","TextLabel","Sound","ParticleEmitter","PointLight"})}
            for i in range(15000)]


async def main_async(targets: dict, concurrency: int):
    setups = load_setups()
    random.shuffle(setups)
    counts = {r: 0 for r in targets}
    files = {r: open(OUT_DIR / f"{r}_traces.jsonl", "a", encoding="utf-8") for r in targets}
    # resume-friendly: count existing lines so each worker stops on global target
    for r in targets:
        p = OUT_DIR / f"{r}_traces.jsonl"
        if p.exists():
            try: counts[r] = sum(1 for _ in open(p, "r", encoding="utf-8", errors="ignore"))
            except: pass
    print(f"[resume] starting counts: {counts}", flush=True)
    queue: asyncio.Queue = asyncio.Queue()
    os.environ["CONCURRENCY"] = str(concurrency)
    workers = [asyncio.create_task(worker(queue, files, counts, targets)) for _ in range(concurrency)]
    prod = asyncio.create_task(producer(queue, setups))
    t0 = time.time()
    while True:
        await asyncio.sleep(8)
        elapsed = time.time() - t0
        print(f"[{elapsed:6.0f}s] " + " ".join(f"{r}={counts[r]}/{targets[r]}" for r in targets))
        if all(counts[r] >= targets[r] for r in targets):
            break
        if elapsed > 14400:
            print("[stop] hit 4hr cap"); break
    for w in workers: w.cancel()
    prod.cancel()
    for f in files.values(): f.close()
    print("done. outputs in datasets/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scheduler", type=int, default=25000)
    ap.add_argument("--indexer", type=int, default=10000)
    ap.add_argument("--designer", type=int, default=8000)
    ap.add_argument("--concurrency", type=int, default=100)
    args = ap.parse_args()
    asyncio.run(main_async(
        {"scheduler": args.scheduler, "indexer": args.indexer, "designer": args.designer},
        args.concurrency,
    ))


if __name__ == "__main__":
    main()

"""Merge per-subagent JSONL slices into the main training datasets.

Concats datasets/sub/{role}_*.jsonl into datasets/{role}_traces.jsonl,
deduping by md5 of the assistant content. Skips designer (we ship base
Qwen 27B + system prompt for that role, no LoRA).

Usage: python scripts/merge_subs.py
"""
from __future__ import annotations
import json, hashlib, pathlib, glob, sys

ROOT = pathlib.Path(__file__).parent.parent
SUB = ROOT / "datasets" / "sub"
OUT = ROOT / "datasets"

ROLES = ("scheduler", "indexer")  # designer skipped on purpose

def line_hash(line: str) -> str:
    try:
        d = json.loads(line)
        msgs = d.get("messages", [])
        # Hash on the assistant content only.
        for m in msgs:
            if m.get("role") == "assistant":
                return hashlib.md5(m["content"].encode()).hexdigest()
    except Exception:
        pass
    return hashlib.md5(line.encode()).hexdigest()


def main():
    summary = []
    for role in ROLES:
        existing_path = OUT / f"{role}_traces.jsonl"
        seen: set[str] = set()
        out_lines: list[str] = []

        # 1) include any pre-existing main file content
        if existing_path.exists():
            for line in existing_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line: continue
                h = line_hash(line)
                if h in seen: continue
                seen.add(h); out_lines.append(line)

        # 2) merge every sub-N.jsonl
        for p in sorted(glob.glob(str(SUB / f"{role}_*.jsonl"))):
            for line in pathlib.Path(p).read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line: continue
                h = line_hash(line)
                if h in seen: continue
                seen.add(h); out_lines.append(line)

        existing_path.write_text("\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8")
        summary.append((role, len(out_lines)))
        print(f"[{role}] merged -> {len(out_lines)} unique lines")

    print()
    for role, n in summary:
        print(f"  {role:10s}: {n} lines")


if __name__ == "__main__":
    main()

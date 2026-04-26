#!/usr/bin/env bash
# Quick smoke test of the serve fleet — once OPENAI_BASE_URL_* env vars are set,
# pings each endpoint with a minimal completion to verify it responds with valid output.
#
# Usage:
#   export OPENAI_BASE_URL_BUILDER=http://<host>:8001/v1
#   export OPENAI_BASE_URL_SCHED=http://<host>:8002/v1
#   export OPENAI_BASE_URL_INDEXER=http://<host>:8002/v1
#   export OPENAI_BASE_URL_DESIGNER=http://<host>:8004/v1
#   ./scripts/smoke_serve.sh

set -e

probe() {
  local name=$1 url=$2 model=$3
  echo "=== $name @ $url ==="
  echo "  GET /v1/models:"
  curl -sf -m 6 "$url/models" 2>&1 | python -c "
import json,sys
try:
    d=json.load(sys.stdin); ids=[m.get('id','?') for m in d.get('data',[])]
    print(f'    -> {ids}')
except Exception as e: print(f'    -> ERR {e}')
" || echo "    -> ENDPOINT DOWN"
  echo "  POST /v1/chat/completions (test JSON output):"
  RESP=$(curl -sf -m 30 -X POST "$url/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$model\",\"max_tokens\":120,\"temperature\":0.2,\"messages\":[
      {\"role\":\"system\",\"content\":\"Respond ONLY with valid JSON: {\\\"ok\\\": true}\"},
      {\"role\":\"user\",\"content\":\"ping\"}]}" 2>&1) || { echo "    -> REQUEST FAILED"; return; }
  echo "    -> $(echo "$RESP" | head -c 250)"
  echo
}

probe Builder   "${OPENAI_BASE_URL_BUILDER:?missing}"   "${MODEL_BUILDER:-squaredcuber/cybus-luau-qwen3p5-v6-sft}"
probe Scheduler "${OPENAI_BASE_URL_SCHED:?missing}"     "cybus-arcade-scheduler-lora"
probe Indexer   "${OPENAI_BASE_URL_INDEXER:?missing}"   "cybus-arcade-indexer-lora"
probe Designer  "${OPENAI_BASE_URL_DESIGNER:?missing}"  "Qwen/Qwen3.5-27B"

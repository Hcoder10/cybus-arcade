#!/usr/bin/env bash
# Bring up a 4×A100-80GB SXM serving instance on Vast.ai with 4 vLLM endpoints.
#
# Layout:
#   GPU 0,1 (TP=2) -> :8001  Builder/Debugger    (cybus-luau-qwen3p5-v6-sft)
#   GPU 2          -> :8002  Scheduler+Indexer   (Qwen/Qwen3.5-9B + 2 LoRAs, multi-LoRA)
#   GPU 3          -> :8004  Designer            (Qwen/Qwen3.5-27B base, no LoRA)
#
# Usage:
#   ./infra/vast/up_serve.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_FILE="$REPO_ROOT/.vast-state.json"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/vast_key}"

echo "[1/5] searching 4×A100 SXM offers"
OFFER_ID=$(vastai search offers \
  'gpu_name=A100_SXM4 gpu_ram>=80 num_gpus=4 rentable=true reliability>0.98 inet_down>=500' \
  -o 'dph_total' --raw 2>/dev/null | python -c '
import json,sys
data=json.load(sys.stdin)
if not data: sys.exit("no offers")
print(data[0]["id"])')
echo "    -> $OFFER_ID"

echo "[2/5] creating instance with vllm image"
INSTANCE_ID=$(vastai create instance "$OFFER_ID" \
  --image "vllm/vllm-openai:latest" \
  --disk 250 \
  --ssh \
  --raw 2>/dev/null | python -c 'import json,sys; print(json.load(sys.stdin)["new_contract"])')
python -c "
import json, os
p='$STATE_FILE'
d=json.load(open(p)) if os.path.exists(p) else {}
d['serve_id']='$INSTANCE_ID'
json.dump(d, open(p,'w'))
"
echo "    -> $INSTANCE_ID"

echo "[3/5] waiting for SSH"
for i in $(seq 1 60); do
  META=$(vastai show instance "$INSTANCE_ID" --raw 2>/dev/null)
  HOST=$(echo "$META" | python -c 'import json,sys; d=json.load(sys.stdin); print(d.get("ssh_host","") or "")')
  PORT=$(echo "$META" | python -c 'import json,sys; d=json.load(sys.stdin); print(d.get("ssh_port",""))')
  PUB=$(echo "$META" | python -c 'import json,sys; d=json.load(sys.stdin); print(d.get("public_ipaddr",""))')
  [ -n "$HOST" ] && [ -n "$PORT" ] && break
  sleep 5
done
SSH="ssh -i $SSH_KEY -p $PORT -o StrictHostKeyChecking=no root@$HOST"

echo "[4/5] starting 4 vLLM servers (background)"
$SSH "huggingface-cli login --token $HF_TOKEN && \
  nvidia-smi -L && \
  CUDA_VISIBLE_DEVICES=0,1 nohup python -m vllm.entrypoints.openai.api_server \
    --model squaredcuber/cybus-luau-qwen3p5-v6-sft \
    --port 8001 --host 0.0.0.0 \
    --tensor-parallel-size 2 --max-model-len 16384 \
    --enable-prefix-caching --max-num-seqs 8 \
    --enable-auto-tool-choice --tool-call-parser qwen3_coder \
    --gpu-memory-utilization 0.92 \
    > /tmp/builder.log 2>&1 & \
  CUDA_VISIBLE_DEVICES=2 nohup python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen3.5-9B \
    --port 8002 --host 0.0.0.0 \
    --max-model-len 8192 --max-num-seqs 16 \
    --enable-lora --max-loras 2 --max-lora-rank 64 \
    --lora-modules cybus-arcade-scheduler-lora=squaredcuber/cybus-arcade-scheduler-lora \
                   cybus-arcade-indexer-lora=squaredcuber/cybus-arcade-indexer-lora \
    --enable-prefix-caching \
    --gpu-memory-utilization 0.85 \
    > /tmp/sched-idx.log 2>&1 & \
  CUDA_VISIBLE_DEVICES=3 nohup python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen3.5-27B \
    --port 8004 --host 0.0.0.0 \
    --max-model-len 16384 --max-num-seqs 4 \
    --enable-prefix-caching \
    --gpu-memory-utilization 0.92 \
    > /tmp/designer.log 2>&1 &"

echo "[5/5] waiting for /v1/models to respond on each port"
for port in 8001 8002 8004; do
  for i in $(seq 1 60); do
    if $SSH "curl -s http://localhost:$port/v1/models -m 4" >/dev/null 2>&1; then
      echo "    :$port up"; break
    fi
    sleep 5
  done
done

cat <<EOF

serving fleet up. point orchestrator env vars at:
  OPENAI_BASE_URL_BUILDER=http://$PUB:8001/v1
  OPENAI_BASE_URL_SCHED=http://$PUB:8002/v1     # use model name cybus-arcade-scheduler-lora
  OPENAI_BASE_URL_INDEXER=http://$PUB:8002/v1   # use model name cybus-arcade-indexer-lora
  OPENAI_BASE_URL_DESIGNER=http://$PUB:8004/v1  # use model name cybus-arcade-designer-lora

tear down with: ./infra/vast/down.sh
EOF

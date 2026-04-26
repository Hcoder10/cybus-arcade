#!/usr/bin/env bash
# Bring up an 8×H200 SXM training instance on Vast.ai for ~1.5 hours of LoRA SFT.
# Pushes the repo + datasets to the instance, runs train.py for each role, pulls back adapters.
#
# Usage:
#   ./infra/vast/up_train.sh
#
# Env required:
#   HF_TOKEN, VAST_API_KEY (vastai CLI auth)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_FILE="$REPO_ROOT/.vast-state.json"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/vast_key}"

echo "[1/6] searching offers — 8×H200 SXM"
OFFER_ID=$(vastai search offers \
  'gpu_name=H200 num_gpus=8 rentable=true reliability>0.97 cuda_max_good>=12.4 inet_down>=500' \
  -o 'dph_total' --raw 2>/dev/null | python -c '
import json,sys
data=json.load(sys.stdin)
if not data: sys.exit("no offers")
print(data[0]["id"])')
echo "    -> offer $OFFER_ID"

echo "[2/6] creating instance"
INSTANCE_ID=$(vastai create instance "$OFFER_ID" \
  --image "pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel" \
  --disk 200 \
  --ssh \
  --raw 2>/dev/null | python -c 'import json,sys; print(json.load(sys.stdin)["new_contract"])')
echo "    -> instance $INSTANCE_ID"
printf '{"train_id":"%s"}\n' "$INSTANCE_ID" > "$STATE_FILE"

echo "[3/6] waiting for SSH"
for i in $(seq 1 60); do
  SSH_URL=$(vastai show instance "$INSTANCE_ID" --raw 2>/dev/null | python -c '
import json,sys
d=json.load(sys.stdin)
if d.get("ssh_host") and d.get("ssh_port"):
    print(f"root@{d[\"ssh_host\"]}:{d[\"ssh_port\"]}")
' || true)
  [ -n "$SSH_URL" ] && break
  sleep 5
done
echo "    -> $SSH_URL"
HOST=$(echo "$SSH_URL" | cut -d@ -f2 | cut -d: -f1)
PORT=$(echo "$SSH_URL" | cut -d: -f2)
SSH="ssh -i $SSH_KEY -p $PORT -o StrictHostKeyChecking=no root@$HOST"
SCP="scp -i $SSH_KEY -P $PORT -o StrictHostKeyChecking=no"

echo "[4/6] uploading repo + datasets"
$SCP -r "$REPO_ROOT/scripts" "$REPO_ROOT/prompts" "$REPO_ROOT/datasets" \
        root@"$HOST":/workspace/cybus-arcade/

$SSH "pip install -q transformers==4.46.0 peft==0.13.0 accelerate==1.0.0 \
                   datasets==3.0.0 bitsandbytes huggingface_hub flash-attn==2.6.3 && \
       huggingface-cli login --token $HF_TOKEN"

echo "[5/6] training scheduler + indexer LoRAs (designer skipped — uses base Qwen 27B at inference)"
$SSH "cd /workspace/cybus-arcade && \
  torchrun --nproc_per_node=8 scripts/train.py --role scheduler \
    --base Qwen/Qwen3-7B --data datasets/scheduler_traces.jsonl \
    --output checkpoints/scheduler-lora --epochs 3 && \
  torchrun --nproc_per_node=8 scripts/train.py --role indexer \
    --base Qwen/Qwen3-7B --data datasets/indexer_traces.jsonl \
    --output checkpoints/indexer-lora --epochs 3"

echo "[6/6] pushing 2 adapters to HF"
$SSH "cd /workspace/cybus-arcade && for r in scheduler indexer; do \
  huggingface-cli upload squaredcuber/cybus-arcade-\$r-lora checkpoints/\$r-lora \
    --token $HF_TOKEN --private; \
done"

echo "scheduler + indexer LoRAs pushed. designer = base Qwen 27B at inference."
echo "tear down with: ./infra/vast/down.sh"

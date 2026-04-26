#!/usr/bin/env bash
# Tear down all vast.ai instances tracked in .vast-state.json.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_FILE="$REPO_ROOT/.vast-state.json"
[ -f "$STATE_FILE" ] || { echo "no state file"; exit 0; }
for key in train_id serve_id; do
  ID=$(python -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('${key}','') or '')" 2>/dev/null)
  if [ -n "$ID" ]; then
    echo "destroying $key=$ID"
    vastai destroy instance "$ID" || true
  fi
done
rm -f "$STATE_FILE"

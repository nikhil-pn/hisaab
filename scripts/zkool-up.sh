#!/usr/bin/env bash
# Start the two zkool_graphql servers Hisaab's demo uses, both on 127.0.0.1 only.
#   wallets  :8001  data/wallets.db  — demo payer + demo freelancer (SEED accounts: never expose this port)
#   watcher  :8002  data/hisaab.db   — Hisaab's watch-only account (UFVK only, no spending key)
# Usage: scripts/zkool-up.sh [wallets|watcher|all]   (default all). Logs in data/*.log.
set -euo pipefail
cd "$(dirname "$0")/.."
ZKOOL="${ZKOOL_BIN:-$(command -v zkool_graphql || echo ../zkool2/target/release/zkool_graphql)}"
LWD="${LWD_URL:-https://testnet.zec.rocks:443}"
mkdir -p data && chmod 700 data

start() { # name port db
  local name=$1 port=$2 db=$3
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:$port/graphql" -H 'content-type: application/json' -d '{"query":"{ currentHeight }"}'; then
    echo "$name already up on :$port"; return
  fi
  # -C 1 = testnet (applies only when the db is created). Unauthenticated is safe ONLY because we bind to 127.0.0.1.
  nohup "$ZKOOL" -d "data/$db" -p "$port" --bind-address 127.0.0.1 -l "$LWD" -C 1 \
    --allow-unauthenticated --allow-unencrypted-database > "data/$name.log" 2>&1 &
  echo $! > "data/$name.pid"
  for _ in $(seq 1 60); do
    curl -s -m 2 -o /dev/null "http://127.0.0.1:$port/graphql" -H 'content-type: application/json' -d '{"query":"{ currentHeight }"}' && { echo "$name up on 127.0.0.1:$port"; chmod 600 "data/$db"* 2>/dev/null || true; return; }
    sleep 1
  done
  echo "$name failed to start; see data/$name.log" >&2; exit 1
}

case "${1:-all}" in
  wallets) start wallets 8001 wallets.db ;;
  watcher) start watcher 8002 hisaab.db ;;
  all) start wallets 8001 wallets.db; start watcher 8002 hisaab.db ;;
esac

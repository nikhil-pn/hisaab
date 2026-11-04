#!/usr/bin/env bash
# Tiny helper: scripts/gql.sh <port> '<graphql query>'  → prints the JSON response.
# Never use it to print `seed` fields.
set -euo pipefail
port=$1; shift
q=$(printf '%s' "$*" | python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')
curl -s -m 120 "http://127.0.0.1:$port/graphql" -H 'content-type: application/json' -d "$q"
echo

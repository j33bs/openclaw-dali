#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TSX_BIN="$REPO_ROOT/node_modules/.bin/tsx"
CLI_SCRIPT="$REPO_ROOT/scripts/interbeing/run_watcher_v0.ts"
MODE="${1:-start}"

if [[ "$MODE" != "start" && "$MODE" != "once" ]]; then
  echo "Usage: scripts/interbeing/run_watcher_v0_service.sh [start|once]" >&2
  exit 1
fi

if [[ ! -x "$TSX_BIN" ]]; then
  echo "Missing $TSX_BIN. Run pnpm install in $REPO_ROOT first." >&2
  exit 1
fi

cd "$REPO_ROOT"
exec "$TSX_BIN" "$CLI_SCRIPT" "$MODE"

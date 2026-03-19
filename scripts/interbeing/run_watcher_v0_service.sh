#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TSX_BIN="$REPO_ROOT/node_modules/.bin/tsx"
CLI_SCRIPT="$REPO_ROOT/scripts/interbeing/run_watcher_v0.ts"
MODE="${1:-start}"
ARGS=("$@")

if [[ ${#ARGS[@]} -eq 0 ]]; then
  ARGS=("start")
fi

case "$MODE" in
  start|once|status|health|list|verify|replay)
    ;;
  *)
    echo "Usage: scripts/interbeing/run_watcher_v0_service.sh [start|once|status|health|list|verify|replay] [args...]" >&2
    exit 1
    ;;
esac

if [[ ! -x "$TSX_BIN" ]]; then
  echo "Missing $TSX_BIN. Run pnpm install in $REPO_ROOT first." >&2
  exit 1
fi

cd "$REPO_ROOT"
exec "$TSX_BIN" "$CLI_SCRIPT" "${ARGS[@]}"

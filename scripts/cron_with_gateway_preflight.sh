#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<USAGE
Usage:
  ${SCRIPT_NAME} -- <original command and args...>

Runs gateway pairing preflight before executing a cron job command.

Example:
  ${SCRIPT_NAME} -- openclaw status
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" != "--" ]]; then
  echo "${SCRIPT_NAME}: missing '--' separator" >&2
  usage >&2
  exit 64
fi
shift

if [[ "$#" -eq 0 ]]; then
  echo "${SCRIPT_NAME}: missing command after '--'" >&2
  usage >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GUARD="${ROOT}/scripts/check_gateway_pairing_health.sh"

status=0
"${GUARD}" || status=$?
if [[ "$status" -ne 0 ]]; then
  echo "PRECHECK FAILED: gateway pairing/repair pending; aborting job (see guard output above)" >&2
  exit "$status"
fi

exec "$@"

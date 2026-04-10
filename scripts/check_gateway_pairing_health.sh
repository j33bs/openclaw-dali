#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<'EOF'
Gateway pairing/repair preflight guard.

Purpose:
  Detect pending pairing/repair requests before sub-agent or gateway work
  starts, and fail fast with remediation.

Checks:
  1) openclaw availability on PATH
  2) openclaw devices list JSON retrieval (with fallback flag style)
  3) pending pairing/repair detection via tolerant JSON parsing
  4) optional recent journal scan for scope-upgrade/pairing-required lines

Exit codes:
  0  OK: no pending pairing/repair detected
  2  Pending pairing/repair detected
  3  CLI pairing/context mismatch detected ("pairing required")
  4  Devices JSON parse failed
  10 openclaw not found
  11 devices command failed for non-pairing reason

Remediation (for exit 2):
  openclaw devices list --json
  openclaw devices approve <REQUEST_ID>
EOF
}

redact_text() {
  sed -E \
    -e 's/(Authorization: Bearer )[A-Za-z0-9._=-]+/\1<redacted>/gI' \
    -e 's/(token[=: ]+)[A-Za-z0-9._=-]{8,}/\1<redacted>/gI' \
    -e 's/(api[_-]?key[=: ]+)[A-Za-z0-9._=-]{8,}/\1<redacted>/gI' \
    -e 's/("token"\s*:\s*")[^"]+(".*)/\1<redacted>\2/g'
}

gateway_journal_units() {
  if [[ -n "${OPENCLAW_GATEWAY_JOURNAL_UNITS:-}" ]]; then
    printf '%s\n' "${OPENCLAW_GATEWAY_JOURNAL_UNITS}" |
      tr ',' '\n' |
      sed '/^[[:space:]]*$/d'
    return 0
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user list-unit-files 'openclaw-gateway*.service' --no-legend --plain 2>/dev/null |
      awk '{print $1}' |
      sed '/^[[:space:]]*$/d' |
      sort -u
    return 0
  fi

  printf '%s\n' 'openclaw-gateway.service'
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if ! command -v openclaw >/dev/null 2>&1; then
  echo "${SCRIPT_NAME}: openclaw not found on PATH"
  exit 10
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "${SCRIPT_NAME}: python3 not found on PATH"
  exit 11
fi

run_devices_json() {
  local out err err_text rc
  out="$(mktemp)"
  err="$(mktemp)"
  trap 'rm -f "$out" "$err"' RETURN

  if openclaw devices list --json >"$out" 2>"$err"; then
    cat "$out"
    return 0
  fi
  rc=$?
  err_text="$(cat "$err")"

  if printf '%s' "$err_text" | grep -qiE 'unknown option|unknown command|invalid option|--json'; then
    : >"$out"
    : >"$err"
    if openclaw devices list --format json >"$out" 2>"$err"; then
      cat "$out"
      return 0
    fi
    rc=$?
    err_text="$(cat "$err")"
  fi

  printf '%s' "$err_text" | redact_text >&2
  return "$rc"
}

DEVICES_ERR=""
DEVICES_ERR_FILE="$(mktemp)"
trap 'rm -f "$DEVICES_ERR_FILE"' EXIT
if ! DEVICES_JSON="$(run_devices_json 2>"$DEVICES_ERR_FILE")"; then
  DEVICES_ERR="$(cat "$DEVICES_ERR_FILE")"
  if printf '%s' "$DEVICES_ERR" | grep -qi 'pairing required'; then
    primary_unit="$(gateway_journal_units | head -n 1)"
    primary_unit="${primary_unit:-openclaw-gateway.service}"
    cat <<EOF
FAIL: CLI context is unpaired or has scope mismatch ("pairing required").
Likely execution-context drift (interactive vs cron/systemd user).

Check:
  - run as same user as gateway
  - echo "\$HOME"
  - command -v openclaw
  - systemctl --user status ${primary_unit}
EOF
    exit 3
  fi

  echo "FAIL: unable to query device pairing state via openclaw devices list"
  printf '%s\n' "$DEVICES_ERR" | redact_text | sed -n '1,20p'
  exit 11
fi
rm -f "$DEVICES_ERR_FILE"

PENDING_JSON="$(DEVICES_JSON_RAW="$DEVICES_JSON" python3 - <<'PY'
import json
import os
import sys

raw = os.environ.get("DEVICES_JSON_RAW", "")

def strv(value):
    if value is None:
        return ""
    return str(value)

def first(item, keys):
    for key in keys:
        value = item.get(key)
        if value not in (None, "", False):
            return value
    return ""

def is_pending(item, from_top_pending=False):
    if from_top_pending:
        return True
    status = strv(first(item, ["status", "state", "pairingStatus", "repairState"]))
    status = status.lower().strip()
    if status in {"pending", "repair_pending", "pairing_required", "pairing-required"}:
        return True
    if bool(first(item, ["pendingRepair", "pairingRequired", "pairing_required"])):
        return True
    requestish = bool(first(item, ["requestId", "request_id", "repairId", "repair_id", "pendingRequestId"]))
    if requestish and status not in {"approved", "paired", "active", "revoked", "rejected", "removed"}:
        return True
    return False

try:
    data = json.loads(raw)
except json.JSONDecodeError as exc:
    print(f"json_parse_error:{exc}", file=sys.stderr)
    raise SystemExit(4)

candidates = []

if isinstance(data, dict):
    pending = data.get("pending")
    if isinstance(pending, list):
        for item in pending:
            if isinstance(item, dict):
                candidates.append((item, True, "top.pending"))

    for key in ("requests", "requestQueue", "items", "devices"):
        maybe = data.get(key)
        if isinstance(maybe, list):
            for item in maybe:
                if isinstance(item, dict):
                    candidates.append((item, False, f"top.{key}"))
elif isinstance(data, list):
    for item in data:
        if isinstance(item, dict):
            candidates.append((item, False, "top.list"))

pending_items = []
for item, from_top_pending, source in candidates:
    if not is_pending(item, from_top_pending=from_top_pending):
        continue
    request_id = strv(first(item, ["requestId", "request_id", "repairId", "repair_id", "pendingRequestId", "id"]))
    client_id = strv(first(item, ["clientId", "client_id", "client", "name"]))
    status = strv(first(item, ["status", "state", "pairingStatus", "repairState"]))
    scopes = item.get("scopes")
    if not isinstance(scopes, list):
        scopes = []
    pending_items.append(
        {
            "request_id": request_id,
            "client_id": client_id,
            "status": status,
            "scopes": [strv(s) for s in scopes],
            "source": source,
        }
    )

print(json.dumps(pending_items, ensure_ascii=False))
PY
)" || {
  echo "FAIL: unable to parse devices JSON for pending pairing/repair"
  exit 4
}

PENDING_COUNT="$(PENDING_JSON_RAW="$PENDING_JSON" python3 - <<'PY'
import json
import os

rows = json.loads(os.environ.get("PENDING_JSON_RAW", "[]"))
print(len(rows) if isinstance(rows, list) else 0)
PY
)"

if [[ "$PENDING_COUNT" -gt 0 ]]; then
  echo "FAIL: Gateway pairing/repair is pending."
  echo
  echo "Pending requests:"
  PENDING_JSON_RAW="$PENDING_JSON" python3 - <<'PY'
import json
import os

rows = json.loads(os.environ.get("PENDING_JSON_RAW", "[]"))
for row in rows:
    rid = row.get("request_id") or "<unknown_request_id>"
    client = row.get("client_id") or "<unknown_client_id>"
    status = row.get("status") or "<unknown_status>"
    scopes = ",".join(row.get("scopes") or [])
    print(f"- request_id={rid} client_id={client} status={status} scopes={scopes}")
PY

  echo
  echo "Remediation:"
  echo "  openclaw devices list --json"
  echo "  openclaw devices approve <REQUEST_ID>"
  exit 2
fi

if command -v journalctl >/dev/null 2>&1; then
  while IFS= read -r unit; do
    [[ -n "$unit" ]] || continue
    if journalctl --user -u "$unit" -n 200 --no-pager 2>/dev/null |
      grep -qE 'reason=scope-upgrade|pairing required'; then
      echo "INFO: recent scope-upgrade/pairing-required lines found in ${unit}; ensure pairing stays pending-free."
      break
    fi
  done < <(gateway_journal_units)
fi

echo "OK: no pending pairing/repair detected."

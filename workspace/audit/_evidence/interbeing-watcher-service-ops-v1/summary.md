# Interbeing Watcher Service Ops v1

- Branch: `codex/harden/interbeing-watcher-service-ops-v1`
- Implementation commit: `a4baeeae1b733493a7735b5eb5a644e738bd47c1`
- Service model: long-running `systemd --user` service
- Reason: the watcher already has a safe resident `start` mode, so the smallest aligned hardening is a stronger user-unit envelope plus a machine-readable `health` command.

## Scope

- Added `health` to the existing watcher CLI and service wrapper.
- Added structured health inspection for systemd state, watched paths, queue depth, lock state, state readability, last processed or failed timestamps, recent watcher failures, and recent journal warnings or errors.
- Hardened stale-lock recovery so dead-owner locks clear automatically while ambiguous ownership remains fail-closed.
- Aligned the unit restart envelope with the repo's long-running user-service conventions: `Restart=always`, `RestartSec=5`, `TimeoutStartSec=30`, `TimeoutStopSec=30`.
- Refreshed focused Vitest coverage for health output and stale-lock cleanup.

## Verification

- `build-output.txt` captures a passing `pnpm build`. The existing `extensions/tlon` unresolved-import warnings remain present and were not introduced by this tranche.
- `test-output.txt` captures a passing `pnpm test -- test/interbeing-watcher-v0.test.ts` run with `8 passed`.
- `service-show-after.txt` proves the installed unit is active, enabled, using the user-unit path, and now reports `RestartUSec=5s`, `TimeoutStartUSec=30s`, and `TimeoutStopUSec=30s`.
- `service-status-after.txt`, `journalctl-restart-proof.txt`, and `watcher-health.json` prove survivability after an induced `SIGKILL`: the service returned to `active/running`, `NRestarts=1`, and the health output surfaced the restart through both service state and journal warnings.
- `verify-valid.json` and `processed-ops-service-proof.receipt.json` prove a fresh valid artifact was autonomously consumed after the hardening and restart proof.
- `verify-invalid.json`, `failed-ops-invalid-schema-version.receipt.json`, and `watcher-health.json` prove invalid artifact diagnosis is operator-visible through both receipts and `health.recent_failures`.
- `git-diff-check.txt` is clean.

## Residual Notes

- The installed unit still assumes this checkout lives at `~/src/openclaw-dali`.
- `watcher-health.json` remains in `warning` state after the induced kill because `NRestarts=1` and the restart warning entries remain present in the recent journal window. That is expected and useful for diagnosis.
- The service was intentionally left enabled and running after verification.

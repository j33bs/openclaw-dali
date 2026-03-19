# Interbeing Watcher v0

Local Dali intake watcher for file-based Interbeing v0 handoff.

## Commands

- `pnpm tsx scripts/interbeing/run_watcher_v0.ts start`
  Runs the single-threaded watcher against `handoff/incoming/dali/`.
- `pnpm tsx scripts/interbeing/run_watcher_v0.ts once`
  Processes the current queue and exits.
- `pnpm tsx scripts/interbeing/run_watcher_v0.ts status`
  Prints a machine-readable JSON status summary for operator or SSH use.
- `pnpm tsx scripts/interbeing/run_watcher_v0.ts health`
  Prints service, lock, queue, state, and recent failure diagnostics as machine-readable JSON.
- `pnpm tsx scripts/interbeing/run_watcher_v0.ts list --limit 10`
  Lists recent processed, failed, and skipped receipts.
- `pnpm tsx scripts/interbeing/run_watcher_v0.ts verify --filename <name>`
- `pnpm tsx scripts/interbeing/run_watcher_v0.ts verify --sha256 <hash>`
  Verifies current or historical intake state by filename or payload hash.
- `pnpm tsx scripts/interbeing/run_watcher_v0.ts replay --file handoff/failed/dali/<file>`
  Copies a failed artifact back into intake.
- `pnpm tsx scripts/interbeing/run_watcher_v0.ts replay --file handoff/processed/dali/<file> --force-reprocess`
  Explicitly overrides idempotency once for a known processed hash.
- `scripts/interbeing/run_watcher_v0_service.sh start`
  Runs the long-lived watcher with an explicit repo-root working directory for systemd user service use.

## Local Paths

- intake: `handoff/incoming/dali/`
- processed: `handoff/processed/dali/`
- failed: `handoff/failed/dali/`
- state: `workspace/state/interbeing_watcher_v0.json`
- mutation lock: `workspace/state/interbeing_watcher_v0.lock`
- log: `workspace/audit/interbeing_watcher_v0.log`
- lifecycle output: `workspace/audit/interbeing-watcher-v0/last-run/`

## Receipts

Every moved processed, failed, or skipped artifact gets an adjacent receipt:

- `*.receipt.json`

Receipt fields include:

- original filename
- intake timestamp
- final disposition
- reason code
- sha256
- watcher tool name and local watcher version
- references to local evidence paths when available

Original envelope contents are never modified.

## Service Mode

`start` is already a long-running chokidar watcher, so the governed always-on form is a `systemd --user` service rather than a timer.

Install the unit from this checkout:

```bash
mkdir -p ~/.config/systemd/user
ln -sfn "$HOME/src/openclaw-dali/scripts/systemd/openclaw-interbeing-watcher.service" \
  "$HOME/.config/systemd/user/openclaw-interbeing-watcher.service"
systemctl --user daemon-reload
```

Operator control surface:

```bash
systemctl --user enable --now openclaw-interbeing-watcher.service
systemctl --user stop openclaw-interbeing-watcher.service
systemctl --user restart openclaw-interbeing-watcher.service
systemctl --user status openclaw-interbeing-watcher.service --no-pager
jq . < <(pnpm tsx scripts/interbeing/run_watcher_v0.ts health)
journalctl --user -u openclaw-interbeing-watcher.service -n 200 --no-pager
systemctl --user disable --now openclaw-interbeing-watcher.service
```

Notes:

- The unit assumes the Dali checkout lives at `~/src/openclaw-dali`.
- The service follows the repo-standard long-running user-unit envelope: `Restart=always`, `RestartSec=5`, `TimeoutStartSec=30`, `TimeoutStopSec=30`.
- `once` remains available for bounded recovery or smoke checks, but the service is the normal operator surface for continuous intake.
- Replay and `--force-reprocess` remain valid while the service is running; queue mutation is serialized through `workspace/state/interbeing_watcher_v0.lock` so state updates are not clobbered by the long-running watcher.
- The lock file is crash-recoverable. A dead owner PID is cleared automatically, and a live PID is only treated as stale when it is clearly not a watcher process. Anything ambiguous remains fail-closed and operator-visible through `health`.
- `status`, `list`, and `verify` stay read-only and can be run while the service is active.
- `health` is the fastest operator diagnostic. It reports the installed unit path, service state, restart count, watched paths, queue depth, lock state, state-file readability, last processed or failed timestamps, and recent journal or watcher-log failures.

## Failure Taxonomy

Stable local reason codes:

- `dispatch_invalid`
- `processed`
- `duplicate`
- `partial_ignored`
- `file_not_ready`
- `hop_limit_exceeded`
- `invalid_json`
- `schema_invalid`
- `schema_version_invalid`
- `processing_error`
- `reviewer_rejected`
- `move_error`
- `state_error`
- `startup_scan_error`
- `unexpected_internal_error`
- `replay_requested`
- `force_reprocess_requested`

## Local Dispatch

`payload.local_dispatch` is the Dali-local extension point for bounded multi-agent work. It does not change the canonical v0 envelope shape because it stays inside the already-opaque `payload` object.

Supported roles:

- `planner`
- `executor`
- `reviewer`

Planner limits:

- planner child fan-out is capped at `4`
- worker concurrency is capped at `3`
- planner children may be `executor` or `reviewer`, not nested `planner`
- duplicate child work is skipped by `dedupe_key` or `task_id` before worker execution starts
- if lineage metadata is present, child fan-out fails closed once `hop_count + 1 > max_hops`

Receipt notes:

- processed and failed receipts may now include `local_dispatch`
- `local_dispatch` records the resolved role, lineage, worker-pool ceiling, child execution counts, and reviewer gate outcome when local dispatch ran

## Operator Workflow

1. Drop a `*.task-envelope.v0.json` file into `handoff/incoming/dali/`.
2. Run `status` to confirm queue and health.
3. Inspect `handoff/processed/dali/` or `handoff/failed/dali/`.
4. Read the adjacent `*.receipt.json`.
5. Use `verify` for remote-friendly confirmation by filename or hash.
6. Use `replay` for failed artifacts, or `--force-reprocess` for explicit processed-hash overrides.

## Non-Scope

- no transport or RPC
- no auth or signing
- no event bus
- no schema changes
- no memory federation

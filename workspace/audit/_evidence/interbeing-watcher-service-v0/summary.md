# Interbeing Watcher Service v0

- Branch: `codex/harden/interbeing-watcher-service-v0`
- Commit: `0cadb91dedd28ed83153c4ec6302f4d908fc4a87`
- Service model: `systemd --user` service
- Reason: `scripts/interbeing/run_watcher_v0.ts start` is already a long-running chokidar watcher, so a timer would add latency and drift without improving safety.

## Files in Scope

- `scripts/interbeing/README.md`
- `scripts/interbeing/run_watcher_v0_service.sh`
- `scripts/interbeing/watch_handoff_v0.ts`
- `scripts/interbeing/watcher_v0_support.ts`
- `scripts/systemd/openclaw-interbeing-watcher.service`
- `test/interbeing-watcher-v0.test.ts`
- `workspace/audit/_evidence/interbeing-watcher-service-v0/*`

## Verification

- `pnpm build` passed.
- `git diff --check` passed.
- `pnpm test -- test/interbeing-watcher-v0.test.ts` did not complete in this environment.
- Direct targeted Vitest invocation also timed out after 40 seconds without reporting a test failure.
- `systemctl --user enable --now openclaw-interbeing-watcher.service` installed and started the service cleanly.
- `service-status.txt` shows the unit active and running from this checkout.
- `watcher-status.json` shows `incoming=0`, `processed=3`, `failed=0`, `pending_reprocess_overrides=0`.
- `processed-service-proof.receipt.json` proves autonomous service consumption of a fresh file dropped into `handoff/incoming/dali/`.
- `duplicate-service-proof.receipt.json` and `verify-service-proof-sha.json` prove duplicate hash handling stayed `skipped/duplicate`.
- `forced-reprocess-service-proof.receipt.json` and `watcher-log-tail.jsonl` prove `replay --force-reprocess` still becomes `processed` while the service remains active.

## Residual Notes

- The unit assumes the Dali checkout path remains `~/src/openclaw-dali`.
- The service lifecycle is visible in `journalctl`; intake decisions remain in `workspace/audit/interbeing_watcher_v0.log` by design.

# Interbeing Local Multi-Agent v0

- Branch: `codex/harden/interbeing-watcher-service-ops-v1`
- Implementation commit: `04c88bdd87efed1afb65c018506ee89e5015f2df`
- Runtime model: watcher-owned intake plus adapter-local planner/executor/reviewer dispatch inside `payload.local_dispatch`
- Reason: this keeps the canonical v0 envelope transport unchanged while adding bounded local role execution behind the watcher's existing queue, duplicate, replay, verify, and receipt authority.

## Scope

- Added a local dispatch runtime for `planner`, `executor`, and `reviewer` roles.
- Kept role and lineage metadata inside `payload.local_dispatch`; no canonical top-level v0 fields changed.
- Added bounded planner fan-out with `worker_limit` capped at `3` and planner child count capped at `4`.
- Kept queue mutation in the watcher only; child execution happens in-memory behind the existing watcher admission flow.
- Added receipt-local lineage and dispatch summaries plus explicit failure codes for `dispatch_invalid`, `hop_limit_exceeded`, and `reviewer_rejected`.
- Added focused watcher tests for role dispatch, bounded concurrency, duplicate child suppression, reviewer rejection, and hop-limit enforcement.

## Verification

- `build-output.txt` captures a passing `pnpm build`. The existing `extensions/tlon` unresolved-import warnings remained and were not introduced by this tranche.
- `test-output.txt` captures a passing `pnpm test -- test/interbeing-watcher-v0.test.ts` run with `13 passed`.
- `service-status.txt` proves the user service is active, enabled, and running from this checkout after restart.
- `verify-chain.json`, `processed-chain.receipt.json`, and `dispatch-summary.json` prove a live bounded planner chain was autonomously consumed by the running service on March 19, 2026.
- The live chain ran two executor children with `worker_pool.limit=2` and `worker_pool.max_in_flight=2`, skipped one duplicate child before execution, and completed under an approving reviewer gate.
- `processed-chain.receipt.json` proves the processed receipt now carries `local_dispatch` lineage, child counts, reviewer gate outcome, and worker-pool summary.
- `watcher-status.json` shows watcher file-state behavior stayed canonical: `incoming=0`, `processed=5`, `failed=1`, `tracked_hashes=4`.
- `git-diff-check.txt` is clean.

## Residual Notes

- The adapter-local extension is intentionally narrow: planner children may be `executor` or `reviewer`, not nested `planner`.
- `watcher-health.json` still reflects older journal warnings and a prior failed proof artifact from earlier service hardening work; this tranche did not clear historical diagnostics.
- The service was intentionally left enabled and running after verification.

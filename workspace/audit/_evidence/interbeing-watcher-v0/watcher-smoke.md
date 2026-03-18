# Interbeing Watcher v0 Hardening Smoke

Flow:

- processed one valid handoff envelope through the real local lifecycle adapter
- dropped a duplicate of the same payload and observed an idempotent skip
- dropped an invalid schema-version envelope and observed fail-closed routing
- forced one processing_error with a controlled failing lifecycle runner to create a replay candidate
- replayed the failed valid artifact back into intake and processed it successfully
- confirmed reprocessing a known processed hash is rejected without `--force-reprocess`
- forced a reprocess of a previously processed hash and confirmed the one-shot override was consumed

Observed:

- first summary: {"mode":"once","processed":1,"skipped":1,"failed":1}
- replay failure summary: {"mode":"once","processed":0,"skipped":0,"failed":1}
- replay success summary: {"mode":"once","processed":1,"skipped":0,"failed":0}
- force replay summary: {"tool_name":"interbeing-watcher-v0","watcher_version":"v0-hardening","force_reprocess":true,"queued_path":"handoff/incoming/dali/a-valid.task-envelope.v0.json","reason_code":"force_reprocess_requested","sha256":"7ac66ebc50eb99bc377b8beea405f3448a81d9df0d3c0d5f885af733abff50d5","source_file":"handoff/processed/dali/a-valid.task-envelope.v0.json"}
- status health: ok

Evidence:

- processed, failed, skipped, replayed, and forced-reprocess receipts were written
- status, list, and verify snapshots were captured as machine-readable JSON
- log and state snapshots reflect the executed run, including replay actions

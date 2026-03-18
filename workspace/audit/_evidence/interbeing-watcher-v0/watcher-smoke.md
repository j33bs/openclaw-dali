# Interbeing Watcher v0 Smoke

Flow:

- dropped one valid handoff file into `handoff/incoming/dali/`
- dropped one duplicate of the same payload to verify idempotent skipping
- dropped one invalid schema-version file to verify fail-closed routing
- ran `once` mode through `scripts/interbeing/run_watcher_v0.ts`
- ran one focused `start` mode check separately by starting the watcher, dropping a handoff file after startup, and confirming processing to `handoff/processed/dali/`

Observed:

- processed files: a-valid.task-envelope.v0.json, b-duplicate.task-envelope.v0.json
- failed files: c-invalid.task-envelope.v0.json
- persisted hash count: 1
- lifecycle event: task.running

Validation:

- valid input moved to `handoff/processed/dali/`
- duplicate input was skipped and also moved out of intake
- invalid schema-version input moved to `handoff/failed/dali/`
- watcher state persisted the valid payload hash exactly once
- lifecycle artifacts were emitted through the existing local interbeing harness

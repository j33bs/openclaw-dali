# Local Interbeing v0 E2E

Scope:

- local-only submit_task ingestion and lifecycle emission
- no transport
- no auth/signing
- no broad runtime integration

Entrypoint:

- `corepack pnpm exec tsx scripts/dev/interbeing-e2e-local-v0.ts`
- input source: inline default submit_task envelope
- interbeing schema source: `/home/jeebs/src/openclaw-interbeing`
- artifact directory: `/home/jeebs/src/openclaw-dali/workspace/audit/_evidence/interbeing-e2e-local-v0`

Lifecycle emitted:

- task-status flow: `queued -> running -> succeeded`
- representative event persisted: `task.running`
- the adapter also emitted queued and succeeded events in memory during the run

Validation:

- input-submit-task.json: direct_schema
- task-status-\*.json: direct_schema
- event-envelope.json: direct_schema

Limitations:

- `event-envelope.json` stores one representative running event even though the in-memory flow emits multiple events
- bootstrap resolution, transport wiring, and shared auth remain deferred

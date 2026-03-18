# Dali Task Lifecycle v0 Smoke

Scope:

- local-only interbeing v0 adapter
- no transport wiring
- no auth/signing
- no bootstrap/runtime refactor

Adapter entrypoint:

- `src/shared/interbeing-task-lifecycle-v0.ts`

Smoke path:

- parse a local `submit_task` envelope
- emit `queued`
- emit `running`
- emit `succeeded` or `failed`
- emit matching local `event-envelope` payloads for each transition

Validation performed in this pass:

- attempted: `pnpm test -- src/shared/interbeing-task-lifecycle-v0.test.ts`
  - the repo test wrapper and direct `vitest` invocation both stalled in the shared Vitest setup path in this environment, so this pass used a direct runtime smoke instead of claiming a passing suite that did not complete
- passed: `corepack pnpm exec tsx --eval '...'`
  - parsed `task-smoke-001`
  - emitted `queued -> running -> succeeded`
  - emitted `task.queued -> task.running -> task.succeeded`
  - validated generated task-status and event-envelope objects with inline v0-shaped JSON Schema checks
- `git diff --check`

Practical schema coverage:

- submit-task envelope parser enforces the required v0 fields, `submit_task` operation, ISO date-time, and Dali target matching by default
- task-status builder emits the required v0 fields for `queued`, `running`, `succeeded`, and `failed`
- event-envelope builder emits the required v0 fields with explicit `event_type`, `correlation_id`, and payload

Deferred by design:

- transport
- auth/signing
- shared bootstrap resolver
- deeper runtime/execution-engine integration

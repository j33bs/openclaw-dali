# Interbeing Handoff

## Dali-Local Concepts Mapped To Interbeing v0

### Task receipt and execution ownership

- Dali-local today:
  - Dali owns orchestration-heavy execution and local task entrypoints.
- Interbeing v0 mapping:
  - `submit_task` request in `schemas/task-envelope.v0.json`
  - `target_node`
  - `task_id`
  - `requestor`
- Later expectation:
  - Dali should express task acceptance and ownership through interbeing envelopes, not through repo-local assumptions.

### Task, result, and status semantics

- Dali-local today:
  - Dali has operational execution semantics, but not yet a shared treaty-shaped status document.
- Interbeing v0 mapping:
  - `schemas/task-status.v0.json`
  - statuses: `queued`, `running`, `succeeded`, `failed`, `cancelled`
  - `progress_message`
  - `result_ref`
  - `error`
- Later expectation:
  - Dali-local progress and completion reporting should map into the shared status shape without forcing local inference/runtime internals into interbeing.

### Node identity declaration

- Dali-local today:
  - Dali identity is still carried through local bootstrap content and local runtime assumptions.
- Interbeing v0 mapping:
  - `schemas/node-identity.v0.json`
  - `node_id`
  - `role`
  - `capabilities`
  - `accepts_operations`
  - `notes`
- Later expectation:
  - Dali should declare its stable shared identity and accepted operations through the node-identity schema while keeping local identity files and bootstrap internals local.

### Bootstrap resolution expectations

- Dali-local today:
  - `hooks/telegram-dali-bootstrap/handler.ts` resolves local bootstrap files through compatibility env vars and legacy defaults.
- Interbeing v0 mapping:
  - indirect only
  - `docs/bootstrap-resolution-notes.md` explicitly says interbeing v0 does not solve local bootstrap resolution
- Later expectation:
  - interbeing should define the shared expectation for requested bootstrap material, not Dali-local file layout.

### Event and correlation concepts

- Dali-local today:
  - Dali has local bootstrap and execution surfaces, but no interbeing v0 event-envelope implementation yet.
- Interbeing v0 mapping:
  - `schemas/event-envelope.v0.json`
  - `event_id`
  - `event_type`
  - `node_id`
  - `correlation_id`
  - `timestamp`
  - `payload`
- Later expectation:
  - Dali-local task execution should be able to emit correlatable events without leaking local file-path assumptions into the shared contract.

## What Remains Dali-Local

- `telegram-dali` hook targeting
- Dali-specific compatibility env vars
- Dali bootstrap file layout and fallback behavior
- Dali local-exec profile and model alias choices
- Dali-specific operational doctrine and bootstrap content

## What Should Not Move Into Interbeing

- file-path conventions such as `nodes/dali/...`
- Dali-specific environment variable names
- Telegram-specific hook targeting
- Dali-only local inference settings
- Dali-local runtime wiring and adapters

## Open Source or Shared-Contract Gaps

- bootstrap identity resolution contract remains deferred
- richer capability discovery remains deferred
- event bus implementation remains deferred
- transport implementation remains deferred
- retries and timeout policy remains deferred
- memory and query federation remain deferred

These gaps match the explicit deferrals in `openclaw-interbeing/docs/deferred-items.md`.

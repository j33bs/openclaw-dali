# Contract Alignment Matrix

| Dali-local concept        | Current Dali surface                                     | Interbeing v0 concept                                  | Alignment status                      | Notes                                                                                                                |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Task receipt              | local orchestration and task entrypoints                 | `submit_task` in `schemas/task-envelope.v0.json`       | conceptually aligned, not implemented | Dali can later receive work through a shared task envelope without changing local execution internals first.         |
| Execution ownership       | Dali remains the execution-heavy node                    | `target_node`, `node_id`, `role`, `accepts_operations` | conceptually aligned, not implemented | Ownership semantics exist locally but are not yet emitted in a shared node/task contract.                            |
| Task status reporting     | local runtime status semantics only                      | `schemas/task-status.v0.json`                          | needs future adapter                  | Shared `queued/running/succeeded/failed/cancelled` states are available but not yet mapped by Dali runtime surfaces. |
| Result reference          | local execution output expectations                      | `result_ref` in `schemas/task-status.v0.json`          | needs future adapter                  | Interbeing v0 can point at results without forcing shared storage design.                                            |
| Error semantics           | local runtime/log semantics                              | `error.code`, `error.message`, `error.retryable`       | needs future adapter                  | No Dali-local treaty mapping exists yet.                                                                             |
| Node identity declaration | local bootstrap and local identity assumptions           | `schemas/node-identity.v0.json`                        | partially aligned                     | Dali identity exists locally, but shared declaration is not yet formalized in this repo.                             |
| Bootstrap resolution      | `hooks/telegram-dali-bootstrap/handler.ts` and `HOOK.md` | deferred by interbeing v0                              | intentionally local                   | Interbeing v0 explicitly does not solve local bootstrap resolution.                                                  |
| Event correlation         | no shared Dali event envelope yet                        | `schemas/event-envelope.v0.json` with `correlation_id` | needs future adapter                  | Dali should later map execution events into the shared envelope without moving local event sources into interbeing.  |
| Version pinning           | Dali branch/audit evidence only                          | `VERSIONING.md`                                        | ready for later pinning               | When runtime integration starts, Dali should pin `schema_version` explicitly instead of assuming latest.             |
| Transport                 | unspecified locally for interbeing                       | deferred by interbeing v0                              | intentionally deferred                | This should remain out of scope for the current Dali docs pass.                                                      |

## Summary

- Interbeing v0 already provides the right shared nouns for Dali task/status/event alignment.
- Dali is aligned at the conceptual boundary level, not yet at runtime adapter level.
- The remaining gaps are explicit v0 deferrals or expected future adapters, not hidden contract conflicts.

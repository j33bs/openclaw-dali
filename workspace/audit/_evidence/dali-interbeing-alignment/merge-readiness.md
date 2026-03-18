# Dali Merge Readiness

## Stable Enough For Merge Now

The following is stable enough for a later merge review:

- the Dali-owned bootstrap hook surface in `hooks/telegram-dali-bootstrap/`
- the Dali local-exec profile in `config/vllm/dali_local_exec.yaml`
- the local compatibility override contract in `hooks/telegram-dali-bootstrap/handler.ts`
- the accumulated Dali audit trail under:
  - `workspace/audit/_evidence/dali-owned-surface-import/`
  - `workspace/audit/_evidence/dali-bootstrap-decoupling/`
  - `workspace/audit/_evidence/dali-post-decoupling-check/`
  - `workspace/audit/_evidence/dali-interbeing-alignment/`

This unit is narrow, reversible, and documented. It does not require additional runtime refactor before a merge-readiness decision.

## Alignment With Interbeing v0

Interbeing v0 is a shared treaty layer only. It owns:

- task envelopes
- task status shape
- event envelope shape
- node identity schema
- shared concept definitions
- versioning guidance

Dali remains aligned with that direction because its current bootstrap/import work stays local and documented rather than pretending to implement a shared runtime contract prematurely.

## Intentionally Deferred

- `telegram-dali` remains the explicit target surface for the hook.
- Legacy fallback still points at the historical `nodes/dali/...` layout when no env overrides are set.
- Dali still has no first-class runtime implementation of interbeing v0 task/status/event envelopes.
- Bootstrap identity resolution is still local and compatibility-based.
- TACTI reader coupling remains outside this repo and outside interbeing v0.

## What Still Blocks A Deeper Dali/Source Split

- no first-class Source/shared bootstrap resolver by node identity
- no local Dali adapter yet emitting or consuming interbeing v0 envelopes
- no shared contract yet for bootstrap identity resolution, which interbeing v0 explicitly defers
- no shared contract yet for memory/query federation, which interbeing v0 also defers
- deferred TACTI reader coupling remains outside the current Dali-local surface

## Can `main` Be Updated After Interbeing v0 Review

- `yes`, after interbeing v0 review

Reason:

- interbeing v0 does not require Dali to refactor local bootstrap internals yet
- the Dali-local surfaces are already isolated enough for a narrow merge
- the remaining blockers are explicitly deferred by interbeing v0 rather than silently incompatible with it

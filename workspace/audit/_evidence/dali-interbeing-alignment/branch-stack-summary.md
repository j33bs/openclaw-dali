# Dali Branch Stack Summary

## Scope

- Current branch: `codex/docs/dali-interbeing-alignment`
- Base branch reviewed: `codex/refactor/dali-bootstrap-decoupling`
- Prior Dali stack reviewed:
  - `codex/bootstrap/dali-owned-surface-import`
  - `codex/refactor/dali-bootstrap-decoupling`

## `codex/bootstrap/dali-owned-surface-import`

Purpose:

- Make clearly Dali-owned material explicit in this repo without broad extraction.
- Classify what stayed Source-owned, shared-governance, or unresolved.

Outcome:

- Imported the Dali-owned surfaces:
  - `hooks/telegram-dali-bootstrap/handler.ts`
  - `hooks/telegram-dali-bootstrap/HOOK.md`
  - `config/vllm/dali_local_exec.yaml`
- Added the ownership evidence bundle under `workspace/audit/_evidence/dali-owned-surface-import/`.
- Left Source-owned, shared-governance, and unresolved items outside the import scope.

## `codex/refactor/dali-bootstrap-decoupling`

Purpose:

- Reduce Dali bootstrap path coupling without changing runtime behavior.
- Document the local-exec deployment contract for the imported Dali surface.

Outcome:

- `hooks/telegram-dali-bootstrap/handler.ts` now supports:
  - `OPENCLAW_DALI_BOOTSTRAP_ROOT`
  - `OPENCLAW_DALI_BOOTSTRAP_IDENTITY_PATH`
  - `OPENCLAW_DALI_BOOTSTRAP_USER_PATH`
  - `OPENCLAW_DALI_BOOTSTRAP_MEMORY_PATH`
- `hooks/telegram-dali-bootstrap/HOOK.md` documents the layout and override contract.
- `config/vllm/dali_local_exec.yaml` documents its deployment contract.
- Added decoupling evidence under `workspace/audit/_evidence/dali-bootstrap-decoupling/`.
- The branch tip also carries the verification-only follow-up under `workspace/audit/_evidence/dali-post-decoupling-check/`.

## Net Result Before Interbeing Alignment

- Dali-owned bootstrap and execution surfaces are explicit in this repo.
- The most brittle bootstrap path assumptions now have compatibility overrides.
- Remaining coupling is documented and intentionally deferred.
- Deeper Source/Dali split work still depends on later shared-contract work rather than additional local refactors.

# Dali Bootstrap Decoupling Audit

## Scope

- Branch: `codex/refactor/dali-bootstrap-decoupling`
- Base branch: `codex/bootstrap/dali-owned-surface-import`
- Goal: reduce Dali-local bootstrap/inference path coupling without changing runtime behavior.

## Exact Path Assumptions Found

### `hooks/telegram-dali-bootstrap/handler.ts`

- The hook previously hard-coded three repo-relative paths:
  - `nodes/dali/bootstrap/IDENTITY.md`
  - `nodes/dali/bootstrap/USER.md`
  - `nodes/dali/MEMORY.md`
- Those paths were resolved relative to `workspaceDir`, so separation from the old monorepo layout required editing code rather than configuration.

### `hooks/telegram-dali-bootstrap/HOOK.md`

- The hook description explained the behavior but did not document the required file layout or any override contract.

### `config/vllm/dali_local_exec.yaml`

- The template did not depend on repo filesystem layout, but it implicitly treated the default local endpoint and served model alias as self-evident rather than as the stable caller contract.

## Assumptions Reduced In This Pass

### Reduced: hard-coded bootstrap file layout in `hooks/telegram-dali-bootstrap/handler.ts`

- Added explicit environment-driven overrides:
  - `OPENCLAW_DALI_BOOTSTRAP_ROOT`
  - `OPENCLAW_DALI_BOOTSTRAP_IDENTITY_PATH`
  - `OPENCLAW_DALI_BOOTSTRAP_USER_PATH`
  - `OPENCLAW_DALI_BOOTSTRAP_MEMORY_PATH`
- Compatibility order is now:
  1. file-specific env override
  2. shared bootstrap root env for `IDENTITY.md` and `USER.md`
  3. legacy repo-relative default
- Result: later extraction can relocate Dali bootstrap files without editing the hook, while current behavior stays unchanged when no env vars are set.

### Reduced: undocumented path contract in `hooks/telegram-dali-bootstrap/HOOK.md`

- Documented the default compatibility layout.
- Documented the override env vars and resolution order.
- Documented that relative overrides resolve from `workspace.dir` and absolute paths are also allowed.

### Reduced: implicit caller contract in `config/vllm/dali_local_exec.yaml`

- Added comments that treat `served_model_name`, `openai_compat.base_url`, and `api_key_env` as the explicit deployment contract.
- This does not change runtime values; it only clarifies how callers should stay decoupled from repo-local launch assumptions.

## Assumptions Remaining

- The hook still targets only agent id `telegram-dali`.
- Legacy fallback paths still assume the historical layout under `nodes/dali/` when no env overrides are provided.
- Relative override paths still depend on `workspaceDir` being the correct contract root for the hook runtime.
- `config/vllm/dali_local_exec.yaml` still assumes a local endpoint at `127.0.0.1:8001` by default; this is a deployment default, not a repo path, so it was documented rather than changed.

## What Still Blocks Future Extraction

- There is still no first-class Source contract for resolving Dali bootstrap files by node identity.
- The hook remains a Dali-local compatibility shim rather than a generic bootstrap resolver.
- `workspace/tacti/arousal_oscillator.py` and `workspace/tacti/dream_consolidation.py` still couple shared routines to `nodes/dali` memory via direct filesystem reads; this pass intentionally left them untouched.
- If the future extracted layout needs non-file bootstrap sources, this hook will need a broader contract change rather than more path shims.

# Bootstrap Validation

## Scope

- Branch: `codex/refactor/dali-bootstrap-decoupling`
- Validation type: static integrity review only
- Files inspected:
  - `hooks/telegram-dali-bootstrap/handler.ts`
  - `hooks/telegram-dali-bootstrap/HOOK.md`
  - `config/vllm/dali_local_exec.yaml`

## Validation Result

- No obvious logic bug found in the imported Dali bootstrap surfaces.
- The current decoupling remains behavior-preserving when no env overrides are set.
- The documented env override contract matches the current code.

## Handler Resolution Logic

### Env override precedence

`hooks/telegram-dali-bootstrap/handler.ts` resolves bootstrap files in this order:

1. file-specific env override
   - `OPENCLAW_DALI_BOOTSTRAP_IDENTITY_PATH`
   - `OPENCLAW_DALI_BOOTSTRAP_USER_PATH`
   - `OPENCLAW_DALI_BOOTSTRAP_MEMORY_PATH`
2. shared bootstrap root override for `IDENTITY.md` and `USER.md`
   - `OPENCLAW_DALI_BOOTSTRAP_ROOT`
3. legacy repo-relative defaults
   - `nodes/dali/bootstrap/IDENTITY.md`
   - `nodes/dali/bootstrap/USER.md`
   - `nodes/dali/MEMORY.md`

### Path resolution behavior

- Relative override paths are resolved from `workspaceDir` via `path.resolve(workspaceDir, relPath)`.
- Absolute override paths are also supported because `path.resolve()` preserves absolute inputs.
- Empty env values are trimmed to `null`, so they do not suppress fallback behavior.

### Fallback behavior

- If the hook event is not `agent:bootstrap`, the hook exits cleanly.
- If `agentId` is not `telegram-dali`, the hook exits cleanly.
- If `workspaceDir` is missing or `bootstrapFiles` is not an array, the hook exits cleanly.
- If an override path cannot be read, the hook logs a warning and leaves that replacement unset.
- If no replacement files load successfully, the hook leaves `context.bootstrapFiles` unchanged.
- If one or more replacement files load, the hook replaces matching injected files by basename and appends any missing replacement files.

## Config and Doc Consistency

- `hooks/telegram-dali-bootstrap/HOOK.md` documents the same env vars and the same resolution order implemented in code.
- `config/vllm/dali_local_exec.yaml` now treats `served_model_name`, `openai_compat.base_url`, and `api_key_env` as the deployment contract and does not introduce extra repo-path assumptions.

## Caveats Still Intentionally Present

- `OPENCLAW_DALI_BOOTSTRAP_ROOT` covers only `IDENTITY.md` and `USER.md`; moving `MEMORY.md` still requires `OPENCLAW_DALI_BOOTSTRAP_MEMORY_PATH`.
- The hook still intentionally targets only `telegram-dali`.
- Legacy fallback still depends on the historical `nodes/dali/...` layout when no overrides are set.

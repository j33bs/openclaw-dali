# Conflicts

## Reference Path Availability

- Requested reference path: `/Users/heathyeager/clawd`
- Observed in this environment: path not present
- Resolution: used the available local Source checkout at `/home/jeebs/src/clawd` after verifying it contained each requested relative path.

## Target Path Conflicts

- None.
- `hooks/telegram-dali-bootstrap/handler.ts` did not exist in the target repo before import.
- `hooks/telegram-dali-bootstrap/HOOK.md` did not exist in the target repo before import.
- `config/vllm/dali_local_exec.yaml` did not exist in the target repo before import.

## Ignore-Rule Conflicts

- None.
- `.gitignore` excludes `.DS_Store`, `__pycache__/`, `*.pyc`, and other local artifacts, but it does not exclude `hooks/`, `config/`, or `workspace/audit/_evidence/`.

## Resolution Summary

- Import was additive only.
- No preserve-both fallback was needed because there were no target-path collisions.
- No ignored junk files were copied from the Source checkout.

# Coupling Scan

## Scope

Search terms requested for this pass:

- `nodes/dali`
- `telegram-dali`
- `workspace/memory`
- absolute paths

Search method:

- `rg` over the current repo, excluding `node_modules`, `.git`, `dist`, generated docs, and bundled viewer assets

## Findings

| Pattern                                   | File                                                                         | Classification            | Reason                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodes/dali`                              | `hooks/telegram-dali-bootstrap/HOOK.md`                                      | acceptable (intentional)  | Documents the legacy compatibility layout that the hook still supports.                                                                     |
| `telegram-dali`                           | `hooks/telegram-dali-bootstrap/handler.ts`                                   | acceptable (intentional)  | The hook is explicitly Dali-owned and intentionally scoped to the `telegram-dali` agent surface.                                            |
| `telegram-dali`                           | `hooks/telegram-dali-bootstrap/HOOK.md`                                      | acceptable (intentional)  | Documents the intended target surface for the hook.                                                                                         |
| `nodes/dali`                              | `workspace/audit/_evidence/dali-bootstrap-decoupling/decoupling-audit.md`    | acceptable (intentional)  | Prior audit evidence recording the preserved fallback layout.                                                                               |
| `nodes/dali`                              | `workspace/audit/_evidence/dali-owned-surface-import/dali-classification.md` | acceptable (intentional)  | Import/classification evidence, not runtime coupling.                                                                                       |
| `workspace/memory`                        | `workspace/audit/_evidence/dali-owned-surface-import/dali-classification.md` | acceptable (intentional)  | Historical evidence describing deferred TACTI reader coupling from the Source repo analysis.                                                |
| `workspace/memory`                        | `workspace/audit/_evidence/dali-owned-surface-import/coupling-hotspots.md`   | acceptable (intentional)  | Historical evidence documenting known deferred coupling, not active code in this repo.                                                      |
| `workspace/memory`                        | `docs/automation/hooks.md` and `docs/cli/hooks.md`                           | acceptable (intentional)  | Generic OpenClaw documentation for the shared workspace-memory default, not Dali-local coupling.                                            |
| absolute paths                            | Dockerfiles, scripts, tests, onboarding UI, docs                             | acceptable (out of scope) | Generic platform/container/test fixtures across the wider repo; none were found in the imported Dali bootstrap surfaces.                    |
| `nodes/dali` fallback in runtime behavior | `hooks/telegram-dali-bootstrap/handler.ts` via `DEFAULT_OVERRIDES`           | needs future decoupling   | Preserved intentionally for compatibility, but still ties default behavior to the historical monorepo layout.                               |
| lack of generic bootstrap contract        | no local contract file or resolver surface                                   | needs future decoupling   | Future extraction still needs a Source/shared contract for resolving node-local bootstrap files by identity rather than by path convention. |
| TACTI reader coupling                     | not present in active Dali repo code; documented in prior evidence only      | needs future decoupling   | Shared readers outside this repo still depend on `workspace/memory` and `nodes/dali/memory`, which blocks a cleaner later split.            |

## Potential Bugs

- None found in the imported Dali bootstrap surfaces during this static scan.

## Summary

- Acceptable intentional couplings remain in documentation, prior audit evidence, and the explicit `telegram-dali` targeting.
- Future-decoupling items remain the legacy `nodes/dali/...` fallback and the absence of a first-class shared bootstrap contract.
- No new Dali-local absolute-path bug was found.

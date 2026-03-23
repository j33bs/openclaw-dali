# Dali-Owned Surface Classification

## Scope

- Target repo: `openclaw-dali`
- Requested Source repo path: `/Users/heathyeager/clawd`
- Available Source checkout used for inspection in this environment: `/home/jeebs/src/clawd`
- Rule for this pass: import only clearly Dali-owned node-local material and document everything else.

## Top-Level Summary

### canonical_dali

- Current repo before this pass: no `nodes/dali/` tree and no root-level Dali bootstrap or Dali execution-config surfaces were present.
- Reference Source repo canonical Dali node-local roots remain under `nodes/dali/`, including `nodes/dali/IDENTITY.md`, `nodes/dali/MEMORY.md`, `nodes/dali/bootstrap/IDENTITY.md`, and `nodes/dali/bootstrap/USER.md`.

### imported_now

- `hooks/telegram-dali-bootstrap/handler.ts`
- `hooks/telegram-dali-bootstrap/HOOK.md`
- `config/vllm/dali_local_exec.yaml`

### source_owned

- `core/node_identity.js`

### shared_governance

- `HEARTBEAT.md`
- `workspace/IDENTITY.md`
- `workspace/CLAUDE_CODE.md`

### unresolved

- `MEMORY.md`
- `workspace/MEMORY.md`
- `workspace/tacti/arousal_oscillator.py`
- `workspace/tacti/dream_consolidation.py`

Notes:

- The unresolved bucket includes both `unresolved_manual_review` items and transition adapters that still hard-code Dali filesystem assumptions.
- Nothing outside the three imported paths was copied into this repo in this pass.

## Exact Path Classification

| Path                                       | Decision                    | Rationale                                                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/telegram-dali-bootstrap/handler.ts` | `import_to_dali_now`        | The hook targets only `telegram-dali` and replaces bootstrap payloads with `nodes/dali/bootstrap/IDENTITY.md`, `nodes/dali/bootstrap/USER.md`, and `nodes/dali/MEMORY.md`. That is a Dali-local bootstrap adapter, not shared substrate. |
| `hooks/telegram-dali-bootstrap/HOOK.md`    | `import_to_dali_now`        | The manifest describes a Dali-specific `agent:bootstrap` hook whose sole purpose is to project Dali identity and memory into the `telegram-dali` surface.                                                                                |
| `config/vllm/dali_local_exec.yaml`         | `import_to_dali_now`        | The filename, comments, and model naming make this a Dali-local execution template rather than shared platform config.                                                                                                                   |
| `core/node_identity.js`                    | `keep_in_source`            | This file is shared node-resolution substrate under `core/`. It reads `workspace/policy/system_map.json` and exposes generic node identity helpers even though the fallback default is currently Dali-biased.                            |
| `workspace/tacti/arousal_oscillator.py`    | `transitional_adapter_only` | The routine lives under shared `workspace/tacti/` and reads both `workspace/memory` and `nodes/dali/memory` directly. That makes it a coupling adapter, not clean canonical Dali ownership.                                              |
| `workspace/tacti/dream_consolidation.py`   | `transitional_adapter_only` | The routine stays under shared `workspace/tacti/` but directly merges `workspace/memory` and `nodes/dali/memory` inputs. It should later use a contract-level memory root instead of hard-coded Dali paths.                              |
| `HEARTBEAT.md`                             | `keep_in_shared_governance` | The file declares its canonical location as `workspace/governance/HEARTBEAT.md` and acts as a repo-wide governance mirror rather than a Dali node-local surface.                                                                         |
| `MEMORY.md`                                | `unresolved_manual_review`  | The repo-root memory mixes operator preferences, project state, system beings, and Dali-specific status. It is Dali-adjacent, but not cleanly separable into node-local versus shared memory without a manual split.                     |
| `workspace/MEMORY.md`                      | `unresolved_manual_review`  | The workspace memory captures Dali rebranding, Telegram routing, and multi-agent operational history, but it is still framed as workspace-wide long-term memory rather than a clean node-local root.                                     |
| `workspace/IDENTITY.md`                    | `keep_in_shared_governance` | The document explicitly defines the default workspace orchestrator identity and distinguishes that from direct-user surface routing. That is a shared governance boundary document, not a Dali node-local import target.                 |
| `workspace/CLAUDE_CODE.md`                 | `keep_in_shared_governance` | This file governs the paired heavy-coding agent and its audit/delegation process. It is workspace governance and role coordination, not Dali node-local material.                                                                        |

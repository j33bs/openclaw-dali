# Coupling Hotspots

This pass only documents these hotspots. It does not refactor them.

## `core/node_identity.js`

- The shared node-identity resolver falls back to `systemMap.default_node_id || "dali"`.
- This keeps a Dali-biased default inside shared substrate, even though the file is conceptually Source-owned.
- Follow-up direction: keep the resolver in Source, but move callers and defaults toward explicit contract-level node selection.

## `hooks/telegram-dali-bootstrap/handler.ts`

- The hook is clearly Dali-owned, but it assumes the in-repo paths `nodes/dali/bootstrap/IDENTITY.md`, `nodes/dali/bootstrap/USER.md`, and `nodes/dali/MEMORY.md`.
- That makes it a local bootstrap adapter rather than a portable Source contract.
- Follow-up direction: retain the adapter for now, but later replace hard-coded path reach-ins with an explicit Source bootstrap contract or node-local surface registry.

## `workspace/tacti/arousal_oscillator.py`

- `_memory_paths()` reads both `workspace/memory` and `nodes/dali/memory`.
- This mixes shared workspace state with Dali-local memory through direct filesystem assumptions.
- Follow-up direction: route memory access through a node contract or declared memory roots instead of hard-coded Dali paths.

## `workspace/tacti/dream_consolidation.py`

- `_memory_sources()` reads both `workspace/memory/<day>.md` and `nodes/dali/memory/<day>.md`.
- This is another shared routine reaching into Dali-local state without a Source-level contract.
- Follow-up direction: resolve memory roots through a shared contract boundary before consolidating cross-node memory.

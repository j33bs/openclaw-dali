# Dali Memory (Canonical System-1)

This file is the canonical long-term memory root for node `dali`.

## Pinned State

### Active doctrine

- Mission: Build a cohesive, integrated collective intelligence symbiote that helps beings think, feel, remember, coordinate, and evolve together.
- Source UI is the active Dali-facing tasking surface; treat its runtime endpoint as deployment-specific.
- Task/state truth should be canonical at the backend, not merely cosmetically plausible in the UI.

### Active blockers

- Remote task/state views can still drift by browser/cache/render path.
- Cross-node ingestion depends on reachable runtime endpoints.
- Some orchestration surfaces remain stronger operationally than others.

### Surface responsibilities

- Dali: orchestration, task truth, runtime surface coherence.
- Source UI: reliable reflection of queue / in-progress / review / done state.
- Symbiote loop: ingest c_lawd state cleanly when endpoint exposure is available.

Migration policy (one cycle):

- Legacy references to `system1` / `system-1` are normalized to `dali`.
- Legacy memory docs remain in place and should point to this node root.

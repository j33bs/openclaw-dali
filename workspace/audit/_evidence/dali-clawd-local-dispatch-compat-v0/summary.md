# Dali C_Lawd Local Dispatch Compatibility v0

- Branch: `codex/harden/interbeing-watcher-service-ops-v1`
- Implementation commit: `9fffe1ff99559433835070330dfece1778bc10f3`
- Proof artifact: faithful fixture mirroring the C_Lawd-emitted flat `payload.local_dispatch` shape, because no live C_Lawd-originated local-dispatch artifact was present in this checkout.

## Results

- The runtime now accepts the flat C_Lawd fields `target_role`, `source_role`, `chain_id`, `parent_task_id`, `hop_count`, and `max_hops` without changing watcher intake, duplicate, replay, verify, list, or health semantics.
- `target_role` resolves to the existing local dispatch `role`; `source_role` resolves to receipt lineage `parent_role`; flat chain fields resolve into the existing receipt lineage object.
- `verify` now includes `local_dispatch` when a receipt-backed match exists.
- `pnpm build` passed.
- `pnpm test -- test/interbeing-watcher-v0.test.ts` passed with `15 passed`.
- The live service autonomously consumed `2026-03-19T12-43-10Z--clawd-reviewer-compat-live.task-envelope.v0.json` after restart and produced a processed receipt with reviewer lineage preserved.

## Residuals

- `health` remains `warning` because the journal still includes an older forced-kill warning and the watcher log still includes an earlier failed pre-restart proof attempt plus the older invalid-schema proof artifact.
- The service remains enabled and running after verification.

# Notes

## Remaining Bootstrap Coupling

- `hooks/telegram-dali-bootstrap/handler.ts` still defaults to the historical `nodes/dali/bootstrap/IDENTITY.md`, `nodes/dali/bootstrap/USER.md`, and `nodes/dali/MEMORY.md` layout when no env overrides are set.
- The hook still intentionally targets only `telegram-dali`.
- `OPENCLAW_DALI_BOOTSTRAP_ROOT` does not relocate `MEMORY.md`; that still requires `OPENCLAW_DALI_BOOTSTRAP_MEMORY_PATH`.

## Missing Shared Contract

- There is still no first-class Source/shared contract for resolving Dali bootstrap content by node identity.
- Current decoupling is a compatibility shim, not a generic bootstrap resolution surface.

## TACTI Reader Coupling

- The known `workspace/tacti` readers were intentionally not changed in earlier Dali passes.
- They are not active local code in this repo, but they remain a blocker for future extraction because the broader system still has shared readers that assume `workspace/memory` and `nodes/dali/memory`.

## What Still Blocks Future Extraction

- A shared bootstrap contract does not yet exist.
- Legacy fallback behavior still depends on the old Dali path layout.
- Telegram-specific hook targeting has not been generalized and should remain unchanged until a real shared contract exists.

## Current Assessment

- The current Dali bootstrap decoupling is internally consistent.
- No new refactor is warranted in this audit-only pass.
- Deferred work is architectural follow-up, not a correctness regression in the current imported surfaces.

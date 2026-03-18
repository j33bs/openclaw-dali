# Rollback Notes

This pass hardens the existing local watcher with:

- classified receipts for processed, failed, and skipped artifacts
- operator status, list, verify, and replay control surfaces
- one-shot force-reprocess overrides
- expanded smoke evidence and focused watcher tests

To rollback after commit:

```bash
git revert --no-edit <commit-sha>
```

If reverting before commit, remove:

- `scripts/interbeing/watcher_v0_support.ts`
- `scripts/interbeing/README.md`
- `test/interbeing-watcher-v0.test.ts`

And restore:

- `scripts/interbeing/watch_handoff_v0.ts`
- `scripts/interbeing/run_watcher_v0.ts`
- `scripts/dev/test_interbeing_watcher_v0.ts`
- `workspace/audit/_evidence/interbeing-watcher-v0/`

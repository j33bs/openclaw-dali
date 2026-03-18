# Rollback Notes

This pass adds a local Dali intake watcher, a small watcher CLI wrapper, a focused
watcher smoke, and the watcher evidence bundle.

To rollback after commit:

```bash
git revert --no-edit <commit-sha>
```

If reverting before commit, remove:

- `scripts/interbeing/`
- `scripts/dev/test_interbeing_watcher_v0.ts`
- `workspace/audit/_evidence/interbeing-watcher-v0/`

And restore:

- `scripts/dev/interbeing-e2e-local-v0.ts`

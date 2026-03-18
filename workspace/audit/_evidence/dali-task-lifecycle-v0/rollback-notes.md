# Rollback Notes

This pass is additive and isolated.

To rollback after commit:

```bash
git revert --no-edit <commit-sha>
```

If reverting before commit, remove:

- `src/shared/interbeing-task-lifecycle-v0.ts`
- `src/shared/interbeing-task-lifecycle-v0.test.ts`
- `workspace/audit/_evidence/dali-task-lifecycle-v0/`

And restore:

- `README.md`

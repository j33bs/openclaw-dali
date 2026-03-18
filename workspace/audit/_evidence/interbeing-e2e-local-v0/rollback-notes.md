# Rollback Notes

This pass adds one local harness script and a generated evidence bundle.

To rollback after commit:

```bash
git revert --no-edit <commit-sha>
```

If reverting before commit, remove:

- `scripts/dev/interbeing-e2e-local-v0.ts`
- `workspace/audit/_evidence/interbeing-e2e-local-v0/`

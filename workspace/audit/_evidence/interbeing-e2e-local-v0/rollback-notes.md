# Rollback Notes

This pass adds one handoff-file fixture, extends the local harness metadata for
file-input runs, and refreshes the generated evidence bundle.

To rollback after commit:

```bash
git revert --no-edit <commit-sha>
```

If reverting before commit, remove:

- `scripts/dev/fixtures/interbeing-handoff-task-envelope.v0.json`
- `scripts/dev/interbeing-e2e-local-v0.ts`
- `workspace/audit/_evidence/interbeing-e2e-local-v0/`

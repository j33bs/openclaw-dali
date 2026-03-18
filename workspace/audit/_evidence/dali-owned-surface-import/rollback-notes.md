# Rollback Notes

This pass is additive only. No existing target files were overwritten.

Preferred rollback after commit:

- `git revert --no-edit HEAD`

Manual rollback before sharing the commit:

- `git rm -r hooks/telegram-dali-bootstrap`
- `git rm config/vllm/dali_local_exec.yaml`
- `git rm -r workspace/audit/_evidence/dali-owned-surface-import`
- `git checkout -- README.md`

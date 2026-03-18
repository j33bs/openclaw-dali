# Rollback Notes

This pass is minimal and behavior-preserving. Legacy bootstrap defaults remain intact.

Preferred rollback after commit:

- `git revert --no-edit HEAD`

Manual rollback before sharing the commit:

- `git rm -r workspace/audit/_evidence/dali-bootstrap-decoupling`
- `git checkout -- hooks/telegram-dali-bootstrap/handler.ts`
- `git checkout -- hooks/telegram-dali-bootstrap/HOOK.md`
- `git checkout -- config/vllm/dali_local_exec.yaml`

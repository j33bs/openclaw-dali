---
name: telegram-dali-bootstrap
description: "Swap Dali bootstrap files into telegram-dali without moving the workspace root"
homepage: https://docs.openclaw.ai/automation/hooks
metadata:
  {
    "openclaw":
      { "emoji": "🎨", "events": ["agent:bootstrap"], "requires": { "config": ["workspace.dir"] } },
  }
---

# Telegram Dali Bootstrap Hook

Replaces the injected bootstrap files for `telegram-dali` so the Telegram DM
surface gets Dali identity and memory while still running in the repo root
workspace with full tool/file access.

## Path Contract

Default compatibility layout:

- `nodes/dali/bootstrap/AGENTS.md`
- `nodes/dali/bootstrap/IDENTITY.md`
- `nodes/dali/bootstrap/USER.md`
- `nodes/dali/MEMORY.md`

To decouple the hook from that exact layout, set one or more environment
variables before the hook runs:

- `OPENCLAW_DALI_BOOTSTRAP_ROOT`
- `OPENCLAW_DALI_BOOTSTRAP_AGENTS_PATH`
- `OPENCLAW_DALI_BOOTSTRAP_IDENTITY_PATH`
- `OPENCLAW_DALI_BOOTSTRAP_USER_PATH`
- `OPENCLAW_DALI_BOOTSTRAP_MEMORY_PATH`

Resolution order:

1. File-specific env var for the requested file
2. `OPENCLAW_DALI_BOOTSTRAP_ROOT` for `IDENTITY.md` and `USER.md`
3. Legacy default repo-relative path

Relative override paths resolve from `workspace.dir`. Absolute paths are also
accepted.

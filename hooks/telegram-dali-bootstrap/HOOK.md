---
name: telegram-dali-bootstrap
description: "Swap Dali bootstrap files into telegram-dali without moving the workspace root"
homepage: https://docs.openclaw.ai/automation/hooks
metadata:
  {
    "openclaw":
      {
        "emoji": "🎨",
        "events": ["agent:bootstrap"],
        "requires": { "config": ["workspace.dir"] },
      },
  }
---

# Telegram Dali Bootstrap Hook

Replaces the injected bootstrap files for `telegram-dali` so the Telegram DM
surface gets Dali identity and memory while still running in the repo root
workspace with full tool/file access.

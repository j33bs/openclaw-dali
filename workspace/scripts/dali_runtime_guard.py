#!/usr/bin/env python3
"""Validate Dali/OpenClaw runtime invariants that affect Telegram quality."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


TELEGRAM_AGENT_ID = "telegram-dali"
TELEGRAM_DIRECT_ID = "8159253715"
ALLOWED_TELEGRAM_MODELS = {
    "openai-codex/gpt-5.4",
    "openai/gpt-5.4",
}
EXPECTED_TELEGRAM_IDENTITY_NAME = "Dali"
REQUIRED_HEARTBEAT_SESSION = "agent:main:heartbeat"
FORBIDDEN_GLOBAL_TOOLS = {"browser", "group:web"}
REQUIRED_PROVIDER_ALLOWLIST = {
    "openai",
    "openai-codex",
    "minimax-portal",
    "local_vllm",
}
DISALLOWED_TELEGRAM_TOOL_PROFILES = {"minimal", "messaging"}
REQUIRED_TELEGRAM_TOOLS = {
    "read",
    "write",
    "edit",
    "apply_patch",
    "exec",
    "process",
    "memory_search",
    "memory_get",
    "agents_list",
    "sessions_send",
    "sessions_spawn",
    "sessions_yield",
    "subagents",
}
REQUIRED_INTERNAL_HOOK = "telegram-dali-bootstrap"
REQUIRED_REPO_FILES = (
    Path("hooks/telegram-dali-bootstrap/HOOK.md"),
    Path("hooks/telegram-dali-bootstrap/handler.ts"),
    Path("nodes/dali/bootstrap/AGENTS.md"),
    Path("nodes/dali/bootstrap/SOUL.md"),
    Path("nodes/dali/bootstrap/TOOLS.md"),
    Path("nodes/dali/bootstrap/IDENTITY.md"),
    Path("nodes/dali/bootstrap/USER.md"),
    Path("nodes/dali/MEMORY.md"),
)


def _resolve_telegram_memory_search(
    cfg: Dict[str, object], agent_id: str
) -> Tuple[bool, bool, List[str]]:
    agents_cfg = cfg.get("agents")
    defaults = agents_cfg.get("defaults") if isinstance(agents_cfg, dict) else None
    defaults_memory = defaults.get("memorySearch") if isinstance(defaults, dict) else None
    agent = _agent_by_id(cfg, agent_id)
    agent_memory = agent.get("memorySearch") if isinstance(agent, dict) else None

    enabled = True
    experimental_session_memory = False
    sources: List[str] = ["memory"]

    if isinstance(defaults_memory, dict):
        if isinstance(defaults_memory.get("enabled"), bool):
            enabled = defaults_memory["enabled"]
        experimental = defaults_memory.get("experimental")
        if isinstance(experimental, dict) and isinstance(
            experimental.get("sessionMemory"), bool
        ):
            experimental_session_memory = experimental["sessionMemory"]
        raw_sources = defaults_memory.get("sources")
        if isinstance(raw_sources, list) and raw_sources:
            sources = [str(item).strip() for item in raw_sources if str(item).strip()]

    if isinstance(agent_memory, dict):
        if isinstance(agent_memory.get("enabled"), bool):
            enabled = agent_memory["enabled"]
        experimental = agent_memory.get("experimental")
        if isinstance(experimental, dict) and isinstance(
            experimental.get("sessionMemory"), bool
        ):
            experimental_session_memory = experimental["sessionMemory"]
        raw_sources = agent_memory.get("sources")
        if isinstance(raw_sources, list) and raw_sources:
            sources = [str(item).strip() for item in raw_sources if str(item).strip()]

    normalized_sources = []
    seen = set()
    for item in sources:
        if item and item not in seen:
            seen.add(item)
            normalized_sources.append(item)

    return enabled, experimental_session_memory, normalized_sources or ["memory"]


def _resolve_telegram_tooling(
    cfg: Dict[str, object], agent_id: str
) -> Tuple[Optional[str], bool, List[str]]:
    tools_cfg = cfg.get("tools") if isinstance(cfg.get("tools"), dict) else None
    agent = _agent_by_id(cfg, agent_id)
    agent_tools = agent.get("tools") if isinstance(agent, dict) else None

    profile: Optional[str] = None
    apply_patch_enabled = False
    deny: List[str] = []

    def merge_deny(raw: object) -> None:
        if not isinstance(raw, list):
            return
        for item in raw:
            value = str(item).strip()
            if value:
                deny.append(value)

    def merge_exec(raw_tools: object) -> None:
        nonlocal apply_patch_enabled
        if not isinstance(raw_tools, dict):
            return
        exec_cfg = raw_tools.get("exec")
        if not isinstance(exec_cfg, dict):
            return
        apply_patch_cfg = exec_cfg.get("applyPatch")
        if not isinstance(apply_patch_cfg, dict):
            return
        if isinstance(apply_patch_cfg.get("enabled"), bool):
            apply_patch_enabled = apply_patch_cfg["enabled"]

    if isinstance(tools_cfg, dict):
        raw_profile = tools_cfg.get("profile")
        if isinstance(raw_profile, str) and raw_profile.strip():
            profile = raw_profile.strip()
        merge_deny(tools_cfg.get("deny"))
        merge_exec(tools_cfg)

    if isinstance(agent_tools, dict):
        raw_profile = agent_tools.get("profile")
        if isinstance(raw_profile, str) and raw_profile.strip():
            profile = raw_profile.strip()
        merge_deny(agent_tools.get("deny"))
        merge_exec(agent_tools)

    normalized_deny = []
    seen = set()
    for item in deny:
        if item not in seen:
            seen.add(item)
            normalized_deny.append(item)

    return profile, apply_patch_enabled, normalized_deny


def _repo_root() -> Path:
    env_root = os.environ.get("OPENCLAW_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()

    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / ".git").exists():
            return parent
    return Path.cwd().resolve()


def _load_json(path: Path) -> Dict[str, object]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} root must be a JSON object")
    return data


def _load_env_dir(path: Path) -> Dict[str, str]:
    env: Dict[str, str] = {}
    if not path.exists() or not path.is_dir():
        return env
    for conf in sorted(path.glob("*.conf")):
        for raw_line in conf.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or not line.startswith("Environment="):
                continue
            body = line[len("Environment="):].strip()
            if body.startswith('"') and body.endswith('"') and len(body) >= 2:
                body = body[1:-1]
            if "=" not in body:
                continue
            key, value = body.split("=", 1)
            key = key.strip()
            value = value.strip()
            if key:
                env[key] = value
    return env


def _agent_by_id(cfg: Dict[str, object], agent_id: str) -> Optional[Dict[str, object]]:
    agents_cfg = cfg.get("agents")
    if not isinstance(agents_cfg, dict):
        return None
    agent_list = agents_cfg.get("list")
    if not isinstance(agent_list, list):
        return None
    for entry in agent_list:
        if isinstance(entry, dict) and entry.get("id") == agent_id:
            return entry
    return None


def _iter_route_bindings(cfg: Dict[str, object]) -> Iterable[Dict[str, object]]:
    bindings = cfg.get("bindings")
    if not isinstance(bindings, list):
        return []
    return [b for b in bindings if isinstance(b, dict) and b.get("type") == "route"]


def validate_openclaw_config(cfg: Dict[str, object]) -> List[str]:
    issues: List[str] = []

    telegram_agent = _agent_by_id(cfg, TELEGRAM_AGENT_ID)
    if telegram_agent is None:
        issues.append("missing_telegram_agent")
    else:
        model = str(telegram_agent.get("model", "")).strip()
        if model not in ALLOWED_TELEGRAM_MODELS:
            issues.append(f"telegram_agent_model:{model or 'missing'}")
        identity = telegram_agent.get("identity")
        if not isinstance(identity, dict):
            issues.append("telegram_agent_identity:missing")
        else:
            name = str(identity.get("name", "")).strip()
            if name != EXPECTED_TELEGRAM_IDENTITY_NAME:
                issues.append(f"telegram_agent_identity:{name or 'missing'}")

        memory_enabled, session_memory_enabled, sources = _resolve_telegram_memory_search(
            cfg, TELEGRAM_AGENT_ID
        )
        if not memory_enabled:
            issues.append("telegram_agent_memory_search:disabled")
        if not session_memory_enabled:
            issues.append("telegram_agent_session_memory:disabled")
        if "memory" not in sources:
            issues.append(f"telegram_agent_memory_sources_missing:memory:{','.join(sources)}")
        if "sessions" not in sources:
            issues.append(f"telegram_agent_memory_sources_missing:sessions:{','.join(sources)}")

        tool_profile, apply_patch_enabled, deny = _resolve_telegram_tooling(
            cfg, TELEGRAM_AGENT_ID
        )
        if tool_profile in DISALLOWED_TELEGRAM_TOOL_PROFILES:
            issues.append(f"telegram_agent_tool_profile:{tool_profile}")
        if not apply_patch_enabled:
            issues.append("telegram_agent_apply_patch:disabled")
        denied = set(deny)
        for tool_name in sorted(REQUIRED_TELEGRAM_TOOLS):
            if tool_name in denied:
                issues.append(f"telegram_agent_tool_denied:{tool_name}")

    has_binding = False
    for binding in _iter_route_bindings(cfg):
        if binding.get("agentId") != TELEGRAM_AGENT_ID:
            continue
        match = binding.get("match")
        if not isinstance(match, dict):
            continue
        peer = match.get("peer")
        if not isinstance(peer, dict):
            continue
        if (
            match.get("channel") == "telegram"
            and str(match.get("accountId", "default")) == "default"
            and peer.get("kind") == "direct"
            and str(peer.get("id")) == TELEGRAM_DIRECT_ID
        ):
            has_binding = True
            break
    if not has_binding:
        issues.append("missing_telegram_direct_binding")

    main_agent = _agent_by_id(cfg, "main")
    if main_agent is None:
        issues.append("missing_main_agent")
    else:
        heartbeat = main_agent.get("heartbeat")
        if not isinstance(heartbeat, dict):
            issues.append("missing_main_heartbeat")
        else:
            if heartbeat.get("session") != REQUIRED_HEARTBEAT_SESSION:
                issues.append(
                    f"main_heartbeat_session:{heartbeat.get('session') or 'missing'}"
                )
            if heartbeat.get("target") != "none":
                issues.append(f"main_heartbeat_target:{heartbeat.get('target') or 'missing'}")
            if heartbeat.get("directPolicy") != "block":
                issues.append(
                    f"main_heartbeat_directPolicy:{heartbeat.get('directPolicy') or 'missing'}"
                )

    tools_cfg = cfg.get("tools")
    if isinstance(tools_cfg, dict):
        deny = tools_cfg.get("deny")
        deny_values = set()
        if isinstance(deny, list):
            for entry in deny:
                if isinstance(entry, str):
                    deny_values.add(entry.strip())
        forbidden = sorted(item for item in FORBIDDEN_GLOBAL_TOOLS if item in deny_values)
        for item in forbidden:
            issues.append(f"global_tool_deny:{item}")

    hooks_cfg = cfg.get("hooks")
    internal_hooks = hooks_cfg.get("internal") if isinstance(hooks_cfg, dict) else None
    if not isinstance(internal_hooks, dict) or internal_hooks.get("enabled") is not True:
        issues.append("internal_hooks_disabled")
    else:
        entries = internal_hooks.get("entries")
        entry = entries.get(REQUIRED_INTERNAL_HOOK) if isinstance(entries, dict) else None
        if not isinstance(entry, dict) or entry.get("enabled") is not True:
            issues.append(f"internal_hook_disabled:{REQUIRED_INTERNAL_HOOK}")

    return issues


def validate_cron_jobs(cfg: Dict[str, object]) -> List[str]:
    issues: List[str] = []
    jobs = cfg.get("jobs")
    if not isinstance(jobs, list):
        return issues
    for job in jobs:
        if not isinstance(job, dict):
            continue
        if job.get("sessionTarget") != "isolated":
            continue
        if job.get("sessionKey") == "agent:main:main":
            issues.append(f"isolated_job_pins_main_session:{job.get('id', 'unknown')}")
    return issues


def validate_service_env(env: Dict[str, str]) -> List[str]:
    issues: List[str] = []
    allowlist_raw = env.get("OPENCLAW_PROVIDER_ALLOWLIST", "").strip()
    if not allowlist_raw:
        issues.append("missing_provider_allowlist")
        return issues
    providers = {item.strip() for item in allowlist_raw.split(",") if item.strip()}
    for provider in sorted(REQUIRED_PROVIDER_ALLOWLIST - providers):
        issues.append(f"provider_allowlist_missing:{provider}")
    return issues


def validate_repo_files(repo_root: Path) -> List[str]:
    issues: List[str] = []
    for rel_path in REQUIRED_REPO_FILES:
        if not (repo_root / rel_path).exists():
            issues.append(f"repo_file_missing:{rel_path.as_posix()}")
    return issues


def audit(
    *,
    config_path: Path,
    cron_path: Path,
    service_dir: Path,
    repo_root: Path,
) -> Dict[str, object]:
    issues: List[str] = []

    try:
        cfg = _load_json(config_path)
    except Exception as exc:
        issues.append(f"config_error:{exc}")
        cfg = {}

    try:
        cron_cfg = _load_json(cron_path)
    except Exception as exc:
        issues.append(f"cron_error:{exc}")
        cron_cfg = {}

    env = _load_env_dir(service_dir)

    issues.extend(validate_openclaw_config(cfg))
    issues.extend(validate_cron_jobs(cron_cfg))
    issues.extend(validate_service_env(env))
    issues.extend(validate_repo_files(repo_root))

    return {
        "ok": not issues,
        "config_path": str(config_path),
        "cron_path": str(cron_path),
        "service_dir": str(service_dir),
        "repo_root": str(repo_root),
        "issues": issues,
        "provider_allowlist": env.get("OPENCLAW_PROVIDER_ALLOWLIST", ""),
    }


def main() -> int:
    repo_root = _repo_root()
    parser = argparse.ArgumentParser(description="Dali runtime guard")
    parser.add_argument(
        "--config",
        default=str(Path.home() / ".openclaw" / "openclaw.json"),
        help="Path to live OpenClaw config",
    )
    parser.add_argument(
        "--cron",
        default=str(Path.home() / ".openclaw" / "cron" / "jobs.json"),
        help="Path to live cron jobs JSON",
    )
    parser.add_argument(
        "--service-dir",
        default=str(Path.home() / ".config" / "systemd" / "user" / "openclaw-gateway.service.d"),
        help="Path to gateway service drop-in directory",
    )
    parser.add_argument("--strict", action="store_true", help="Exit non-zero on issues")
    parser.add_argument(
        "--repo-root",
        default=str(repo_root),
        help="Repo root override for metadata only",
    )
    args = parser.parse_args()

    payload = audit(
        config_path=Path(args.config).expanduser(),
        cron_path=Path(args.cron).expanduser(),
        service_dir=Path(args.service_dir).expanduser(),
        repo_root=Path(args.repo_root).expanduser(),
    )
    print(json.dumps(payload, sort_keys=True))
    if args.strict and payload["issues"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "workspace" / "scripts" / "dali_runtime_guard.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("dali_runtime_guard", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DaliRuntimeGuardTests(unittest.TestCase):
    def setUp(self):
        self.mod = _load_module()

    def _good_config(self):
        return {
            "agents": {
                "list": [
                    {
                        "id": "main",
                        "heartbeat": {
                            "every": "30m",
                            "target": "none",
                            "directPolicy": "block",
                            "session": "agent:main:heartbeat",
                        },
                    },
                    {
                        "id": "telegram-dali",
                        "model": "openai-codex/gpt-5.4",
                        "identity": {
                            "name": "Dali",
                        },
                        "memorySearch": {
                            "enabled": True,
                            "experimental": {"sessionMemory": True},
                            "sources": ["memory", "sessions"],
                        },
                    },
                    {
                        "id": "discord-gpt54",
                        "tools": {
                            "deny": ["group:web", "browser"],
                        },
                    },
                ]
            },
            "bindings": [
                {
                    "type": "route",
                    "agentId": "telegram-dali",
                    "match": {
                        "channel": "telegram",
                        "accountId": "default",
                        "peer": {
                            "kind": "direct",
                            "id": "8159253715",
                        },
                    },
                }
            ],
            "tools": {
                "web": {"search": {"enabled": True}, "fetch": {"enabled": True}},
            },
            "hooks": {
                "internal": {
                    "enabled": True,
                    "entries": {
                        "telegram-dali-bootstrap": {"enabled": True},
                    },
                }
            },
        }

    def _good_cron(self):
        return {
            "jobs": [
                {
                    "id": "job-1",
                    "sessionTarget": "isolated",
                    "payload": {"kind": "agentTurn"},
                }
            ]
        }

    def test_validate_good_config(self):
        issues = self.mod.validate_openclaw_config(self._good_config())
        self.assertEqual(issues, [])

    def test_missing_telegram_agent_fails(self):
        cfg = self._good_config()
        cfg["agents"]["list"] = [cfg["agents"]["list"][0]]
        issues = self.mod.validate_openclaw_config(cfg)
        self.assertIn("missing_telegram_agent", issues)

    def test_wrong_telegram_model_fails(self):
        cfg = self._good_config()
        cfg["agents"]["list"][1]["model"] = "minimax-portal/MiniMax-M2.5"
        issues = self.mod.validate_openclaw_config(cfg)
        self.assertIn("telegram_agent_model:minimax-portal/MiniMax-M2.5", issues)

    def test_missing_binding_fails(self):
        cfg = self._good_config()
        cfg["bindings"] = []
        issues = self.mod.validate_openclaw_config(cfg)
        self.assertIn("missing_telegram_direct_binding", issues)

    def test_missing_identity_fails(self):
        cfg = self._good_config()
        del cfg["agents"]["list"][1]["identity"]
        issues = self.mod.validate_openclaw_config(cfg)
        self.assertIn("telegram_agent_identity:missing", issues)

    def test_missing_session_memory_flag_fails(self):
        cfg = self._good_config()
        cfg["agents"]["list"][1]["memorySearch"]["experimental"]["sessionMemory"] = False
        issues = self.mod.validate_openclaw_config(cfg)
        self.assertIn("telegram_agent_session_memory:disabled", issues)

    def test_missing_session_source_fails(self):
        cfg = self._good_config()
        cfg["agents"]["list"][1]["memorySearch"]["sources"] = ["memory"]
        issues = self.mod.validate_openclaw_config(cfg)
        self.assertIn("telegram_agent_memory_sources_missing:sessions:memory", issues)

    def test_disabled_internal_hook_fails(self):
        cfg = self._good_config()
        cfg["hooks"]["internal"]["entries"] = {}
        issues = self.mod.validate_openclaw_config(cfg)
        self.assertIn("internal_hook_disabled:telegram-dali-bootstrap", issues)

    def test_global_browser_deny_fails(self):
        cfg = self._good_config()
        cfg["tools"]["deny"] = ["browser", "group:web"]
        issues = self.mod.validate_openclaw_config(cfg)
        self.assertIn("global_tool_deny:browser", issues)
        self.assertIn("global_tool_deny:group:web", issues)

    def test_isolated_cron_pin_fails(self):
        cron = self._good_cron()
        cron["jobs"][0]["sessionKey"] = "agent:main:main"
        issues = self.mod.validate_cron_jobs(cron)
        self.assertIn("isolated_job_pins_main_session:job-1", issues)

    def test_provider_allowlist_requires_openai_and_codex(self):
        issues = self.mod.validate_service_env(
            {"OPENCLAW_PROVIDER_ALLOWLIST": "local_vllm,minimax-portal,xai"}
        )
        self.assertIn("provider_allowlist_missing:openai", issues)
        self.assertIn("provider_allowlist_missing:openai-codex", issues)

    def test_provider_allowlist_passes_when_complete(self):
        issues = self.mod.validate_service_env(
            {
                "OPENCLAW_PROVIDER_ALLOWLIST": "local_vllm,minimax-portal,xai,openai,openai-codex"
            }
        )
        self.assertEqual(issues, [])

    def test_repo_files_pass_when_present(self):
        with tempfile.TemporaryDirectory() as td:
            repo_root = Path(td)
            for rel_path in self.mod.REQUIRED_REPO_FILES:
                path = repo_root / rel_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("ok\n", encoding="utf-8")
            issues = self.mod.validate_repo_files(repo_root)
            self.assertEqual(issues, [])

    def test_repo_files_fail_when_missing(self):
        with tempfile.TemporaryDirectory() as td:
            issues = self.mod.validate_repo_files(Path(td))
            self.assertTrue(any(item.startswith("repo_file_missing:") for item in issues))

    def test_cli_strict_returns_zero_for_good_state(self):
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            config_path = td_path / "openclaw.json"
            cron_path = td_path / "jobs.json"
            service_dir = td_path / "service.d"
            repo_root = td_path / "repo"
            service_dir.mkdir()
            repo_root.mkdir()
            config_path.write_text(json.dumps(self._good_config()), encoding="utf-8")
            cron_path.write_text(json.dumps(self._good_cron()), encoding="utf-8")
            (service_dir / "10-test.conf").write_text(
                "Environment=OPENCLAW_PROVIDER_ALLOWLIST=local_vllm,minimax-portal,xai,openai,openai-codex\n",
                encoding="utf-8",
            )
            for rel_path in self.mod.REQUIRED_REPO_FILES:
                path = repo_root / rel_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("ok\n", encoding="utf-8")
            proc = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--config",
                    str(config_path),
                    "--cron",
                    str(cron_path),
                    "--service-dir",
                    str(service_dir),
                    "--repo-root",
                    str(repo_root),
                    "--strict",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            payload = json.loads(proc.stdout.strip())
            self.assertEqual(proc.returncode, 0)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["issues"], [])

    def test_cli_strict_returns_nonzero_for_broken_state(self):
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            config_path = td_path / "openclaw.json"
            cron_path = td_path / "jobs.json"
            service_dir = td_path / "service.d"
            repo_root = td_path / "repo"
            service_dir.mkdir()
            repo_root.mkdir()
            config = self._good_config()
            config["tools"]["deny"] = ["browser"]
            config_path.write_text(json.dumps(config), encoding="utf-8")
            cron_path.write_text(json.dumps(self._good_cron()), encoding="utf-8")
            (service_dir / "10-test.conf").write_text(
                "Environment=OPENCLAW_PROVIDER_ALLOWLIST=local_vllm,minimax-portal,xai\n",
                encoding="utf-8",
            )
            proc = subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "--config",
                    str(config_path),
                    "--cron",
                    str(cron_path),
                    "--service-dir",
                    str(service_dir),
                    "--repo-root",
                    str(repo_root),
                    "--strict",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            payload = json.loads(proc.stdout.strip())
            self.assertEqual(proc.returncode, 2)
            self.assertFalse(payload["ok"])
            self.assertIn("global_tool_deny:browser", payload["issues"])


if __name__ == "__main__":
    unittest.main()

import fs from "node:fs/promises";
import path from "node:path";

const TARGET_AGENT_ID = "telegram-dali";
const DEFAULT_BOOTSTRAP_ROOT = path.join("nodes", "dali", "bootstrap");
const DEFAULT_OVERRIDES: Record<string, string> = {
  "AGENTS.md": path.join(DEFAULT_BOOTSTRAP_ROOT, "AGENTS.md"),
  "IDENTITY.md": path.join(DEFAULT_BOOTSTRAP_ROOT, "IDENTITY.md"),
  "USER.md": path.join(DEFAULT_BOOTSTRAP_ROOT, "USER.md"),
  "MEMORY.md": path.join("nodes", "dali", "MEMORY.md"),
};
const APPEND_ONLY_FILES = new Set(["AGENTS.md"]);
const OVERRIDE_ENV_NAMES: Record<string, string> = {
  "AGENTS.md": "OPENCLAW_DALI_BOOTSTRAP_AGENTS_PATH",
  "IDENTITY.md": "OPENCLAW_DALI_BOOTSTRAP_IDENTITY_PATH",
  "USER.md": "OPENCLAW_DALI_BOOTSTRAP_USER_PATH",
  "MEMORY.md": "OPENCLAW_DALI_BOOTSTRAP_MEMORY_PATH",
};
const BOOTSTRAP_ROOT_ENV_NAME = "OPENCLAW_DALI_BOOTSTRAP_ROOT";

type BootstrapFile = {
  name: string;
  path: string;
  content: string;
  missing?: boolean;
};

type BootstrapEvent = {
  type?: string;
  action?: string;
  context?: {
    workspaceDir?: string;
    agentId?: string;
    bootstrapFiles?: BootstrapFile[];
  };
};

function readTrimmedEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function resolveOverridePath(name: string): string | null {
  const directEnvName = OVERRIDE_ENV_NAMES[name];
  const directValue = directEnvName ? readTrimmedEnv(directEnvName) : null;
  if (directValue) {
    return directValue;
  }

  const bootstrapRoot = readTrimmedEnv(BOOTSTRAP_ROOT_ENV_NAME);
  if (bootstrapRoot && (name === "AGENTS.md" || name === "IDENTITY.md" || name === "USER.md")) {
    return path.join(bootstrapRoot, name);
  }

  return DEFAULT_OVERRIDES[name] ?? null;
}

async function loadOverride(
  workspaceDir: string,
  name: string,
  relPath: string,
): Promise<BootstrapFile | null> {
  const filePath = path.resolve(workspaceDir, relPath);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return {
      name,
      path: filePath,
      content,
      missing: false,
    };
  } catch (err) {
    console.warn(
      `[telegram-dali-bootstrap] unable to load ${name} from ${relPath}: ${String(err)}`,
    );
    return null;
  }
}

export default async function telegramDaliBootstrapHook(event: BootstrapEvent) {
  if (event?.type !== "agent" || event?.action !== "bootstrap") {
    return;
  }

  const context = event.context;
  if (!context || context.agentId !== TARGET_AGENT_ID) {
    return;
  }

  const workspaceDir = context.workspaceDir?.trim();
  const bootstrapFiles = context.bootstrapFiles;
  if (!workspaceDir || !Array.isArray(bootstrapFiles)) {
    return;
  }

  const replacements = new Map<string, BootstrapFile>();
  const appendOnly = new Map<string, BootstrapFile>();
  // Compatibility order: file-specific env override, shared bootstrap root env, legacy repo-relative default.
  for (const name of Object.keys(DEFAULT_OVERRIDES)) {
    const relPath = resolveOverridePath(name);
    if (!relPath) {
      continue;
    }
    const loaded = await loadOverride(workspaceDir, name, relPath);
    if (loaded) {
      if (APPEND_ONLY_FILES.has(name)) {
        appendOnly.set(name, loaded);
      } else {
        replacements.set(name, loaded);
      }
    }
  }
  if (replacements.size === 0 && appendOnly.size === 0) {
    return;
  }

  const seen = new Set<string>();
  const next: BootstrapFile[] = [];
  for (const file of bootstrapFiles) {
    const replacement = replacements.get(file?.name);
    if (replacement) {
      next.push(replacement);
      seen.add(replacement.name);
      continue;
    }
    next.push(file);
  }

  for (const [name, replacement] of replacements.entries()) {
    if (!seen.has(name)) {
      next.push(replacement);
    }
  }

  for (const addition of appendOnly.values()) {
    if (!next.some((file) => file.path === addition.path)) {
      next.push(addition);
    }
  }

  context.bootstrapFiles = next;
}

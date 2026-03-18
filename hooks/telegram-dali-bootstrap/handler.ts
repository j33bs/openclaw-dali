import fs from "node:fs/promises";
import path from "node:path";

const TARGET_AGENT_ID = "telegram-dali";
const OVERRIDES: Record<string, string> = {
  "IDENTITY.md": "nodes/dali/bootstrap/IDENTITY.md",
  "USER.md": "nodes/dali/bootstrap/USER.md",
  "MEMORY.md": "nodes/dali/MEMORY.md",
};

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
  for (const [name, relPath] of Object.entries(OVERRIDES)) {
    const loaded = await loadOverride(workspaceDir, name, relPath);
    if (loaded) {
      replacements.set(name, loaded);
    }
  }
  if (replacements.size === 0) {
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

  context.bootstrapFiles = next;
}

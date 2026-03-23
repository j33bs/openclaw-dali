import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import handler from "../../hooks/telegram-dali-bootstrap/handler.js";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import { createHookEvent } from "./hooks.js";
import type { AgentBootstrapHookContext } from "./internal-hooks.js";

async function createBootstrapContext(workspaceDir: string): Promise<AgentBootstrapHookContext> {
  const rootAgents = await writeWorkspaceFile({
    dir: workspaceDir,
    name: "AGENTS.md",
    content: "root agents",
  });
  const rootSoul = await writeWorkspaceFile({
    dir: workspaceDir,
    name: "SOUL.md",
    content: "root soul",
  });
  const rootTools = await writeWorkspaceFile({
    dir: workspaceDir,
    name: "TOOLS.md",
    content: "root tools",
  });
  const rootMemory = await writeWorkspaceFile({
    dir: workspaceDir,
    name: "MEMORY.md",
    content: "root memory",
  });
  return {
    workspaceDir,
    agentId: "telegram-dali",
    bootstrapFiles: [
      {
        name: "AGENTS.md",
        path: rootAgents,
        content: "root agents",
        missing: false,
      },
      {
        name: "SOUL.md",
        path: rootSoul,
        content: "root soul",
        missing: false,
      },
      {
        name: "TOOLS.md",
        path: rootTools,
        content: "root tools",
        missing: false,
      },
      {
        name: "MEMORY.md",
        path: rootMemory,
        content: "root memory",
        missing: false,
      },
    ],
  };
}

describe("telegram-dali-bootstrap hook", () => {
  it("keeps the root AGENTS and appends Dali AGENTS while replacing MEMORY", async () => {
    const workspaceDir = await makeTempWorkspace("telegram-dali-bootstrap-");
    const daliBootstrapDir = path.join(workspaceDir, "nodes", "dali", "bootstrap");
    await fs.mkdir(daliBootstrapDir, { recursive: true });
    await fs.writeFile(path.join(daliBootstrapDir, "AGENTS.md"), "dali agents", "utf-8");
    await fs.writeFile(path.join(daliBootstrapDir, "SOUL.md"), "dali soul", "utf-8");
    await fs.writeFile(path.join(daliBootstrapDir, "TOOLS.md"), "dali tools", "utf-8");
    await fs.writeFile(path.join(daliBootstrapDir, "IDENTITY.md"), "dali identity", "utf-8");
    await fs.writeFile(path.join(daliBootstrapDir, "USER.md"), "dali user", "utf-8");
    await fs.writeFile(
      path.join(workspaceDir, "nodes", "dali", "MEMORY.md"),
      "dali memory",
      "utf-8",
    );

    const context = await createBootstrapContext(workspaceDir);
    const event = createHookEvent("agent", "bootstrap", "agent:telegram-dali:main", context);

    await handler(event);

    const agentsFiles = context.bootstrapFiles.filter((file) => file.name === "AGENTS.md");
    expect(agentsFiles).toHaveLength(2);
    expect(agentsFiles.some((file) => file.content === "root agents")).toBe(true);
    expect(agentsFiles.some((file) => file.content === "dali agents")).toBe(true);

    const soulFiles = context.bootstrapFiles.filter((file) => file.name === "SOUL.md");
    expect(soulFiles).toHaveLength(1);
    expect(soulFiles[0]?.content).toBe("dali soul");

    const toolsFiles = context.bootstrapFiles.filter((file) => file.name === "TOOLS.md");
    expect(toolsFiles).toHaveLength(2);
    expect(toolsFiles.some((file) => file.content === "root tools")).toBe(true);
    expect(toolsFiles.some((file) => file.content === "dali tools")).toBe(true);

    const memoryFiles = context.bootstrapFiles.filter((file) => file.name === "MEMORY.md");
    expect(memoryFiles).toHaveLength(1);
    expect(memoryFiles[0]?.content).toBe("dali memory");
    expect(memoryFiles[0]?.path).toContain(path.join("nodes", "dali", "MEMORY.md"));
  });
});

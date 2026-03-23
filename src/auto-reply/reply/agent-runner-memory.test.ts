import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { didMemoryFlushAppend, readMemoryFlushTargetSnapshot } from "./agent-runner-memory.js";

const tempDirs: string[] = [];

async function makeTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "openclaw-memory-flush-target-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("readMemoryFlushTargetSnapshot", () => {
  it("treats a missing target file as an empty snapshot", async () => {
    const workspaceDir = await makeTempWorkspace();

    await expect(
      readMemoryFlushTargetSnapshot({
        workspaceDir,
        relativePath: "memory/2026-03-24.md",
      }),
    ).resolves.toEqual({
      exists: false,
      size: 0,
    });
  });

  it("reads the current size of the canonical memory target", async () => {
    const workspaceDir = await makeTempWorkspace();
    const targetPath = path.join(workspaceDir, "memory/2026-03-24.md");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, "seed\nfollowup", "utf-8");

    const snapshot = await readMemoryFlushTargetSnapshot({
      workspaceDir,
      relativePath: "memory/2026-03-24.md",
    });

    expect(snapshot.exists).toBe(true);
    expect(snapshot.size).toBe(Buffer.byteLength("seed\nfollowup"));
  });
});

describe("didMemoryFlushAppend", () => {
  it("returns true only when the target file grows", async () => {
    const workspaceDir = await makeTempWorkspace();
    const relativePath = "memory/2026-03-24.md";
    const targetPath = path.join(workspaceDir, relativePath);

    const before = await readMemoryFlushTargetSnapshot({
      workspaceDir,
      relativePath,
    });
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, "- first note", "utf-8");
    const afterCreate = await readMemoryFlushTargetSnapshot({
      workspaceDir,
      relativePath,
    });
    await fs.appendFile(targetPath, "\n- second note", "utf-8");
    const afterAppend = await readMemoryFlushTargetSnapshot({
      workspaceDir,
      relativePath,
    });

    expect(didMemoryFlushAppend(before, afterCreate)).toBe(true);
    expect(didMemoryFlushAppend(afterCreate, afterCreate)).toBe(false);
    expect(didMemoryFlushAppend(afterCreate, afterAppend)).toBe(true);
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emitInterbeingTaskV0,
  listInterbeingEmitterV0,
  resolveInterbeingEmitterV0Paths,
  verifyInterbeingEmitterV0,
} from "../scripts/interbeing/emitter_v0_support.ts";

const createdRoots: string[] = [];

async function createTempRepoRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "interbeing-emitter-v0-"));
  createdRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function createEnvelope(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: "v0",
    operation: "submit_task",
    task_id: "task-outbound-001",
    requestor: "dali",
    target_node: "c_lawd",
    correlation_id: "corr-outbound-001",
    created_at: "2026-03-20T13:00:00Z",
    payload: { intent: "notify", message: "hello from dali" },
    ...overrides,
  };
}

describe("interbeing emitter v0", () => {
  it("writes outbound task envelopes with receipts", async () => {
    const cwd = await createTempRepoRoot();
    const result = await emitInterbeingTaskV0(createEnvelope(), { cwd });
    const paths = resolveInterbeingEmitterV0Paths(cwd);

    expect(result.duplicate).toBe(false);
    expect(result.queuePath).toContain(path.join("handoff", "outgoing", "c_lawd"));
    expect(result.receiptPath).toBe(`${result.queuePath}.receipt.json`);

    const receipt = JSON.parse(await readFile(result.receiptPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(receipt.target_node).toBe("c_lawd");
    expect(receipt.task_id).toBe("task-outbound-001");

    const listed = await listInterbeingEmitterV0(cwd, 5);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.queue_path.startsWith(paths.outgoingRoot)).toBe(true);

    const verified = await verifyInterbeingEmitterV0(cwd, { filename: result.filename });
    expect(verified?.sha256).toBe(result.sha256);
  });

  it("deduplicates identical emissions by default", async () => {
    const cwd = await createTempRepoRoot();
    const first = await emitInterbeingTaskV0(createEnvelope(), { cwd });
    const second = await emitInterbeingTaskV0(createEnvelope(), { cwd });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.filename).toBe(first.filename);
    expect(second.duplicateOf).toBe(first.filename);

    const listed = await listInterbeingEmitterV0(cwd, 10);
    expect(listed).toHaveLength(1);
  });

  it("can deliver a copy into an external bridge directory", async () => {
    const cwd = await createTempRepoRoot();
    const deliverDir = path.join(cwd, "bridge", "incoming", "c_lawd");
    const result = await emitInterbeingTaskV0(
      createEnvelope({ task_id: "task-outbound-bridge-001" }),
      {
        cwd,
        deliverDir,
      },
    );

    expect(result.deliveredTo).toBe(path.join(deliverDir, result.filename));
    const copied = JSON.parse(await readFile(result.deliveredTo!, "utf8")) as Record<
      string,
      unknown
    >;
    expect(copied.task_id).toBe("task-outbound-bridge-001");
  });
});

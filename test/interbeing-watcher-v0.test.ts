import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getInterbeingWatcherV0Status,
  replayInterbeingWatcherV0,
  runInterbeingWatcherV0,
  verifyInterbeingWatcherV0,
} from "../scripts/interbeing/watch_handoff_v0.ts";
import {
  buildReceiptPath,
  hashFileContents,
  readWatcherState,
  resolveInterbeingWatcherV0Paths,
  resolveWatcherLockPath,
  withWatcherMutationLock,
} from "../scripts/interbeing/watcher_v0_support.ts";

type SubmitTaskEnvelope = {
  correlation_id: string;
  created_at: string;
  operation: "submit_task";
  payload: Record<string, unknown>;
  requestor: string;
  schema_version: "v0" | "v1";
  target_node: string;
  task_id: string;
};

const createdRoots: string[] = [];

function createEnvelope(overrides: Partial<SubmitTaskEnvelope> = {}): SubmitTaskEnvelope {
  return {
    schema_version: "v0",
    operation: "submit_task",
    task_id: "task-test-001",
    requestor: "c_lawd",
    target_node: "dali",
    correlation_id: "corr-test-001",
    created_at: "2026-03-19T00:00:00Z",
    payload: { intent: "test" },
    ...overrides,
  };
}

async function createTempRepoRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "openclaw-dali-watcher-"));
  createdRoots.push(root);
  return root;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeEnvelope(params: {
  cwd: string;
  envelope: SubmitTaskEnvelope;
  filename: string;
}): Promise<string> {
  const paths = resolveInterbeingWatcherV0Paths(params.cwd);
  await mkdir(paths.incomingDir, { recursive: true });
  const filePath = path.join(paths.incomingDir, params.filename);
  await writeFile(filePath, `${JSON.stringify(params.envelope, null, 2)}\n`, "utf8");
  return filePath;
}

async function createSuccessfulLifecycleRunner(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "event-envelope.json"),
    '{\n  "event_type": "task.running"\n}\n',
  );
}

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("interbeing watcher v0 hardening", () => {
  it("classifies invalid schema_version failures and writes a failed receipt", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({ schema_version: "v1" }),
      filename: "invalid-schema-version.task-envelope.v0.json",
    });

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async ({ outputDir }) => createSuccessfulLifecycleRunner(outputDir),
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 0,
      skipped: 0,
      failed: 1,
    });

    const failedFile = path.join(paths.failedDir, "invalid-schema-version.task-envelope.v0.json");
    const failedReceipt = await readJsonFile<{
      final_disposition: string;
      reason_code: string;
      original_filename: string;
    }>(buildReceiptPath(failedFile));
    expect(failedReceipt).toMatchObject({
      final_disposition: "failed",
      reason_code: "schema_version_invalid",
      original_filename: "invalid-schema-version.task-envelope.v0.json",
    });
  });

  it("keeps duplicate handling as skipped and writes receipts for processed and duplicate artifacts", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    const envelope = createEnvelope();
    await Promise.all([
      writeEnvelope({ cwd, envelope, filename: "a-valid.task-envelope.v0.json" }),
      writeEnvelope({ cwd, envelope, filename: "b-duplicate.task-envelope.v0.json" }),
    ]);

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async ({ outputDir }) => createSuccessfulLifecycleRunner(outputDir),
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 1,
      skipped: 1,
      failed: 0,
    });

    const processedReceipt = await readJsonFile<{
      final_disposition: string;
      reason_code: string;
    }>(buildReceiptPath(path.join(paths.processedDir, "a-valid.task-envelope.v0.json")));
    const duplicateReceipt = await readJsonFile<{
      final_disposition: string;
      reason_code: string;
    }>(buildReceiptPath(path.join(paths.processedDir, "b-duplicate.task-envelope.v0.json")));

    expect(processedReceipt).toMatchObject({
      final_disposition: "processed",
      reason_code: "processed",
    });
    expect(duplicateReceipt).toMatchObject({
      final_disposition: "skipped",
      reason_code: "duplicate",
    });
  });

  it("returns a stable status shape and verifies artifacts by filename and sha256", async () => {
    const cwd = await createTempRepoRoot();
    const envelope = createEnvelope();
    const intakeFile = await writeEnvelope({
      cwd,
      envelope,
      filename: "status-check.task-envelope.v0.json",
    });
    const expectedHash = await hashFileContents(intakeFile);

    await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async ({ outputDir }) => createSuccessfulLifecycleRunner(outputDir),
    });

    const status = await getInterbeingWatcherV0Status({ cwd });
    expect(status.available_modes).toEqual(["once", "start", "status", "list", "verify", "replay"]);
    expect(status.counts).toMatchObject({
      incoming: 0,
      processed: 1,
      failed: 0,
    });
    expect(status.state.tracked_hashes).toBe(1);

    const byFilename = await verifyInterbeingWatcherV0({
      cwd,
      filename: "status-check.task-envelope.v0.json",
    });
    expect(byFilename.found).toBe(true);
    expect(byFilename.matches[0]).toMatchObject({
      disposition: "processed",
      reason_code: "processed",
    });

    const byHash = await verifyInterbeingWatcherV0({
      cwd,
      sha256: expectedHash,
    });
    expect(byHash.found).toBe(true);
    expect(byHash.matches.some((match) => match.tracked_hash)).toBe(true);
  });

  it("replays a failed item back into intake and processes it on the next run", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({ task_id: "task-replay-001", correlation_id: "corr-replay-001" }),
      filename: "replay-me.task-envelope.v0.json",
    });

    let shouldFail = true;
    await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async () => {
        if (shouldFail) {
          throw new Error("simulated processing failure");
        }
      },
    });

    const failedFile = path.join(paths.failedDir, "replay-me.task-envelope.v0.json");
    const replaySummary = await replayInterbeingWatcherV0({
      cwd,
      file: failedFile,
    });
    expect(replaySummary.reason_code).toBe("replay_requested");

    shouldFail = false;
    const secondSummary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async ({ outputDir }) => createSuccessfulLifecycleRunner(outputDir),
    });

    expect(secondSummary).toEqual({
      mode: "once",
      processed: 1,
      skipped: 0,
      failed: 0,
    });
    expect(
      await readJsonFile<{ final_disposition: string; reason_code: string }>(
        buildReceiptPath(path.join(paths.processedDir, "replay-me.task-envelope.v0.json")),
      ),
    ).toMatchObject({
      final_disposition: "processed",
      reason_code: "processed",
    });
  });

  it("requires explicit force_reprocess before replaying a previously processed hash", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({ task_id: "task-force-001", correlation_id: "corr-force-001" }),
      filename: "force-me.task-envelope.v0.json",
    });

    await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async ({ outputDir }) => createSuccessfulLifecycleRunner(outputDir),
    });

    const processedFile = path.join(paths.processedDir, "force-me.task-envelope.v0.json");
    await expect(
      replayInterbeingWatcherV0({
        cwd,
        file: processedFile,
      }),
    ).rejects.toThrow("--force-reprocess");

    const forcedReplay = await replayInterbeingWatcherV0({
      cwd,
      file: processedFile,
      forceReprocess: true,
    });
    expect(forcedReplay.reason_code).toBe("force_reprocess_requested");

    const stateBeforeRun = await readWatcherState(paths.statePath);
    expect(Object.keys(stateBeforeRun.reprocess_overrides)).toHaveLength(1);

    await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async ({ outputDir }) => createSuccessfulLifecycleRunner(outputDir),
    });

    const stateAfterRun = await readWatcherState(paths.statePath);
    expect(Object.keys(stateAfterRun.reprocess_overrides)).toHaveLength(0);
    expect(
      (await readFile(paths.logPath, "utf8")).includes('"reason_code":"force_reprocess_requested"'),
    ).toBe(true);
  });

  it("serializes queue mutations through the watcher lock file", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    const order: string[] = [];

    await Promise.all([
      withWatcherMutationLock(paths, async () => {
        order.push("first:start");
        await new Promise((resolve) => setTimeout(resolve, 150));
        order.push("first:end");
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await withWatcherMutationLock(paths, async () => {
          order.push("second");
        });
      })(),
    ]);

    expect(order).toEqual(["first:start", "first:end", "second"]);
    await expect(readFile(resolveWatcherLockPath(paths), "utf8")).rejects.toThrow();
  });
});

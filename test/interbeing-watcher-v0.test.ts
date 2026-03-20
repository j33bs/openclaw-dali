import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInterbeingE2ELocalV0 } from "../scripts/dev/interbeing-e2e-local-v0.ts";
import { DEFAULT_INTERBEING_DIR } from "../scripts/interbeing/interbeing_paths.ts";
import {
  getInterbeingWatcherV0Health,
  getInterbeingWatcherV0Status,
  listInterbeingWatcherV0Items,
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

type ReceiptWithLocalDispatch = {
  final_disposition: string;
  local_dispatch?: {
    children: {
      executed: number;
      failed: number;
      skipped_duplicates: number;
      total: number;
    } | null;
    lineage: {
      chain_id: string;
      hop_count: number;
      max_hops: number | null;
      parent_role: string | null;
      parent_task_id: string | null;
    } | null;
    reviewer_gate: {
      approved: boolean | null;
      required: boolean;
      reviewer_task_id: string | null;
    } | null;
    role: string;
    worker_pool: {
      limit: number;
      max_in_flight: number;
    } | null;
  };
  reason_code: string;
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

function createLocalDispatchPayload(
  localDispatch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    intent: "local-dispatch",
    local_dispatch: localDispatch,
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

async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("interbeing watcher v0 hardening", () => {
  it("runs the local E2E harness with repo-local vendored schemas by default", async () => {
    const cwd = await createTempRepoRoot();
    const outputDir = path.join(cwd, "workspace", "audit", "_evidence", "interbeing-e2e-local-v0");
    const result = await runInterbeingE2ELocalV0({
      outputDir,
    });

    expect(result.validation).toEqual({
      inputSubmitTask: "direct_schema",
      taskStatuses: "direct_schema",
      eventEnvelope: "direct_schema",
    });
    expect(result.summary.inputSource).toBe("inline default submit_task envelope");
    expect(result.summary.statusFlow).toEqual(["queued", "running", "succeeded"]);
    expect(result.summary.artifactDir).toContain("interbeing-e2e-local-v0");
    expect(result.summary.resultRefUri).toMatch(/^file:\/\//);

    const succeededStatus = await readJsonFile<{ result_ref: { uri: string } | null }>(
      path.join(outputDir, "task-status-succeeded.json"),
    );
    expect(succeededStatus.result_ref?.uri).toBe(result.summary.resultRefUri);

    const resultSummary = await readJsonFile<{ outcome: string; task_id: string }>(
      path.join(outputDir, "result-summary.json"),
    );
    expect(resultSummary).toMatchObject({
      outcome: "succeeded",
      task_id: "task-local-e2e-001",
    });

    const notes = await readTextFile(path.join(outputDir, "e2e-notes.md"));
    expect(notes).toContain(DEFAULT_INTERBEING_DIR);
    expect(notes).toContain("result-summary.json");
  });

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
    expect(status.available_modes).toEqual([
      "once",
      "start",
      "status",
      "health",
      "list",
      "verify",
      "replay",
    ]);
    expect(status.counts).toMatchObject({
      incoming: 0,
      processed: 1,
      failed: 0,
    });
    expect(status.state.readable).toBe(true);
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

  it("reports service, lock, and recent failure diagnostics through the health surface", async () => {
    const cwd = await createTempRepoRoot();
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({ task_id: "task-health-001", correlation_id: "corr-health-001" }),
      filename: "health-check.task-envelope.v0.json",
    });

    await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async ({ outputDir }) => createSuccessfulLifecycleRunner(outputDir),
    });

    const health = await getInterbeingWatcherV0Health({
      cwd,
      deps: {
        now: () => Date.parse("2026-03-19T11:10:00.000Z"),
        inspectLock: async () => ({
          acquired_at: null,
          age_seconds: null,
          detail: null,
          exists: false,
          owner_command: null,
          owner_matches_watcher: null,
          path: "workspace/state/interbeing_watcher_v0.lock",
          pid: null,
          status: "absent",
          tool_name: null,
          watcher_version: null,
        }),
        inspectService: async () => ({
          active_enter_timestamp: "Thu 2026-03-19 11:00:00 UTC",
          active_state: "active",
          available: true,
          detail: null,
          exec_main_code: "0",
          exec_main_status: 0,
          fragment_path: "scripts/systemd/openclaw-interbeing-watcher.service",
          load_state: "loaded",
          main_pid: 1234,
          n_restarts: 1,
          result: "success",
          sub_state: "running",
          unit: "openclaw-interbeing-watcher.service",
          unit_file_state: "enabled",
        }),
        readJournalIssues: async () => ({
          available: true,
          detail: null,
          errors: [],
          unit: "openclaw-interbeing-watcher.service",
          warnings: [
            {
              message: "watcher restarted",
              priority: 4,
              timestamp: "2026-03-19T11:01:00.000Z",
            },
          ],
        }),
        readRecentFailures: async () => [
          {
            action: "intake",
            filename: "invalid-schema-version.task-envelope.v0.json",
            reason_code: "schema_version_invalid",
            reason_detail: '"v1"',
            status: "failed",
            timestamp: "2026-03-19T11:02:00.000Z",
          },
        ],
      },
    });

    expect(health.service.unit).toBe("openclaw-interbeing-watcher.service");
    expect(health.service.fragment_path).toBe(
      "scripts/systemd/openclaw-interbeing-watcher.service",
    );
    expect(health.watcher.counts.processed).toBe(1);
    expect(health.watcher.lock.status).toBe("absent");
    expect(health.watcher.state.readable).toBe(true);
    expect(health.watcher.recent_failures).toHaveLength(1);
    expect(health.health.status).toBe("warning");
    expect(health.health.issues).toContain("service_restarts:1");
    expect(health.health.issues).toContain("journal_warnings:1");
    expect(health.health.issues).toContain("recent_failures:1");
  });

  it("ignores stale journal warnings and failure receipts in health summaries", async () => {
    const cwd = await createTempRepoRoot();
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({ task_id: "task-health-stale-001" }),
      filename: "health-stale.task-envelope.v0.json",
    });

    await runInterbeingWatcherV0({
      cwd,
      mode: "once",
      runLifecycle: async ({ outputDir }) => createSuccessfulLifecycleRunner(outputDir),
    });

    const health = await getInterbeingWatcherV0Health({
      cwd,
      deps: {
        now: () => Date.parse("2026-03-20T20:00:00.000Z"),
        inspectLock: async () => ({
          acquired_at: null,
          age_seconds: null,
          detail: null,
          exists: false,
          owner_command: null,
          owner_matches_watcher: null,
          path: "workspace/state/interbeing_watcher_v0.lock",
          pid: null,
          status: "absent",
          tool_name: null,
          watcher_version: null,
        }),
        inspectService: async () => ({
          active_enter_timestamp: "Thu 2026-03-20 19:50:00 UTC",
          active_state: "active",
          available: true,
          detail: null,
          exec_main_code: "0",
          exec_main_status: 0,
          fragment_path: "scripts/systemd/openclaw-interbeing-watcher.service",
          load_state: "loaded",
          main_pid: 1234,
          n_restarts: 0,
          result: "success",
          sub_state: "running",
          unit: "openclaw-interbeing-watcher.service",
          unit_file_state: "enabled",
        }),
        readJournalIssues: async () => ({
          available: true,
          detail: null,
          errors: [],
          unit: "openclaw-interbeing-watcher.service",
          warnings: [
            {
              message: "older restart warning",
              priority: 4,
              timestamp: "2026-03-19T11:01:00.000Z",
            },
          ],
        }),
        readRecentFailures: async () => [
          {
            action: "intake",
            filename: "invalid-schema-version.task-envelope.v0.json",
            reason_code: "schema_version_invalid",
            reason_detail: '"v1"',
            status: "failed",
            timestamp: "2026-03-19T11:02:00.000Z",
          },
        ],
      },
    });

    expect(health.journal.warnings).toHaveLength(0);
    expect(health.watcher.recent_failures).toHaveLength(0);
    expect(health.health.status).toBe("ok");
    expect(health.health.issues).not.toContain("journal_warnings:1");
    expect(health.health.issues).not.toContain("recent_failures:1");
  });

  it("clears stale lock files left behind by dead processes", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    const lockPath = resolveWatcherLockPath(paths);
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: 999_999_999,
        acquired_at: "2026-03-19T11:03:00.000Z",
        tool_name: "interbeing-watcher-v0",
        watcher_version: "v0-hardening",
      })}\n`,
      "utf8",
    );

    const order: string[] = [];
    await withWatcherMutationLock(paths, async () => {
      order.push("acquired");
    });

    expect(order).toEqual(["acquired"]);
    await expect(readFile(lockPath, "utf8")).rejects.toThrow();
  });

  it("dispatches explicit executor and reviewer root roles through the default local runtime", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await Promise.all([
      writeEnvelope({
        cwd,
        envelope: createEnvelope({
          task_id: "task-role-executor-001",
          correlation_id: "corr-role-executor-001",
          payload: createLocalDispatchPayload({
            role: "executor",
            input: { objective: "run executor directly" },
          }),
        }),
        filename: "root-executor.task-envelope.v0.json",
      }),
      writeEnvelope({
        cwd,
        envelope: createEnvelope({
          task_id: "task-role-reviewer-001",
          correlation_id: "corr-role-reviewer-001",
          payload: createLocalDispatchPayload({
            role: "reviewer",
            approved: true,
            notes: "approved by direct reviewer",
          }),
        }),
        filename: "root-reviewer.task-envelope.v0.json",
      }),
    ]);

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 2,
      skipped: 0,
      failed: 0,
    });

    const executorReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(path.join(paths.processedDir, "root-executor.task-envelope.v0.json")),
    );
    const reviewerReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(path.join(paths.processedDir, "root-reviewer.task-envelope.v0.json")),
    );

    expect(executorReceipt.local_dispatch).toMatchObject({
      role: "executor",
      reviewer_gate: null,
      worker_pool: null,
    });
    expect(reviewerReceipt.local_dispatch).toMatchObject({
      role: "reviewer",
      reviewer_gate: {
        approved: true,
        required: true,
      },
    });
  });

  it("accepts C_Lawd local_dispatch fields for executor and reviewer targets and preserves mapped lineage", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await Promise.all([
      writeEnvelope({
        cwd,
        envelope: createEnvelope({
          task_id: "task-clawd-executor-001",
          correlation_id: "corr-clawd-executor-001",
          payload: createLocalDispatchPayload({
            target_role: "executor",
            source_role: "planner",
            chain_id: "chain-clawd-compat-001",
            parent_task_id: "task-plan-compat-001",
            hop_count: 1,
            max_hops: 3,
            result: {
              compatibility: "clawd-flat-local-dispatch",
              ok: true,
            },
          }),
        }),
        filename: "clawd-executor-compat.task-envelope.v0.json",
      }),
      writeEnvelope({
        cwd,
        envelope: createEnvelope({
          task_id: "task-clawd-reviewer-001",
          correlation_id: "corr-clawd-reviewer-001",
          payload: createLocalDispatchPayload({
            target_role: "reviewer",
            source_role: "executor",
            chain_id: "chain-clawd-compat-002",
            parent_task_id: "task-exec-compat-002",
            hop_count: 2,
            max_hops: 3,
          }),
        }),
        filename: "clawd-reviewer-compat.task-envelope.v0.json",
      }),
    ]);

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 2,
      skipped: 0,
      failed: 0,
    });

    const executorReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(
        path.join(paths.processedDir, "clawd-executor-compat.task-envelope.v0.json"),
      ),
    );
    const reviewerReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(
        path.join(paths.processedDir, "clawd-reviewer-compat.task-envelope.v0.json"),
      ),
    );

    expect(executorReceipt.local_dispatch).toMatchObject({
      role: "executor",
      lineage: {
        chain_id: "chain-clawd-compat-001",
        hop_count: 1,
        max_hops: 3,
        parent_role: "planner",
        parent_task_id: "task-plan-compat-001",
      },
      worker_pool: null,
    });
    expect(reviewerReceipt.local_dispatch).toMatchObject({
      role: "reviewer",
      lineage: {
        chain_id: "chain-clawd-compat-002",
        hop_count: 2,
        max_hops: 3,
        parent_role: "executor",
        parent_task_id: "task-exec-compat-002",
      },
      reviewer_gate: {
        approved: true,
        required: true,
        reviewer_task_id: "task-clawd-reviewer-001",
      },
    });

    const verify = await verifyInterbeingWatcherV0({
      cwd,
      filename: "clawd-executor-compat.task-envelope.v0.json",
    });
    expect(verify.matches).toHaveLength(1);
    expect(verify.matches[0]).toMatchObject({
      disposition: "processed",
      local_dispatch: {
        role: "executor",
        lineage: {
          chain_id: "chain-clawd-compat-001",
          hop_count: 1,
          max_hops: 3,
          parent_role: "planner",
          parent_task_id: "task-plan-compat-001",
        },
      },
    });

    const listed = await listInterbeingWatcherV0Items({
      cwd,
      limit: 5,
    });
    const listedItems = listed.items as Array<{
      local_dispatch?: ReceiptWithLocalDispatch["local_dispatch"];
      original_filename?: string;
    }>;
    expect(listedItems).toHaveLength(2);
    expect(
      listedItems.some(
        (item) =>
          item.original_filename === "clawd-executor-compat.task-envelope.v0.json" &&
          item.local_dispatch?.role === "executor" &&
          item.local_dispatch?.lineage?.parent_role === "planner",
      ),
    ).toBe(true);
    expect(
      listedItems.some(
        (item) =>
          item.original_filename === "clawd-reviewer-compat.task-envelope.v0.json" &&
          item.local_dispatch?.role === "reviewer" &&
          item.local_dispatch?.lineage?.parent_role === "executor",
      ),
    ).toBe(true);
  });

  it("runs planner child executors with bounded concurrency and records reviewer-approved lineage", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({
        task_id: "task-planner-001",
        correlation_id: "corr-planner-001",
        payload: createLocalDispatchPayload({
          role: "planner",
          worker_limit: 2,
          lineage: {
            chain_id: "chain-planner-001",
            hop_count: 0,
            max_hops: 2,
          },
          planner_children: [
            {
              role: "executor",
              task_id: "exec-a",
              sleep_ms: 120,
              input: { step: "a" },
            },
            {
              role: "executor",
              task_id: "exec-b",
              sleep_ms: 120,
              input: { step: "b" },
            },
            {
              role: "reviewer",
              task_id: "review-final",
              approved: true,
              notes: "planner chain approved",
            },
          ],
        }),
      }),
      filename: "planner-chain.task-envelope.v0.json",
    });

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 1,
      skipped: 0,
      failed: 0,
    });

    const processedReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(path.join(paths.processedDir, "planner-chain.task-envelope.v0.json")),
    );
    expect(processedReceipt.local_dispatch).toMatchObject({
      role: "planner",
      children: {
        total: 3,
        executed: 3,
        skipped_duplicates: 0,
        failed: 0,
      },
      lineage: {
        chain_id: "chain-planner-001",
        hop_count: 0,
        max_hops: 2,
      },
      reviewer_gate: {
        approved: true,
        required: true,
        reviewer_task_id: "review-final",
      },
      worker_pool: {
        limit: 2,
        max_in_flight: 2,
      },
    });

    const dispatchSummary = await readJsonFile<{
      child_results: Array<{ role: string; status: string }>;
      outcome: string;
    }>(path.join(paths.lifecycleOutputDir, "dispatch-summary.json"));
    expect(dispatchSummary.outcome).toBe("succeeded");
    expect(dispatchSummary.child_results.map((child) => `${child.role}:${child.status}`)).toEqual([
      "executor:succeeded",
      "executor:succeeded",
      "reviewer:succeeded",
    ]);
  });

  it("skips duplicate planner child work before concurrent execution", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({
        task_id: "task-planner-dup-001",
        correlation_id: "corr-planner-dup-001",
        payload: createLocalDispatchPayload({
          role: "planner",
          worker_limit: 2,
          planner_children: [
            {
              role: "executor",
              task_id: "exec-primary",
              dedupe_key: "same-step",
              input: { step: "same" },
            },
            {
              role: "executor",
              task_id: "exec-duplicate",
              dedupe_key: "same-step",
              input: { step: "same duplicate" },
            },
            {
              role: "reviewer",
              task_id: "review-dup",
              approved: true,
            },
          ],
        }),
      }),
      filename: "planner-duplicate-chain.task-envelope.v0.json",
    });

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 1,
      skipped: 0,
      failed: 0,
    });

    const processedReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(
        path.join(paths.processedDir, "planner-duplicate-chain.task-envelope.v0.json"),
      ),
    );
    expect(processedReceipt.local_dispatch?.children).toMatchObject({
      total: 3,
      executed: 2,
      skipped_duplicates: 1,
      failed: 0,
    });
  });

  it("fails closed when a reviewer gate rejects planner output", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({
        task_id: "task-review-reject-001",
        correlation_id: "corr-review-reject-001",
        payload: createLocalDispatchPayload({
          role: "planner",
          worker_limit: 2,
          planner_children: [
            {
              role: "executor",
              task_id: "exec-review-target",
              input: { step: "needs review" },
            },
            {
              role: "reviewer",
              task_id: "review-reject",
              approved: false,
              notes: "review failed",
            },
          ],
        }),
      }),
      filename: "planner-review-reject.task-envelope.v0.json",
    });

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 0,
      skipped: 0,
      failed: 1,
    });

    const failedReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(path.join(paths.failedDir, "planner-review-reject.task-envelope.v0.json")),
    );
    expect(failedReceipt).toMatchObject({
      final_disposition: "failed",
      reason_code: "reviewer_rejected",
    });
    expect(failedReceipt.local_dispatch).toMatchObject({
      role: "planner",
      reviewer_gate: {
        approved: false,
        required: true,
        reviewer_task_id: "review-reject",
      },
    });
  });

  it("enforces hop limits before planner fan-out", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({
        task_id: "task-hop-limit-001",
        correlation_id: "corr-hop-limit-001",
        payload: createLocalDispatchPayload({
          role: "planner",
          worker_limit: 3,
          lineage: {
            chain_id: "chain-hop-001",
            hop_count: 1,
            max_hops: 1,
          },
          planner_children: [
            {
              role: "executor",
              task_id: "exec-hop-child",
              input: { step: "should not run" },
            },
          ],
        }),
      }),
      filename: "planner-hop-limit.task-envelope.v0.json",
    });

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 0,
      skipped: 0,
      failed: 1,
    });

    const failedReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(path.join(paths.failedDir, "planner-hop-limit.task-envelope.v0.json")),
    );
    expect(failedReceipt).toMatchObject({
      final_disposition: "failed",
      reason_code: "hop_limit_exceeded",
    });
    expect(failedReceipt.local_dispatch).toMatchObject({
      role: "planner",
      lineage: {
        chain_id: "chain-hop-001",
        hop_count: 1,
        max_hops: 1,
      },
      worker_pool: {
        limit: 3,
        max_in_flight: 0,
      },
    });
  });

  it("fails closed when C_Lawd local_dispatch hop_count exceeds max_hops", async () => {
    const cwd = await createTempRepoRoot();
    const paths = resolveInterbeingWatcherV0Paths(cwd);
    await writeEnvelope({
      cwd,
      envelope: createEnvelope({
        task_id: "task-clawd-hop-limit-001",
        correlation_id: "corr-clawd-hop-limit-001",
        payload: createLocalDispatchPayload({
          target_role: "executor",
          source_role: "planner",
          chain_id: "chain-clawd-hop-limit-001",
          parent_task_id: "task-plan-hop-limit-001",
          hop_count: 2,
          max_hops: 1,
        }),
      }),
      filename: "clawd-hop-limit.task-envelope.v0.json",
    });

    const summary = await runInterbeingWatcherV0({
      cwd,
      mode: "once",
    });

    expect(summary).toEqual({
      mode: "once",
      processed: 0,
      skipped: 0,
      failed: 1,
    });

    const failedReceipt = await readJsonFile<ReceiptWithLocalDispatch>(
      buildReceiptPath(path.join(paths.failedDir, "clawd-hop-limit.task-envelope.v0.json")),
    );
    expect(failedReceipt).toMatchObject({
      final_disposition: "failed",
      reason_code: "hop_limit_exceeded",
    });
    expect(failedReceipt.local_dispatch).toMatchObject({
      role: "executor",
      lineage: {
        chain_id: "chain-clawd-hop-limit-001",
        hop_count: 2,
        max_hops: 1,
        parent_role: "planner",
        parent_task_id: "task-plan-hop-limit-001",
      },
      worker_pool: null,
    });
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

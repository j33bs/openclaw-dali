import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getInterbeingWatcherV0Status,
  listInterbeingWatcherV0Items,
  replayInterbeingWatcherV0,
  runInterbeingWatcherV0,
  verifyInterbeingWatcherV0,
} from "../interbeing/watch_handoff_v0.ts";
import {
  buildReceiptPath,
  readWatcherState,
  resolveInterbeingWatcherV0Paths,
} from "../interbeing/watcher_v0_support.ts";
import { DEFAULT_HANDOFF_FIXTURE_PATH } from "./interbeing-e2e-local-v0.ts";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "workspace",
  "audit",
  "_evidence",
  "interbeing-watcher-v0",
);

function fileHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listDirectoryFiles(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .toSorted();
}

async function copyIfExists(sourcePath: string, targetPath: string): Promise<void> {
  if (await pathExists(sourcePath)) {
    await copyFile(sourcePath, targetPath);
  }
}

async function cleanupRuntime(
  paths: ReturnType<typeof resolveInterbeingWatcherV0Paths>,
): Promise<void> {
  await Promise.all([
    rm(paths.handoffRoot, { recursive: true, force: true }),
    rm(paths.statePath, { force: true }),
    rm(paths.logPath, { force: true }),
    rm(path.dirname(paths.lifecycleOutputDir), { recursive: true, force: true }),
  ]);
}

async function writeEnvelope(params: {
  contents: string;
  filename: string;
  incomingDir: string;
}): Promise<string> {
  const filePath = path.join(params.incomingDir, params.filename);
  await writeFile(filePath, params.contents, "utf8");
  return filePath;
}

async function main(): Promise<void> {
  const paths = resolveInterbeingWatcherV0Paths();
  await cleanupRuntime(paths);
  await rm(EVIDENCE_DIR, { recursive: true, force: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await Promise.all([
    mkdir(paths.incomingDir, { recursive: true }),
    mkdir(paths.processedDir, { recursive: true }),
    mkdir(paths.failedDir, { recursive: true }),
  ]);

  const validText = await readFile(DEFAULT_HANDOFF_FIXTURE_PATH, "utf8");
  const validHash = fileHash(validText);
  const invalidEnvelope = {
    ...(JSON.parse(validText) as Record<string, unknown>),
    schema_version: "v1",
  };
  const replayEnvelope = {
    ...(JSON.parse(validText) as Record<string, unknown>),
    task_id: "task-replay-hardening-001",
    correlation_id: "corr-replay-hardening-001",
  };

  await Promise.all([
    writeEnvelope({
      contents: validText,
      filename: "a-valid.task-envelope.v0.json",
      incomingDir: paths.incomingDir,
    }),
    writeEnvelope({
      contents: validText,
      filename: "b-duplicate.task-envelope.v0.json",
      incomingDir: paths.incomingDir,
    }),
    writeJsonFile(
      path.join(paths.incomingDir, "c-invalid-version.task-envelope.v0.json"),
      invalidEnvelope,
    ),
  ]);

  const firstSummary = await runInterbeingWatcherV0({ mode: "once" });
  if (firstSummary.processed !== 1 || firstSummary.skipped !== 1 || firstSummary.failed !== 1) {
    throw new Error(`unexpected first summary: ${JSON.stringify(firstSummary)}`);
  }

  const watcherState = await readWatcherState(paths.statePath);
  if (
    Object.keys(watcherState.processed_hashes).length !== 1 ||
    !watcherState.processed_hashes[validHash]
  ) {
    throw new Error("watcher state did not persist the valid hash exactly once");
  }

  const processedValidPath = path.join(paths.processedDir, "a-valid.task-envelope.v0.json");
  const processedDuplicatePath = path.join(paths.processedDir, "b-duplicate.task-envelope.v0.json");
  const failedInvalidPath = path.join(paths.failedDir, "c-invalid-version.task-envelope.v0.json");

  const processedValidReceiptPath = buildReceiptPath(processedValidPath);
  const processedDuplicateReceiptPath = buildReceiptPath(processedDuplicatePath);
  const failedInvalidReceiptPath = buildReceiptPath(failedInvalidPath);
  const processedValidReceipt = await readJsonFile<{ reason_code: string }>(
    processedValidReceiptPath,
  );
  const duplicateReceipt = await readJsonFile<{ reason_code: string }>(
    processedDuplicateReceiptPath,
  );
  const invalidReceipt = await readJsonFile<{ reason_code: string }>(failedInvalidReceiptPath);

  if (processedValidReceipt.reason_code !== "processed") {
    throw new Error("processed receipt did not record reason_code=processed");
  }
  if (duplicateReceipt.reason_code !== "duplicate") {
    throw new Error("duplicate receipt did not record reason_code=duplicate");
  }
  if (invalidReceipt.reason_code !== "schema_version_invalid") {
    throw new Error("invalid receipt did not record reason_code=schema_version_invalid");
  }

  await writeJsonFile(
    path.join(paths.incomingDir, "d-replay.task-envelope.v0.json"),
    replayEnvelope,
  );
  const failureSummary = await runInterbeingWatcherV0({
    mode: "once",
    runLifecycle: async () => {
      throw new Error("simulated processing failure");
    },
  });
  if (failureSummary.failed !== 1) {
    throw new Error(`unexpected replay failure summary: ${JSON.stringify(failureSummary)}`);
  }

  const failedReplayPath = path.join(paths.failedDir, "d-replay.task-envelope.v0.json");
  const failedReplayReceiptPath = buildReceiptPath(failedReplayPath);
  const failedReplayReceipt = await readJsonFile<{ reason_code: string }>(failedReplayReceiptPath);
  if (failedReplayReceipt.reason_code !== "processing_error") {
    throw new Error("processing failure receipt did not record reason_code=processing_error");
  }

  const replaySummary = await replayInterbeingWatcherV0({
    file: failedReplayPath,
  });
  if (replaySummary.reason_code !== "replay_requested") {
    throw new Error("replay did not record replay_requested");
  }

  const replayRunSummary = await runInterbeingWatcherV0({ mode: "once" });
  if (replayRunSummary.processed !== 1 || replayRunSummary.failed !== 0) {
    throw new Error(`unexpected replay run summary: ${JSON.stringify(replayRunSummary)}`);
  }

  const replayProcessedPath = path.join(paths.processedDir, "d-replay.task-envelope.v0.json");
  const replayProcessedReceiptPath = buildReceiptPath(replayProcessedPath);
  const replayProcessedReceipt = await readJsonFile<{ reason_code: string }>(
    replayProcessedReceiptPath,
  );
  if (replayProcessedReceipt.reason_code !== "processed") {
    throw new Error("replayed processed receipt did not record reason_code=processed");
  }

  let forceReplayRejected = false;
  try {
    await replayInterbeingWatcherV0({
      file: processedValidPath,
    });
  } catch (err) {
    forceReplayRejected = String(err).includes("--force-reprocess");
  }
  if (!forceReplayRejected) {
    throw new Error("replay of processed hash did not require --force-reprocess");
  }

  const forceReplaySummary = await replayInterbeingWatcherV0({
    file: processedValidPath,
    forceReprocess: true,
  });
  if (forceReplaySummary.reason_code !== "force_reprocess_requested") {
    throw new Error("force replay did not record force_reprocess_requested");
  }

  const forcedReplayRunSummary = await runInterbeingWatcherV0({ mode: "once" });
  if (forcedReplayRunSummary.processed !== 1) {
    throw new Error(`unexpected forced replay summary: ${JSON.stringify(forcedReplayRunSummary)}`);
  }

  const processedFiles = await listDirectoryFiles(paths.processedDir);
  const forcedReplayFile =
    processedFiles.find(
      (name) =>
        name.startsWith("a-valid.task-envelope.v0.") &&
        name.endsWith(".json") &&
        !name.endsWith(".receipt.json"),
    ) ?? null;
  if (!forcedReplayFile) {
    throw new Error("forced replay did not create a second processed artifact");
  }

  const status = await getInterbeingWatcherV0Status();
  const listOutput = await listInterbeingWatcherV0Items({ limit: 10 });
  const verifyByFilename = await verifyInterbeingWatcherV0({
    filename: "a-valid.task-envelope.v0.json",
  });
  const verifyByHash = await verifyInterbeingWatcherV0({
    sha256: validHash,
  });

  if (!verifyByFilename.found || !verifyByHash.found) {
    throw new Error("verify output did not find expected processed artifacts");
  }

  await Promise.all([
    copyFile(
      processedValidPath,
      path.join(EVIDENCE_DIR, "sample-processed-file.task-envelope.v0.json"),
    ),
    copyFile(
      failedInvalidPath,
      path.join(EVIDENCE_DIR, "sample-failed-file.task-envelope.v0.json"),
    ),
    copyFile(paths.logPath, path.join(EVIDENCE_DIR, "interbeing_watcher_v0.log")),
    copyFile(paths.statePath, path.join(EVIDENCE_DIR, "interbeing_watcher_v0.state.json")),
    copyFile(processedValidReceiptPath, path.join(EVIDENCE_DIR, "processed-valid.receipt.json")),
    copyFile(
      processedDuplicateReceiptPath,
      path.join(EVIDENCE_DIR, "skipped-duplicate.receipt.json"),
    ),
    copyFile(
      failedInvalidReceiptPath,
      path.join(EVIDENCE_DIR, "failed-invalid-version.receipt.json"),
    ),
    copyFile(failedReplayReceiptPath, path.join(EVIDENCE_DIR, "failed-processing.receipt.json")),
    copyFile(
      replayProcessedReceiptPath,
      path.join(EVIDENCE_DIR, "replayed-processed.receipt.json"),
    ),
    copyFile(
      buildReceiptPath(path.join(paths.processedDir, forcedReplayFile)),
      path.join(EVIDENCE_DIR, "forced-reprocess.receipt.json"),
    ),
    copyIfExists(
      path.join(paths.lifecycleOutputDir, "event-envelope.json"),
      path.join(EVIDENCE_DIR, "event-envelope.json"),
    ),
    copyIfExists(
      path.join(paths.lifecycleOutputDir, "task-status-queued.json"),
      path.join(EVIDENCE_DIR, "task-status-queued.json"),
    ),
    copyIfExists(
      path.join(paths.lifecycleOutputDir, "task-status-running.json"),
      path.join(EVIDENCE_DIR, "task-status-running.json"),
    ),
    copyIfExists(
      path.join(paths.lifecycleOutputDir, "task-status-succeeded.json"),
      path.join(EVIDENCE_DIR, "task-status-succeeded.json"),
    ),
    writeJsonFile(path.join(EVIDENCE_DIR, "status.json"), status),
    writeJsonFile(path.join(EVIDENCE_DIR, "list.json"), listOutput),
    writeJsonFile(path.join(EVIDENCE_DIR, "verify-by-filename.json"), verifyByFilename),
    writeJsonFile(path.join(EVIDENCE_DIR, "verify-by-sha256.json"), verifyByHash),
    writeJsonFile(path.join(EVIDENCE_DIR, "replay-summary.json"), replaySummary),
    writeJsonFile(path.join(EVIDENCE_DIR, "force-reprocess-summary.json"), forceReplaySummary),
  ]);

  await writeFile(
    path.join(EVIDENCE_DIR, "watcher-smoke.md"),
    [
      "# Interbeing Watcher v0 Hardening Smoke",
      "",
      "Flow:",
      "- processed one valid handoff envelope through the real local lifecycle adapter",
      "- dropped a duplicate of the same payload and observed an idempotent skip",
      "- dropped an invalid schema-version envelope and observed fail-closed routing",
      "- forced one processing_error with a controlled failing lifecycle runner to create a replay candidate",
      "- replayed the failed valid artifact back into intake and processed it successfully",
      "- confirmed reprocessing a known processed hash is rejected without `--force-reprocess`",
      "- forced a reprocess of a previously processed hash and confirmed the one-shot override was consumed",
      "",
      "Observed:",
      `- first summary: ${JSON.stringify(firstSummary)}`,
      `- replay failure summary: ${JSON.stringify(failureSummary)}`,
      `- replay success summary: ${JSON.stringify(replayRunSummary)}`,
      `- force replay summary: ${JSON.stringify(forceReplaySummary)}`,
      `- status health: ${status.health.status}`,
      "",
      "Evidence:",
      "- processed, failed, skipped, replayed, and forced-reprocess receipts were written",
      "- status, list, and verify snapshots were captured as machine-readable JSON",
      "- log and state snapshots reflect the executed run, including replay actions",
    ].join("\n") + "\n",
    "utf8",
  );

  await cleanupRuntime(paths);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        evidenceDir: path.relative(process.cwd(), EVIDENCE_DIR),
        failed: status.counts.failed,
        processed: status.counts.processed,
        replayImplemented: true,
        statusImplemented: true,
        verifyImplemented: true,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}

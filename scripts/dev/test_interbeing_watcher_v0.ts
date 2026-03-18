import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runWatcherCliV0 } from "../interbeing/run_watcher_v0.ts";
import { resolveInterbeingWatcherV0Paths } from "../interbeing/watch_handoff_v0.ts";
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

async function assertNoExistingRuntime(paths: ReturnType<typeof resolveInterbeingWatcherV0Paths>) {
  const existingIncoming = await listDirectoryFiles(paths.incomingDir);
  const existingProcessed = await listDirectoryFiles(paths.processedDir);
  const existingFailed = await listDirectoryFiles(paths.failedDir);

  if (existingIncoming.length > 0 || existingProcessed.length > 0 || existingFailed.length > 0) {
    throw new Error("watcher smoke requires empty handoff directories");
  }
  if (await pathExists(paths.statePath)) {
    throw new Error("watcher smoke requires no existing watcher state file");
  }
  if (await pathExists(paths.logPath)) {
    throw new Error("watcher smoke requires no existing watcher log file");
  }
  if (await pathExists(path.dirname(paths.lifecycleOutputDir))) {
    throw new Error("watcher smoke requires no existing watcher runtime output");
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

async function main(): Promise<void> {
  const paths = resolveInterbeingWatcherV0Paths();
  await cleanupRuntime(paths);
  await assertNoExistingRuntime(paths);
  await rm(EVIDENCE_DIR, { recursive: true, force: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await Promise.all([
    mkdir(paths.incomingDir, { recursive: true }),
    mkdir(paths.processedDir, { recursive: true }),
    mkdir(paths.failedDir, { recursive: true }),
  ]);

  const validText = await readFile(DEFAULT_HANDOFF_FIXTURE_PATH, "utf8");
  const invalidEnvelope = {
    ...(JSON.parse(validText) as Record<string, unknown>),
    schema_version: "v1",
  };
  const validFilename = "a-valid.task-envelope.v0.json";
  const duplicateFilename = "b-duplicate.task-envelope.v0.json";
  const invalidFilename = "c-invalid.task-envelope.v0.json";

  await Promise.all([
    writeFile(path.join(paths.incomingDir, validFilename), validText, "utf8"),
    writeFile(path.join(paths.incomingDir, duplicateFilename), validText, "utf8"),
    writeJsonFile(path.join(paths.incomingDir, invalidFilename), invalidEnvelope),
  ]);

  await runWatcherCliV0({ argv: ["once"] });

  const processedFiles = await listDirectoryFiles(paths.processedDir);
  const failedFiles = await listDirectoryFiles(paths.failedDir);
  if (!processedFiles.some((name) => name.startsWith("a-valid.task-envelope.v0"))) {
    throw new Error("valid handoff file was not moved to processed");
  }
  if (!processedFiles.some((name) => name.startsWith("b-duplicate.task-envelope.v0"))) {
    throw new Error("duplicate handoff file was not moved to processed");
  }
  if (!failedFiles.some((name) => name.startsWith("c-invalid.task-envelope.v0"))) {
    throw new Error("invalid handoff file was not moved to failed");
  }

  const watcherState = await readJsonFile<{
    processed_hashes: Record<string, { filename: string; processed_at: string }>;
    schema_version: string;
  }>(paths.statePath);
  const expectedHash = fileHash(validText);
  if (watcherState.schema_version !== "v0") {
    throw new Error("watcher state did not persist schema_version v0");
  }
  if (Object.keys(watcherState.processed_hashes).length !== 1) {
    throw new Error("watcher state did not persist exactly one processed hash");
  }
  if (!watcherState.processed_hashes[expectedHash]) {
    throw new Error("watcher state did not persist the processed valid hash");
  }

  const watcherLogLines = (await readFile(paths.logPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { filename: string; reason: string; status: string });
  const statuses = new Set(watcherLogLines.map((entry) => entry.status));
  if (!statuses.has("processed") || !statuses.has("skipped") || !statuses.has("failed")) {
    throw new Error("watcher log did not record processed, skipped, and failed outcomes");
  }

  const lifecycleEvent = await readJsonFile<{ event_type?: string }>(
    path.join(paths.lifecycleOutputDir, "event-envelope.json"),
  );
  if (lifecycleEvent.event_type !== "task.running") {
    throw new Error("watcher did not emit the expected representative lifecycle event");
  }

  const processedValidFile =
    processedFiles.find((name) => name.startsWith("a-valid.task-envelope.v0")) ?? validFilename;
  await Promise.all([
    copyFile(
      path.join(paths.processedDir, processedValidFile),
      path.join(EVIDENCE_DIR, "sample-processed-file.task-envelope.v0.json"),
    ),
    copyFile(paths.logPath, path.join(EVIDENCE_DIR, "interbeing_watcher_v0.log")),
    copyFile(paths.statePath, path.join(EVIDENCE_DIR, "interbeing_watcher_v0.state.json")),
    copyFile(
      path.join(paths.lifecycleOutputDir, "event-envelope.json"),
      path.join(EVIDENCE_DIR, "event-envelope.json"),
    ),
    copyFile(
      path.join(paths.lifecycleOutputDir, "task-status-queued.json"),
      path.join(EVIDENCE_DIR, "task-status-queued.json"),
    ),
    copyFile(
      path.join(paths.lifecycleOutputDir, "task-status-running.json"),
      path.join(EVIDENCE_DIR, "task-status-running.json"),
    ),
    copyFile(
      path.join(paths.lifecycleOutputDir, "task-status-succeeded.json"),
      path.join(EVIDENCE_DIR, "task-status-succeeded.json"),
    ),
  ]);

  await writeFile(
    path.join(EVIDENCE_DIR, "watcher-smoke.md"),
    [
      "# Interbeing Watcher v0 Smoke",
      "",
      "Flow:",
      "- dropped one valid handoff file into `handoff/incoming/dali/`",
      "- dropped one duplicate of the same payload to verify idempotent skipping",
      "- dropped one invalid schema-version file to verify fail-closed routing",
      "- ran `once` mode through `scripts/interbeing/run_watcher_v0.ts`",
      "",
      "Observed:",
      `- processed files: ${processedFiles.join(", ")}`,
      `- failed files: ${failedFiles.join(", ")}`,
      `- persisted hash count: ${Object.keys(watcherState.processed_hashes).length}`,
      `- lifecycle event: ${lifecycleEvent.event_type ?? "unknown"}`,
      "",
      "Validation:",
      "- valid input moved to `handoff/processed/dali/`",
      "- duplicate input was skipped and also moved out of intake",
      "- invalid schema-version input moved to `handoff/failed/dali/`",
      "- watcher state persisted the valid payload hash exactly once",
      "- lifecycle artifacts were emitted through the existing local interbeing harness",
    ].join("\n") + "\n",
    "utf8",
  );

  await cleanupRuntime(paths);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        evidenceDir: path.relative(process.cwd(), EVIDENCE_DIR),
        failed: failedFiles.length,
        processed: processedFiles.length,
        stateHashes: Object.keys(watcherState.processed_hashes).length,
      },
      null,
      2,
    ),
  );
}

await main();

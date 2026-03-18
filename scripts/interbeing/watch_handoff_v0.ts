import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import { DEFAULT_INTERBEING_DIR, runInterbeingE2ELocalV0 } from "../dev/interbeing-e2e-local-v0.ts";

export type InterbeingWatcherV0Mode = "once" | "start";
export type InterbeingWatcherV0Status = "failed" | "processed" | "skipped";

export type InterbeingWatcherV0Paths = {
  failedDir: string;
  handoffRoot: string;
  incomingDir: string;
  lifecycleOutputDir: string;
  logPath: string;
  processedDir: string;
  statePath: string;
};

export type InterbeingWatcherV0State = {
  processed_hashes: Record<
    string,
    {
      filename: string;
      processed_at: string;
    }
  >;
  schema_version: "v0";
};

export type InterbeingWatcherV0LogEntry = {
  filename: string;
  reason: string;
  status: InterbeingWatcherV0Status;
  timestamp: string;
};

export type InterbeingWatcherV0Options = {
  cwd?: string;
  interbeingDir?: string;
  mode: InterbeingWatcherV0Mode;
  onIdle?: () => void | Promise<void>;
  paths?: Partial<InterbeingWatcherV0Paths>;
};

export type InterbeingWatcherV0Summary = {
  failed: number;
  mode: InterbeingWatcherV0Mode;
  processed: number;
  skipped: number;
};

const WATCHER_OUTPUT_ROOT = "interbeing-watcher-v0";
const STATE_SCHEMA_VERSION = "v0";
const STABILITY_DELAY_MS = 200;
const STABILITY_POLLS = 3;
const WATCH_PATTERN = ".task-envelope.v0.json";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTaskEnvelopeFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return baseName.endsWith(WATCH_PATTERN) && !baseName.endsWith(".partial");
}

function withCounterSuffix(filePath: string, counter: number): string {
  const extension = path.extname(filePath);
  const base = extension.length > 0 ? filePath.slice(0, -extension.length) : filePath;
  return `${base}.${counter}${extension}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveInterbeingWatcherV0Paths(cwd = process.cwd()): InterbeingWatcherV0Paths {
  const repoRoot = path.resolve(cwd);
  const handoffRoot = path.join(repoRoot, "handoff");
  return {
    handoffRoot,
    incomingDir: path.join(handoffRoot, "incoming", "dali"),
    processedDir: path.join(handoffRoot, "processed", "dali"),
    failedDir: path.join(handoffRoot, "failed", "dali"),
    statePath: path.join(repoRoot, "workspace", "state", "interbeing_watcher_v0.json"),
    logPath: path.join(repoRoot, "workspace", "audit", "interbeing_watcher_v0.log"),
    lifecycleOutputDir: path.join(repoRoot, "workspace", "audit", WATCHER_OUTPUT_ROOT, "last-run"),
  };
}

async function ensureRuntimePaths(paths: InterbeingWatcherV0Paths): Promise<void> {
  await Promise.all([
    mkdir(paths.incomingDir, { recursive: true }),
    mkdir(paths.processedDir, { recursive: true }),
    mkdir(paths.failedDir, { recursive: true }),
    mkdir(path.dirname(paths.statePath), { recursive: true }),
    mkdir(path.dirname(paths.logPath), { recursive: true }),
    mkdir(paths.lifecycleOutputDir, { recursive: true }),
  ]);
}

async function readWatcherState(statePath: string): Promise<InterbeingWatcherV0State> {
  if (!(await pathExists(statePath))) {
    return {
      schema_version: STATE_SCHEMA_VERSION,
      processed_hashes: {},
    };
  }

  const raw = JSON.parse(await readFile(statePath, "utf8")) as Partial<InterbeingWatcherV0State>;
  if (raw.schema_version !== STATE_SCHEMA_VERSION || !raw.processed_hashes) {
    throw new Error(`invalid watcher state schema in ${statePath}`);
  }
  return {
    schema_version: STATE_SCHEMA_VERSION,
    processed_hashes: raw.processed_hashes,
  };
}

async function writeWatcherState(
  statePath: string,
  state: InterbeingWatcherV0State,
): Promise<void> {
  const tempPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}

async function appendWatcherLog(
  logPath: string,
  entry: InterbeingWatcherV0LogEntry,
): Promise<void> {
  await writeFile(logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", flag: "a" });
}

async function hashFileContents(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function waitForStableFile(filePath: string): Promise<boolean> {
  let previousSignature = "";
  for (let attempt = 0; attempt < STABILITY_POLLS; attempt += 1) {
    if (!(await pathExists(filePath))) {
      return false;
    }
    const stats = await stat(filePath);
    const signature = `${stats.size}:${stats.mtimeMs}`;
    if (signature === previousSignature) {
      return true;
    }
    previousSignature = signature;
    await wait(STABILITY_DELAY_MS);
  }
  return false;
}

async function moveIntoDirectory(sourcePath: string, targetDir: string): Promise<string> {
  const baseName = path.basename(sourcePath);
  let candidatePath = path.join(targetDir, baseName);
  let counter = 1;
  while (await pathExists(candidatePath)) {
    candidatePath = withCounterSuffix(path.join(targetDir, baseName), counter);
    counter += 1;
  }
  await rename(sourcePath, candidatePath);
  return candidatePath;
}

async function resetLifecycleOutputDir(outputDir: string): Promise<void> {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
}

async function processSingleFile(params: {
  filePath: string;
  interbeingDir: string;
  paths: InterbeingWatcherV0Paths;
  state: InterbeingWatcherV0State;
}): Promise<InterbeingWatcherV0Status> {
  const filePath = path.resolve(params.filePath);
  const filename = path.basename(filePath);
  if (!isTaskEnvelopeFile(filePath)) {
    return "skipped";
  }
  if (!(await waitForStableFile(filePath))) {
    await appendWatcherLog(params.paths.logPath, {
      filename,
      reason: "file_not_stable",
      status: "skipped",
      timestamp: nowIso(),
    });
    return "skipped";
  }

  let rawText = "";
  try {
    rawText = await readFile(filePath, "utf8");
  } catch (err) {
    await appendWatcherLog(params.paths.logPath, {
      filename,
      reason: `read_error:${normalizeErrorMessage(err)}`,
      status: "failed",
      timestamp: nowIso(),
    });
    return "failed";
  }

  let rawJson: Record<string, unknown>;
  try {
    rawJson = JSON.parse(rawText) as Record<string, unknown>;
  } catch (err) {
    await moveIntoDirectory(filePath, params.paths.failedDir);
    await appendWatcherLog(params.paths.logPath, {
      filename,
      reason: `invalid_json:${normalizeErrorMessage(err)}`,
      status: "failed",
      timestamp: nowIso(),
    });
    return "failed";
  }

  if (rawJson.schema_version !== STATE_SCHEMA_VERSION) {
    await moveIntoDirectory(filePath, params.paths.failedDir);
    await appendWatcherLog(params.paths.logPath, {
      filename,
      reason: `unsupported_schema_version:${JSON.stringify(rawJson.schema_version)}`,
      status: "failed",
      timestamp: nowIso(),
    });
    return "failed";
  }

  const fileHash = await hashFileContents(filePath);
  if (params.state.processed_hashes[fileHash]) {
    await moveIntoDirectory(filePath, params.paths.processedDir);
    await appendWatcherLog(params.paths.logPath, {
      filename,
      reason: `duplicate_sha256:${fileHash}`,
      status: "skipped",
      timestamp: nowIso(),
    });
    return "skipped";
  }

  try {
    await resetLifecycleOutputDir(params.paths.lifecycleOutputDir);
    await runInterbeingE2ELocalV0({
      inputPath: filePath,
      interbeingDir: params.interbeingDir,
      outputDir: params.paths.lifecycleOutputDir,
    });
    params.state.processed_hashes[fileHash] = {
      filename,
      processed_at: nowIso(),
    };
    await writeWatcherState(params.paths.statePath, params.state);
    await moveIntoDirectory(filePath, params.paths.processedDir);
    await appendWatcherLog(params.paths.logPath, {
      filename,
      reason: `processed_sha256:${fileHash}`,
      status: "processed",
      timestamp: nowIso(),
    });
    return "processed";
  } catch (err) {
    await moveIntoDirectory(filePath, params.paths.failedDir);
    await appendWatcherLog(params.paths.logPath, {
      filename,
      reason: `processing_error:${normalizeErrorMessage(err)}`,
      status: "failed",
      timestamp: nowIso(),
    });
    return "failed";
  }
}

async function listIncomingFiles(incomingDir: string): Promise<string[]> {
  const entries = await readdir(incomingDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(incomingDir, entry.name))
    .filter((filePath) => isTaskEnvelopeFile(filePath))
    .toSorted((left, right) => left.localeCompare(right));
}

async function processQueue(params: {
  interbeingDir: string;
  paths: InterbeingWatcherV0Paths;
  state: InterbeingWatcherV0State;
  summary: InterbeingWatcherV0Summary;
}): Promise<void> {
  const files = await listIncomingFiles(params.paths.incomingDir);
  for (const filePath of files) {
    const outcome = await processSingleFile({
      filePath,
      interbeingDir: params.interbeingDir,
      paths: params.paths,
      state: params.state,
    });
    params.summary[outcome] += 1;
  }
}

export async function runInterbeingWatcherV0(
  options: InterbeingWatcherV0Options,
): Promise<InterbeingWatcherV0Summary> {
  const paths = {
    ...resolveInterbeingWatcherV0Paths(options.cwd),
    ...options.paths,
  };
  const interbeingDir = path.resolve(options.interbeingDir ?? DEFAULT_INTERBEING_DIR);
  await ensureRuntimePaths(paths);
  const state = await readWatcherState(paths.statePath);

  const summary: InterbeingWatcherV0Summary = {
    mode: options.mode,
    processed: 0,
    skipped: 0,
    failed: 0,
  };

  await processQueue({ interbeingDir, paths, state, summary });
  if (options.onIdle) {
    await options.onIdle();
  }
  if (options.mode === "once") {
    return summary;
  }

  const pending = new Set<string>();
  let draining = false;
  const drain = async (): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      while (pending.size > 0) {
        const next = pending.values().next().value;
        if (!next) {
          break;
        }
        pending.delete(next);
        const outcome = await processSingleFile({
          filePath: next,
          interbeingDir,
          paths,
          state,
        });
        summary[outcome] += 1;
      }
    } finally {
      draining = false;
      if (options.onIdle) {
        await options.onIdle();
      }
    }
  };

  const watcher = chokidar.watch(paths.incomingDir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("add", (filePath) => {
    if (!isTaskEnvelopeFile(filePath)) {
      return;
    }
    pending.add(path.resolve(filePath));
    void drain();
  });
  watcher.on("change", (filePath) => {
    if (!isTaskEnvelopeFile(filePath)) {
      return;
    }
    pending.add(path.resolve(filePath));
    void drain();
  });

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      watcher.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      watcher.off("ready", onReady);
      reject(err);
    };
    watcher.once("ready", onReady);
    watcher.once("error", onError);
  });
  await processQueue({ interbeingDir, paths, state, summary });
  if (options.onIdle) {
    await options.onIdle();
  }

  await new Promise<void>((resolve, reject) => {
    const onSigInt = () => resolve();
    const onSigTerm = () => resolve();
    const onError = (err: Error) => reject(err);
    watcher.on("error", onError);
    process.once("SIGINT", onSigInt);
    process.once("SIGTERM", onSigTerm);
    watcher.once("close", () => {
      watcher.off("error", onError);
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
    });
  }).finally(async () => {
    await watcher.close();
  });
  return summary;
}

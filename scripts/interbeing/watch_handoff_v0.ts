import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import { parseSubmitTaskEnvelopeV0 } from "../../src/shared/interbeing-task-lifecycle-v0.ts";
import { DEFAULT_INTERBEING_DIR, runInterbeingE2ELocalV0 } from "../dev/interbeing-e2e-local-v0.ts";
import {
  WATCHER_TOOL_NAME,
  WATCHER_TOOL_VERSION,
  appendWatcherLog,
  ensureWatcherRuntimePaths,
  hashFileContents,
  isPartialTaskEnvelopeFile,
  isTaskEnvelopeFile,
  listEnvelopeFiles,
  listPartialEnvelopeFiles,
  listRecentWatcherReceipts,
  moveIntoDirectory,
  normalizeErrorMessage,
  nowIso,
  queueReplayIntoIncoming,
  readWatcherState,
  resolveInterbeingWatcherV0Paths,
  summarizeWatcherHealth,
  summarizeWatcherStatus,
  toRepoRelative,
  verifyWatcherArtifact,
  waitForStableFile,
  withWatcherMutationLock,
  writeReceiptForMovedFile,
  writeWatcherState,
  type InterbeingWatcherV0Disposition,
  type InterbeingWatcherV0HealthDeps,
  type InterbeingWatcherV0HealthSummary,
  type InterbeingWatcherV0LogEntry,
  type InterbeingWatcherV0Mode,
  type InterbeingWatcherV0Paths,
  type InterbeingWatcherV0ProcessResult,
  type InterbeingWatcherV0ReasonCode,
  type InterbeingWatcherV0State,
  type InterbeingWatcherV0StatusSummary,
  type InterbeingWatcherV0Summary,
  type InterbeingWatcherV0VerifySummary,
} from "./watcher_v0_support.ts";

export type { InterbeingWatcherV0Mode, InterbeingWatcherV0Paths, InterbeingWatcherV0ReasonCode };

export type InterbeingWatcherV0Options = {
  cwd?: string;
  interbeingDir?: string;
  mode: InterbeingWatcherV0Mode;
  onIdle?: () => void | Promise<void>;
  paths?: Partial<InterbeingWatcherV0Paths>;
  runLifecycle?: (options: {
    inputPath: string;
    interbeingDir: string;
    outputDir: string;
  }) => Promise<unknown>;
};

const STABILITY_DELAY_MS = 200;
const STABILITY_POLLS = 3;

function createLogEntry(params: {
  action: InterbeingWatcherV0LogEntry["action"];
  filename: string;
  finalPath?: string | null;
  paths: InterbeingWatcherV0Paths;
  reasonCode: InterbeingWatcherV0ReasonCode;
  reasonDetail?: string | null;
  receiptPath?: string | null;
  sha256?: string | null;
  status: InterbeingWatcherV0LogEntry["status"];
  timestamp?: string;
}): InterbeingWatcherV0LogEntry {
  return {
    action: params.action,
    filename: params.filename,
    final_path: toRepoRelative(params.paths, params.finalPath) ?? null,
    reason_code: params.reasonCode,
    reason_detail: params.reasonDetail ?? null,
    receipt_path: toRepoRelative(params.paths, params.receiptPath) ?? null,
    sha256: params.sha256 ?? null,
    status: params.status,
    timestamp: params.timestamp ?? nowIso(),
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
  };
}

async function resetLifecycleOutputDir(outputDir: string): Promise<void> {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
}

async function logIgnoredPartial(params: {
  filePath: string;
  observedPartials: Set<string>;
  paths: InterbeingWatcherV0Paths;
}): Promise<void> {
  const resolvedPath = path.resolve(params.filePath);
  if (params.observedPartials.has(resolvedPath)) {
    return;
  }
  params.observedPartials.add(resolvedPath);
  await appendWatcherLog(
    params.paths.logPath,
    createLogEntry({
      action: "intake",
      filename: path.basename(resolvedPath),
      finalPath: resolvedPath,
      paths: params.paths,
      reasonCode: "partial_ignored",
      status: "skipped",
    }),
  );
}

async function logIgnoredPartialsInQueue(params: {
  incomingDir: string;
  observedPartials: Set<string>;
  paths: InterbeingWatcherV0Paths;
}): Promise<void> {
  const partials = await listPartialEnvelopeFiles(params.incomingDir);
  for (const filePath of partials) {
    await logIgnoredPartial({
      filePath,
      observedPartials: params.observedPartials,
      paths: params.paths,
    });
  }
}

async function finalizeMovedOutcome(params: {
  disposition: InterbeingWatcherV0Disposition;
  filename: string;
  intakePath: string;
  intakeTimestamp: string;
  paths: InterbeingWatcherV0Paths;
  reasonCode: InterbeingWatcherV0ReasonCode;
  reasonDetail?: string | null;
  sha256?: string | null;
  status: InterbeingWatcherV0LogEntry["status"];
  targetDir: string;
}): Promise<InterbeingWatcherV0ProcessResult> {
  let finalPath: string | null = null;
  try {
    finalPath = await moveIntoDirectory(params.intakePath, params.targetDir);
  } catch (err) {
    await appendWatcherLog(
      params.paths.logPath,
      createLogEntry({
        action: "intake",
        filename: params.filename,
        finalPath: null,
        paths: params.paths,
        reasonCode: "move_error",
        reasonDetail: normalizeErrorMessage(err),
        sha256: params.sha256,
        status: "failed",
        timestamp: params.intakeTimestamp,
      }),
    );
    return {
      disposition: "failed",
      filename: params.filename,
      finalPath: null,
      intakeTimestamp: params.intakeTimestamp,
      reasonCode: "move_error",
      reasonDetail: normalizeErrorMessage(err),
      receiptPath: null,
      sha256: params.sha256 ?? null,
    };
  }

  try {
    const receiptPath = await writeReceiptForMovedFile(finalPath, {
      evidence: {
        lifecycle_output_dir:
          params.disposition === "processed"
            ? (toRepoRelative(params.paths, params.paths.lifecycleOutputDir) ??
              params.paths.lifecycleOutputDir)
            : null,
        log_path: toRepoRelative(params.paths, params.paths.logPath) ?? params.paths.logPath,
        state_path: toRepoRelative(params.paths, params.paths.statePath) ?? params.paths.statePath,
      },
      final_disposition: params.disposition,
      intake_path: toRepoRelative(params.paths, params.intakePath) ?? params.intakePath,
      intake_timestamp: params.intakeTimestamp,
      original_filename: params.filename,
      reason_code: params.reasonCode,
      reason_detail: params.reasonDetail ?? null,
      schema_version: "v0",
      sha256: params.sha256 ?? null,
      tool_name: WATCHER_TOOL_NAME,
      watcher_version: WATCHER_TOOL_VERSION,
    });
    await appendWatcherLog(
      params.paths.logPath,
      createLogEntry({
        action: "intake",
        filename: params.filename,
        finalPath,
        paths: params.paths,
        reasonCode: params.reasonCode,
        reasonDetail: params.reasonDetail ?? null,
        receiptPath,
        sha256: params.sha256,
        status: params.status,
        timestamp: params.intakeTimestamp,
      }),
    );
    return {
      disposition: params.disposition,
      filename: params.filename,
      finalPath: toRepoRelative(params.paths, finalPath) ?? finalPath,
      intakeTimestamp: params.intakeTimestamp,
      reasonCode: params.reasonCode,
      reasonDetail: params.reasonDetail ?? null,
      receiptPath: toRepoRelative(params.paths, receiptPath) ?? receiptPath,
      sha256: params.sha256 ?? null,
    };
  } catch (err) {
    await appendWatcherLog(
      params.paths.logPath,
      createLogEntry({
        action: "intake",
        filename: params.filename,
        finalPath,
        paths: params.paths,
        reasonCode: "unexpected_internal_error",
        reasonDetail: normalizeErrorMessage(err),
        sha256: params.sha256,
        status: "failed",
        timestamp: params.intakeTimestamp,
      }),
    );
    return {
      disposition: "failed",
      filename: params.filename,
      finalPath: toRepoRelative(params.paths, finalPath) ?? finalPath,
      intakeTimestamp: params.intakeTimestamp,
      reasonCode: "unexpected_internal_error",
      reasonDetail: normalizeErrorMessage(err),
      receiptPath: null,
      sha256: params.sha256 ?? null,
    };
  }
}

async function processSingleFile(params: {
  filePath: string;
  interbeingDir: string;
  paths: InterbeingWatcherV0Paths;
  runLifecycle: NonNullable<InterbeingWatcherV0Options["runLifecycle"]>;
}): Promise<InterbeingWatcherV0ProcessResult> {
  const intakePath = path.resolve(params.filePath);
  const filename = path.basename(intakePath);
  const intakeTimestamp = nowIso();

  if (!isTaskEnvelopeFile(intakePath)) {
    return {
      disposition: "skipped",
      filename,
      finalPath: null,
      intakeTimestamp,
      reasonCode: "partial_ignored",
      reasonDetail: null,
      receiptPath: null,
      sha256: null,
    };
  }

  if (
    !(await waitForStableFile(intakePath, {
      delayMs: STABILITY_DELAY_MS,
      polls: STABILITY_POLLS,
    }))
  ) {
    await appendWatcherLog(
      params.paths.logPath,
      createLogEntry({
        action: "intake",
        filename,
        finalPath: intakePath,
        paths: params.paths,
        reasonCode: "file_not_ready",
        status: "skipped",
        timestamp: intakeTimestamp,
      }),
    );
    return {
      disposition: "skipped",
      filename,
      finalPath: toRepoRelative(params.paths, intakePath) ?? intakePath,
      intakeTimestamp,
      reasonCode: "file_not_ready",
      reasonDetail: null,
      receiptPath: null,
      sha256: null,
    };
  }

  let rawText: string;
  try {
    rawText = await readFile(intakePath, "utf8");
  } catch (err) {
    return finalizeMovedOutcome({
      disposition: "failed",
      filename,
      intakePath,
      intakeTimestamp,
      paths: params.paths,
      reasonCode: "unexpected_internal_error",
      reasonDetail: `read_error:${normalizeErrorMessage(err)}`,
      status: "failed",
      targetDir: params.paths.failedDir,
    });
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch (err) {
    return finalizeMovedOutcome({
      disposition: "failed",
      filename,
      intakePath,
      intakeTimestamp,
      paths: params.paths,
      reasonCode: "invalid_json",
      reasonDetail: normalizeErrorMessage(err),
      status: "failed",
      targetDir: params.paths.failedDir,
    });
  }

  const rawRecord =
    typeof rawJson === "object" && rawJson !== null ? (rawJson as Record<string, unknown>) : null;
  if (rawRecord?.schema_version !== "v0") {
    return finalizeMovedOutcome({
      disposition: "failed",
      filename,
      intakePath,
      intakeTimestamp,
      paths: params.paths,
      reasonCode: "schema_version_invalid",
      reasonDetail: JSON.stringify(rawRecord?.schema_version ?? null),
      status: "failed",
      targetDir: params.paths.failedDir,
    });
  }

  try {
    parseSubmitTaskEnvelopeV0(rawJson);
  } catch (err) {
    return finalizeMovedOutcome({
      disposition: "failed",
      filename,
      intakePath,
      intakeTimestamp,
      paths: params.paths,
      reasonCode: "schema_invalid",
      reasonDetail: normalizeErrorMessage(err),
      status: "failed",
      targetDir: params.paths.failedDir,
    });
  }

  const sha256 = await hashFileContents(intakePath);
  const state = await readWatcherState(params.paths.statePath);
  const hasOverride = Boolean(state.reprocess_overrides[sha256]);
  if (state.processed_hashes[sha256] && !hasOverride) {
    return finalizeMovedOutcome({
      disposition: "skipped",
      filename,
      intakePath,
      intakeTimestamp,
      paths: params.paths,
      reasonCode: "duplicate",
      reasonDetail: sha256,
      sha256,
      status: "skipped",
      targetDir: params.paths.processedDir,
    });
  }

  try {
    await resetLifecycleOutputDir(params.paths.lifecycleOutputDir);
    await params.runLifecycle({
      inputPath: intakePath,
      interbeingDir: params.interbeingDir,
      outputDir: params.paths.lifecycleOutputDir,
    });
  } catch (err) {
    return finalizeMovedOutcome({
      disposition: "failed",
      filename,
      intakePath,
      intakeTimestamp,
      paths: params.paths,
      reasonCode: "processing_error",
      reasonDetail: normalizeErrorMessage(err),
      sha256,
      status: "failed",
      targetDir: params.paths.failedDir,
    });
  }

  const nextState: InterbeingWatcherV0State = {
    schema_version: state.schema_version,
    processed_hashes: {
      ...state.processed_hashes,
      [sha256]: {
        filename,
        processed_at: nowIso(),
      },
    },
    reprocess_overrides: { ...state.reprocess_overrides },
  };
  if (hasOverride) {
    delete nextState.reprocess_overrides[sha256];
  }

  try {
    await writeWatcherState(params.paths.statePath, nextState);
  } catch (err) {
    return finalizeMovedOutcome({
      disposition: "failed",
      filename,
      intakePath,
      intakeTimestamp,
      paths: params.paths,
      reasonCode: "state_error",
      reasonDetail: normalizeErrorMessage(err),
      sha256,
      status: "failed",
      targetDir: params.paths.failedDir,
    });
  }

  return finalizeMovedOutcome({
    disposition: "processed",
    filename,
    intakePath,
    intakeTimestamp,
    paths: params.paths,
    reasonCode: "processed",
    sha256,
    status: "processed",
    targetDir: params.paths.processedDir,
  });
}

async function processQueue(params: {
  interbeingDir: string;
  observedPartials: Set<string>;
  paths: InterbeingWatcherV0Paths;
  phase: "startup" | "watch";
  runLifecycle: NonNullable<InterbeingWatcherV0Options["runLifecycle"]>;
  summary: InterbeingWatcherV0Summary;
}): Promise<void> {
  await withWatcherMutationLock(params.paths, async () => {
    try {
      await readWatcherState(params.paths.statePath);
    } catch (err) {
      await appendWatcherLog(
        params.paths.logPath,
        createLogEntry({
          action: "intake",
          filename: "<state>",
          paths: params.paths,
          reasonCode: "state_error",
          reasonDetail: normalizeErrorMessage(err),
          status: "failed",
        }),
      );
      throw err;
    }

    let files: string[];
    try {
      await logIgnoredPartialsInQueue({
        incomingDir: params.paths.incomingDir,
        observedPartials: params.observedPartials,
        paths: params.paths,
      });
      files = await listEnvelopeFiles(params.paths.incomingDir);
    } catch (err) {
      await appendWatcherLog(
        params.paths.logPath,
        createLogEntry({
          action: "intake",
          filename: params.phase === "startup" ? "<startup-scan>" : "<watch-scan>",
          paths: params.paths,
          reasonCode: "startup_scan_error",
          reasonDetail: normalizeErrorMessage(err),
          status: "failed",
        }),
      );
      throw err;
    }

    for (const filePath of files) {
      const outcome = await processSingleFile({
        filePath,
        interbeingDir: params.interbeingDir,
        paths: params.paths,
        runLifecycle: params.runLifecycle,
      });
      params.summary[outcome.disposition] += 1;
    }
  });
}

export async function getInterbeingWatcherV0Status(
  options: { cwd?: string; paths?: Partial<InterbeingWatcherV0Paths> } = {},
): Promise<InterbeingWatcherV0StatusSummary> {
  const paths = {
    ...resolveInterbeingWatcherV0Paths(options.cwd),
    ...options.paths,
  };
  await ensureWatcherRuntimePaths(paths);
  return summarizeWatcherStatus(paths);
}

export async function getInterbeingWatcherV0Health(
  options: {
    cwd?: string;
    deps?: InterbeingWatcherV0HealthDeps;
    paths?: Partial<InterbeingWatcherV0Paths>;
  } = {},
): Promise<InterbeingWatcherV0HealthSummary> {
  const paths = {
    ...resolveInterbeingWatcherV0Paths(options.cwd),
    ...options.paths,
  };
  await ensureWatcherRuntimePaths(paths);
  return summarizeWatcherHealth(paths, options.deps);
}

export async function listInterbeingWatcherV0Items(
  options: { cwd?: string; limit?: number; paths?: Partial<InterbeingWatcherV0Paths> } = {},
): Promise<{ items: unknown[]; tool_name: string; watcher_version: string }> {
  const paths = {
    ...resolveInterbeingWatcherV0Paths(options.cwd),
    ...options.paths,
  };
  await ensureWatcherRuntimePaths(paths);
  return listRecentWatcherReceipts(paths, options.limit ?? 10);
}

export async function verifyInterbeingWatcherV0(
  options: {
    cwd?: string;
    filename?: string;
    paths?: Partial<InterbeingWatcherV0Paths>;
    sha256?: string;
  } = {},
): Promise<InterbeingWatcherV0VerifySummary> {
  const paths = {
    ...resolveInterbeingWatcherV0Paths(options.cwd),
    ...options.paths,
  };
  await ensureWatcherRuntimePaths(paths);
  return verifyWatcherArtifact(paths, {
    filename: options.filename,
    sha256: options.sha256,
  });
}

export async function replayInterbeingWatcherV0(options: {
  cwd?: string;
  file: string;
  forceReprocess?: boolean;
  paths?: Partial<InterbeingWatcherV0Paths>;
}): Promise<ReturnType<typeof queueReplayIntoIncoming> extends Promise<infer T> ? T : never> {
  const paths = {
    ...resolveInterbeingWatcherV0Paths(options.cwd),
    ...options.paths,
  };
  await ensureWatcherRuntimePaths(paths);
  try {
    return await queueReplayIntoIncoming({
      filePath: options.file,
      forceReprocess: options.forceReprocess,
      paths,
    });
  } catch (err) {
    const detail = normalizeErrorMessage(err);
    await appendWatcherLog(
      paths.logPath,
      createLogEntry({
        action: "replay",
        filename: path.basename(options.file),
        finalPath: null,
        paths,
        reasonCode: detail.includes("--force-reprocess")
          ? "duplicate"
          : "unexpected_internal_error",
        reasonDetail: detail,
        status: "failed",
      }),
    );
    throw err;
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
  const runLifecycle = options.runLifecycle ?? runInterbeingE2ELocalV0;
  await ensureWatcherRuntimePaths(paths);

  const summary: InterbeingWatcherV0Summary = {
    mode: options.mode,
    processed: 0,
    skipped: 0,
    failed: 0,
  };
  const observedPartials = new Set<string>();

  await processQueue({
    interbeingDir,
    observedPartials,
    paths,
    phase: "startup",
    runLifecycle,
    summary,
  });
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
      await withWatcherMutationLock(paths, async () => {
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
            runLifecycle,
          });
          summary[outcome.disposition] += 1;
        }
      });
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
    if (isPartialTaskEnvelopeFile(filePath)) {
      void logIgnoredPartial({ filePath, observedPartials, paths });
      return;
    }
    if (!isTaskEnvelopeFile(filePath)) {
      return;
    }
    pending.add(path.resolve(filePath));
    void drain();
  });
  watcher.on("change", (filePath) => {
    if (isPartialTaskEnvelopeFile(filePath)) {
      void logIgnoredPartial({ filePath, observedPartials, paths });
      return;
    }
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
  await processQueue({
    interbeingDir,
    observedPartials,
    paths,
    phase: "startup",
    runLifecycle,
    summary,
  });
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

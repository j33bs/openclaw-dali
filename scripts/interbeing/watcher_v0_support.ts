import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const WATCHER_TOOL_NAME = "interbeing-watcher-v0";
export const WATCHER_TOOL_VERSION = "v0-hardening";
export const WATCHER_STATE_SCHEMA_VERSION = "v0";
export const WATCHER_OUTPUT_ROOT = "interbeing-watcher-v0";
export const WATCHER_RECEIPT_SUFFIX = ".receipt.json";
export const WATCHER_TASK_PATTERN = ".task-envelope.v0.json";
export const WATCHER_TEMP_EXTENSION = ".partial";
export const WATCHER_STATE_FILENAME = "interbeing_watcher_v0.json";
export const WATCHER_LOG_FILENAME = "interbeing_watcher_v0.log";

export type InterbeingWatcherV0Mode = "once" | "start";
export type InterbeingWatcherV0Disposition = "failed" | "processed" | "skipped";
export type InterbeingWatcherV0LogStatus = InterbeingWatcherV0Disposition | "queued";
export type InterbeingWatcherV0Action = "intake" | "replay";
export type InterbeingWatcherV0ReasonCode =
  | "duplicate"
  | "file_not_ready"
  | "invalid_json"
  | "move_error"
  | "partial_ignored"
  | "processed"
  | "processing_error"
  | "replay_requested"
  | "force_reprocess_requested"
  | "schema_invalid"
  | "schema_version_invalid"
  | "startup_scan_error"
  | "state_error"
  | "unexpected_internal_error";

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
  reprocess_overrides: Record<
    string,
    {
      requested_at: string;
      source_file: string;
    }
  >;
  schema_version: "v0";
};

export type InterbeingWatcherV0LogEntry = {
  action: InterbeingWatcherV0Action;
  filename: string;
  final_path: string | null;
  reason_code: InterbeingWatcherV0ReasonCode;
  reason_detail: string | null;
  receipt_path: string | null;
  sha256: string | null;
  status: InterbeingWatcherV0LogStatus;
  timestamp: string;
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0Receipt = {
  evidence: {
    lifecycle_output_dir: string | null;
    log_path: string;
    state_path: string;
  };
  final_disposition: InterbeingWatcherV0Disposition;
  final_path: string;
  intake_path: string;
  intake_timestamp: string;
  original_filename: string;
  reason_code: InterbeingWatcherV0ReasonCode;
  reason_detail: string | null;
  receipt_path: string;
  schema_version: "v0";
  sha256: string | null;
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0ProcessResult = {
  disposition: InterbeingWatcherV0Disposition;
  filename: string;
  finalPath: string | null;
  intakeTimestamp: string;
  reasonCode: InterbeingWatcherV0ReasonCode;
  reasonDetail: string | null;
  receiptPath: string | null;
  sha256: string | null;
};

export type InterbeingWatcherV0Summary = {
  failed: number;
  mode: InterbeingWatcherV0Mode;
  processed: number;
  skipped: number;
};

export type InterbeingWatcherV0StatusSummary = {
  available_modes: string[];
  counts: {
    failed: number;
    incoming: number;
    partial: number;
    processed: number;
  };
  health: {
    issues: string[];
    status: "error" | "ok" | "warning";
  };
  last_failed_timestamp: string | null;
  last_processed_timestamp: string | null;
  log_path: string;
  paths: {
    failed: string;
    incoming: string;
    processed: string;
  };
  state: {
    exists: boolean;
    path: string;
    pending_reprocess_overrides: number;
    tracked_hashes: number;
  };
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0VerifyMatch = {
  disposition: InterbeingWatcherV0Disposition | "incoming";
  file: string;
  intake_timestamp: string | null;
  original_filename: string | null;
  reason_code: InterbeingWatcherV0ReasonCode | null;
  receipt_path: string | null;
  sha256: string | null;
  tracked_hash: boolean;
};

export type InterbeingWatcherV0VerifySummary = {
  found: boolean;
  matches: InterbeingWatcherV0VerifyMatch[];
  query: {
    filename: string | null;
    sha256: string | null;
  };
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0ReplaySummary = {
  force_reprocess: boolean;
  queued_path: string;
  reason_code: InterbeingWatcherV0ReasonCode;
  sha256: string;
  source_file: string;
  tool_name: string;
  watcher_version: string;
};

type CandidateReceipt = Omit<InterbeingWatcherV0Receipt, "final_path" | "receipt_path">;

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function withCounterSuffix(filePath: string, counter: number): string {
  const extension = path.extname(filePath);
  const base = extension.length > 0 ? filePath.slice(0, -extension.length) : filePath;
  return `${base}.${counter}${extension}`;
}

export function buildReceiptPath(filePath: string): string {
  return filePath.endsWith(".json")
    ? filePath.slice(0, -".json".length) + WATCHER_RECEIPT_SUFFIX
    : `${filePath}${WATCHER_RECEIPT_SUFFIX}`;
}

export function isTaskEnvelopeFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return baseName.endsWith(WATCHER_TASK_PATTERN) && !baseName.endsWith(WATCHER_TEMP_EXTENSION);
}

export function isPartialTaskEnvelopeFile(filePath: string): boolean {
  return path.basename(filePath).endsWith(`${WATCHER_TASK_PATTERN}${WATCHER_TEMP_EXTENSION}`);
}

export function resolveInterbeingWatcherV0Paths(cwd = process.cwd()): InterbeingWatcherV0Paths {
  const repoRoot = path.resolve(cwd);
  const handoffRoot = path.join(repoRoot, "handoff");
  return {
    handoffRoot,
    incomingDir: path.join(handoffRoot, "incoming", "dali"),
    processedDir: path.join(handoffRoot, "processed", "dali"),
    failedDir: path.join(handoffRoot, "failed", "dali"),
    statePath: path.join(repoRoot, "workspace", "state", WATCHER_STATE_FILENAME),
    logPath: path.join(repoRoot, "workspace", "audit", WATCHER_LOG_FILENAME),
    lifecycleOutputDir: path.join(repoRoot, "workspace", "audit", WATCHER_OUTPUT_ROOT, "last-run"),
  };
}

export function resolveWatcherRepoRoot(paths: InterbeingWatcherV0Paths): string {
  return path.dirname(paths.handoffRoot);
}

export function toRepoRelative(
  paths: InterbeingWatcherV0Paths,
  filePath: string | null | undefined,
): string | null {
  if (!filePath) {
    return null;
  }
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }
  const repoRoot = resolveWatcherRepoRoot(paths);
  const relative = path.relative(repoRoot, filePath);
  return relative.length > 0 ? relative : ".";
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureWatcherRuntimePaths(paths: InterbeingWatcherV0Paths): Promise<void> {
  await Promise.all([
    mkdir(paths.incomingDir, { recursive: true }),
    mkdir(paths.processedDir, { recursive: true }),
    mkdir(paths.failedDir, { recursive: true }),
    mkdir(path.dirname(paths.statePath), { recursive: true }),
    mkdir(path.dirname(paths.logPath), { recursive: true }),
    mkdir(paths.lifecycleOutputDir, { recursive: true }),
  ]);
}

export async function readWatcherState(statePath: string): Promise<InterbeingWatcherV0State> {
  if (!(await pathExists(statePath))) {
    return {
      schema_version: WATCHER_STATE_SCHEMA_VERSION,
      processed_hashes: {},
      reprocess_overrides: {},
    };
  }

  const raw = JSON.parse(await readFile(statePath, "utf8")) as Partial<InterbeingWatcherV0State>;
  if (
    raw.schema_version !== WATCHER_STATE_SCHEMA_VERSION ||
    !raw.processed_hashes ||
    typeof raw.processed_hashes !== "object" ||
    (raw.reprocess_overrides != null && typeof raw.reprocess_overrides !== "object")
  ) {
    throw new Error(`invalid watcher state schema in ${statePath}`);
  }
  return {
    schema_version: WATCHER_STATE_SCHEMA_VERSION,
    processed_hashes: raw.processed_hashes,
    reprocess_overrides: raw.reprocess_overrides ?? {},
  };
}

export async function writeWatcherState(
  statePath: string,
  state: InterbeingWatcherV0State,
): Promise<void> {
  const tempPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}

export async function appendWatcherLog(
  logPath: string,
  entry: InterbeingWatcherV0LogEntry,
): Promise<void> {
  await writeFile(logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", flag: "a" });
}

export async function hashFileContents(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function waitForStableFile(
  filePath: string,
  options: { delayMs?: number; polls?: number } = {},
): Promise<boolean> {
  const delayMs = options.delayMs ?? 200;
  const polls = options.polls ?? 3;
  let previousSignature = "";
  for (let attempt = 0; attempt < polls; attempt += 1) {
    if (!(await pathExists(filePath))) {
      return false;
    }
    const stats = await stat(filePath);
    const signature = `${stats.size}:${stats.mtimeMs}`;
    if (signature === previousSignature) {
      return true;
    }
    previousSignature = signature;
    await wait(delayMs);
  }
  return false;
}

async function reserveDestinationPath(sourcePath: string, targetDir: string): Promise<string> {
  const baseName = path.basename(sourcePath);
  let candidatePath = path.join(targetDir, baseName);
  let counter = 1;
  while (await pathExists(candidatePath)) {
    candidatePath = withCounterSuffix(path.join(targetDir, baseName), counter);
    counter += 1;
  }
  return candidatePath;
}

export async function moveIntoDirectory(sourcePath: string, targetDir: string): Promise<string> {
  const candidatePath = await reserveDestinationPath(sourcePath, targetDir);
  await rename(sourcePath, candidatePath);
  return candidatePath;
}

export async function copyIntoDirectory(sourcePath: string, targetDir: string): Promise<string> {
  const candidatePath = await reserveDestinationPath(sourcePath, targetDir);
  await copyFile(sourcePath, candidatePath);
  return candidatePath;
}

export async function writeReceiptForMovedFile(
  movedFilePath: string,
  receipt: CandidateReceipt,
): Promise<string> {
  const receiptPath = buildReceiptPath(movedFilePath);
  const tempPath = `${receiptPath}.tmp-${process.pid}-${Date.now()}`;
  const nextReceipt: InterbeingWatcherV0Receipt = {
    ...receipt,
    final_path: movedFilePath,
    receipt_path: receiptPath,
  };
  await writeFile(tempPath, `${JSON.stringify(nextReceipt, null, 2)}\n`, "utf8");
  await rename(tempPath, receiptPath);
  return receiptPath;
}

export async function readWatcherReceipt(receiptPath: string): Promise<InterbeingWatcherV0Receipt> {
  return JSON.parse(await readFile(receiptPath, "utf8")) as InterbeingWatcherV0Receipt;
}

export async function listEnvelopeFiles(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name))
    .filter((filePath) => isTaskEnvelopeFile(filePath))
    .toSorted((left, right) => left.localeCompare(right));
}

export async function listPartialEnvelopeFiles(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name))
    .filter((filePath) => isPartialTaskEnvelopeFile(filePath))
    .toSorted((left, right) => left.localeCompare(right));
}

export async function listWatcherReceipts(
  paths: InterbeingWatcherV0Paths,
): Promise<InterbeingWatcherV0Receipt[]> {
  const collect = async (dirPath: string): Promise<InterbeingWatcherV0Receipt[]> => {
    if (!(await pathExists(dirPath))) {
      return [];
    }
    const entries = await readdir(dirPath, { withFileTypes: true });
    const receiptPaths = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(WATCHER_RECEIPT_SUFFIX))
      .map((entry) => path.join(dirPath, entry.name))
      .toSorted((left, right) => left.localeCompare(right));
    const receipts = await Promise.all(
      receiptPaths.map((receiptPath) => readWatcherReceipt(receiptPath)),
    );
    return receipts;
  };

  const receipts = [...(await collect(paths.processedDir)), ...(await collect(paths.failedDir))];
  return receipts.toSorted((left, right) => {
    if (left.intake_timestamp === right.intake_timestamp) {
      return left.final_path.localeCompare(right.final_path);
    }
    return right.intake_timestamp.localeCompare(left.intake_timestamp);
  });
}

export async function summarizeWatcherStatus(
  paths: InterbeingWatcherV0Paths,
): Promise<InterbeingWatcherV0StatusSummary> {
  const [incoming, processed, failed, partial, stateExists, logExists, receipts] =
    await Promise.all([
      listEnvelopeFiles(paths.incomingDir),
      listEnvelopeFiles(paths.processedDir),
      listEnvelopeFiles(paths.failedDir),
      listPartialEnvelopeFiles(paths.incomingDir),
      pathExists(paths.statePath),
      pathExists(paths.logPath),
      listWatcherReceipts(paths),
    ]);

  const issues: string[] = [];
  let trackedHashes = 0;
  let pendingOverrides = 0;

  if (stateExists) {
    try {
      const state = await readWatcherState(paths.statePath);
      trackedHashes = Object.keys(state.processed_hashes).length;
      pendingOverrides = Object.keys(state.reprocess_overrides).length;
    } catch (err) {
      issues.push(`state_error:${normalizeErrorMessage(err)}`);
    }
  }
  if (!logExists) {
    issues.push("log_not_created_yet");
  }
  if (partial.length > 0) {
    issues.push(`partial_intake_files:${partial.length}`);
  }

  const lastProcessed = receipts.find((receipt) => receipt.final_disposition === "processed");
  const lastFailed = receipts.find((receipt) => receipt.final_disposition === "failed");

  return {
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
    available_modes: ["once", "start", "status", "list", "verify", "replay"],
    paths: {
      incoming: toRepoRelative(paths, paths.incomingDir) ?? paths.incomingDir,
      processed: toRepoRelative(paths, paths.processedDir) ?? paths.processedDir,
      failed: toRepoRelative(paths, paths.failedDir) ?? paths.failedDir,
    },
    counts: {
      incoming: incoming.length,
      processed: processed.length,
      failed: failed.length,
      partial: partial.length,
    },
    state: {
      exists: stateExists,
      path: toRepoRelative(paths, paths.statePath) ?? paths.statePath,
      tracked_hashes: trackedHashes,
      pending_reprocess_overrides: pendingOverrides,
    },
    last_processed_timestamp: lastProcessed?.intake_timestamp ?? null,
    last_failed_timestamp: lastFailed?.intake_timestamp ?? null,
    log_path: toRepoRelative(paths, paths.logPath) ?? paths.logPath,
    health: {
      status: issues.some((issue) => issue.startsWith("state_error"))
        ? "error"
        : issues.length > 0
          ? "warning"
          : "ok",
      issues,
    },
  };
}

export async function verifyWatcherArtifact(
  paths: InterbeingWatcherV0Paths,
  params: { filename?: string; sha256?: string },
): Promise<InterbeingWatcherV0VerifySummary> {
  const filename = params.filename?.trim() || null;
  const sha256 = params.sha256?.trim() || null;
  if (!filename && !sha256) {
    throw new Error("verify requires --filename or --sha256");
  }

  const matches: InterbeingWatcherV0VerifyMatch[] = [];
  const trackedHashes = await readWatcherState(paths.statePath);
  const receipts = await listWatcherReceipts(paths);

  for (const receipt of receipts) {
    if (
      (filename &&
        receipt.original_filename !== filename &&
        path.basename(receipt.final_path) !== filename) ||
      (sha256 && receipt.sha256 !== sha256)
    ) {
      continue;
    }
    matches.push({
      disposition: receipt.final_disposition,
      file: receipt.final_path,
      intake_timestamp: receipt.intake_timestamp,
      original_filename: receipt.original_filename,
      reason_code: receipt.reason_code,
      receipt_path: receipt.receipt_path,
      sha256: receipt.sha256,
      tracked_hash:
        receipt.sha256 != null ? Boolean(trackedHashes?.processed_hashes[receipt.sha256]) : false,
    });
  }

  const incoming = await listEnvelopeFiles(paths.incomingDir);
  for (const filePath of incoming) {
    const baseName = path.basename(filePath);
    if (filename && baseName !== filename) {
      continue;
    }
    const fileSha = sha256 ? await hashFileContents(filePath) : null;
    if (sha256 && fileSha !== sha256) {
      continue;
    }
    matches.push({
      disposition: "incoming",
      file: toRepoRelative(paths, filePath) ?? filePath,
      intake_timestamp: null,
      original_filename: baseName,
      reason_code: null,
      receipt_path: null,
      sha256: fileSha,
      tracked_hash: fileSha != null ? Boolean(trackedHashes?.processed_hashes[fileSha]) : false,
    });
  }

  const normalizedMatches = matches
    .map((match) => ({
      ...match,
      file: match.file.startsWith("handoff/")
        ? match.file
        : (toRepoRelative(paths, match.file) ?? match.file),
      receipt_path:
        match.receipt_path == null
          ? null
          : (toRepoRelative(paths, match.receipt_path) ?? match.receipt_path),
    }))
    .toSorted((left, right) => {
      if (left.file === right.file) {
        return (left.receipt_path ?? "").localeCompare(right.receipt_path ?? "");
      }
      return left.file.localeCompare(right.file);
    });

  return {
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
    found: normalizedMatches.length > 0,
    query: { filename, sha256 },
    matches: normalizedMatches,
  };
}

export async function listRecentWatcherReceipts(
  paths: InterbeingWatcherV0Paths,
  limit = 10,
): Promise<{ items: InterbeingWatcherV0Receipt[]; tool_name: string; watcher_version: string }> {
  const receipts = await listWatcherReceipts(paths);
  return {
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
    items: receipts.slice(0, Math.max(0, limit)).map((receipt) => ({
      ...receipt,
      final_path: toRepoRelative(paths, receipt.final_path) ?? receipt.final_path,
      intake_path: toRepoRelative(paths, receipt.intake_path) ?? receipt.intake_path,
      receipt_path: toRepoRelative(paths, receipt.receipt_path) ?? receipt.receipt_path,
      evidence: {
        ...receipt.evidence,
        lifecycle_output_dir:
          receipt.evidence.lifecycle_output_dir == null
            ? null
            : (toRepoRelative(paths, receipt.evidence.lifecycle_output_dir) ??
              receipt.evidence.lifecycle_output_dir),
        log_path: toRepoRelative(paths, receipt.evidence.log_path) ?? receipt.evidence.log_path,
        state_path:
          toRepoRelative(paths, receipt.evidence.state_path) ?? receipt.evidence.state_path,
      },
    })),
  };
}

export async function queueReplayIntoIncoming(params: {
  filePath: string;
  forceReprocess?: boolean;
  paths: InterbeingWatcherV0Paths;
}): Promise<InterbeingWatcherV0ReplaySummary> {
  const sourcePath = path.resolve(params.filePath);
  const isFailedSource = sourcePath.startsWith(path.resolve(params.paths.failedDir) + path.sep);
  const isProcessedSource = sourcePath.startsWith(
    path.resolve(params.paths.processedDir) + path.sep,
  );
  if (!isFailedSource && !isProcessedSource) {
    throw new Error(
      "replay source must live under handoff/processed/dali/ or handoff/failed/dali/",
    );
  }

  if (!(await pathExists(sourcePath))) {
    throw new Error(`replay source not found: ${sourcePath}`);
  }

  const sha256 = await hashFileContents(sourcePath);
  const state = await readWatcherState(params.paths.statePath);
  const alreadyProcessed = Boolean(state.processed_hashes[sha256]);
  if (alreadyProcessed && !params.forceReprocess) {
    throw new Error("replay of a previously processed hash requires --force-reprocess");
  }
  if (params.forceReprocess) {
    state.reprocess_overrides[sha256] = {
      requested_at: nowIso(),
      source_file: path.basename(sourcePath),
    };
    await writeWatcherState(params.paths.statePath, state);
  }

  const queuedPath = await copyIntoDirectory(sourcePath, params.paths.incomingDir);
  const reasonCode = params.forceReprocess ? "force_reprocess_requested" : "replay_requested";
  await appendWatcherLog(params.paths.logPath, {
    action: "replay",
    filename: path.basename(sourcePath),
    final_path: toRepoRelative(params.paths, queuedPath),
    reason_code: reasonCode,
    reason_detail: null,
    receipt_path: null,
    sha256,
    status: "queued",
    timestamp: nowIso(),
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
  });

  return {
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
    force_reprocess: Boolean(params.forceReprocess),
    queued_path: toRepoRelative(params.paths, queuedPath) ?? queuedPath,
    reason_code: reasonCode,
    sha256,
    source_file: toRepoRelative(params.paths, sourcePath) ?? sourcePath,
  };
}

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
export const WATCHER_LOCK_FILENAME = "interbeing_watcher_v0.lock";
export const WATCHER_SYSTEMD_SERVICE_NAME = "openclaw-interbeing-watcher";
export const WATCHER_LOCK_STALE_AGE_MS = 60_000;
export const WATCHER_HEALTH_ISSUE_MAX_AGE_MS = 12 * 60 * 60 * 1_000;
export const WATCHER_AVAILABLE_MODES = [
  "once",
  "start",
  "status",
  "health",
  "list",
  "verify",
  "replay",
] as const;

export type InterbeingWatcherV0Mode = "once" | "start";
export type InterbeingWatcherV0Disposition = "failed" | "processed" | "skipped";
export type InterbeingWatcherV0LogStatus = InterbeingWatcherV0Disposition | "queued";
export type InterbeingWatcherV0Action = "intake" | "replay";
export type InterbeingWatcherV0ReasonCode =
  | "dispatch_invalid"
  | "duplicate"
  | "file_not_ready"
  | "hop_limit_exceeded"
  | "invalid_json"
  | "move_error"
  | "partial_ignored"
  | "processed"
  | "processing_error"
  | "replay_requested"
  | "reviewer_rejected"
  | "force_reprocess_requested"
  | "schema_invalid"
  | "schema_version_invalid"
  | "startup_scan_error"
  | "state_error"
  | "unexpected_internal_error";

export type InterbeingWatcherV0LocalDispatchRole = "executor" | "planner" | "reviewer";

export type InterbeingWatcherV0ReceiptLineage = {
  chain_id: string;
  hop_count: number;
  max_hops: number | null;
  parent_role: InterbeingWatcherV0LocalDispatchRole | null;
  parent_task_id: string | null;
};

export type InterbeingWatcherV0ReceiptLocalDispatch = {
  children: {
    executed: number;
    failed: number;
    skipped_duplicates: number;
    total: number;
  } | null;
  lineage: InterbeingWatcherV0ReceiptLineage | null;
  reviewer_gate: {
    approved: boolean | null;
    required: boolean;
    reviewer_task_id: string | null;
  } | null;
  role: InterbeingWatcherV0LocalDispatchRole;
  worker_pool: {
    limit: number;
    max_in_flight: number;
  } | null;
};

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
  local_dispatch?: InterbeingWatcherV0ReceiptLocalDispatch;
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
    readable: boolean;
    tracked_hashes: number;
  };
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0LockSummary = {
  acquired_at: string | null;
  age_seconds: number | null;
  detail: string | null;
  exists: boolean;
  owner_command: string | null;
  owner_matches_watcher: boolean | null;
  path: string;
  pid: number | null;
  status: "absent" | "active" | "stale" | "unknown";
  tool_name: string | null;
  watcher_version: string | null;
};

export type InterbeingWatcherV0ServiceRuntimeSummary = {
  active_enter_timestamp: string | null;
  active_state: string | null;
  available: boolean;
  detail: string | null;
  exec_main_code: string | null;
  exec_main_status: number | null;
  fragment_path: string | null;
  load_state: string | null;
  main_pid: number | null;
  n_restarts: number | null;
  result: string | null;
  sub_state: string | null;
  unit: string;
  unit_file_state: string | null;
};

export type InterbeingWatcherV0JournalIssueSummary = {
  message: string;
  priority: number | null;
  timestamp: string | null;
};

export type InterbeingWatcherV0JournalSummary = {
  available: boolean;
  detail: string | null;
  errors: InterbeingWatcherV0JournalIssueSummary[];
  unit: string;
  warnings: InterbeingWatcherV0JournalIssueSummary[];
};

export type InterbeingWatcherV0RecentLogIssueSummary = {
  action: InterbeingWatcherV0Action;
  filename: string;
  reason_code: InterbeingWatcherV0ReasonCode;
  reason_detail: string | null;
  status: InterbeingWatcherV0LogStatus;
  timestamp: string;
};

export type InterbeingWatcherV0HealthSummary = {
  health: {
    issues: string[];
    status: "error" | "ok" | "warning";
  };
  journal: InterbeingWatcherV0JournalSummary;
  service: InterbeingWatcherV0ServiceRuntimeSummary;
  tool_name: string;
  watcher: InterbeingWatcherV0StatusSummary & {
    lock: InterbeingWatcherV0LockSummary;
    recent_failures: InterbeingWatcherV0RecentLogIssueSummary[];
  };
  watcher_version: string;
};

export type InterbeingWatcherV0VerifyMatch = {
  disposition: InterbeingWatcherV0Disposition | "incoming";
  file: string;
  intake_timestamp: string | null;
  local_dispatch?: InterbeingWatcherV0ReceiptLocalDispatch;
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

type InterbeingWatcherV0LockRecord = {
  acquired_at?: unknown;
  pid?: unknown;
  repo_root?: unknown;
  tool_name?: unknown;
  watcher_version?: unknown;
};

export type InterbeingWatcherV0HealthDeps = {
  inspectLock?: (paths: InterbeingWatcherV0Paths) => Promise<InterbeingWatcherV0LockSummary>;
  inspectService?: (
    unit: string,
    paths: InterbeingWatcherV0Paths,
  ) => Promise<InterbeingWatcherV0ServiceRuntimeSummary>;
  now?: () => number;
  readRecentFailures?: (
    paths: InterbeingWatcherV0Paths,
  ) => Promise<InterbeingWatcherV0RecentLogIssueSummary[]>;
  readJournalIssues?: (
    unit: string,
    paths: InterbeingWatcherV0Paths,
  ) => Promise<InterbeingWatcherV0JournalSummary>;
};

export function nowIso(): string {
  return new Date().toISOString();
}

function isRecentIsoTimestamp(
  timestamp: string | null | undefined,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  if (typeof timestamp !== "string" || timestamp.trim().length === 0) {
    return false;
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return nowMs - parsed <= maxAgeMs;
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
  if (relative.length === 0) {
    return ".";
  }
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    return filePath;
  }
  return relative;
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

export function resolveWatcherLockPath(paths: InterbeingWatcherV0Paths): string {
  return path.join(path.dirname(paths.statePath), WATCHER_LOCK_FILENAME);
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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function summarizeCommandFailure(result: {
  error?: Error;
  signal?: NodeJS.Signals | null;
  status?: number | null;
  stderr?: string;
  stdout?: string;
}): string {
  if (result.error) {
    return normalizeErrorMessage(result.error);
  }
  if (result.signal) {
    return `signal:${result.signal}`;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return (result.stderr || result.stdout || `exit:${result.status}`).trim();
  }
  return "unknown_failure";
}

function resolveWatcherUnitName(unit = WATCHER_SYSTEMD_SERVICE_NAME): string {
  return unit.endsWith(".service") ? unit : `${unit}.service`;
}

function asFiniteInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function parseLockTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function computeLockAgeSeconds(mtimeMs: number | null): number | null {
  if (mtimeMs == null) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 1_000));
}

async function readLinuxProcessCommand(pid: number): Promise<string | null> {
  if (process.platform !== "linux") {
    return null;
  }
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, "utf8");
    const tokens = raw
      .split("\u0000")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    return tokens.length > 0 ? tokens.join(" ") : null;
  } catch {
    return null;
  }
}

function isWatcherOwnerCommand(command: string, repoRoot: string): boolean {
  const normalized = command.replaceAll("\\", "/");
  const expectedScript = path.join(repoRoot, "scripts", "interbeing", "run_watcher_v0.ts");
  const expectedWrapper = path.join(repoRoot, "scripts", "interbeing", "run_watcher_v0_service.sh");
  return (
    normalized.includes(expectedScript.replaceAll("\\", "/")) ||
    normalized.includes(expectedWrapper.replaceAll("\\", "/")) ||
    normalized.includes("scripts/interbeing/run_watcher_v0.ts") ||
    normalized.includes("scripts/interbeing/run_watcher_v0_service.sh")
  );
}

export async function inspectWatcherLock(
  paths: InterbeingWatcherV0Paths,
): Promise<InterbeingWatcherV0LockSummary> {
  const lockPath = resolveWatcherLockPath(paths);
  const lockStats = await stat(lockPath).catch(() => null);
  if (!lockStats) {
    return {
      acquired_at: null,
      age_seconds: null,
      detail: null,
      exists: false,
      owner_command: null,
      owner_matches_watcher: null,
      path: toRepoRelative(paths, lockPath) ?? lockPath,
      pid: null,
      status: "absent",
      tool_name: null,
      watcher_version: null,
    };
  }

  const ageSeconds = computeLockAgeSeconds(lockStats.mtimeMs);
  let raw = "";
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (err) {
    return {
      acquired_at: null,
      age_seconds: ageSeconds,
      detail: `read_error:${normalizeErrorMessage(err)}`,
      exists: true,
      owner_command: null,
      owner_matches_watcher: null,
      path: toRepoRelative(paths, lockPath) ?? lockPath,
      pid: null,
      status: "unknown",
      tool_name: null,
      watcher_version: null,
    };
  }

  let parsed: InterbeingWatcherV0LockRecord | null = null;
  try {
    parsed = JSON.parse(raw) as InterbeingWatcherV0LockRecord;
  } catch {
    return {
      acquired_at: null,
      age_seconds: ageSeconds,
      detail:
        ageSeconds != null && ageSeconds >= WATCHER_LOCK_STALE_AGE_MS / 1_000
          ? "invalid_json_stale_lock"
          : "invalid_json_lock",
      exists: true,
      owner_command: null,
      owner_matches_watcher: null,
      path: toRepoRelative(paths, lockPath) ?? lockPath,
      pid: null,
      status:
        ageSeconds != null && ageSeconds >= WATCHER_LOCK_STALE_AGE_MS / 1_000 ? "stale" : "unknown",
      tool_name: null,
      watcher_version: null,
    };
  }

  const pid = asFiniteInteger(parsed.pid);
  const ownerCommand = pid != null ? await readLinuxProcessCommand(pid) : null;
  const ownerMatchesWatcher =
    ownerCommand == null
      ? null
      : isWatcherOwnerCommand(ownerCommand, resolveWatcherRepoRoot(paths));

  if (pid == null) {
    return {
      acquired_at: parseLockTimestamp(parsed.acquired_at),
      age_seconds: ageSeconds,
      detail:
        ageSeconds != null && ageSeconds >= WATCHER_LOCK_STALE_AGE_MS / 1_000
          ? "missing_pid_stale_lock"
          : "missing_pid",
      exists: true,
      owner_command: ownerCommand,
      owner_matches_watcher: ownerMatchesWatcher,
      path: toRepoRelative(paths, lockPath) ?? lockPath,
      pid: null,
      status:
        ageSeconds != null && ageSeconds >= WATCHER_LOCK_STALE_AGE_MS / 1_000 ? "stale" : "unknown",
      tool_name: typeof parsed.tool_name === "string" ? parsed.tool_name : null,
      watcher_version: typeof parsed.watcher_version === "string" ? parsed.watcher_version : null,
    };
  }

  if (!isProcessAlive(pid)) {
    return {
      acquired_at: parseLockTimestamp(parsed.acquired_at),
      age_seconds: ageSeconds,
      detail: "pid_not_running",
      exists: true,
      owner_command: ownerCommand,
      owner_matches_watcher: ownerMatchesWatcher,
      path: toRepoRelative(paths, lockPath) ?? lockPath,
      pid,
      status: "stale",
      tool_name: typeof parsed.tool_name === "string" ? parsed.tool_name : null,
      watcher_version: typeof parsed.watcher_version === "string" ? parsed.watcher_version : null,
    };
  }

  if (ownerMatchesWatcher === false) {
    if (
      pid === process.pid &&
      ageSeconds != null &&
      ageSeconds < WATCHER_LOCK_STALE_AGE_MS / 1_000
    ) {
      return {
        acquired_at: parseLockTimestamp(parsed.acquired_at),
        age_seconds: ageSeconds,
        detail: "lock_owned_by_current_process",
        exists: true,
        owner_command: ownerCommand,
        owner_matches_watcher: ownerMatchesWatcher,
        path: toRepoRelative(paths, lockPath) ?? lockPath,
        pid,
        status: "active",
        tool_name: typeof parsed.tool_name === "string" ? parsed.tool_name : null,
        watcher_version: typeof parsed.watcher_version === "string" ? parsed.watcher_version : null,
      };
    }
    return {
      acquired_at: parseLockTimestamp(parsed.acquired_at),
      age_seconds: ageSeconds,
      detail: "pid_reused_by_non_watcher_process",
      exists: true,
      owner_command: ownerCommand,
      owner_matches_watcher: ownerMatchesWatcher,
      path: toRepoRelative(paths, lockPath) ?? lockPath,
      pid,
      status: "stale",
      tool_name: typeof parsed.tool_name === "string" ? parsed.tool_name : null,
      watcher_version: typeof parsed.watcher_version === "string" ? parsed.watcher_version : null,
    };
  }

  return {
    acquired_at: parseLockTimestamp(parsed.acquired_at),
    age_seconds: ageSeconds,
    detail: ownerMatchesWatcher == null ? "process_alive_but_owner_unverified" : null,
    exists: true,
    owner_command: ownerCommand,
    owner_matches_watcher: ownerMatchesWatcher,
    path: toRepoRelative(paths, lockPath) ?? lockPath,
    pid,
    status: ownerMatchesWatcher == null ? "unknown" : "active",
    tool_name: typeof parsed.tool_name === "string" ? parsed.tool_name : null,
    watcher_version: typeof parsed.watcher_version === "string" ? parsed.watcher_version : null,
  };
}

async function clearStaleWatcherLock(paths: InterbeingWatcherV0Paths): Promise<boolean> {
  const lock = await inspectWatcherLock(paths);
  if (!lock.exists || lock.status !== "stale") {
    return false;
  }
  await rm(resolveWatcherLockPath(paths), { force: true });
  return true;
}

export async function withWatcherMutationLock<T>(
  paths: InterbeingWatcherV0Paths,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = resolveWatcherLockPath(paths);
  await mkdir(path.dirname(lockPath), { recursive: true });

  // Keep queue mutation single-writer so long-running watch mode and
  // operator-triggered replays cannot clobber the state file or double-run a payload.
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(
          `${JSON.stringify(
            {
              pid: process.pid,
              acquired_at: nowIso(),
              repo_root: resolveWatcherRepoRoot(paths),
              tool_name: WATCHER_TOOL_NAME,
              watcher_version: WATCHER_TOOL_VERSION,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        return await fn();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
      if (await clearStaleWatcherLock(paths)) {
        continue;
      }
      await wait(100);
    }
  }
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

async function inspectWatcherServiceRuntime(
  unit: string,
  paths: InterbeingWatcherV0Paths,
): Promise<InterbeingWatcherV0ServiceRuntimeSummary> {
  const resolvedUnit = resolveWatcherUnitName(unit);
  const result = spawnSync(
    "systemctl",
    [
      "--user",
      "show",
      resolvedUnit,
      "--property=LoadState",
      "--property=UnitFileState",
      "--property=ActiveState",
      "--property=SubState",
      "--property=Result",
      "--property=MainPID",
      "--property=ExecMainStatus",
      "--property=ExecMainCode",
      "--property=NRestarts",
      "--property=ActiveEnterTimestamp",
      "--property=FragmentPath",
    ],
    {
      cwd: resolveWatcherRepoRoot(paths),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );

  if (result.status !== 0 || result.error) {
    return {
      active_enter_timestamp: null,
      active_state: null,
      available: false,
      detail: summarizeCommandFailure(result),
      exec_main_code: null,
      exec_main_status: null,
      fragment_path: null,
      load_state: null,
      main_pid: null,
      n_restarts: null,
      result: null,
      sub_state: null,
      unit: resolvedUnit,
      unit_file_state: null,
    };
  }

  const values = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    if (!line.includes("=")) {
      continue;
    }
    const index = line.indexOf("=");
    values.set(line.slice(0, index), line.slice(index + 1));
  }

  const fragmentPath = values.get("FragmentPath") || null;
  const loadState = values.get("LoadState") || null;
  const available = loadState != null && loadState !== "not-found" && fragmentPath != null;

  return {
    active_enter_timestamp: values.get("ActiveEnterTimestamp") || null,
    active_state: values.get("ActiveState") || null,
    available,
    detail: available ? null : "unit_not_found_or_not_loaded",
    exec_main_code: values.get("ExecMainCode") || null,
    exec_main_status: asFiniteInteger(values.get("ExecMainStatus")) ?? null,
    fragment_path:
      fragmentPath == null ? null : (toRepoRelative(paths, fragmentPath) ?? fragmentPath),
    load_state: loadState,
    main_pid: asFiniteInteger(values.get("MainPID")) ?? null,
    n_restarts: asFiniteInteger(values.get("NRestarts")) ?? null,
    result: values.get("Result") || null,
    sub_state: values.get("SubState") || null,
    unit: resolvedUnit,
    unit_file_state: values.get("UnitFileState") || null,
  };
}

function journalTimestampToIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const micros = Number(value);
  if (!Number.isFinite(micros)) {
    return null;
  }
  return new Date(micros / 1_000).toISOString();
}

function normalizeJournalMessage(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (message == null) {
    return "<missing-message>";
  }
  try {
    return JSON.stringify(message) ?? "<non-string-message>";
  } catch {
    return "<non-string-message>";
  }
}

async function readWatcherJournalIssues(
  unit: string,
  paths: InterbeingWatcherV0Paths,
): Promise<InterbeingWatcherV0JournalSummary> {
  const resolvedUnit = resolveWatcherUnitName(unit);
  const result = spawnSync(
    "journalctl",
    ["--user", "-u", resolvedUnit, "-n", "50", "--no-pager", "--output=json", "--priority=4"],
    {
      cwd: resolveWatcherRepoRoot(paths),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );

  if (result.status !== 0 || result.error) {
    return {
      available: false,
      detail: summarizeCommandFailure(result),
      errors: [],
      unit: resolvedUnit,
      warnings: [],
    };
  }

  const warnings: InterbeingWatcherV0JournalIssueSummary[] = [];
  const errors: InterbeingWatcherV0JournalIssueSummary[] = [];
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = parsed.MESSAGE;
    const priority = asFiniteInteger(parsed.PRIORITY);
    const issue = {
      message: normalizeJournalMessage(message),
      priority,
      timestamp: journalTimestampToIso(parsed.__REALTIME_TIMESTAMP),
    };
    if (priority != null && priority <= 3) {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  return {
    available: true,
    detail: null,
    errors: errors.slice(0, 10),
    unit: resolvedUnit,
    warnings: warnings.slice(0, 10),
  };
}

async function readRecentWatcherFailures(
  paths: InterbeingWatcherV0Paths,
  limit = 5,
): Promise<InterbeingWatcherV0RecentLogIssueSummary[]> {
  if (!(await pathExists(paths.logPath))) {
    return [];
  }

  const raw = await readFile(paths.logPath, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const issues: InterbeingWatcherV0RecentLogIssueSummary[] = [];

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let parsed: Partial<InterbeingWatcherV0LogEntry>;
    try {
      parsed = JSON.parse(lines[index]) as Partial<InterbeingWatcherV0LogEntry>;
    } catch {
      continue;
    }
    if (parsed.status !== "failed" || typeof parsed.filename !== "string") {
      continue;
    }
    if (
      parsed.action !== "intake" ||
      typeof parsed.reason_code !== "string" ||
      typeof parsed.timestamp !== "string"
    ) {
      continue;
    }
    issues.push({
      action: parsed.action,
      filename: parsed.filename,
      reason_code: parsed.reason_code,
      reason_detail: typeof parsed.reason_detail === "string" ? parsed.reason_detail : null,
      status: parsed.status,
      timestamp: parsed.timestamp,
    });
    if (issues.length >= limit) {
      break;
    }
  }

  return issues;
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
  let stateReadable = true;

  if (stateExists) {
    try {
      const state = await readWatcherState(paths.statePath);
      trackedHashes = Object.keys(state.processed_hashes).length;
      pendingOverrides = Object.keys(state.reprocess_overrides).length;
    } catch (err) {
      stateReadable = false;
      issues.push(`state_error:${normalizeErrorMessage(err)}`);
    }
  }
  if (!logExists && receipts.length > 0) {
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
    available_modes: [...WATCHER_AVAILABLE_MODES],
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
      readable: stateReadable,
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

export async function summarizeWatcherHealth(
  paths: InterbeingWatcherV0Paths,
  deps: InterbeingWatcherV0HealthDeps = {},
): Promise<InterbeingWatcherV0HealthSummary> {
  const [watcher, lock, service, journal, recentFailures] = await Promise.all([
    summarizeWatcherStatus(paths),
    (deps.inspectLock ?? inspectWatcherLock)(paths),
    (deps.inspectService ?? inspectWatcherServiceRuntime)(WATCHER_SYSTEMD_SERVICE_NAME, paths),
    (deps.readJournalIssues ?? readWatcherJournalIssues)(WATCHER_SYSTEMD_SERVICE_NAME, paths),
    (deps.readRecentFailures ?? readRecentWatcherFailures)(paths),
  ]);
  const nowMs = (deps.now ?? Date.now)();
  const recentJournal = {
    ...journal,
    errors: journal.errors.filter((entry) =>
      isRecentIsoTimestamp(entry.timestamp, nowMs, WATCHER_HEALTH_ISSUE_MAX_AGE_MS),
    ),
    warnings: journal.warnings.filter((entry) =>
      isRecentIsoTimestamp(entry.timestamp, nowMs, WATCHER_HEALTH_ISSUE_MAX_AGE_MS),
    ),
  };
  const freshRecentFailures = recentFailures.filter((entry) =>
    isRecentIsoTimestamp(entry.timestamp, nowMs, WATCHER_HEALTH_ISSUE_MAX_AGE_MS),
  );

  const issues = [...watcher.health.issues];

  const serviceIsRunning =
    service.available && service.active_state === "active" && service.sub_state === "running";
  if (!service.available) {
    issues.push(`service_status_unavailable:${service.detail ?? "unavailable"}`);
  } else if (!serviceIsRunning) {
    issues.push(
      `service_inactive:${service.active_state ?? "unknown"}/${service.sub_state ?? "unknown"}`,
    );
  }

  if ((service.n_restarts ?? 0) > 0) {
    issues.push(`service_restarts:${service.n_restarts}`);
  }
  if (service.result && service.result !== "success") {
    issues.push(`service_result:${service.result}`);
  }
  if (watcher.counts.incoming > 0) {
    issues.push(`incoming_queue:${watcher.counts.incoming}`);
  }
  if (lock.status === "stale") {
    issues.push(`lock_stale:${lock.detail ?? lock.path}`);
  } else if (lock.status === "unknown") {
    issues.push(`lock_unknown:${lock.detail ?? lock.path}`);
  }
  if (!recentJournal.available) {
    issues.push(`journal_unavailable:${recentJournal.detail ?? "unavailable"}`);
  } else {
    if (recentJournal.errors.length > 0) {
      issues.push(`journal_errors:${recentJournal.errors.length}`);
    }
    if (recentJournal.warnings.length > 0) {
      issues.push(`journal_warnings:${recentJournal.warnings.length}`);
    }
  }
  if (freshRecentFailures.length > 0) {
    issues.push(`recent_failures:${freshRecentFailures.length}`);
  }

  const healthStatus =
    watcher.health.status === "error" ||
    (service.available && !serviceIsRunning) ||
    lock.status === "stale"
      ? "error"
      : issues.length > 0
        ? "warning"
        : "ok";

  return {
    health: {
      status: healthStatus,
      issues,
    },
    journal: recentJournal,
    service,
    tool_name: WATCHER_TOOL_NAME,
    watcher: {
      ...watcher,
      lock,
      recent_failures: freshRecentFailures,
    },
    watcher_version: WATCHER_TOOL_VERSION,
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
      ...(receipt.local_dispatch == null ? {} : { local_dispatch: receipt.local_dispatch }),
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
  return await withWatcherMutationLock(params.paths, async () => {
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
  });
}

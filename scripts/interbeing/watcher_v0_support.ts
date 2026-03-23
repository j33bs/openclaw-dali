import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
import { fileURLToPath } from "node:url";
import { parseSubmitTaskEnvelopeV0 } from "../../src/shared/interbeing-task-lifecycle-v0.ts";
import { resolveInterbeingTraceId } from "./trace_v0_support.ts";

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
export const WATCHER_HEARTBEAT_FILENAME = "interbeing_watcher_v0.heartbeat.json";
export const WATCHER_SYSTEMD_SERVICE_NAME = "openclaw-interbeing-watcher";
export const WATCHER_LOCK_STALE_AGE_MS = 60_000;
export const WATCHER_HEARTBEAT_INTERVAL_MS = 15_000;
export const WATCHER_HEARTBEAT_STALE_AGE_MS = WATCHER_HEARTBEAT_INTERVAL_MS * 3;
export const WATCHER_HEALTH_ISSUE_MAX_AGE_MS = 12 * 60 * 60 * 1_000;
export const WATCHER_HEALTH_RECENT_WINDOW_MS = 60 * 60 * 1_000;
export const WATCHER_FAILURE_BURST_THRESHOLD = 3;
export const WATCHER_TASK_VOLUME_THRESHOLD = 20;
export const WATCHER_SLOW_PROCESSING_THRESHOLD_MS = 2_000;
export const WATCHER_SUCCESS_STATUS_FILENAME = "task-status-succeeded.json";
export const WATCHER_SUCCESS_SUMMARY_FILENAMES = [
  "dispatch-summary.json",
  "result-summary.json",
] as const;
export const WATCHER_AVAILABLE_MODES = [
  "once",
  "start",
  "status",
  "health",
  "list",
  "logs",
  "report",
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
  | "silent_failure_detected"
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

// Adapter-local passthrough metadata carried in local_dispatch receipts.
// This does not alter canonical Interbeing v0 payload or transport semantics.
export type InterbeingWatcherV0ReceiptTaskContract = {
  acceptance_criteria?: string[];
  execution_notes?: string;
  review_mode?: string;
  task_class?: string;
  worker_limit?: number;
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
  task_contract?: InterbeingWatcherV0ReceiptTaskContract | null;
  worker_pool: {
    limit: number;
    max_in_flight: number;
  } | null;
};

export type InterbeingWatcherV0Paths = {
  failedDir: string;
  handoffRoot: string;
  heartbeatPath: string;
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
  duration_ms: number | null;
  filename: string;
  final_path: string | null;
  reason_code: InterbeingWatcherV0ReasonCode;
  reason_detail: string | null;
  receipt_path: string | null;
  sha256: string | null;
  status: InterbeingWatcherV0LogStatus;
  timestamp: string;
  trace_id: string | null;
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
  trace_id: string;
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
  heartbeat_path: string;
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

export type InterbeingWatcherV0HeartbeatRecord = {
  last_failed_timestamp: string | null;
  last_processed_timestamp: string | null;
  last_seen_at: string;
  mode: InterbeingWatcherV0Mode;
  pid: number;
  session_id: string;
  started_at: string;
  totals: {
    failed: number;
    processed: number;
    skipped: number;
  };
};

export type InterbeingWatcherV0HeartbeatSummary = {
  age_seconds: number | null;
  available: boolean;
  detail: string | null;
  last_failed_timestamp: string | null;
  last_processed_timestamp: string | null;
  last_seen_at: string | null;
  mode: InterbeingWatcherV0Mode | null;
  path: string;
  pid: number | null;
  session_id: string | null;
  started_at: string | null;
  status: "absent" | "fresh" | "invalid" | "stale";
  totals: {
    failed: number;
    processed: number;
    skipped: number;
  };
  uptime_seconds: number | null;
};

export type InterbeingWatcherV0MetricsSummary = {
  latency: {
    lifetime: InterbeingWatcherV0LatencySummary;
    recent_window: InterbeingWatcherV0LatencySummary;
  };
  lifetime: {
    failed: number;
    processed: number;
    skipped: number;
  };
  recent_window: {
    error_rate: number;
    failed: number;
    minutes: number;
    processed: number;
    skipped: number;
    total: number;
  };
};

export type InterbeingWatcherV0LatencySummary = {
  avg_ms: number;
  count: number;
  max_ms: number;
  p95_ms: number;
};

export type InterbeingWatcherV0Anomaly = {
  code: string;
  detail: string;
  severity: "error" | "warning";
};

export type InterbeingWatcherV0RecentLogIssueSummary = {
  action: InterbeingWatcherV0Action;
  duration_ms: number | null;
  filename: string;
  reason_code: InterbeingWatcherV0ReasonCode;
  reason_detail: string | null;
  status: InterbeingWatcherV0LogStatus;
  timestamp: string;
  trace_id?: string | null;
};

export type InterbeingWatcherV0HealthSummary = {
  health: {
    anomalies: InterbeingWatcherV0Anomaly[];
    issues: string[];
    status: "error" | "ok" | "warning";
  };
  journal: InterbeingWatcherV0JournalSummary;
  service: InterbeingWatcherV0ServiceRuntimeSummary;
  tool_name: string;
  watcher: InterbeingWatcherV0StatusSummary & {
    heartbeat: InterbeingWatcherV0HeartbeatSummary;
    lock: InterbeingWatcherV0LockSummary;
    metrics: InterbeingWatcherV0MetricsSummary;
    recent_failures: InterbeingWatcherV0RecentLogIssueSummary[];
  };
  watcher_version: string;
};

function latestProcessedReceiptTimestampsByFilename(
  receipts: InterbeingWatcherV0Receipt[],
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const receipt of receipts) {
    if (receipt.final_disposition !== "processed") {
      continue;
    }
    const existing = latest.get(receipt.original_filename);
    if (existing == null || existing < receipt.intake_timestamp) {
      latest.set(receipt.original_filename, receipt.intake_timestamp);
    }
  }
  return latest;
}

export type InterbeingWatcherV0VerifyMatch = {
  disposition: InterbeingWatcherV0Disposition | "incoming";
  file: string;
  intake_timestamp: string | null;
  local_dispatch?: InterbeingWatcherV0ReceiptLocalDispatch;
  original_filename: string | null;
  reason_code: InterbeingWatcherV0ReasonCode | null;
  receipt_path: string | null;
  sha256: string | null;
  trace_id: string | null;
  tracked_hash: boolean;
};

export type InterbeingWatcherV0ReceiptFilters = {
  disposition?: InterbeingWatcherV0Disposition;
  reasonCode?: InterbeingWatcherV0ReasonCode;
  traceId?: string;
};

export type InterbeingWatcherV0LogQuery = {
  action?: InterbeingWatcherV0Action;
  filename?: string;
  limit?: number;
  reasonCode?: InterbeingWatcherV0ReasonCode;
  sha256?: string;
  status?: InterbeingWatcherV0LogStatus;
  traceId?: string;
};

export type InterbeingWatcherV0LogQuerySummary = {
  items: InterbeingWatcherV0LogEntry[];
  query: {
    action: InterbeingWatcherV0Action | null;
    filename: string | null;
    limit: number;
    reason_code: InterbeingWatcherV0ReasonCode | null;
    sha256: string | null;
    status: InterbeingWatcherV0LogStatus | null;
    trace_id: string | null;
  };
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0VerifySummary = {
  found: boolean;
  matches: InterbeingWatcherV0VerifyMatch[];
  query: {
    filename: string | null;
    sha256: string | null;
    trace_id: string | null;
  };
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0ReplaySummary = {
  force_reprocess: boolean;
  queued_path: string;
  reason_code: InterbeingWatcherV0ReasonCode;
  selected_source: {
    disposition: InterbeingWatcherV0Disposition;
    file: string;
    intake_timestamp: string | null;
    trace_id: string | null;
  } | null;
  sha256: string;
  source_file: string;
  trace_id: string | null;
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0ReportSummary = {
  environment: {
    arch: string;
    cwd: string;
    node_version: string;
    platform: NodeJS.Platform;
  };
  generated_at: string;
  health: InterbeingWatcherV0HealthSummary;
  input_envelopes: Array<{
    contents: unknown;
    exists: boolean;
    path: string;
  }>;
  log_entries: InterbeingWatcherV0LogEntry[];
  matches: InterbeingWatcherV0VerifyMatch[];
  output_path: string;
  query: InterbeingWatcherV0VerifySummary["query"];
  receipts: InterbeingWatcherV0Receipt[];
  status: InterbeingWatcherV0StatusSummary;
  tool_name: string;
  watcher_version: string;
};

export type InterbeingWatcherV0LifecycleSuccessArtifacts = {
  detail: string | null;
  ok: boolean;
  result_ref_path: string | null;
  status_path: string;
  summary_path: string | null;
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

function slugifyFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveResultRefPath(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") {
      return null;
    }
    return path.resolve(fileURLToPath(parsed));
  } catch {
    return null;
  }
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
    heartbeatPath: path.join(repoRoot, "workspace", "state", WATCHER_HEARTBEAT_FILENAME),
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

export function createWatcherHeartbeatSessionId(): string {
  return `watcher-${randomUUID()}`;
}

export async function writeWatcherHeartbeat(
  heartbeatPath: string,
  heartbeat: InterbeingWatcherV0HeartbeatRecord,
): Promise<void> {
  const tempPath = `${heartbeatPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(heartbeat, null, 2)}\n`, "utf8");
  await rename(tempPath, heartbeatPath);
}

export async function readWatcherHeartbeat(
  heartbeatPath: string,
): Promise<InterbeingWatcherV0HeartbeatRecord | null> {
  if (!(await pathExists(heartbeatPath))) {
    return null;
  }
  const raw = JSON.parse(
    await readFile(heartbeatPath, "utf8"),
  ) as Partial<InterbeingWatcherV0HeartbeatRecord>;
  if (
    (raw.mode !== "once" && raw.mode !== "start") ||
    typeof raw.last_seen_at !== "string" ||
    typeof raw.session_id !== "string" ||
    typeof raw.started_at !== "string" ||
    typeof raw.pid !== "number" ||
    typeof raw.totals !== "object" ||
    raw.totals == null
  ) {
    throw new Error(`invalid watcher heartbeat schema in ${heartbeatPath}`);
  }
  return {
    last_failed_timestamp:
      typeof raw.last_failed_timestamp === "string" ? raw.last_failed_timestamp : null,
    last_processed_timestamp:
      typeof raw.last_processed_timestamp === "string" ? raw.last_processed_timestamp : null,
    last_seen_at: raw.last_seen_at,
    mode: raw.mode,
    pid: raw.pid,
    session_id: raw.session_id,
    started_at: raw.started_at,
    totals: {
      failed:
        typeof raw.totals.failed === "number" && Number.isFinite(raw.totals.failed)
          ? raw.totals.failed
          : 0,
      processed:
        typeof raw.totals.processed === "number" && Number.isFinite(raw.totals.processed)
          ? raw.totals.processed
          : 0,
      skipped:
        typeof raw.totals.skipped === "number" && Number.isFinite(raw.totals.skipped)
          ? raw.totals.skipped
          : 0,
    },
  };
}

function secondsSince(timestamp: string | null, nowMs: number): number | null {
  if (timestamp == null) {
    return null;
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor((nowMs - parsed) / 1_000));
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

async function readLifecycleArtifactRecord(filePath: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const record = asJsonRecord(parsed);
  if (record == null) {
    throw new Error(`${path.basename(filePath)} is not a JSON object`);
  }
  return record;
}

export async function inspectWatcherLifecycleSuccessArtifacts(
  outputDir: string,
): Promise<InterbeingWatcherV0LifecycleSuccessArtifacts> {
  const statusPath = path.join(outputDir, WATCHER_SUCCESS_STATUS_FILENAME);
  if (!(await pathExists(statusPath))) {
    return {
      detail: `missing ${WATCHER_SUCCESS_STATUS_FILENAME}`,
      ok: false,
      result_ref_path: null,
      status_path: statusPath,
      summary_path: null,
    };
  }

  let statusRecord: Record<string, unknown>;
  try {
    statusRecord = await readLifecycleArtifactRecord(statusPath);
  } catch (err) {
    return {
      detail: normalizeErrorMessage(err),
      ok: false,
      result_ref_path: null,
      status_path: statusPath,
      summary_path: null,
    };
  }
  if (statusRecord.status !== "succeeded") {
    return {
      detail: `${WATCHER_SUCCESS_STATUS_FILENAME} did not record status=succeeded`,
      ok: false,
      result_ref_path: null,
      status_path: statusPath,
      summary_path: null,
    };
  }

  let summaryPath: string | null = null;
  for (const filename of WATCHER_SUCCESS_SUMMARY_FILENAMES) {
    const candidate = path.join(outputDir, filename);
    if (await pathExists(candidate)) {
      summaryPath = candidate;
      break;
    }
  }
  if (summaryPath == null) {
    return {
      detail: `missing ${WATCHER_SUCCESS_SUMMARY_FILENAMES.join(" or ")}`,
      ok: false,
      result_ref_path: null,
      status_path: statusPath,
      summary_path: null,
    };
  }

  try {
    const summaryRecord = await readLifecycleArtifactRecord(summaryPath);
    if (summaryRecord.outcome != null && summaryRecord.outcome !== "succeeded") {
      return {
        detail: `${path.basename(summaryPath)} did not record outcome=succeeded`,
        ok: false,
        result_ref_path: null,
        status_path: statusPath,
        summary_path: summaryPath,
      };
    }
  } catch (err) {
    return {
      detail: normalizeErrorMessage(err),
      ok: false,
      result_ref_path: null,
      status_path: statusPath,
      summary_path: summaryPath,
    };
  }

  const resultRef = asJsonRecord(statusRecord.result_ref);
  const resultRefUri = typeof resultRef?.uri === "string" ? resultRef.uri : null;
  if (resultRefUri == null) {
    return {
      detail: `${WATCHER_SUCCESS_STATUS_FILENAME} is missing result_ref.uri`,
      ok: false,
      result_ref_path: null,
      status_path: statusPath,
      summary_path: summaryPath,
    };
  }

  const resultRefPath = resolveResultRefPath(resultRefUri);
  if (resultRefPath == null) {
    return {
      detail: `${WATCHER_SUCCESS_STATUS_FILENAME} result_ref.uri is not a file:// URI`,
      ok: false,
      result_ref_path: null,
      status_path: statusPath,
      summary_path: summaryPath,
    };
  }
  if (!(await pathExists(resultRefPath))) {
    return {
      detail: `${WATCHER_SUCCESS_STATUS_FILENAME} result_ref.uri points to a missing file`,
      ok: false,
      result_ref_path: resultRefPath,
      status_path: statusPath,
      summary_path: summaryPath,
    };
  }
  if (path.resolve(summaryPath) !== path.resolve(resultRefPath)) {
    return {
      detail: `${WATCHER_SUCCESS_STATUS_FILENAME} result_ref.uri does not match ${path.basename(summaryPath)}`,
      ok: false,
      result_ref_path: resultRefPath,
      status_path: statusPath,
      summary_path: summaryPath,
    };
  }

  return {
    detail: null,
    ok: true,
    result_ref_path: resultRefPath,
    status_path: statusPath,
    summary_path: summaryPath,
  };
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

function emptyHeartbeatTotals(): InterbeingWatcherV0HeartbeatSummary["totals"] {
  return {
    failed: 0,
    processed: 0,
    skipped: 0,
  };
}

export async function inspectWatcherHeartbeat(
  paths: InterbeingWatcherV0Paths,
  nowMs = Date.now(),
): Promise<InterbeingWatcherV0HeartbeatSummary> {
  const heartbeatPath = paths.heartbeatPath;
  const relativePath = toRepoRelative(paths, heartbeatPath) ?? heartbeatPath;
  if (!(await pathExists(heartbeatPath))) {
    return {
      age_seconds: null,
      available: false,
      detail: null,
      last_failed_timestamp: null,
      last_processed_timestamp: null,
      last_seen_at: null,
      mode: null,
      path: relativePath,
      pid: null,
      session_id: null,
      started_at: null,
      status: "absent",
      totals: emptyHeartbeatTotals(),
      uptime_seconds: null,
    };
  }

  let heartbeat: InterbeingWatcherV0HeartbeatRecord | null = null;
  try {
    heartbeat = await readWatcherHeartbeat(heartbeatPath);
  } catch (err) {
    return {
      age_seconds: null,
      available: false,
      detail: normalizeErrorMessage(err),
      last_failed_timestamp: null,
      last_processed_timestamp: null,
      last_seen_at: null,
      mode: null,
      path: relativePath,
      pid: null,
      session_id: null,
      started_at: null,
      status: "invalid",
      totals: emptyHeartbeatTotals(),
      uptime_seconds: null,
    };
  }

  if (heartbeat == null) {
    return {
      age_seconds: null,
      available: false,
      detail: null,
      last_failed_timestamp: null,
      last_processed_timestamp: null,
      last_seen_at: null,
      mode: null,
      path: relativePath,
      pid: null,
      session_id: null,
      started_at: null,
      status: "absent",
      totals: emptyHeartbeatTotals(),
      uptime_seconds: null,
    };
  }

  const ageSeconds = secondsSince(heartbeat.last_seen_at, nowMs);
  const uptimeSeconds = secondsSince(heartbeat.started_at, nowMs);
  return {
    age_seconds: ageSeconds,
    available: true,
    detail: null,
    last_failed_timestamp: heartbeat.last_failed_timestamp,
    last_processed_timestamp: heartbeat.last_processed_timestamp,
    last_seen_at: heartbeat.last_seen_at,
    mode: heartbeat.mode,
    path: relativePath,
    pid: heartbeat.pid,
    session_id: heartbeat.session_id,
    started_at: heartbeat.started_at,
    status:
      ageSeconds != null && ageSeconds * 1_000 > WATCHER_HEARTBEAT_STALE_AGE_MS ? "stale" : "fresh",
    totals: heartbeat.totals,
    uptime_seconds: uptimeSeconds,
  };
}

async function readWatcherLogEntries(
  logPath: string,
): Promise<Array<Partial<InterbeingWatcherV0LogEntry>>> {
  if (!(await pathExists(logPath))) {
    return [];
  }
  const raw = await readFile(logPath, "utf8");
  const entries: Array<Partial<InterbeingWatcherV0LogEntry>> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed) as Partial<InterbeingWatcherV0LogEntry>);
    } catch {
      continue;
    }
  }
  return entries;
}

function normalizeWatcherLogEntry(
  entry: Partial<InterbeingWatcherV0LogEntry>,
  paths: InterbeingWatcherV0Paths,
): InterbeingWatcherV0LogEntry | null {
  if (
    (entry.action !== "intake" && entry.action !== "replay") ||
    typeof entry.filename !== "string" ||
    typeof entry.reason_code !== "string" ||
    typeof entry.status !== "string" ||
    typeof entry.timestamp !== "string"
  ) {
    return null;
  }
  if (
    entry.status !== "failed" &&
    entry.status !== "processed" &&
    entry.status !== "queued" &&
    entry.status !== "skipped"
  ) {
    return null;
  }
  return {
    action: entry.action,
    duration_ms:
      typeof entry.duration_ms === "number" && Number.isFinite(entry.duration_ms)
        ? entry.duration_ms
        : null,
    filename: entry.filename,
    final_path:
      entry.final_path == null
        ? null
        : (toRepoRelative(paths, entry.final_path) ?? entry.final_path),
    reason_code: entry.reason_code,
    reason_detail: typeof entry.reason_detail === "string" ? entry.reason_detail : null,
    receipt_path:
      entry.receipt_path == null
        ? null
        : (toRepoRelative(paths, entry.receipt_path) ?? entry.receipt_path),
    sha256: typeof entry.sha256 === "string" ? entry.sha256 : null,
    status: entry.status as InterbeingWatcherV0LogStatus,
    timestamp: entry.timestamp,
    trace_id: typeof entry.trace_id === "string" ? entry.trace_id : null,
    tool_name: typeof entry.tool_name === "string" ? entry.tool_name : WATCHER_TOOL_NAME,
    watcher_version:
      typeof entry.watcher_version === "string" ? entry.watcher_version : WATCHER_TOOL_VERSION,
  };
}

function summarizeLatencyDurations(durations: number[]): InterbeingWatcherV0LatencySummary {
  if (durations.length === 0) {
    return {
      avg_ms: 0,
      count: 0,
      max_ms: 0,
      p95_ms: 0,
    };
  }
  const sorted = [...durations].toSorted((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return {
    avg_ms: Math.round(total / sorted.length),
    count: sorted.length,
    max_ms: sorted[sorted.length - 1] ?? 0,
    p95_ms: sorted[p95Index] ?? 0,
  };
}

function matchesWatcherReceiptFilters(
  receipt: InterbeingWatcherV0Receipt,
  filters: InterbeingWatcherV0ReceiptFilters,
): boolean {
  if (filters.disposition && receipt.final_disposition !== filters.disposition) {
    return false;
  }
  if (filters.reasonCode && receipt.reason_code !== filters.reasonCode) {
    return false;
  }
  if (filters.traceId && receipt.trace_id !== filters.traceId) {
    return false;
  }
  return true;
}

export async function listWatcherLogEntries(
  paths: InterbeingWatcherV0Paths,
  options: InterbeingWatcherV0LogQuery = {},
): Promise<InterbeingWatcherV0LogQuerySummary> {
  const limit = Math.max(1, options.limit ?? 50);
  const normalized = (await readWatcherLogEntries(paths.logPath))
    .map((entry) => normalizeWatcherLogEntry(entry, paths))
    .filter((entry): entry is InterbeingWatcherV0LogEntry => entry != null)
    .filter((entry) => {
      if (options.action && entry.action !== options.action) {
        return false;
      }
      if (options.filename && entry.filename !== options.filename) {
        return false;
      }
      if (options.reasonCode && entry.reason_code !== options.reasonCode) {
        return false;
      }
      if (options.sha256 && entry.sha256 !== options.sha256) {
        return false;
      }
      if (options.status && entry.status !== options.status) {
        return false;
      }
      if (options.traceId && entry.trace_id !== options.traceId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => {
      if (left.timestamp === right.timestamp) {
        return right.filename.localeCompare(left.filename);
      }
      return right.timestamp.localeCompare(left.timestamp);
    })
    .slice(0, limit);

  return {
    items: normalized,
    query: {
      action: options.action ?? null,
      filename: options.filename ?? null,
      limit,
      reason_code: options.reasonCode ?? null,
      sha256: options.sha256 ?? null,
      status: options.status ?? null,
      trace_id: options.traceId ?? null,
    },
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
  };
}

function summarizeWatcherMetrics(params: {
  logEntries: Array<Partial<InterbeingWatcherV0LogEntry>>;
  nowMs: number;
  receipts: InterbeingWatcherV0Receipt[];
}): InterbeingWatcherV0MetricsSummary {
  const lifetime = {
    failed: params.receipts.filter((receipt) => receipt.final_disposition === "failed").length,
    processed: params.receipts.filter((receipt) => receipt.final_disposition === "processed")
      .length,
    skipped: params.receipts.filter((receipt) => receipt.final_disposition === "skipped").length,
  };
  const recent = params.logEntries.filter(
    (entry) =>
      typeof entry.timestamp === "string" &&
      isRecentIsoTimestamp(entry.timestamp, params.nowMs, WATCHER_HEALTH_RECENT_WINDOW_MS),
  );
  const recentProcessed = recent.filter((entry) => entry.status === "processed").length;
  const recentFailed = recent.filter((entry) => entry.status === "failed").length;
  const recentSkipped = recent.filter((entry) => entry.status === "skipped").length;
  const recentTotal = recentProcessed + recentFailed + recentSkipped;
  const latencyEntries = params.logEntries.filter(
    (entry) =>
      entry.action === "intake" &&
      entry.status !== "queued" &&
      typeof entry.duration_ms === "number" &&
      Number.isFinite(entry.duration_ms),
  );
  const recentLatencyEntries = recent.filter(
    (entry) =>
      entry.action === "intake" &&
      entry.status !== "queued" &&
      typeof entry.duration_ms === "number" &&
      Number.isFinite(entry.duration_ms),
  );
  return {
    latency: {
      lifetime: summarizeLatencyDurations(
        latencyEntries.map((entry) => entry.duration_ms as number),
      ),
      recent_window: summarizeLatencyDurations(
        recentLatencyEntries.map((entry) => entry.duration_ms as number),
      ),
    },
    lifetime,
    recent_window: {
      error_rate: recentTotal === 0 ? 0 : Number((recentFailed / recentTotal).toFixed(3)),
      failed: recentFailed,
      minutes: WATCHER_HEALTH_RECENT_WINDOW_MS / 60_000,
      processed: recentProcessed,
      skipped: recentSkipped,
      total: recentTotal,
    },
  };
}

async function readRecentWatcherFailures(
  paths: InterbeingWatcherV0Paths,
  limit = 5,
): Promise<InterbeingWatcherV0RecentLogIssueSummary[]> {
  const lines = await readWatcherLogEntries(paths.logPath);
  const issues: InterbeingWatcherV0RecentLogIssueSummary[] = [];

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = lines[index] ?? {};
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
      duration_ms:
        typeof parsed.duration_ms === "number" && Number.isFinite(parsed.duration_ms)
          ? parsed.duration_ms
          : null,
      filename: parsed.filename,
      reason_code: parsed.reason_code,
      reason_detail: typeof parsed.reason_detail === "string" ? parsed.reason_detail : null,
      status: parsed.status,
      timestamp: parsed.timestamp,
      trace_id: typeof parsed.trace_id === "string" ? parsed.trace_id : null,
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
    heartbeat_path: toRepoRelative(paths, paths.heartbeatPath) ?? paths.heartbeatPath,
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
  const nowMs = (deps.now ?? Date.now)();
  const [watcher, heartbeat, lock, service, journal, recentFailures, receipts, logEntries] =
    await Promise.all([
      summarizeWatcherStatus(paths),
      inspectWatcherHeartbeat(paths, nowMs),
      (deps.inspectLock ?? inspectWatcherLock)(paths),
      (deps.inspectService ?? inspectWatcherServiceRuntime)(WATCHER_SYSTEMD_SERVICE_NAME, paths),
      (deps.readJournalIssues ?? readWatcherJournalIssues)(WATCHER_SYSTEMD_SERVICE_NAME, paths),
      (deps.readRecentFailures ?? readRecentWatcherFailures)(paths),
      listWatcherReceipts(paths),
      readWatcherLogEntries(paths.logPath),
    ]);
  const recentJournal = {
    ...journal,
    errors: journal.errors.filter((entry) =>
      isRecentIsoTimestamp(entry.timestamp, nowMs, WATCHER_HEALTH_ISSUE_MAX_AGE_MS),
    ),
    warnings: journal.warnings.filter((entry) =>
      isRecentIsoTimestamp(entry.timestamp, nowMs, WATCHER_HEALTH_ISSUE_MAX_AGE_MS),
    ),
  };
  const latestProcessedByFilename = latestProcessedReceiptTimestampsByFilename(receipts);
  const freshRecentFailures = recentFailures.filter((entry) =>
    isRecentIsoTimestamp(entry.timestamp, nowMs, WATCHER_HEALTH_ISSUE_MAX_AGE_MS),
  );
  const activeRecentFailures = freshRecentFailures.filter((entry) => {
    const processedTimestamp = latestProcessedByFilename.get(entry.filename);
    return processedTimestamp == null || processedTimestamp < entry.timestamp;
  });
  const metrics = summarizeWatcherMetrics({
    logEntries,
    nowMs,
    receipts,
  });

  const issues = [...watcher.health.issues];
  const anomalies: InterbeingWatcherV0Anomaly[] = [];

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
  if (activeRecentFailures.length > 0) {
    issues.push(`recent_failures:${activeRecentFailures.length}`);
  }
  if (serviceIsRunning) {
    if (heartbeat.status === "absent") {
      issues.push("heartbeat_missing");
      anomalies.push({
        code: "heartbeat_missing",
        detail: "service is running but no watcher heartbeat file is present",
        severity: "warning",
      });
    } else if (heartbeat.status === "invalid") {
      issues.push(`heartbeat_invalid:${heartbeat.detail ?? heartbeat.path}`);
      anomalies.push({
        code: "heartbeat_invalid",
        detail: heartbeat.detail ?? "watcher heartbeat file is unreadable",
        severity: "warning",
      });
    } else if (heartbeat.mode === "start" && heartbeat.status === "stale") {
      issues.push(`heartbeat_stale:${heartbeat.age_seconds ?? "unknown"}`);
      anomalies.push({
        code: "heartbeat_stale",
        detail: `watcher heartbeat has not updated for ${heartbeat.age_seconds ?? "unknown"}s`,
        severity: "error",
      });
    }
  }
  if (
    metrics.recent_window.failed >= WATCHER_FAILURE_BURST_THRESHOLD &&
    metrics.recent_window.error_rate >= 0.5
  ) {
    issues.push(`failure_burst:${metrics.recent_window.failed}/${metrics.recent_window.total}`);
    anomalies.push({
      code: "failure_burst",
      detail: `${metrics.recent_window.failed} of ${metrics.recent_window.total} recent watcher events failed`,
      severity: "warning",
    });
  }
  if (metrics.recent_window.total >= WATCHER_TASK_VOLUME_THRESHOLD) {
    issues.push(`task_volume_spike:${metrics.recent_window.total}`);
    anomalies.push({
      code: "task_volume_spike",
      detail: `${metrics.recent_window.total} watcher events were recorded in the last ${metrics.recent_window.minutes} minutes`,
      severity: "warning",
    });
  }
  if (metrics.latency.recent_window.max_ms >= WATCHER_SLOW_PROCESSING_THRESHOLD_MS) {
    issues.push(`slow_processing:${metrics.latency.recent_window.max_ms}`);
    anomalies.push({
      code: "slow_processing",
      detail: `recent watcher processing reached ${metrics.latency.recent_window.max_ms}ms`,
      severity: "warning",
    });
  }

  const healthStatus =
    watcher.health.status === "error" ||
    (service.available && !serviceIsRunning) ||
    lock.status === "stale" ||
    anomalies.some((anomaly) => anomaly.severity === "error")
      ? "error"
      : issues.length > 0
        ? "warning"
        : "ok";

  return {
    health: {
      anomalies,
      status: healthStatus,
      issues,
    },
    journal: recentJournal,
    service,
    tool_name: WATCHER_TOOL_NAME,
    watcher: {
      ...watcher,
      heartbeat,
      lock,
      metrics,
      recent_failures: activeRecentFailures,
    },
    watcher_version: WATCHER_TOOL_VERSION,
  };
}

async function readTraceIdFromEnvelopeFile(filePath: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const envelope = parseSubmitTaskEnvelopeV0(raw, {
      allowTargetMismatch: true,
      nodeId:
        typeof (raw as { target_node?: unknown })?.target_node === "string"
          ? String((raw as { target_node?: unknown }).target_node)
          : "dali",
    });
    return resolveInterbeingTraceId(envelope);
  } catch {
    return null;
  }
}

export async function verifyWatcherArtifact(
  paths: InterbeingWatcherV0Paths,
  params: { filename?: string; sha256?: string; traceId?: string },
): Promise<InterbeingWatcherV0VerifySummary> {
  const filename = params.filename?.trim() || null;
  const sha256 = params.sha256?.trim() || null;
  const traceId = params.traceId?.trim() || null;
  if (!filename && !sha256 && !traceId) {
    throw new Error("verify requires --filename, --sha256, or --trace-id");
  }

  const matches: InterbeingWatcherV0VerifyMatch[] = [];
  const trackedHashes = await readWatcherState(paths.statePath);
  const receipts = await listWatcherReceipts(paths);

  for (const receipt of receipts) {
    if (
      (filename &&
        receipt.original_filename !== filename &&
        path.basename(receipt.final_path) !== filename) ||
      (sha256 && receipt.sha256 !== sha256) ||
      (traceId && receipt.trace_id !== traceId)
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
      trace_id: receipt.trace_id,
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
    const resolvedTraceId = await readTraceIdFromEnvelopeFile(filePath);
    if (traceId && resolvedTraceId !== traceId) {
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
      trace_id: resolvedTraceId,
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
    query: { filename, sha256, trace_id: traceId },
    matches: normalizedMatches,
  };
}

async function readWatcherInputEnvelope(
  paths: InterbeingWatcherV0Paths,
  pathOrRelativePath: string,
): Promise<{
  contents: unknown;
  exists: boolean;
  path: string;
}> {
  const resolved = path.isAbsolute(pathOrRelativePath)
    ? pathOrRelativePath
    : path.join(resolveWatcherRepoRoot(paths), pathOrRelativePath);
  if (!(await pathExists(resolved))) {
    return {
      contents: null,
      exists: false,
      path: pathOrRelativePath,
    };
  }
  try {
    return {
      contents: JSON.parse(await readFile(resolved, "utf8")) as unknown,
      exists: true,
      path: pathOrRelativePath,
    };
  } catch {
    return {
      contents: null,
      exists: true,
      path: pathOrRelativePath,
    };
  }
}

export async function writeInterbeingWatcherReport(params: {
  filename?: string;
  outPath?: string;
  paths: InterbeingWatcherV0Paths;
  sha256?: string;
  traceId?: string;
}): Promise<InterbeingWatcherV0ReportSummary> {
  const verify = await verifyWatcherArtifact(params.paths, {
    filename: params.filename,
    sha256: params.sha256,
    traceId: params.traceId,
  });
  const status = await summarizeWatcherStatus(params.paths);
  const health = await summarizeWatcherHealth(params.paths);
  const receipts = await listWatcherReceipts(params.paths);
  const filteredReceipts = receipts.filter((receipt) => {
    if (params.filename && receipt.original_filename !== params.filename) {
      return false;
    }
    if (params.sha256 && receipt.sha256 !== params.sha256) {
      return false;
    }
    if (params.traceId && receipt.trace_id !== params.traceId) {
      return false;
    }
    return true;
  });
  const traceForLogs =
    params.traceId ??
    verify.matches
      .map((match) => match.trace_id)
      .find((traceId): traceId is string => traceId != null) ??
    null;
  const logs = await listWatcherLogEntries(params.paths, {
    filename: params.filename,
    limit: 200,
    sha256: params.sha256,
    traceId: traceForLogs ?? undefined,
  });
  const inputEnvelopes = await Promise.all(
    verify.matches.map((match) => readWatcherInputEnvelope(params.paths, match.file)),
  );
  const reportSlugSource =
    params.traceId ?? params.filename ?? params.sha256 ?? verify.matches[0]?.file ?? "query";
  const defaultOutPath = path.join(
    resolveWatcherRepoRoot(params.paths),
    "workspace",
    "audit",
    WATCHER_OUTPUT_ROOT,
    "reports",
    `${slugifyFragment(reportSlugSource)}.report.json`,
  );
  const outputPath = path.resolve(params.outPath ?? defaultOutPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const report: InterbeingWatcherV0ReportSummary = {
    environment: {
      arch: process.arch,
      cwd: resolveWatcherRepoRoot(params.paths),
      node_version: process.version,
      platform: process.platform,
    },
    generated_at: nowIso(),
    health,
    input_envelopes: inputEnvelopes,
    log_entries: logs.items,
    matches: verify.matches,
    output_path: toRepoRelative(params.paths, outputPath) ?? outputPath,
    query: verify.query,
    receipts: filteredReceipts.map((receipt) => ({
      ...receipt,
      final_path: toRepoRelative(params.paths, receipt.final_path) ?? receipt.final_path,
      intake_path: toRepoRelative(params.paths, receipt.intake_path) ?? receipt.intake_path,
      receipt_path: toRepoRelative(params.paths, receipt.receipt_path) ?? receipt.receipt_path,
      evidence: {
        ...receipt.evidence,
        lifecycle_output_dir:
          receipt.evidence.lifecycle_output_dir == null
            ? null
            : (toRepoRelative(params.paths, receipt.evidence.lifecycle_output_dir) ??
              receipt.evidence.lifecycle_output_dir),
        log_path:
          toRepoRelative(params.paths, receipt.evidence.log_path) ?? receipt.evidence.log_path,
        state_path:
          toRepoRelative(params.paths, receipt.evidence.state_path) ?? receipt.evidence.state_path,
      },
    })),
    status,
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function resolveReplaySourceByQuery(params: {
  filename?: string;
  paths: InterbeingWatcherV0Paths;
  sha256?: string;
  traceId?: string;
}): Promise<InterbeingWatcherV0Receipt> {
  const receipts = await listWatcherReceipts(params.paths);
  const match = receipts.find((receipt) => {
    if (params.filename && receipt.original_filename !== params.filename) {
      return false;
    }
    if (params.sha256 && receipt.sha256 !== params.sha256) {
      return false;
    }
    if (params.traceId && receipt.trace_id !== params.traceId) {
      return false;
    }
    return true;
  });
  if (!match) {
    throw new Error("replay query did not match any processed or failed receipt");
  }
  return match;
}

export async function listRecentWatcherReceipts(
  paths: InterbeingWatcherV0Paths,
  limit = 10,
  filters: InterbeingWatcherV0ReceiptFilters = {},
): Promise<{ items: InterbeingWatcherV0Receipt[]; tool_name: string; watcher_version: string }> {
  const receipts = await listWatcherReceipts(paths);
  return {
    tool_name: WATCHER_TOOL_NAME,
    watcher_version: WATCHER_TOOL_VERSION,
    items: receipts
      .filter((receipt) => matchesWatcherReceiptFilters(receipt, filters))
      .slice(0, Math.max(0, limit))
      .map((receipt) => ({
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
  filename?: string;
  filePath: string;
  forceReprocess?: boolean;
  paths: InterbeingWatcherV0Paths;
  sha256?: string;
  traceId?: string;
}): Promise<InterbeingWatcherV0ReplaySummary> {
  return await withWatcherMutationLock(params.paths, async () => {
    const selectedReceipt =
      params.filePath.trim().length > 0
        ? null
        : await resolveReplaySourceByQuery({
            filename: params.filename,
            paths: params.paths,
            sha256: params.sha256,
            traceId: params.traceId,
          });
    const sourcePath = path.resolve(selectedReceipt?.final_path ?? params.filePath);
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
    const traceId = await readTraceIdFromEnvelopeFile(sourcePath);
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
      duration_ms: null,
      filename: path.basename(sourcePath),
      final_path: toRepoRelative(params.paths, queuedPath),
      reason_code: reasonCode,
      reason_detail: null,
      receipt_path: null,
      sha256,
      status: "queued",
      timestamp: nowIso(),
      trace_id: traceId,
      tool_name: WATCHER_TOOL_NAME,
      watcher_version: WATCHER_TOOL_VERSION,
    });

    return {
      tool_name: WATCHER_TOOL_NAME,
      watcher_version: WATCHER_TOOL_VERSION,
      force_reprocess: Boolean(params.forceReprocess),
      queued_path: toRepoRelative(params.paths, queuedPath) ?? queuedPath,
      reason_code: reasonCode,
      selected_source: selectedReceipt
        ? {
            disposition: selectedReceipt.final_disposition,
            file:
              toRepoRelative(params.paths, selectedReceipt.final_path) ??
              selectedReceipt.final_path,
            intake_timestamp: selectedReceipt.intake_timestamp,
            trace_id: selectedReceipt.trace_id,
          }
        : null,
      sha256,
      source_file: toRepoRelative(params.paths, sourcePath) ?? sourcePath,
      trace_id: traceId,
    };
  });
}

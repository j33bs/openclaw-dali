import crypto from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseSubmitTaskEnvelopeV0,
  type InterbeingTaskEnvelopeV0,
} from "../../src/shared/interbeing-task-lifecycle-v0.ts";
import { withInterbeingTraceMetadata } from "./trace_v0_support.ts";

export const EMITTER_TOOL_NAME = "interbeing-emitter-v0";
export const EMITTER_STATE_FILENAME = "interbeing_emitter_v0.json";
export const EMITTER_LOG_FILENAME = "interbeing_emitter_v0.log";
export const EMITTER_TASK_PATTERN = ".task-envelope.v0.json";

export type InterbeingEmitterV0Paths = {
  handoffRoot: string;
  outgoingRoot: string;
  statePath: string;
  logPath: string;
};

export type InterbeingEmitterV0State = {
  schema_version: "v0";
  emitted_hashes: Record<
    string,
    {
      emitted_at: string;
      filename: string;
      target_node: string;
    }
  >;
};

export type InterbeingEmitterV0Receipt = {
  correlation_id: string;
  delivery_receipt: {
    accepted: boolean;
    accepted_at: string | null;
    deliver_dir: string | null;
    delivered_to: string | null;
    status: "accepted" | "queued_only";
  };
  duplicate_of: string | null;
  delivered_to: string | null;
  schema_version: "v0";
  tool_name: string;
  emitted_at: string;
  filename: string;
  queue_path: string;
  requestor: string;
  trace_id: string;
  target_node: string;
  task_id: string;
  sha256: string;
};

export type EmitInterbeingTaskV0Options = {
  cwd?: string;
  deliverDir?: string;
  allowDuplicate?: boolean;
  filename?: string;
  now?: () => string;
  traceId?: string;
};

export type EmitInterbeingTaskV0Result = {
  deliveryReceipt: InterbeingEmitterV0Receipt["delivery_receipt"];
  duplicate: boolean;
  duplicateOf: string | null;
  envelope: InterbeingTaskEnvelopeV0;
  filename: string;
  queuePath: string;
  receiptPath: string;
  sha256: string;
  deliveredTo: string | null;
  traceId: string;
};

export type InterbeingEmitterListItem = {
  delivery_receipt: InterbeingEmitterV0Receipt["delivery_receipt"];
  emitted_at: string;
  filename: string;
  queue_path: string;
  receipt_path: string;
  target_node: string;
  trace_id: string;
};

export type InterbeingEmitterV0LogEntry = {
  action: "duplicate_emit" | "emit";
  delivered_to: string | null;
  duplicate_of: string | null;
  emitted_at: string;
  filename: string;
  queue_path: string;
  requestor: string;
  sha256: string | null;
  target_node: string;
  task_id: string;
  trace_id: string | null;
};

export type InterbeingEmitterV0LogQuery = {
  action?: InterbeingEmitterV0LogEntry["action"];
  filename?: string;
  limit?: number;
  sha256?: string;
  traceId?: string;
};

export type InterbeingEmitterV0LogQuerySummary = {
  items: InterbeingEmitterV0LogEntry[];
  query: {
    action: InterbeingEmitterV0LogEntry["action"] | null;
    filename: string | null;
    limit: number;
    sha256: string | null;
    trace_id: string | null;
  };
  tool_name: string;
};

export function resolveInterbeingEmitterV0Paths(cwd = process.cwd()): InterbeingEmitterV0Paths {
  const repoRoot = path.resolve(cwd);
  const handoffRoot = path.join(repoRoot, "handoff");
  return {
    handoffRoot,
    outgoingRoot: path.join(handoffRoot, "outgoing"),
    statePath: path.join(repoRoot, "workspace", "state", EMITTER_STATE_FILENAME),
    logPath: path.join(repoRoot, "workspace", "audit", EMITTER_LOG_FILENAME),
  };
}

function nowIso(now?: () => string): string {
  return now ? now() : new Date().toISOString();
}

function ensureTaskFilename(filename: string): string {
  return filename.endsWith(EMITTER_TASK_PATTERN) ? filename : `${filename}${EMITTER_TASK_PATTERN}`;
}

function slugifyFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function defaultFilename(envelope: InterbeingTaskEnvelopeV0, timestamp: string): string {
  const stamp = timestamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const task = slugifyFragment(envelope.task_id || envelope.correlation_id || "task");
  return ensureTaskFilename(`${stamp}--${task || "task"}`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readState(statePath: string): Promise<InterbeingEmitterV0State> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as InterbeingEmitterV0State;
    if (parsed?.schema_version === "v0" && parsed.emitted_hashes) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return {
    schema_version: "v0",
    emitted_hashes: {},
  };
}

async function writeState(statePath: string, state: InterbeingEmitterV0State): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function appendLog(logPath: string, payload: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", flag: "a" });
}

async function readEmitterLogEntries(
  logPath: string,
): Promise<Array<Partial<InterbeingEmitterV0LogEntry>>> {
  if (!(await pathExists(logPath))) {
    return [];
  }
  const raw = await readFile(logPath, "utf8");
  const entries: Array<Partial<InterbeingEmitterV0LogEntry>> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed) as Partial<InterbeingEmitterV0LogEntry>);
    } catch {
      continue;
    }
  }
  return entries;
}

function normalizeEmitterLogEntry(
  entry: Partial<InterbeingEmitterV0LogEntry>,
): InterbeingEmitterV0LogEntry | null {
  if (
    (entry.action !== "duplicate_emit" && entry.action !== "emit") ||
    typeof entry.emitted_at !== "string" ||
    typeof entry.filename !== "string" ||
    typeof entry.queue_path !== "string" ||
    typeof entry.requestor !== "string" ||
    typeof entry.target_node !== "string" ||
    typeof entry.task_id !== "string"
  ) {
    return null;
  }
  return {
    action: entry.action,
    delivered_to: typeof entry.delivered_to === "string" ? entry.delivered_to : null,
    duplicate_of: typeof entry.duplicate_of === "string" ? entry.duplicate_of : null,
    emitted_at: entry.emitted_at,
    filename: entry.filename,
    queue_path: entry.queue_path,
    requestor: entry.requestor,
    sha256: typeof entry.sha256 === "string" ? entry.sha256 : null,
    target_node: entry.target_node,
    task_id: entry.task_id,
    trace_id: typeof entry.trace_id === "string" ? entry.trace_id : null,
  };
}

function sha256Text(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function normalizeEnvelope(value: unknown): InterbeingTaskEnvelopeV0 {
  const envelope = parseSubmitTaskEnvelopeV0(value, {
    allowTargetMismatch: true,
    nodeId:
      typeof (value as { target_node?: unknown })?.target_node === "string"
        ? String((value as { target_node?: unknown }).target_node)
        : "dali",
  });
  return envelope;
}

async function readEmitterReceipt(receiptPath: string): Promise<InterbeingEmitterV0Receipt | null> {
  if (!(await pathExists(receiptPath))) {
    return null;
  }
  return JSON.parse(await readFile(receiptPath, "utf8")) as InterbeingEmitterV0Receipt;
}

export async function emitInterbeingTaskV0(
  value: unknown,
  options: EmitInterbeingTaskV0Options = {},
): Promise<EmitInterbeingTaskV0Result> {
  const timestamp = nowIso(options.now);
  const withTrace = withInterbeingTraceMetadata(normalizeEnvelope(value), {
    emitter: EMITTER_TOOL_NAME,
    traceId: options.traceId,
  });
  const envelope = withTrace.envelope;
  const traceId = withTrace.traceId;
  const paths = resolveInterbeingEmitterV0Paths(options.cwd);
  const queueDir = path.join(paths.outgoingRoot, envelope.target_node);
  await mkdir(queueDir, { recursive: true });

  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  const sha256 = sha256Text(serialized);
  const state = await readState(paths.statePath);
  const existing = state.emitted_hashes[sha256] ?? null;
  if (existing && !options.allowDuplicate) {
    const duplicateQueuePath = path.join(queueDir, existing.filename);
    const duplicateReceiptPath = `${duplicateQueuePath}.receipt.json`;
    const duplicateReceipt = await readEmitterReceipt(duplicateReceiptPath);
    await appendLog(paths.logPath, {
      action: "duplicate_emit",
      duplicate_of: existing.filename,
      emitted_at: timestamp,
      filename: existing.filename,
      queue_path: duplicateQueuePath,
      requestor: envelope.requestor,
      sha256,
      target_node: envelope.target_node,
      task_id: envelope.task_id,
      trace_id: duplicateReceipt?.trace_id ?? traceId,
    });
    return {
      deliveryReceipt: duplicateReceipt?.delivery_receipt ?? {
        accepted: false,
        accepted_at: null,
        deliver_dir: null,
        delivered_to: null,
        status: "queued_only",
      },
      duplicate: true,
      duplicateOf: existing.filename,
      envelope,
      filename: existing.filename,
      queuePath: duplicateQueuePath,
      receiptPath: duplicateReceiptPath,
      sha256,
      deliveredTo: duplicateReceipt?.delivery_receipt.delivered_to ?? null,
      traceId: duplicateReceipt?.trace_id ?? traceId,
    };
  }

  const filename = ensureTaskFilename(options.filename ?? defaultFilename(envelope, timestamp));
  const queuePath = path.join(queueDir, filename);
  const tempPath = `${queuePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, queuePath);

  let deliveredTo: string | null = null;
  if (options.deliverDir) {
    await mkdir(options.deliverDir, { recursive: true });
    deliveredTo = path.join(options.deliverDir, filename);
    await copyFile(queuePath, deliveredTo);
  }
  const deliveryReceipt: InterbeingEmitterV0Receipt["delivery_receipt"] = deliveredTo
    ? {
        accepted: true,
        accepted_at: timestamp,
        deliver_dir: options.deliverDir ?? null,
        delivered_to: deliveredTo,
        status: "accepted",
      }
    : {
        accepted: false,
        accepted_at: null,
        deliver_dir: options.deliverDir ?? null,
        delivered_to: null,
        status: "queued_only",
      };

  const receipt: InterbeingEmitterV0Receipt = {
    correlation_id: envelope.correlation_id,
    delivery_receipt: deliveryReceipt,
    duplicate_of: existing?.filename ?? null,
    delivered_to: deliveredTo,
    schema_version: "v0",
    tool_name: EMITTER_TOOL_NAME,
    emitted_at: timestamp,
    filename,
    queue_path: queuePath,
    requestor: envelope.requestor,
    trace_id: traceId,
    target_node: envelope.target_node,
    task_id: envelope.task_id,
    sha256,
  };
  const receiptPath = `${queuePath}.receipt.json`;
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  state.emitted_hashes[sha256] = {
    emitted_at: timestamp,
    filename,
    target_node: envelope.target_node,
  };
  await writeState(paths.statePath, state);
  await appendLog(paths.logPath, {
    action: existing ? "duplicate_emit" : "emit",
    emitted_at: timestamp,
    filename,
    queue_path: queuePath,
    requestor: envelope.requestor,
    sha256,
    target_node: envelope.target_node,
    task_id: envelope.task_id,
    trace_id: traceId,
    delivered_to: deliveredTo,
    duplicate_of: existing?.filename ?? null,
  });

  return {
    deliveryReceipt,
    duplicate: false,
    duplicateOf: existing?.filename ?? null,
    envelope,
    filename,
    queuePath,
    receiptPath,
    sha256,
    deliveredTo,
    traceId,
  };
}

export async function listInterbeingEmitterV0(
  cwd = process.cwd(),
  limit = 10,
  options: { traceId?: string } = {},
): Promise<InterbeingEmitterListItem[]> {
  const paths = resolveInterbeingEmitterV0Paths(cwd);
  const state = await readState(paths.statePath);
  const items = (
    await Promise.all(
      Object.values(state.emitted_hashes).map(async (item) => {
        const queuePath = path.join(paths.outgoingRoot, item.target_node, item.filename);
        const receiptPath = `${queuePath}.receipt.json`;
        const receipt = await readEmitterReceipt(receiptPath);
        const traceId = receipt?.trace_id;
        if (options.traceId && traceId !== options.traceId) {
          return null;
        }
        return {
          delivery_receipt: receipt?.delivery_receipt ?? {
            accepted: false,
            accepted_at: null,
            deliver_dir: null,
            delivered_to: null,
            status: "queued_only" as const,
          },
          emitted_at: item.emitted_at,
          filename: item.filename,
          queue_path: queuePath,
          receipt_path: receiptPath,
          target_node: item.target_node,
          trace_id: traceId ?? null,
        };
      }),
    )
  )
    .filter(
      (
        item,
      ): item is InterbeingEmitterListItem & {
        trace_id: string | null;
      } => item != null,
    )
    .toSorted((left, right) => right.emitted_at.localeCompare(left.emitted_at));
  return items.slice(0, Math.max(1, limit)).map((item) => ({
    ...item,
    trace_id: item.trace_id ?? item.filename,
  }));
}

export async function verifyInterbeingEmitterV0(
  cwd: string,
  options: { filename?: string; sha256?: string; traceId?: string },
): Promise<(InterbeingEmitterListItem & { sha256: string }) | null> {
  const paths = resolveInterbeingEmitterV0Paths(cwd);
  const state = await readState(paths.statePath);
  for (const [sha256, item] of Object.entries(state.emitted_hashes)) {
    if (options.sha256 && options.sha256 !== sha256) {
      continue;
    }
    if (options.filename && options.filename !== item.filename) {
      continue;
    }
    const queuePath = path.join(paths.outgoingRoot, item.target_node, item.filename);
    const exists = await pathExists(queuePath);
    if (!exists) {
      continue;
    }
    const receiptPath = `${queuePath}.receipt.json`;
    const receipt = await readEmitterReceipt(receiptPath);
    const traceId = receipt?.trace_id ?? item.filename;
    if (options.traceId && options.traceId !== traceId) {
      continue;
    }
    return {
      delivery_receipt: receipt?.delivery_receipt ?? {
        accepted: false,
        accepted_at: null,
        deliver_dir: null,
        delivered_to: null,
        status: "queued_only",
      },
      emitted_at: item.emitted_at,
      filename: item.filename,
      target_node: item.target_node,
      queue_path: queuePath,
      receipt_path: receiptPath,
      sha256,
      trace_id: traceId,
    };
  }
  return null;
}

export async function listInterbeingEmitterV0LogEntries(
  cwd = process.cwd(),
  options: InterbeingEmitterV0LogQuery = {},
): Promise<InterbeingEmitterV0LogQuerySummary> {
  const paths = resolveInterbeingEmitterV0Paths(cwd);
  const limit = Math.max(1, options.limit ?? 50);
  const items = (await readEmitterLogEntries(paths.logPath))
    .map((entry) => normalizeEmitterLogEntry(entry))
    .filter((entry): entry is InterbeingEmitterV0LogEntry => entry != null)
    .filter((entry) => {
      if (options.action && entry.action !== options.action) {
        return false;
      }
      if (options.filename && entry.filename !== options.filename) {
        return false;
      }
      if (options.sha256 && entry.sha256 !== options.sha256) {
        return false;
      }
      if (options.traceId && entry.trace_id !== options.traceId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => {
      if (left.emitted_at === right.emitted_at) {
        return right.filename.localeCompare(left.filename);
      }
      return right.emitted_at.localeCompare(left.emitted_at);
    })
    .slice(0, limit);

  return {
    items,
    query: {
      action: options.action ?? null,
      filename: options.filename ?? null,
      limit,
      sha256: options.sha256 ?? null,
      trace_id: options.traceId ?? null,
    },
    tool_name: EMITTER_TOOL_NAME,
  };
}

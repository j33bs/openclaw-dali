import crypto from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseSubmitTaskEnvelopeV0,
  type InterbeingTaskEnvelopeV0,
} from "../../src/shared/interbeing-task-lifecycle-v0.ts";

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
  schema_version: "v0";
  tool_name: string;
  emitted_at: string;
  filename: string;
  queue_path: string;
  requestor: string;
  target_node: string;
  task_id: string;
  correlation_id: string;
  sha256: string;
  duplicate_of: string | null;
  delivered_to: string | null;
};

export type EmitInterbeingTaskV0Options = {
  cwd?: string;
  deliverDir?: string;
  allowDuplicate?: boolean;
  filename?: string;
  now?: () => string;
};

export type EmitInterbeingTaskV0Result = {
  duplicate: boolean;
  envelope: InterbeingTaskEnvelopeV0;
  filename: string;
  queuePath: string;
  receiptPath: string;
  sha256: string;
  deliveredTo: string | null;
  duplicateOf: string | null;
};

export type InterbeingEmitterListItem = {
  emitted_at: string;
  filename: string;
  target_node: string;
  queue_path: string;
  receipt_path: string;
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

export async function emitInterbeingTaskV0(
  value: unknown,
  options: EmitInterbeingTaskV0Options = {},
): Promise<EmitInterbeingTaskV0Result> {
  const envelope = normalizeEnvelope(value);
  const timestamp = nowIso(options.now);
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
    return {
      duplicate: true,
      envelope,
      filename: existing.filename,
      queuePath: duplicateQueuePath,
      receiptPath: duplicateReceiptPath,
      sha256,
      deliveredTo: null,
      duplicateOf: existing.filename,
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

  const receipt: InterbeingEmitterV0Receipt = {
    schema_version: "v0",
    tool_name: EMITTER_TOOL_NAME,
    emitted_at: timestamp,
    filename,
    queue_path: queuePath,
    requestor: envelope.requestor,
    target_node: envelope.target_node,
    task_id: envelope.task_id,
    correlation_id: envelope.correlation_id,
    sha256,
    duplicate_of: existing?.filename ?? null,
    delivered_to: deliveredTo,
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
    delivered_to: deliveredTo,
    duplicate_of: existing?.filename ?? null,
  });

  return {
    duplicate: false,
    envelope,
    filename,
    queuePath,
    receiptPath,
    sha256,
    deliveredTo,
    duplicateOf: existing?.filename ?? null,
  };
}

export async function listInterbeingEmitterV0(
  cwd = process.cwd(),
  limit = 10,
): Promise<InterbeingEmitterListItem[]> {
  const paths = resolveInterbeingEmitterV0Paths(cwd);
  const state = await readState(paths.statePath);
  const items = Object.values(state.emitted_hashes)
    .map((item) => {
      const queuePath = path.join(paths.outgoingRoot, item.target_node, item.filename);
      return {
        emitted_at: item.emitted_at,
        filename: item.filename,
        target_node: item.target_node,
        queue_path: queuePath,
        receipt_path: `${queuePath}.receipt.json`,
      };
    })
    .toSorted((left, right) => right.emitted_at.localeCompare(left.emitted_at));
  return items.slice(0, Math.max(1, limit));
}

export async function verifyInterbeingEmitterV0(
  cwd: string,
  options: { filename?: string; sha256?: string },
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
    return {
      emitted_at: item.emitted_at,
      filename: item.filename,
      target_node: item.target_node,
      queue_path: queuePath,
      receipt_path: `${queuePath}.receipt.json`,
      sha256,
    };
  }
  return null;
}

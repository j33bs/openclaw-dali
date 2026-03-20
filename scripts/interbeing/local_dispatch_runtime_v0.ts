import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  emitLocalTaskLifecycleV0,
  parseSubmitTaskEnvelopeV0,
  type InterbeingTaskEnvelopeV0,
} from "../../src/shared/interbeing-task-lifecycle-v0.ts";
import { runTasksWithConcurrency } from "../../src/utils/run-with-concurrency.ts";
import {
  runInterbeingE2ELocalV0,
  type InterbeingE2ERunOptions,
} from "../dev/interbeing-e2e-local-v0.ts";
import type {
  InterbeingWatcherV0LocalDispatchRole,
  InterbeingWatcherV0ReceiptLineage,
  InterbeingWatcherV0ReceiptLocalDispatch,
  InterbeingWatcherV0ReceiptTaskContract,
} from "./watcher_v0_support.ts";

type JsonObject = Record<string, unknown>;

const LOCAL_DISPATCH_KEY = "local_dispatch";
const MAX_PLANNER_CHILDREN = 4;
const MAX_WORKER_LIMIT = 3;
const DEFAULT_WORKER_LIMIT = 2;
const MAX_REVIEWER_CHILDREN = 1;
const MAX_SLEEP_MS = 300;
const LOCAL_DISPATCH_ALLOWED_KEYS = [
  "approved",
  "chain_id",
  "hop_count",
  "input",
  "lineage",
  "max_hops",
  "notes",
  "parent_task_id",
  "planner_children",
  "result",
  "role",
  "sleep_ms",
  "source_role",
  "task_contract",
  "target_role",
  "worker_limit",
] as const;
const LOCAL_LINEAGE_ALLOWED_KEYS = [
  "chain_id",
  "hop_count",
  "max_hops",
  "parent_role",
  "parent_task_id",
] as const;
const LOCAL_CHILD_ALLOWED_KEYS = [
  "approved",
  "dedupe_key",
  "input",
  "notes",
  "result",
  "role",
  "sleep_ms",
  "task_id",
] as const;
const LOCAL_TASK_CONTRACT_ALLOWED_KEYS = [
  "acceptance_criteria",
  "execution_notes",
  "review_mode",
  "task_class",
  "worker_limit",
] as const;

export type InterbeingLocalDispatchFailureReasonCode =
  | "dispatch_invalid"
  | "hop_limit_exceeded"
  | "reviewer_rejected";

export type InterbeingLocalDispatchRunResult = {
  outputDir: string;
  receiptContext?: InterbeingWatcherV0ReceiptLocalDispatch;
  summary: JsonObject;
};

type NormalizedLocalDispatchSpec = {
  approved: boolean | null;
  input: JsonObject;
  lineage: InterbeingWatcherV0ReceiptLineage;
  notes: string | null;
  plannerChildren: NormalizedPlannerChildSpec[];
  result: JsonObject | null;
  role: InterbeingWatcherV0LocalDispatchRole;
  sleepMs: number;
  taskContract: InterbeingWatcherV0ReceiptTaskContract | null;
  workerLimit: number;
};

type NormalizedPlannerChildSpec = {
  approved: boolean | null;
  dedupeKey: string;
  input: JsonObject;
  lineage: InterbeingWatcherV0ReceiptLineage;
  notes: string | null;
  result: JsonObject | null;
  role: Exclude<InterbeingWatcherV0LocalDispatchRole, "planner">;
  sleepMs: number;
  taskId: string;
};

type LocalDispatchChildSummary = {
  approved: boolean | null;
  dedupe_key: string;
  lineage: InterbeingWatcherV0ReceiptLineage;
  notes: string | null;
  output: JsonObject | null;
  role: Exclude<InterbeingWatcherV0LocalDispatchRole, "planner">;
  status: "rejected" | "skipped_duplicate" | "succeeded";
  task_id: string;
};

export class InterbeingLocalDispatchError extends Error {
  readonly reasonCode: InterbeingLocalDispatchFailureReasonCode;
  readonly receiptContext?: InterbeingWatcherV0ReceiptLocalDispatch;
  readonly summary?: JsonObject;

  constructor(params: {
    message: string;
    reasonCode: InterbeingLocalDispatchFailureReasonCode;
    receiptContext?: InterbeingWatcherV0ReceiptLocalDispatch;
    summary?: JsonObject;
  }) {
    super(params.message);
    this.name = "InterbeingLocalDispatchError";
    this.reasonCode = params.reasonCode;
    this.receiptContext = params.receiptContext;
    this.summary = params.summary;
  }
}

export function isInterbeingLocalDispatchError(
  value: unknown,
): value is InterbeingLocalDispatchError {
  return value instanceof InterbeingLocalDispatchError;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${label} has unexpected property "${key}"`);
    }
  }
}

function asPlainObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function asOptionalString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function asOptionalBoolean(value: unknown, label: string): boolean | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function asOptionalJsonObject(value: unknown, label: string): JsonObject {
  if (value == null) {
    return {};
  }
  return asPlainObject(value, label);
}

function asOptionalResultObject(value: unknown, label: string): JsonObject | null {
  if (value == null) {
    return null;
  }
  return asPlainObject(value, label);
}

function asOptionalArray(value: unknown, label: string): unknown[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function asOptionalStringArray(value: unknown, label: string): string[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  const normalized: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    normalized.push(entry.trim());
  }
  return normalized;
}

function asNonNegativeInteger(value: unknown, label: string): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function clampSleepMs(value: number | null): number {
  return Math.max(0, Math.min(MAX_SLEEP_MS, value ?? 0));
}

function normalizeRole(value: unknown, label: string): InterbeingWatcherV0LocalDispatchRole {
  if (value !== "executor" && value !== "planner" && value !== "reviewer") {
    throw new Error(`${label} must be one of executor, planner, reviewer`);
  }
  return value;
}

function normalizeResolvedRole(
  record: JsonObject,
  label: string,
): InterbeingWatcherV0LocalDispatchRole {
  const role = record.role == null ? null : normalizeRole(record.role, `${label}.role`);
  const targetRole =
    record.target_role == null ? null : normalizeRole(record.target_role, `${label}.target_role`);
  if (role != null && targetRole != null && role !== targetRole) {
    throw new Error(`${label}.role conflicts with ${label}.target_role`);
  }
  if (role == null && targetRole == null) {
    throw new Error(`${label}.role or ${label}.target_role is required`);
  }
  return role ?? targetRole!;
}

function normalizeRootLineage(
  envelope: InterbeingTaskEnvelopeV0,
  role: InterbeingWatcherV0LocalDispatchRole,
  value: unknown,
  taskContract?: InterbeingWatcherV0ReceiptTaskContract | null,
): InterbeingWatcherV0ReceiptLineage {
  if (value == null) {
    return {
      chain_id: envelope.correlation_id,
      hop_count: 0,
      max_hops: null,
      parent_role: null,
      parent_task_id: null,
    };
  }
  const record = asPlainObject(value, "payload.local_dispatch.lineage");
  assertAllowedKeys(record, LOCAL_LINEAGE_ALLOWED_KEYS, "payload.local_dispatch.lineage");
  const parentRoleValue = record.parent_role;
  const parentRole =
    parentRoleValue == null
      ? null
      : normalizeRole(parentRoleValue, "payload.local_dispatch.lineage.parent_role");
  const hopCount = asNonNegativeInteger(
    record.hop_count,
    "payload.local_dispatch.lineage.hop_count",
  );
  const maxHops = asNonNegativeInteger(record.max_hops, "payload.local_dispatch.lineage.max_hops");
  const lineage = {
    chain_id:
      asOptionalString(record.chain_id, "payload.local_dispatch.lineage.chain_id") ??
      envelope.correlation_id,
    hop_count: hopCount ?? 0,
    max_hops: maxHops,
    parent_role: parentRole,
    parent_task_id: asOptionalString(
      record.parent_task_id,
      "payload.local_dispatch.lineage.parent_task_id",
    ),
  };
  if (lineage.max_hops != null && lineage.hop_count > lineage.max_hops) {
    throw new InterbeingLocalDispatchError({
      message: `lineage hop_count ${lineage.hop_count} exceeds max_hops ${lineage.max_hops}`,
      reasonCode: "hop_limit_exceeded",
      receiptContext: {
        children: null,
        lineage,
        reviewer_gate: null,
        role,
        ...(taskContract == null ? {} : { task_contract: taskContract }),
        worker_pool: null,
      },
    });
  }
  return lineage;
}

function normalizeFlatRootLineage(
  envelope: InterbeingTaskEnvelopeV0,
  role: InterbeingWatcherV0LocalDispatchRole,
  record: JsonObject,
  taskContract?: InterbeingWatcherV0ReceiptTaskContract | null,
): InterbeingWatcherV0ReceiptLineage | null {
  const hasFlatLineage =
    record.chain_id != null ||
    record.hop_count != null ||
    record.max_hops != null ||
    record.parent_task_id != null ||
    record.source_role != null;
  if (!hasFlatLineage) {
    return null;
  }

  return normalizeRootLineage(
    envelope,
    role,
    {
      chain_id: record.chain_id,
      hop_count: record.hop_count,
      max_hops: record.max_hops,
      parent_role: record.source_role,
      parent_task_id: record.parent_task_id,
    },
    taskContract,
  );
}

function lineagesMatch(
  left: InterbeingWatcherV0ReceiptLineage,
  right: InterbeingWatcherV0ReceiptLineage,
): boolean {
  return (
    left.chain_id === right.chain_id &&
    left.hop_count === right.hop_count &&
    left.max_hops === right.max_hops &&
    left.parent_role === right.parent_role &&
    left.parent_task_id === right.parent_task_id
  );
}

function normalizeWorkerLimit(value: unknown): number {
  const parsed = asNonNegativeInteger(value, "payload.local_dispatch.worker_limit");
  if (parsed == null) {
    return DEFAULT_WORKER_LIMIT;
  }
  if (parsed === 0) {
    throw new Error("payload.local_dispatch.worker_limit must be greater than zero");
  }
  return Math.min(MAX_WORKER_LIMIT, parsed);
}

function asOptionalPositiveInteger(value: unknown, label: string): number | null {
  const parsed = asNonNegativeInteger(value, label);
  if (parsed == null) {
    return null;
  }
  if (parsed === 0) {
    throw new Error(`${label} must be greater than zero`);
  }
  return parsed;
}

function normalizeTaskContract(value: unknown): InterbeingWatcherV0ReceiptTaskContract | null {
  if (value == null) {
    return null;
  }
  const record = asPlainObject(value, "payload.local_dispatch.task_contract");
  assertAllowedKeys(
    record,
    LOCAL_TASK_CONTRACT_ALLOWED_KEYS,
    "payload.local_dispatch.task_contract",
  );

  const taskContract: InterbeingWatcherV0ReceiptTaskContract = {};
  const acceptanceCriteria = asOptionalStringArray(
    record.acceptance_criteria,
    "payload.local_dispatch.task_contract.acceptance_criteria",
  );
  const executionNotes = asOptionalString(
    record.execution_notes,
    "payload.local_dispatch.task_contract.execution_notes",
  );
  const reviewMode = asOptionalString(
    record.review_mode,
    "payload.local_dispatch.task_contract.review_mode",
  );
  const taskClass = asOptionalString(
    record.task_class,
    "payload.local_dispatch.task_contract.task_class",
  );
  const workerLimit = asOptionalPositiveInteger(
    record.worker_limit,
    "payload.local_dispatch.task_contract.worker_limit",
  );

  if (acceptanceCriteria != null) {
    taskContract.acceptance_criteria = acceptanceCriteria;
  }
  if (executionNotes != null) {
    taskContract.execution_notes = executionNotes;
  }
  if (reviewMode != null) {
    taskContract.review_mode = reviewMode;
  }
  if (taskClass != null) {
    taskContract.task_class = taskClass;
  }
  if (workerLimit != null) {
    taskContract.worker_limit = workerLimit;
  }

  return taskContract;
}

function createDispatchInvalidError(
  message: string,
  receiptContext?: InterbeingWatcherV0ReceiptLocalDispatch,
): InterbeingLocalDispatchError {
  return new InterbeingLocalDispatchError({
    message,
    reasonCode: "dispatch_invalid",
    receiptContext,
  });
}

function createBaseReceiptContext(params: {
  lineage: InterbeingWatcherV0ReceiptLineage;
  role: InterbeingWatcherV0LocalDispatchRole;
  taskContract?: InterbeingWatcherV0ReceiptTaskContract | null;
  workerLimit?: number | null;
}): InterbeingWatcherV0ReceiptLocalDispatch {
  return {
    children: null,
    lineage: params.lineage,
    reviewer_gate: null,
    role: params.role,
    ...(params.taskContract == null ? {} : { task_contract: params.taskContract }),
    worker_pool:
      params.workerLimit == null
        ? null
        : {
            limit: params.workerLimit,
            max_in_flight: 0,
          },
  };
}

function buildChildLineage(
  parentTaskId: string,
  parentLineage: InterbeingWatcherV0ReceiptLineage,
  taskContract: InterbeingWatcherV0ReceiptTaskContract | null,
  workerLimit: number,
): InterbeingWatcherV0ReceiptLineage {
  const nextHop = parentLineage.hop_count + 1;
  if (parentLineage.max_hops != null && nextHop > parentLineage.max_hops) {
    throw new InterbeingLocalDispatchError({
      message: `planner child hop_count ${nextHop} exceeds max_hops ${parentLineage.max_hops}`,
      reasonCode: "hop_limit_exceeded",
      receiptContext: {
        children: null,
        lineage: parentLineage,
        reviewer_gate: null,
        role: "planner",
        ...(taskContract == null ? {} : { task_contract: taskContract }),
        worker_pool: {
          limit: workerLimit,
          max_in_flight: 0,
        },
      },
    });
  }
  return {
    chain_id: parentLineage.chain_id,
    hop_count: nextHop,
    max_hops: parentLineage.max_hops,
    parent_role: "planner",
    parent_task_id: parentTaskId,
  };
}

function normalizePlannerChild(
  envelope: InterbeingTaskEnvelopeV0,
  parentLineage: InterbeingWatcherV0ReceiptLineage,
  taskContract: InterbeingWatcherV0ReceiptTaskContract | null,
  workerLimit: number,
  value: unknown,
  index: number,
): NormalizedPlannerChildSpec {
  const record = asPlainObject(value, `payload.local_dispatch.planner_children[${index}]`);
  assertAllowedKeys(
    record,
    LOCAL_CHILD_ALLOWED_KEYS,
    `payload.local_dispatch.planner_children[${index}]`,
  );
  const role = normalizeRole(record.role, `payload.local_dispatch.planner_children[${index}].role`);
  if (role === "planner") {
    throw createDispatchInvalidError(
      `payload.local_dispatch.planner_children[${index}].role must not be planner`,
      createBaseReceiptContext({
        lineage: parentLineage,
        role: "planner",
        taskContract,
        workerLimit,
      }),
    );
  }

  const taskId =
    asOptionalString(record.task_id, `payload.local_dispatch.planner_children[${index}].task_id`) ??
    `${envelope.task_id}-${role}-${index + 1}`;
  const dedupeKey =
    asOptionalString(
      record.dedupe_key,
      `payload.local_dispatch.planner_children[${index}].dedupe_key`,
    ) ?? taskId;

  return {
    approved: asOptionalBoolean(
      record.approved,
      `payload.local_dispatch.planner_children[${index}].approved`,
    ),
    dedupeKey,
    input: asOptionalJsonObject(
      record.input,
      `payload.local_dispatch.planner_children[${index}].input`,
    ),
    lineage: buildChildLineage(envelope.task_id, parentLineage, taskContract, workerLimit),
    notes: asOptionalString(
      record.notes,
      `payload.local_dispatch.planner_children[${index}].notes`,
    ),
    result: asOptionalResultObject(
      record.result,
      `payload.local_dispatch.planner_children[${index}].result`,
    ),
    role,
    sleepMs: clampSleepMs(
      asNonNegativeInteger(
        record.sleep_ms,
        `payload.local_dispatch.planner_children[${index}].sleep_ms`,
      ),
    ),
    taskId,
  };
}

function normalizeLocalDispatchSpec(
  envelope: InterbeingTaskEnvelopeV0,
): NormalizedLocalDispatchSpec | null {
  const localDispatchValue = envelope.payload[LOCAL_DISPATCH_KEY];
  if (localDispatchValue == null) {
    return null;
  }

  try {
    const record = asPlainObject(localDispatchValue, `payload.${LOCAL_DISPATCH_KEY}`);
    assertAllowedKeys(record, LOCAL_DISPATCH_ALLOWED_KEYS, `payload.${LOCAL_DISPATCH_KEY}`);

    const role = normalizeResolvedRole(record, `payload.${LOCAL_DISPATCH_KEY}`);
    const taskContract = normalizeTaskContract(record.task_contract);
    const explicitLineage =
      record.lineage == null
        ? null
        : normalizeRootLineage(envelope, role, record.lineage, taskContract);
    const flatLineage = normalizeFlatRootLineage(envelope, role, record, taskContract);
    if (
      explicitLineage != null &&
      flatLineage != null &&
      !lineagesMatch(explicitLineage, flatLineage)
    ) {
      throw new Error(
        `payload.${LOCAL_DISPATCH_KEY}.lineage conflicts with flat local_dispatch lineage fields`,
      );
    }
    const lineage =
      explicitLineage ?? flatLineage ?? normalizeRootLineage(envelope, role, null, taskContract);
    const workerLimit = normalizeWorkerLimit(record.worker_limit);
    const plannerChildren = asOptionalArray(
      record.planner_children,
      `payload.${LOCAL_DISPATCH_KEY}.planner_children`,
    );

    if (role !== "planner" && plannerChildren.length > 0) {
      throw createDispatchInvalidError(
        `payload.${LOCAL_DISPATCH_KEY}.planner_children is only valid for planner role`,
        createBaseReceiptContext({
          lineage,
          role,
          taskContract,
          workerLimit: role === "planner" ? workerLimit : null,
        }),
      );
    }
    if (plannerChildren.length > MAX_PLANNER_CHILDREN) {
      throw createDispatchInvalidError(
        `payload.${LOCAL_DISPATCH_KEY}.planner_children exceeds limit ${MAX_PLANNER_CHILDREN}`,
        createBaseReceiptContext({ lineage, role: "planner", taskContract, workerLimit }),
      );
    }

    return {
      approved: asOptionalBoolean(record.approved, `payload.${LOCAL_DISPATCH_KEY}.approved`),
      input: asOptionalJsonObject(record.input, `payload.${LOCAL_DISPATCH_KEY}.input`),
      lineage,
      notes: asOptionalString(record.notes, `payload.${LOCAL_DISPATCH_KEY}.notes`),
      plannerChildren: plannerChildren.map((entry, index) =>
        normalizePlannerChild(envelope, lineage, taskContract, workerLimit, entry, index),
      ),
      result: asOptionalResultObject(record.result, `payload.${LOCAL_DISPATCH_KEY}.result`),
      role,
      sleepMs: clampSleepMs(
        asNonNegativeInteger(record.sleep_ms, `payload.${LOCAL_DISPATCH_KEY}.sleep_ms`),
      ),
      taskContract,
      workerLimit,
    };
  } catch (error) {
    if (isInterbeingLocalDispatchError(error)) {
      throw error;
    }
    throw createDispatchInvalidError(error instanceof Error ? error.message : String(error));
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextFile(filePath: string, value: string): Promise<void> {
  await writeFile(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function buildDispatchNotes(params: {
  receiptContext?: InterbeingWatcherV0ReceiptLocalDispatch;
  roleLabel: string;
  summary: JsonObject;
  terminalStatus: "failed" | "succeeded";
}): string {
  return [
    "# Local Dali Dispatch",
    "",
    `- role: \`${params.roleLabel}\``,
    `- terminal status: \`${params.terminalStatus}\``,
    params.receiptContext?.lineage == null
      ? "- lineage: none"
      : `- lineage: chain \`${params.receiptContext.lineage.chain_id}\`, hop \`${params.receiptContext.lineage.hop_count}\`, max \`${params.receiptContext.lineage.max_hops ?? "unbounded"}\``,
    params.receiptContext?.worker_pool == null
      ? "- worker pool: none"
      : `- worker pool: limit \`${params.receiptContext.worker_pool.limit}\`, max in flight \`${params.receiptContext.worker_pool.max_in_flight}\``,
    params.receiptContext?.children == null
      ? "- child tasks: none"
      : `- child tasks: total \`${params.receiptContext.children.total}\`, executed \`${params.receiptContext.children.executed}\`, skipped duplicates \`${params.receiptContext.children.skipped_duplicates}\`, failed \`${params.receiptContext.children.failed}\``,
    params.receiptContext?.reviewer_gate == null
      ? "- reviewer gate: none"
      : `- reviewer gate: required \`${params.receiptContext.reviewer_gate.required}\`, approved \`${params.receiptContext.reviewer_gate.approved}\``,
    params.receiptContext?.task_contract == null
      ? "- task contract: none"
      : `- task contract: \`${JSON.stringify(params.receiptContext.task_contract)}\``,
    "",
    "Summary:",
    "```json",
    JSON.stringify(params.summary, null, 2),
    "```",
  ].join("\n");
}

async function persistDispatchArtifacts(params: {
  envelope: InterbeingTaskEnvelopeV0;
  outputDir: string;
  receiptContext?: InterbeingWatcherV0ReceiptLocalDispatch;
  roleLabel: string;
  summary: JsonObject;
  terminalReason?: { code: string; message: string };
  terminalStatus: "failed" | "succeeded";
}): Promise<void> {
  await mkdir(params.outputDir, { recursive: true });
  const summaryPath = path.join(params.outputDir, "dispatch-summary.json");
  const lifecycle = emitLocalTaskLifecycleV0(params.envelope, {
    error:
      params.terminalStatus === "failed"
        ? {
            code: params.terminalReason?.code ?? "task_failed",
            message: params.terminalReason?.message ?? "Local Dali dispatch failed.",
          }
        : null,
    queuedMessage: "Accepted for local Dali dispatch.",
    resultRef:
      params.terminalStatus === "succeeded"
        ? {
            uri: `file://${summaryPath}`,
            content_type: "application/json",
          }
        : null,
    runningMessage: `Running local ${params.roleLabel} dispatch.`,
    terminalMessage:
      params.terminalStatus === "succeeded"
        ? `Local ${params.roleLabel} dispatch completed successfully.`
        : `Local ${params.roleLabel} dispatch failed.`,
    terminalStatus: params.terminalStatus,
  });
  const representativeEvent = lifecycle.events[1] ?? lifecycle.events[0];
  const terminalStatus = lifecycle.statuses[2];
  if (!representativeEvent || !terminalStatus) {
    throw new Error("local dispatch lifecycle did not emit expected artifacts");
  }

  await Promise.all([
    writeJsonFile(path.join(params.outputDir, "input-submit-task.json"), params.envelope),
    writeJsonFile(path.join(params.outputDir, "task-status-queued.json"), lifecycle.statuses[0]),
    writeJsonFile(path.join(params.outputDir, "task-status-running.json"), lifecycle.statuses[1]),
    writeJsonFile(
      path.join(params.outputDir, `task-status-${params.terminalStatus}.json`),
      terminalStatus,
    ),
    writeJsonFile(path.join(params.outputDir, "event-envelope.json"), representativeEvent),
    writeJsonFile(summaryPath, params.summary),
    writeTextFile(
      path.join(params.outputDir, "dispatch-notes.md"),
      buildDispatchNotes({
        receiptContext: params.receiptContext,
        roleLabel: params.roleLabel,
        summary: params.summary,
        terminalStatus: params.terminalStatus,
      }),
    ),
  ]);
}

async function runExecutorRole(params: {
  envelope: InterbeingTaskEnvelopeV0;
  lineage: InterbeingWatcherV0ReceiptLineage;
  taskId: string;
  input: JsonObject;
  result: JsonObject | null;
  sleepMs: number;
}): Promise<JsonObject> {
  if (params.sleepMs > 0) {
    await wait(params.sleepMs);
  }
  return (
    params.result ?? {
      acknowledged: true,
      input: params.input,
      lineage: params.lineage,
      source_task_id: params.envelope.task_id,
      task_id: params.taskId,
    }
  );
}

async function runReviewerRole(params: {
  approved: boolean | null;
  childTaskId: string;
  executorOutputs: LocalDispatchChildSummary[];
  notes: string | null;
  sleepMs: number;
}): Promise<{ approved: boolean; notes: string | null; output: JsonObject }> {
  if (params.sleepMs > 0) {
    await wait(params.sleepMs);
  }
  const approved = params.approved ?? true;
  return {
    approved,
    notes:
      params.notes ??
      (approved
        ? "Reviewer approved the local executor outputs."
        : "Reviewer rejected the local executor outputs."),
    output: {
      approved,
      reviewed_children: params.executorOutputs.length,
      reviewer_task_id: params.childTaskId,
    },
  };
}

async function executePlannerRole(params: {
  envelope: InterbeingTaskEnvelopeV0;
  spec: NormalizedLocalDispatchSpec;
}): Promise<InterbeingLocalDispatchRunResult> {
  const receiptContext = createBaseReceiptContext({
    lineage: params.spec.lineage,
    role: "planner",
    taskContract: params.spec.taskContract,
    workerLimit: params.spec.workerLimit,
  });

  const childSummaries: LocalDispatchChildSummary[] = [];
  const uniqueChildren: NormalizedPlannerChildSpec[] = [];
  const seenKeys = new Set<string>();

  for (const child of params.spec.plannerChildren) {
    if (seenKeys.has(child.dedupeKey)) {
      childSummaries.push({
        approved: child.role === "reviewer" ? (child.approved ?? true) : null,
        dedupe_key: child.dedupeKey,
        lineage: child.lineage,
        notes: child.notes,
        output: null,
        role: child.role,
        status: "skipped_duplicate",
        task_id: child.taskId,
      });
      continue;
    }
    seenKeys.add(child.dedupeKey);
    uniqueChildren.push(child);
  }

  const reviewerChildren = uniqueChildren.filter((child) => child.role === "reviewer");
  if (reviewerChildren.length > MAX_REVIEWER_CHILDREN) {
    throw createDispatchInvalidError(
      `planner role supports at most ${MAX_REVIEWER_CHILDREN} reviewer child`,
      receiptContext,
    );
  }
  const executorChildren = uniqueChildren.filter((child) => child.role === "executor");

  let activeExecutors = 0;
  let maxInFlight = 0;
  const executorTasks = executorChildren.map((child) => async () => {
    activeExecutors += 1;
    maxInFlight = Math.max(maxInFlight, activeExecutors);
    try {
      const output = await runExecutorRole({
        envelope: params.envelope,
        input: child.input,
        lineage: child.lineage,
        result: child.result,
        sleepMs: child.sleepMs,
        taskId: child.taskId,
      });
      return {
        approved: null,
        dedupe_key: child.dedupeKey,
        lineage: child.lineage,
        notes: child.notes,
        output,
        role: child.role,
        status: "succeeded" as const,
        task_id: child.taskId,
      };
    } finally {
      activeExecutors -= 1;
    }
  });

  const executorRun = await runTasksWithConcurrency({
    errorMode: "stop",
    limit: params.spec.workerLimit,
    tasks: executorTasks,
  });
  if (executorRun.hasError) {
    throw executorRun.firstError;
  }
  const executorResults = executorRun.results.filter(
    (result): result is LocalDispatchChildSummary => Boolean(result),
  );
  childSummaries.push(...executorResults);

  let reviewerGate: InterbeingWatcherV0ReceiptLocalDispatch["reviewer_gate"] = null;
  const reviewerChild = reviewerChildren[0];
  if (reviewerChild) {
    const reviewerResult = await runReviewerRole({
      approved: reviewerChild.approved,
      childTaskId: reviewerChild.taskId,
      executorOutputs: executorResults,
      notes: reviewerChild.notes,
      sleepMs: reviewerChild.sleepMs,
    });
    const reviewerSummary: LocalDispatchChildSummary = {
      approved: reviewerResult.approved,
      dedupe_key: reviewerChild.dedupeKey,
      lineage: reviewerChild.lineage,
      notes: reviewerResult.notes,
      output: reviewerResult.output,
      role: "reviewer",
      status: reviewerResult.approved ? "succeeded" : "rejected",
      task_id: reviewerChild.taskId,
    };
    childSummaries.push(reviewerSummary);
    reviewerGate = {
      approved: reviewerResult.approved,
      required: true,
      reviewer_task_id: reviewerChild.taskId,
    };
    if (!reviewerResult.approved) {
      const rejectedContext: InterbeingWatcherV0ReceiptLocalDispatch = {
        ...receiptContext,
        children: {
          executed: childSummaries.filter((child) => child.status !== "skipped_duplicate").length,
          failed: 1,
          skipped_duplicates: childSummaries.filter((child) => child.status === "skipped_duplicate")
            .length,
          total: params.spec.plannerChildren.length,
        },
        reviewer_gate: reviewerGate,
        worker_pool: {
          limit: params.spec.workerLimit,
          max_in_flight: maxInFlight,
        },
      };
      throw new InterbeingLocalDispatchError({
        message: reviewerResult.notes ?? "reviewer rejected local executor outputs",
        reasonCode: "reviewer_rejected",
        receiptContext: rejectedContext,
        summary: {
          child_results: childSummaries,
          correlation_id: params.envelope.correlation_id,
          outcome: "reviewer_rejected",
          role: "planner",
          task_id: params.envelope.task_id,
          worker_pool: rejectedContext.worker_pool,
        },
      });
    }
  }

  const nextReceiptContext: InterbeingWatcherV0ReceiptLocalDispatch = {
    ...receiptContext,
    children: {
      executed: childSummaries.filter((child) => child.status !== "skipped_duplicate").length,
      failed: childSummaries.filter((child) => child.status === "rejected").length,
      skipped_duplicates: childSummaries.filter((child) => child.status === "skipped_duplicate")
        .length,
      total: params.spec.plannerChildren.length,
    },
    reviewer_gate: reviewerGate,
    worker_pool: {
      limit: params.spec.workerLimit,
      max_in_flight: maxInFlight,
    },
  };

  return {
    outputDir: "",
    receiptContext: nextReceiptContext,
    summary: {
      child_results: childSummaries,
      correlation_id: params.envelope.correlation_id,
      outcome: "succeeded",
      role: "planner",
      task_id: params.envelope.task_id,
      worker_pool: nextReceiptContext.worker_pool,
    },
  };
}

async function executeRootRole(params: {
  envelope: InterbeingTaskEnvelopeV0;
  spec: NormalizedLocalDispatchSpec;
}): Promise<InterbeingLocalDispatchRunResult> {
  if (params.spec.role === "planner") {
    return executePlannerRole(params);
  }

  const receiptContext = createBaseReceiptContext({
    lineage: params.spec.lineage,
    role: params.spec.role,
    taskContract: params.spec.taskContract,
  });
  if (params.spec.role === "executor") {
    const output = await runExecutorRole({
      envelope: params.envelope,
      input: params.spec.input,
      lineage: params.spec.lineage,
      result: params.spec.result,
      sleepMs: params.spec.sleepMs,
      taskId: params.envelope.task_id,
    });
    return {
      outputDir: "",
      receiptContext,
      summary: {
        correlation_id: params.envelope.correlation_id,
        outcome: "succeeded",
        output,
        role: "executor",
        task_id: params.envelope.task_id,
      },
    };
  }

  const reviewer = await runReviewerRole({
    approved: params.spec.approved,
    childTaskId: params.envelope.task_id,
    executorOutputs: [],
    notes: params.spec.notes,
    sleepMs: params.spec.sleepMs,
  });
  const reviewerContext: InterbeingWatcherV0ReceiptLocalDispatch = {
    ...receiptContext,
    reviewer_gate: {
      approved: reviewer.approved,
      required: true,
      reviewer_task_id: params.envelope.task_id,
    },
  };
  if (!reviewer.approved) {
    throw new InterbeingLocalDispatchError({
      message: reviewer.notes ?? "reviewer rejected the local task",
      reasonCode: "reviewer_rejected",
      receiptContext: reviewerContext,
      summary: {
        correlation_id: params.envelope.correlation_id,
        outcome: "reviewer_rejected",
        output: reviewer.output,
        role: "reviewer",
        task_id: params.envelope.task_id,
      },
    });
  }
  return {
    outputDir: "",
    receiptContext: reviewerContext,
    summary: {
      correlation_id: params.envelope.correlation_id,
      outcome: "succeeded",
      output: reviewer.output,
      role: "reviewer",
      task_id: params.envelope.task_id,
    },
  };
}

function buildFailureSummary(params: {
  envelope: InterbeingTaskEnvelopeV0;
  error: InterbeingLocalDispatchError;
  roleLabel: string;
}): JsonObject {
  return (
    params.error.summary ?? {
      correlation_id: params.envelope.correlation_id,
      message: params.error.message,
      outcome: "failed",
      reason_code: params.error.reasonCode,
      role: params.roleLabel,
      task_id: params.envelope.task_id,
    }
  );
}

export async function runInterbeingLocalDispatchV0(
  options: InterbeingE2ERunOptions = {},
): Promise<InterbeingLocalDispatchRunResult> {
  if (!options.inputPath) {
    const fallback = await runInterbeingE2ELocalV0(options);
    return {
      outputDir: fallback.outputDir,
      summary: fallback.summary,
    };
  }

  const resolvedInputPath = path.resolve(options.inputPath);
  const resolvedOutputDir = path.resolve(
    options.outputDir ??
      path.join(process.cwd(), "workspace", "audit", "interbeing-local-dispatch-v0"),
  );
  const raw = JSON.parse(await readFile(resolvedInputPath, "utf8")) as unknown;
  const envelope = parseSubmitTaskEnvelopeV0(raw);

  let spec: NormalizedLocalDispatchSpec | null = null;
  try {
    spec = normalizeLocalDispatchSpec(envelope);
    if (!spec) {
      const fallback = await runInterbeingE2ELocalV0(options);
      return {
        outputDir: fallback.outputDir,
        summary: fallback.summary,
      };
    }

    const result = await executeRootRole({ envelope, spec });
    await persistDispatchArtifacts({
      envelope,
      outputDir: resolvedOutputDir,
      receiptContext: result.receiptContext,
      roleLabel: spec.role,
      summary: result.summary,
      terminalStatus: "succeeded",
    });
    return {
      ...result,
      outputDir: resolvedOutputDir,
    };
  } catch (error) {
    if (!isInterbeingLocalDispatchError(error)) {
      throw error;
    }
    const roleLabel = spec?.role ?? "dispatch";
    await persistDispatchArtifacts({
      envelope,
      outputDir: resolvedOutputDir,
      receiptContext: error.receiptContext,
      roleLabel,
      summary: buildFailureSummary({ envelope, error, roleLabel }),
      terminalReason: {
        code: error.reasonCode,
        message: error.message,
      },
      terminalStatus: "failed",
    });
    throw error;
  }
}

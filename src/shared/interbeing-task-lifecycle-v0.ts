import { randomUUID } from "node:crypto";

const DEFAULT_NODE_ID = "dali";
const SCHEMA_VERSION_V0 = "v0";
const SUBMIT_TASK_OPERATION_V0 = "submit_task";
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SUBMIT_TASK_ENVELOPE_KEYS = [
  "schema_version",
  "operation",
  "task_id",
  "requestor",
  "target_node",
  "correlation_id",
  "created_at",
  "payload",
] as const;
const RESULT_REF_KEYS = ["uri", "content_type", "expires_at"] as const;
const ERROR_KEYS = ["code", "message", "retryable"] as const;
const TASK_STATUS_VALUES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

type JsonObject = Record<string, unknown>;

export type InterbeingTaskStatusKindV0 = (typeof TASK_STATUS_VALUES)[number];

export type InterbeingTaskEnvelopeV0 = {
  schema_version: "v0";
  operation: "submit_task";
  task_id: string;
  requestor: string;
  target_node: string;
  correlation_id: string;
  created_at: string;
  payload: JsonObject;
};

export type InterbeingResultRefV0 = {
  uri: string;
  content_type?: string;
  expires_at?: string;
};

export type InterbeingTaskErrorV0 = {
  code: string;
  message?: string;
  retryable?: boolean;
};

export type InterbeingTaskStatusV0 = {
  schema_version: "v0";
  task_id: string;
  node_id: string;
  status: InterbeingTaskStatusKindV0;
  updated_at: string;
  progress_message: string | null;
  result_ref: InterbeingResultRefV0 | null;
  error: InterbeingTaskErrorV0 | null;
};

export type InterbeingEventEnvelopeV0 = {
  schema_version: "v0";
  event_id: string;
  event_type: string;
  node_id: string;
  correlation_id: string;
  timestamp: string;
  payload: JsonObject;
};

export type ParseSubmitTaskEnvelopeV0Options = {
  allowTargetMismatch?: boolean;
  nodeId?: string;
};

export type CreateTaskStatusV0Params = {
  error?: InterbeingTaskErrorV0 | null;
  nodeId?: string;
  progressMessage?: string | null;
  resultRef?: InterbeingResultRefV0 | null;
  status: InterbeingTaskStatusKindV0;
  taskId: string;
  updatedAt?: string;
};

export type CreateEventEnvelopeV0Params = {
  correlationId: string;
  eventId?: string;
  eventType: string;
  nodeId?: string;
  payload: JsonObject;
  timestamp?: string;
};

export type EmitLocalTaskLifecycleV0Options = {
  createEventId?: () => string;
  error?: InterbeingTaskErrorV0 | null;
  nodeId?: string;
  now?: () => string;
  queuedMessage?: string | null;
  resultRef?: InterbeingResultRefV0 | null;
  runningMessage?: string | null;
  terminalMessage?: string | null;
  terminalStatus?: Extract<InterbeingTaskStatusKindV0, "succeeded" | "failed">;
};

export type LocalTaskLifecycleEmissionV0 = {
  envelope: InterbeingTaskEnvelopeV0;
  events: InterbeingEventEnvelopeV0[];
  statuses: InterbeingTaskStatusV0[];
};

function assertAllowedKeys(value: JsonObject, allowedKeys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} has unexpected property "${key}"`);
    }
  }
}

function assertDateTimeString(value: string, label: string): string {
  if (!ISO_DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO 8601 date-time string`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeNodeId(value: string | undefined): string {
  return assertNonEmptyString(value ?? DEFAULT_NODE_ID, "node_id");
}

function normalizePlainObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function normalizeNullableString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }
  return assertNonEmptyString(value, label);
}

function normalizeResultRef(
  value: InterbeingResultRefV0 | null | undefined,
): InterbeingResultRefV0 | null {
  if (value == null) {
    return null;
  }
  const record = normalizePlainObject(value, "result_ref");
  assertAllowedKeys(record, RESULT_REF_KEYS, "result_ref");
  const expiresAt = record.expires_at;
  return {
    uri: assertNonEmptyString(record.uri, "result_ref.uri"),
    ...(record.content_type == null
      ? {}
      : { content_type: assertNonEmptyString(record.content_type, "result_ref.content_type") }),
    ...(expiresAt == null
      ? {}
      : {
          expires_at: assertDateTimeString(
            assertNonEmptyString(expiresAt, "result_ref.expires_at"),
            "result_ref.expires_at",
          ),
        }),
  };
}

function normalizeTaskError(
  value: InterbeingTaskErrorV0 | null | undefined,
): InterbeingTaskErrorV0 | null {
  if (value == null) {
    return null;
  }
  const record = normalizePlainObject(value, "error");
  assertAllowedKeys(record, ERROR_KEYS, "error");
  return {
    code: assertNonEmptyString(record.code, "error.code"),
    ...(record.message == null
      ? {}
      : { message: assertNonEmptyString(record.message, "error.message") }),
    ...(record.retryable == null
      ? {}
      : {
          retryable:
            typeof record.retryable === "boolean"
              ? record.retryable
              : (() => {
                  throw new Error("error.retryable must be a boolean");
                })(),
        }),
  };
}

function normalizeTaskStatus(value: unknown): InterbeingTaskStatusKindV0 {
  const status = assertNonEmptyString(value, "status");
  if (!TASK_STATUS_VALUES.includes(status as InterbeingTaskStatusKindV0)) {
    throw new Error(`status must be one of ${TASK_STATUS_VALUES.join(", ")}`);
  }
  return status as InterbeingTaskStatusKindV0;
}

function nextTimestamp(now?: () => string): string {
  const timestamp = now ? now() : new Date().toISOString();
  return assertDateTimeString(timestamp, "timestamp");
}

function nextEventId(createEventId?: () => string): string {
  const eventId = createEventId ? createEventId() : `evt-${randomUUID()}`;
  return assertNonEmptyString(eventId, "event_id");
}

export function parseSubmitTaskEnvelopeV0(
  value: unknown,
  options: ParseSubmitTaskEnvelopeV0Options = {},
): InterbeingTaskEnvelopeV0 {
  const nodeId = normalizeNodeId(options.nodeId);
  const record = normalizePlainObject(value, "submit_task envelope");
  assertAllowedKeys(record, SUBMIT_TASK_ENVELOPE_KEYS, "submit_task envelope");

  const envelope: InterbeingTaskEnvelopeV0 = {
    schema_version:
      assertNonEmptyString(record.schema_version, "schema_version") === SCHEMA_VERSION_V0
        ? SCHEMA_VERSION_V0
        : (() => {
            throw new Error(`schema_version must be "${SCHEMA_VERSION_V0}"`);
          })(),
    operation:
      assertNonEmptyString(record.operation, "operation") === SUBMIT_TASK_OPERATION_V0
        ? SUBMIT_TASK_OPERATION_V0
        : (() => {
            throw new Error(`operation must be "${SUBMIT_TASK_OPERATION_V0}"`);
          })(),
    task_id: assertNonEmptyString(record.task_id, "task_id"),
    requestor: assertNonEmptyString(record.requestor, "requestor"),
    target_node: assertNonEmptyString(record.target_node, "target_node"),
    correlation_id: assertNonEmptyString(record.correlation_id, "correlation_id"),
    created_at: assertDateTimeString(
      assertNonEmptyString(record.created_at, "created_at"),
      "created_at",
    ),
    payload: normalizePlainObject(record.payload, "payload"),
  };

  if (!options.allowTargetMismatch && envelope.target_node !== nodeId) {
    throw new Error(`submit_task target_node must match "${nodeId}"`);
  }

  return envelope;
}

export function createTaskStatusV0(params: CreateTaskStatusV0Params): InterbeingTaskStatusV0 {
  return {
    schema_version: SCHEMA_VERSION_V0,
    task_id: assertNonEmptyString(params.taskId, "task_id"),
    node_id: normalizeNodeId(params.nodeId),
    status: normalizeTaskStatus(params.status),
    updated_at: params.updatedAt
      ? assertDateTimeString(assertNonEmptyString(params.updatedAt, "updated_at"), "updated_at")
      : new Date().toISOString(),
    progress_message: normalizeNullableString(params.progressMessage, "progress_message"),
    result_ref: normalizeResultRef(params.resultRef),
    error: normalizeTaskError(params.error),
  };
}

export function createEventEnvelopeV0(
  params: CreateEventEnvelopeV0Params,
): InterbeingEventEnvelopeV0 {
  return {
    schema_version: SCHEMA_VERSION_V0,
    event_id: params.eventId
      ? assertNonEmptyString(params.eventId, "event_id")
      : `evt-${randomUUID()}`,
    event_type: assertNonEmptyString(params.eventType, "event_type"),
    node_id: normalizeNodeId(params.nodeId),
    correlation_id: assertNonEmptyString(params.correlationId, "correlation_id"),
    timestamp: params.timestamp
      ? assertDateTimeString(assertNonEmptyString(params.timestamp, "timestamp"), "timestamp")
      : new Date().toISOString(),
    payload: normalizePlainObject(params.payload, "payload"),
  };
}

function createLifecycleEventPayload(params: {
  envelope: InterbeingTaskEnvelopeV0;
  message: string | null;
  resultRef?: InterbeingResultRefV0 | null;
  status: InterbeingTaskStatusKindV0;
  error?: InterbeingTaskErrorV0 | null;
}): JsonObject {
  return {
    task_id: params.envelope.task_id,
    requestor: params.envelope.requestor,
    target_node: params.envelope.target_node,
    status: params.status,
    ...(params.message == null ? {} : { message: params.message }),
    ...(params.resultRef == null ? {} : { result_ref: params.resultRef }),
    ...(params.error == null ? {} : { error: params.error }),
  };
}

// Keep the first adapter intentionally in-memory so Dali can emit shared shapes
// without pulling transport, auth, or runtime orchestration into this pass.
export function emitLocalTaskLifecycleV0(
  value: unknown,
  options: EmitLocalTaskLifecycleV0Options = {},
): LocalTaskLifecycleEmissionV0 {
  const nodeId = normalizeNodeId(options.nodeId);
  const envelope = parseSubmitTaskEnvelopeV0(value, { nodeId });
  const terminalStatus = options.terminalStatus ?? "succeeded";
  const terminalError =
    terminalStatus === "failed"
      ? normalizeTaskError(options.error ?? { code: "task_failed", message: "Dali task failed." })
      : null;
  const queuedMessage = options.queuedMessage ?? "Accepted for local Dali processing.";
  const runningMessage = options.runningMessage ?? "Running task locally.";
  const terminalMessage =
    options.terminalMessage ??
    (terminalStatus === "succeeded" ? "Task completed successfully." : "Task failed.");
  const resultRef = terminalStatus === "succeeded" ? normalizeResultRef(options.resultRef) : null;

  const queuedAt = nextTimestamp(options.now);
  const runningAt = nextTimestamp(options.now);
  const terminalAt = nextTimestamp(options.now);

  const statuses = [
    createTaskStatusV0({
      nodeId,
      progressMessage: queuedMessage,
      status: "queued",
      taskId: envelope.task_id,
      updatedAt: queuedAt,
    }),
    createTaskStatusV0({
      nodeId,
      progressMessage: runningMessage,
      status: "running",
      taskId: envelope.task_id,
      updatedAt: runningAt,
    }),
    createTaskStatusV0({
      error: terminalError,
      nodeId,
      progressMessage: terminalMessage,
      resultRef,
      status: terminalStatus,
      taskId: envelope.task_id,
      updatedAt: terminalAt,
    }),
  ];

  const events = [
    createEventEnvelopeV0({
      correlationId: envelope.correlation_id,
      eventId: nextEventId(options.createEventId),
      eventType: "task.queued",
      nodeId,
      payload: createLifecycleEventPayload({
        envelope,
        message: queuedMessage,
        status: "queued",
      }),
      timestamp: queuedAt,
    }),
    createEventEnvelopeV0({
      correlationId: envelope.correlation_id,
      eventId: nextEventId(options.createEventId),
      eventType: "task.running",
      nodeId,
      payload: createLifecycleEventPayload({
        envelope,
        message: runningMessage,
        status: "running",
      }),
      timestamp: runningAt,
    }),
    createEventEnvelopeV0({
      correlationId: envelope.correlation_id,
      eventId: nextEventId(options.createEventId),
      eventType: `task.${terminalStatus}`,
      nodeId,
      payload: createLifecycleEventPayload({
        envelope,
        error: terminalError,
        message: terminalMessage,
        resultRef,
        status: terminalStatus,
      }),
      timestamp: terminalAt,
    }),
  ];

  return { envelope, statuses, events };
}

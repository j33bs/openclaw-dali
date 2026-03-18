import AjvPkg from "ajv";
import { describe, expect, it } from "vitest";
import {
  createEventEnvelopeV0,
  createTaskStatusV0,
  emitLocalTaskLifecycleV0,
  parseSubmitTaskEnvelopeV0,
} from "./interbeing-task-lifecycle-v0.js";

const Ajv = AjvPkg as unknown as typeof AjvPkg;
const ajv = new Ajv({ allErrors: true, strict: false });

ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
});

const taskEnvelopeSchemaV0 = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "operation",
    "task_id",
    "requestor",
    "target_node",
    "correlation_id",
    "created_at",
    "payload",
  ],
  properties: {
    schema_version: { const: "v0" },
    operation: { type: "string", enum: ["submit_task"] },
    task_id: { type: "string", minLength: 1 },
    requestor: { type: "string", minLength: 1 },
    target_node: { type: "string", minLength: 1 },
    correlation_id: { type: "string", minLength: 1 },
    created_at: { type: "string", format: "date-time" },
    payload: { type: "object" },
  },
} as const;

const taskStatusSchemaV0 = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "task_id",
    "node_id",
    "status",
    "updated_at",
    "progress_message",
    "result_ref",
    "error",
  ],
  properties: {
    schema_version: { const: "v0" },
    task_id: { type: "string", minLength: 1 },
    node_id: { type: "string", minLength: 1 },
    status: {
      type: "string",
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    },
    updated_at: { type: "string", format: "date-time" },
    progress_message: { type: ["string", "null"] },
    result_ref: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["uri"],
      properties: {
        uri: { type: "string", minLength: 1 },
        content_type: { type: "string", minLength: 1 },
        expires_at: { type: "string", format: "date-time" },
      },
    },
    error: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["code"],
      properties: {
        code: { type: "string", minLength: 1 },
        message: { type: "string" },
        retryable: { type: "boolean" },
      },
    },
  },
} as const;

const eventEnvelopeSchemaV0 = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "event_id",
    "event_type",
    "node_id",
    "correlation_id",
    "timestamp",
    "payload",
  ],
  properties: {
    schema_version: { const: "v0" },
    event_id: { type: "string", minLength: 1 },
    event_type: { type: "string", minLength: 1 },
    node_id: { type: "string", minLength: 1 },
    correlation_id: { type: "string", minLength: 1 },
    timestamp: { type: "string", format: "date-time" },
    payload: { type: "object" },
  },
} as const;

const validateTaskEnvelope = ajv.compile(taskEnvelopeSchemaV0);
const validateTaskStatus = ajv.compile(taskStatusSchemaV0);
const validateEventEnvelope = ajv.compile(eventEnvelopeSchemaV0);

function expectSchemaMatch(validate: typeof validateTaskEnvelope, value: unknown): void {
  const ok = validate(value);
  expect(ok, JSON.stringify(validate.errors)).toBe(true);
}

describe("shared/interbeing-task-lifecycle-v0", () => {
  it("parses submit_task envelopes and enforces the local Dali target", () => {
    const envelope = parseSubmitTaskEnvelopeV0({
      schema_version: "v0",
      operation: "submit_task",
      task_id: "task-001",
      requestor: "c_lawd",
      target_node: "dali",
      correlation_id: "corr-001",
      created_at: "2026-03-18T09:00:00Z",
      payload: {
        intent: "synthesize",
      },
    });

    expect(envelope.target_node).toBe("dali");
    expectSchemaMatch(validateTaskEnvelope, envelope);
    expect(() =>
      parseSubmitTaskEnvelopeV0({
        ...envelope,
        target_node: "other-node",
      }),
    ).toThrow(/target_node/);
    expect(() =>
      parseSubmitTaskEnvelopeV0({
        ...envelope,
        unexpected: true,
      }),
    ).toThrow(/unexpected property/);
  });

  it("builds task-status and event-envelope payloads that serialize cleanly", () => {
    const status = createTaskStatusV0({
      taskId: "task-002",
      status: "running",
      progressMessage: "Accepted and processing task payload.",
      updatedAt: "2026-03-18T09:02:00Z",
    });
    const event = createEventEnvelopeV0({
      correlationId: "corr-002",
      eventId: "evt-002",
      eventType: "task.progress",
      timestamp: "2026-03-18T09:03:00Z",
      payload: {
        task_id: "task-002",
        message: "Synthesis pass has started.",
      },
    });

    expectSchemaMatch(validateTaskStatus, status);
    expectSchemaMatch(validateEventEnvelope, event);
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  it("emits a minimal queued-running-terminal lifecycle for local smoke use", () => {
    const timestamps = ["2026-03-18T09:00:00Z", "2026-03-18T09:00:01Z", "2026-03-18T09:00:02Z"];
    const eventIds = ["evt-queued", "evt-running", "evt-succeeded"];
    const lifecycle = emitLocalTaskLifecycleV0(
      {
        schema_version: "v0",
        operation: "submit_task",
        task_id: "task-003",
        requestor: "c_lawd",
        target_node: "dali",
        correlation_id: "corr-003",
        created_at: "2026-03-18T08:59:59Z",
        payload: {
          intent: "summarize",
          topic: "merge readiness",
        },
      },
      {
        createEventId: () => eventIds.shift() ?? "evt-fallback",
        now: () => timestamps.shift() ?? "2026-03-18T09:00:03Z",
        resultRef: {
          uri: "file:///tmp/dali/task-003/result.json",
          content_type: "application/json",
        },
      },
    );

    expect(lifecycle.statuses.map((entry) => entry.status)).toEqual([
      "queued",
      "running",
      "succeeded",
    ]);
    expect(lifecycle.events.map((entry) => entry.event_type)).toEqual([
      "task.queued",
      "task.running",
      "task.succeeded",
    ]);
    expect(lifecycle.events[2]?.payload).toEqual({
      task_id: "task-003",
      requestor: "c_lawd",
      target_node: "dali",
      status: "succeeded",
      message: "Task completed successfully.",
      result_ref: {
        uri: "file:///tmp/dali/task-003/result.json",
        content_type: "application/json",
      },
    });
    for (const status of lifecycle.statuses) {
      expectSchemaMatch(validateTaskStatus, status);
    }
    for (const event of lifecycle.events) {
      expectSchemaMatch(validateEventEnvelope, event);
    }
  });
});

import type { ValidateFunction } from "ajv";
import Ajv2020Pkg from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import eventEnvelopeSchemaV0 from "../../schemas/event-envelope.v0.json" with { type: "json" };
import taskEnvelopeSchemaV0 from "../../schemas/task-envelope.v0.json" with { type: "json" };
import taskStatusSchemaV0 from "../../schemas/task-status.v0.json" with { type: "json" };
import {
  createEventEnvelopeV0,
  createTaskStatusV0,
  emitLocalTaskLifecycleV0,
  parseSubmitTaskEnvelopeV0,
} from "./interbeing-task-lifecycle-v0.js";

const Ajv = Ajv2020Pkg as unknown as typeof Ajv2020Pkg;
const ajv = new Ajv({ allErrors: true, strict: false });

ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
});

const validateTaskEnvelope = ajv.compile(taskEnvelopeSchemaV0);
const validateTaskStatus = ajv.compile(taskStatusSchemaV0);
const validateEventEnvelope = ajv.compile(eventEnvelopeSchemaV0);

function expectSchemaMatch(validate: ValidateFunction, value: unknown): void {
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

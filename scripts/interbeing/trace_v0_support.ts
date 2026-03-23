import type { InterbeingTaskEnvelopeV0 } from "../../src/shared/interbeing-task-lifecycle-v0.ts";

type JsonObject = Record<string, unknown>;

export const INTERBEING_META_KEY = "_interbeing";

export type InterbeingTraceMetadata = {
  emitted_at?: string;
  emitter?: string;
  trace_id: string;
};

function asPlainObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function normalizeTraceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function extractInterbeingTraceMetadata(
  payload: JsonObject,
): InterbeingTraceMetadata | null {
  const record = asPlainObject(payload[INTERBEING_META_KEY]);
  const traceId = normalizeTraceId(record?.trace_id);
  if (traceId == null) {
    return null;
  }
  const emittedAt =
    typeof record?.emitted_at === "string" && record.emitted_at.trim().length > 0
      ? record.emitted_at.trim()
      : undefined;
  const emitter =
    typeof record?.emitter === "string" && record.emitter.trim().length > 0
      ? record.emitter.trim()
      : undefined;
  return {
    ...(emittedAt == null ? {} : { emitted_at: emittedAt }),
    ...(emitter == null ? {} : { emitter }),
    trace_id: traceId,
  };
}

export function resolveInterbeingTraceId(
  envelope: Pick<InterbeingTaskEnvelopeV0, "correlation_id" | "payload">,
): string {
  return extractInterbeingTraceMetadata(envelope.payload)?.trace_id ?? envelope.correlation_id;
}

export function withInterbeingTraceMetadata(
  envelope: InterbeingTaskEnvelopeV0,
  params: { emitter: string; traceId?: string },
): { envelope: InterbeingTaskEnvelopeV0; traceId: string } {
  const existingMeta = asPlainObject(envelope.payload[INTERBEING_META_KEY]) ?? {};
  const traceId =
    normalizeTraceId(params.traceId) ??
    normalizeTraceId(existingMeta.trace_id) ??
    normalizeTraceId(envelope.correlation_id) ??
    "trace-missing";
  const nextMeta: InterbeingTraceMetadata = {
    emitter:
      typeof existingMeta.emitter === "string" && existingMeta.emitter.trim().length > 0
        ? existingMeta.emitter.trim()
        : params.emitter,
    trace_id: traceId,
  };
  return {
    traceId,
    envelope: {
      ...envelope,
      payload: {
        ...envelope.payload,
        [INTERBEING_META_KEY]: nextMeta,
      },
    },
  };
}

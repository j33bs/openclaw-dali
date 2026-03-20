import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ValidateFunction } from "ajv";
import Ajv2020Pkg from "ajv/dist/2020";
import {
  emitLocalTaskLifecycleV0,
  parseSubmitTaskEnvelopeV0,
  type InterbeingEventEnvelopeV0,
  type InterbeingTaskEnvelopeV0,
  type InterbeingTaskStatusV0,
  type LocalTaskLifecycleEmissionV0,
} from "../../src/shared/interbeing-task-lifecycle-v0.ts";
import { DEFAULT_INTERBEING_DIR } from "../interbeing/interbeing_paths.ts";

type JsonObject = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;

export const DEFAULT_OUTPUT_DIR = path.join(
  process.cwd(),
  "workspace",
  "audit",
  "_evidence",
  "interbeing-e2e-local-v0",
);
export const DEFAULT_HANDOFF_FIXTURE_PATH = path.join(
  process.cwd(),
  "scripts",
  "dev",
  "fixtures",
  "interbeing-handoff-task-envelope.v0.json",
);
export const RERUN_COMMAND = "corepack pnpm exec tsx scripts/dev/interbeing-e2e-local-v0.ts";

export type InterbeingE2EInputMode = "handoff-file" | "inline-default";

export type InterbeingE2EValidationSummary = {
  eventEnvelope: "direct_schema";
  inputSubmitTask: "direct_schema";
  taskStatuses: "direct_schema";
};

export type InterbeingE2ELoadedInput = {
  inputEnvelope: InterbeingTaskEnvelopeV0;
  inputMode: InterbeingE2EInputMode;
  inputSource: string;
};

export type InterbeingE2ERunOptions = {
  inputPath?: string;
  interbeingDir?: string;
  outputDir?: string;
};

export type InterbeingE2ERunResult = {
  lifecycle: LocalTaskLifecycleEmissionV0;
  outputDir: string;
  parsedEnvelope: InterbeingTaskEnvelopeV0;
  representativeEvent: InterbeingEventEnvelopeV0;
  summary: JsonObject;
  validation: InterbeingE2EValidationSummary;
};

type SchemaValidators = {
  validateEventEnvelope: ValidateFunction;
  validateTaskEnvelope: ValidateFunction;
  validateTaskStatus: ValidateFunction;
};

function parseArgs(argv: string[]): InterbeingE2ERunOptions {
  const getFlag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index < 0) {
      return undefined;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    return value;
  };

  return {
    inputPath: getFlag("--input"),
    interbeingDir: getFlag("--interbeing-dir"),
    outputDir: getFlag("--out-dir"),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextFile(filePath: string, value: string): Promise<void> {
  await writeFile(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function createDefaultEnvelope(): InterbeingTaskEnvelopeV0 {
  return {
    schema_version: "v0",
    operation: "submit_task",
    task_id: "task-local-e2e-001",
    requestor: "c_lawd",
    target_node: "dali",
    correlation_id: "corr-local-e2e-001",
    created_at: "2026-03-18T09:00:00Z",
    payload: {
      intent: "summarize",
      topic: "interbeing local e2e harness",
      priority: "normal",
    },
  };
}

function createDeterministicTimestampSource(): () => string {
  const timestamps = ["2026-03-18T09:00:01Z", "2026-03-18T09:00:02Z", "2026-03-18T09:00:03Z"];
  let index = 0;
  return () => timestamps[index++] ?? "2026-03-18T09:00:04Z";
}

function createDeterministicEventIdSource(): () => string {
  const ids = [
    "evt-local-e2e-queued-001",
    "evt-local-e2e-running-001",
    "evt-local-e2e-succeeded-001",
  ];
  let index = 0;
  return () => ids[index++] ?? `evt-local-e2e-fallback-${index}`;
}

async function loadSchemaValidators(interbeingDir: string): Promise<SchemaValidators> {
  const Ajv2020 = Ajv2020Pkg as unknown as typeof Ajv2020Pkg;
  const ajv = new Ajv2020({ allErrors: true, strict: false });

  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !Number.isNaN(Date.parse(value)),
  });

  const [taskEnvelopeSchema, taskStatusSchema, eventEnvelopeSchema] = await Promise.all([
    readJsonFile<JsonSchema>(path.join(interbeingDir, "schemas", "task-envelope.v0.json")),
    readJsonFile<JsonSchema>(path.join(interbeingDir, "schemas", "task-status.v0.json")),
    readJsonFile<JsonSchema>(path.join(interbeingDir, "schemas", "event-envelope.v0.json")),
  ]);

  return {
    validateTaskEnvelope: ajv.compile(taskEnvelopeSchema),
    validateTaskStatus: ajv.compile(taskStatusSchema),
    validateEventEnvelope: ajv.compile(eventEnvelopeSchema),
  };
}

function assertSchemaMatch(label: string, validate: ValidateFunction, value: unknown): void {
  if (validate(value)) {
    return;
  }
  throw new Error(`${label} failed schema validation: ${JSON.stringify(validate.errors)}`);
}

async function loadInputEnvelope(
  params: Required<Pick<InterbeingE2ERunOptions, "inputPath">>,
): Promise<InterbeingE2ELoadedInput> {
  if (!params.inputPath) {
    return {
      inputEnvelope: createDefaultEnvelope(),
      inputMode: "inline-default",
      inputSource: "inline default submit_task envelope",
    };
  }

  const resolvedInputPath = path.resolve(params.inputPath);
  const raw = await readJsonFile<unknown>(resolvedInputPath);
  return {
    inputEnvelope: parseSubmitTaskEnvelopeV0(raw),
    inputMode: "handoff-file",
    inputSource: path.relative(process.cwd(), resolvedInputPath) || resolvedInputPath,
  };
}

function pickRepresentativeEvent(events: InterbeingEventEnvelopeV0[]): InterbeingEventEnvelopeV0 {
  const runningEvent = events.find((event) => event.event_type === "task.running");
  if (runningEvent) {
    return runningEvent;
  }
  const firstEvent = events[0];
  if (!firstEvent) {
    throw new Error("local lifecycle did not emit any events");
  }
  return firstEvent;
}

function buildNotes(params: {
  inputMode: InterbeingE2EInputMode;
  inputSource: string;
  interbeingDir: string;
  outputDir: string;
  representativeEvent: InterbeingEventEnvelopeV0;
  statuses: InterbeingTaskStatusV0[];
  validation: InterbeingE2EValidationSummary;
}): string {
  const statusFlow = params.statuses.map((entry) => entry.status).join(" -> ");
  return [
    "# Local Interbeing v0 E2E",
    "",
    "Scope:",
    "- local-only submit_task ingestion and lifecycle emission",
    "- no transport",
    "- no auth/signing",
    "- no broad runtime integration",
    "",
    "Entrypoint:",
    `- \`${RERUN_COMMAND}\``,
    `- file-input rerun: \`${RERUN_COMMAND} --input ${path.relative(process.cwd(), DEFAULT_HANDOFF_FIXTURE_PATH) || DEFAULT_HANDOFF_FIXTURE_PATH}\``,
    `- input mode: \`${params.inputMode}\``,
    `- input source: \`${params.inputSource}\``,
    `- interbeing schema source: \`${params.interbeingDir}\``,
    `- artifact directory: \`${params.outputDir}\``,
    "",
    "Lifecycle emitted:",
    `- task-status flow: \`${statusFlow}\``,
    `- representative event persisted: \`${params.representativeEvent.event_type}\``,
    "- the adapter also emitted queued and succeeded events in memory during the run",
    "",
    "Validation:",
    `- input-submit-task.json: ${params.validation.inputSubmitTask}`,
    `- task-status-*.json: ${params.validation.taskStatuses}`,
    `- event-envelope.json: ${params.validation.eventEnvelope}`,
    "",
    "Limitations:",
    "- `event-envelope.json` stores one representative running event even though the in-memory flow emits multiple events",
    "- bootstrap resolution, transport wiring, and shared auth remain deferred",
  ].join("\n");
}

export async function runInterbeingE2ELocalV0(
  options: InterbeingE2ERunOptions = {},
): Promise<InterbeingE2ERunResult> {
  const interbeingDir = path.resolve(options.interbeingDir ?? DEFAULT_INTERBEING_DIR);
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });

  const loadedInput = await loadInputEnvelope({ inputPath: options.inputPath });
  const parsedEnvelope = parseSubmitTaskEnvelopeV0(loadedInput.inputEnvelope);
  const lifecycle = emitLocalTaskLifecycleV0(parsedEnvelope, {
    createEventId: createDeterministicEventIdSource(),
    now: createDeterministicTimestampSource(),
    queuedMessage: "Accepted for local Dali execution.",
    runningMessage: "Running local interbeing v0 harness.",
    terminalMessage: "Local interbeing v0 harness completed successfully.",
  });
  const representativeEvent = pickRepresentativeEvent(lifecycle.events);
  const validators = await loadSchemaValidators(interbeingDir);

  assertSchemaMatch("submit_task envelope", validators.validateTaskEnvelope, parsedEnvelope);
  for (const status of lifecycle.statuses) {
    assertSchemaMatch(`task status (${status.status})`, validators.validateTaskStatus, status);
  }
  assertSchemaMatch(
    `event envelope (${representativeEvent.event_type})`,
    validators.validateEventEnvelope,
    representativeEvent,
  );

  const [queuedStatus, runningStatus, succeededStatus] = lifecycle.statuses;
  if (!queuedStatus || !runningStatus || !succeededStatus) {
    throw new Error("local lifecycle did not emit queued, running, and succeeded statuses");
  }

  const validation: InterbeingE2EValidationSummary = {
    inputSubmitTask: "direct_schema",
    taskStatuses: "direct_schema",
    eventEnvelope: "direct_schema",
  };

  await Promise.all([
    writeJsonFile(path.join(outputDir, "input-submit-task.json"), parsedEnvelope),
    writeJsonFile(path.join(outputDir, "task-status-queued.json"), queuedStatus),
    writeJsonFile(path.join(outputDir, "task-status-running.json"), runningStatus),
    writeJsonFile(path.join(outputDir, "task-status-succeeded.json"), succeededStatus),
    writeJsonFile(path.join(outputDir, "event-envelope.json"), representativeEvent),
    writeTextFile(
      path.join(outputDir, "e2e-notes.md"),
      buildNotes({
        inputMode: loadedInput.inputMode,
        inputSource: loadedInput.inputSource,
        interbeingDir,
        outputDir,
        representativeEvent,
        statuses: lifecycle.statuses,
        validation,
      }),
    ),
  ]);

  const summary: JsonObject = {
    artifactDir: path.relative(process.cwd(), outputDir),
    eventType: representativeEvent.event_type,
    inputMode: loadedInput.inputMode,
    inputSource: loadedInput.inputSource,
    statusFlow: lifecycle.statuses.map((entry) => entry.status),
    validation,
  };

  return {
    lifecycle,
    outputDir,
    parsedEnvelope,
    representativeEvent,
    summary,
    validation,
  };
}

async function main(): Promise<void> {
  const result = await runInterbeingE2ELocalV0(parseArgs(process.argv.slice(2)));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result.summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}

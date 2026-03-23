import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  emitInterbeingTaskV0,
  listInterbeingEmitterV0,
  listInterbeingEmitterV0LogEntries,
  resolveInterbeingEmitterV0Paths,
  verifyInterbeingEmitterV0,
} from "./emitter_v0_support.ts";

type Command = "emit" | "list" | "logs" | "status" | "verify";

type EmitArgs = {
  deliverDir?: string;
  filename?: string;
  payloadFile?: string;
  payloadJson?: string;
  requestor?: string;
  targetNode?: string;
  taskId?: string;
  correlationId?: string;
  createdAt?: string;
  allowDuplicate?: boolean;
  traceId?: string;
};

function parseFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function loadPayload(args: EmitArgs): Promise<Record<string, unknown>> {
  if (args.payloadJson) {
    return JSON.parse(args.payloadJson) as Record<string, unknown>;
  }
  if (args.payloadFile) {
    return JSON.parse(await readFile(path.resolve(args.payloadFile), "utf8")) as Record<
      string,
      unknown
    >;
  }
  return {};
}

async function runEmit(argv: string[]): Promise<void> {
  const args: EmitArgs = {
    allowDuplicate: hasFlag(argv, "--allow-duplicate"),
    correlationId: parseFlag(argv, "--correlation-id"),
    createdAt: parseFlag(argv, "--created-at"),
    deliverDir: parseFlag(argv, "--deliver-dir"),
    filename: parseFlag(argv, "--filename"),
    payloadFile: parseFlag(argv, "--payload-file"),
    payloadJson: parseFlag(argv, "--payload-json"),
    requestor: parseFlag(argv, "--requestor"),
    targetNode: parseFlag(argv, "--target-node"),
    taskId: parseFlag(argv, "--task-id"),
    traceId: parseFlag(argv, "--trace-id"),
  };

  const envelope = {
    schema_version: "v0",
    operation: "submit_task",
    task_id: requireValue(args.taskId, "--task-id"),
    requestor: requireValue(args.requestor, "--requestor"),
    target_node: requireValue(args.targetNode, "--target-node"),
    correlation_id: requireValue(args.correlationId, "--correlation-id"),
    created_at: args.createdAt ?? new Date().toISOString(),
    payload: await loadPayload(args),
  };

  const result = await emitInterbeingTaskV0(envelope, {
    allowDuplicate: args.allowDuplicate,
    deliverDir: args.deliverDir,
    filename: args.filename,
    traceId: args.traceId,
  });
  console.log(
    JSON.stringify(
      {
        delivery_receipt: result.deliveryReceipt,
        duplicate: result.duplicate,
        delivered_to: result.deliveredTo,
        filename: result.filename,
        queue_path: result.queuePath,
        receipt_path: result.receiptPath,
        sha256: result.sha256,
        target_node: result.envelope.target_node,
        task_id: result.envelope.task_id,
        trace_id: result.traceId,
      },
      null,
      2,
    ),
  );
}

async function runList(argv: string[]): Promise<void> {
  const limit = Number.parseInt(parseFlag(argv, "--limit") ?? "10", 10);
  const items = await listInterbeingEmitterV0(process.cwd(), Number.isFinite(limit) ? limit : 10, {
    traceId: parseFlag(argv, "--trace-id"),
  });
  console.log(JSON.stringify({ items }, null, 2));
}

async function runStatus(): Promise<void> {
  const paths = resolveInterbeingEmitterV0Paths(process.cwd());
  const items = await listInterbeingEmitterV0(process.cwd(), 20);
  const byTarget = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.target_node] = (acc[item.target_node] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    JSON.stringify(
      {
        handoff_root: paths.handoffRoot,
        outgoing_root: paths.outgoingRoot,
        recent_items: items.length,
        state_path: paths.statePath,
        log_path: paths.logPath,
        by_target: byTarget,
      },
      null,
      2,
    ),
  );
}

async function runLogs(argv: string[]): Promise<void> {
  const limit = Number.parseInt(parseFlag(argv, "--limit") ?? "50", 10);
  const items = await listInterbeingEmitterV0LogEntries(process.cwd(), {
    action: parseFlag(argv, "--action") as "duplicate_emit" | "emit" | undefined,
    filename: parseFlag(argv, "--filename"),
    limit: Number.isFinite(limit) ? limit : 50,
    sha256: parseFlag(argv, "--sha256"),
    traceId: parseFlag(argv, "--trace-id"),
  });
  console.log(JSON.stringify(items, null, 2));
}

async function runVerify(argv: string[]): Promise<void> {
  const filename = parseFlag(argv, "--filename");
  const sha256 = parseFlag(argv, "--sha256");
  const traceId = parseFlag(argv, "--trace-id");
  if (!filename && !sha256 && !traceId) {
    throw new Error("verify requires --filename, --sha256, or --trace-id");
  }
  const match = await verifyInterbeingEmitterV0(process.cwd(), { filename, sha256, traceId });
  console.log(JSON.stringify({ match }, null, 2));
}

async function main(): Promise<void> {
  const [commandRaw, ...rest] = process.argv.slice(2);
  const command = commandRaw as Command | undefined;
  if (!command) {
    throw new Error("expected command: emit | list | logs | status | verify");
  }
  if (command === "emit") {
    await runEmit(rest);
    return;
  }
  if (command === "list") {
    await runList(rest);
    return;
  }
  if (command === "status") {
    await runStatus();
    return;
  }
  if (command === "logs") {
    await runLogs(rest);
    return;
  }
  if (command === "verify") {
    await runVerify(rest);
    return;
  }
  throw new Error("unknown command");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

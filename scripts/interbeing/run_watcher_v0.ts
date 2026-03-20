import { pathToFileURL } from "node:url";
import { DEFAULT_INTERBEING_DIR } from "./interbeing_paths.ts";
import {
  getInterbeingWatcherV0Health,
  getInterbeingWatcherV0Status,
  listInterbeingWatcherV0Items,
  replayInterbeingWatcherV0,
  runInterbeingWatcherV0,
  verifyInterbeingWatcherV0,
  type InterbeingWatcherV0Mode,
} from "./watch_handoff_v0.ts";

type RunWatcherV0Options = {
  argv?: string[];
};

type ParsedCommand =
  | { kind: "watch"; mode: InterbeingWatcherV0Mode; interbeingDir?: string }
  | { kind: "health" }
  | { kind: "status" }
  | { kind: "list"; limit: number }
  | { kind: "verify"; filename?: string; sha256?: string; interbeingDir?: string }
  | { file: string; forceReprocess: boolean; kind: "replay" };

function stripGlobalFlags(argv: string[]): { interbeingDir?: string; argv: string[] } {
  const nextArgv: string[] = [];
  let interbeingDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--interbeing-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--interbeing-dir requires a value");
      }
      interbeingDir = value;
      index += 1;
      continue;
    }
    nextArgv.push(arg);
  }
  return { interbeingDir, argv: nextArgv };
}

function readFlagValue(argv: string[], name: string): string | undefined {
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

function parseCommand(argv: string[]): ParsedCommand {
  const { interbeingDir, argv: strippedArgv } = stripGlobalFlags(argv);
  const command = strippedArgv[0];
  if (command === "start" || command === "once") {
    return { kind: "watch", interbeingDir, mode: command };
  }
  if (command === "status") {
    return { kind: "status" };
  }
  if (command === "health") {
    return { kind: "health" };
  }
  if (command === "list") {
    const rawLimit = readFlagValue(strippedArgv, "--limit");
    const limit = rawLimit == null ? 10 : Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(limit) || limit < 0) {
      throw new Error("--limit must be a non-negative integer");
    }
    return { kind: "list", limit };
  }
  if (command === "verify") {
    const filename = readFlagValue(strippedArgv, "--filename");
    const sha256 = readFlagValue(strippedArgv, "--sha256");
    if (!filename && !sha256) {
      throw new Error("verify requires --filename or --sha256");
    }
    return { kind: "verify", filename, interbeingDir, sha256 };
  }
  if (command === "replay") {
    const file = readFlagValue(strippedArgv, "--file");
    if (!file) {
      throw new Error("replay requires --file");
    }
    return {
      kind: "replay",
      file,
      forceReprocess: strippedArgv.includes("--force-reprocess"),
    };
  }
  throw new Error(
    "Usage: pnpm tsx scripts/interbeing/run_watcher_v0.ts [--interbeing-dir <path>] <start|once|status|health|list|verify|replay>",
  );
}

export async function runWatcherCliV0(options: RunWatcherV0Options = {}): Promise<number> {
  const command = parseCommand(options.argv ?? process.argv.slice(2));
  const result = await (async () => {
    switch (command.kind) {
      case "watch":
        return runInterbeingWatcherV0({
          interbeingDir: command.interbeingDir ?? DEFAULT_INTERBEING_DIR,
          mode: command.mode,
        });
      case "status":
        return getInterbeingWatcherV0Status();
      case "health":
        return getInterbeingWatcherV0Health();
      case "list":
        return listInterbeingWatcherV0Items({ limit: command.limit });
      case "verify":
        return verifyInterbeingWatcherV0({
          filename: command.filename,
          sha256: command.sha256,
        });
      case "replay":
        return replayInterbeingWatcherV0({
          file: command.file,
          forceReprocess: command.forceReprocess,
        });
    }
  })();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runWatcherCliV0().then(
    (code) => process.exit(code),
    (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}

import { pathToFileURL } from "node:url";
import { runInterbeingWatcherV0, type InterbeingWatcherV0Mode } from "./watch_handoff_v0.ts";

type RunWatcherV0Options = {
  argv?: string[];
};

function parseMode(argv: string[]): InterbeingWatcherV0Mode {
  const mode = argv[0];
  if (mode === "start" || mode === "once") {
    return mode;
  }
  throw new Error("Usage: pnpm tsx scripts/interbeing/run_watcher_v0.ts <start|once>");
}

export async function runWatcherCliV0(options: RunWatcherV0Options = {}): Promise<number> {
  const mode = parseMode(options.argv ?? process.argv.slice(2));
  const summary = await runInterbeingWatcherV0({ mode });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
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

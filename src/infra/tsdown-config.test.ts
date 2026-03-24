import { describe, expect, it } from "vitest";
import tsdownConfig from "../../tsdown.config.ts";

type TsdownConfigEntry = {
  entry?: Record<string, string> | string[];
  outDir?: string;
};

function asConfigArray(config: unknown): TsdownConfigEntry[] {
  return Array.isArray(config) ? (config as TsdownConfigEntry[]) : [config as TsdownConfigEntry];
}

function entryKeys(config: TsdownConfigEntry): string[] {
  if (!config.entry || Array.isArray(config.entry)) {
    return [];
  }
  return Object.keys(config.entry);
}

describe("tsdown config", () => {
  it("keeps core, plugin runtime, plugin-sdk, bundled plugins, and bundled hooks in one dist graph", () => {
    const configs = asConfigArray(tsdownConfig);
    const distGraphs = configs.filter((config) => {
      const keys = entryKeys(config);
      return (
        keys.includes("index") ||
        keys.includes("plugins/runtime/index") ||
        keys.includes("plugin-sdk/index") ||
        keys.includes("extensions/openai/index") ||
        keys.includes("bundled/boot-md/handler")
      );
    });

    expect(distGraphs).toHaveLength(1);
    expect(entryKeys(distGraphs[0])).toEqual(
      expect.arrayContaining([
        "index",
        "agents/auth-profiles.runtime",
        "plugins/provider-runtime.runtime",
        "extensions/telegram/media-understanding.runtime",
        "plugins/runtime/index",
        "plugin-sdk/index",
        "extensions/openai/index",
        "bundled/boot-md/handler",
      ]),
    );
  });

  it("emits dedicated runtime boundaries as stable dist entries", () => {
    const configs = asConfigArray(tsdownConfig);
    const distGraph = configs.find((config) => entryKeys(config).includes("index"));

    expect(distGraph).toBeDefined();
    expect(entryKeys(distGraph!)).toEqual(
      expect.arrayContaining([
        "agents/auth-profiles.runtime",
        "agents/pi-embedded-runner/compact.runtime",
        "channels/read-only-account-inspect.telegram.runtime",
        "commands/model-picker.runtime",
        "plugins/provider-runtime.runtime",
        "plugins/runtime/runtime-telegram-ops.runtime",
        "extensions/telegram/media-understanding.runtime",
        "extensions/slack/monitor/slash-commands.runtime",
      ]),
    );
  });

  it("does not emit plugin-sdk or hooks from a separate dist graph", () => {
    const configs = asConfigArray(tsdownConfig);

    expect(configs.some((config) => config.outDir === "dist/plugin-sdk")).toBe(false);
    expect(
      configs.some((config) =>
        Array.isArray(config.entry)
          ? config.entry.some((entry) => entry.includes("src/hooks/"))
          : false,
      ),
    ).toBe(false);
  });
});

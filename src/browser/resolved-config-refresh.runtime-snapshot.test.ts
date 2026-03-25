import fs from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  loadConfig,
  setRuntimeConfigSnapshot,
} from "../config/config.js";
import { withEnvOverride, withTempHomeConfig } from "../config/test-helpers.js";
import { resolveBrowserConfig } from "./config.js";
import {
  refreshResolvedBrowserConfigFromDisk,
  resolveBrowserProfileWithHotReload,
} from "./resolved-config-refresh.js";
import type { BrowserServerState } from "./server-context.types.js";

type ProfileFixture = {
  cdpPort?: number;
  cdpUrl?: string;
  color?: string;
};

function buildConfig(profiles: Record<string, ProfileFixture>) {
  return {
    browser: {
      enabled: true,
      color: "#FF4500",
      headless: true,
      defaultProfile: "openclaw",
      profiles,
    },
  };
}

async function writeConfigFile(configPath: string, config: unknown): Promise<void> {
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function createState(cfg = loadConfig()): BrowserServerState {
  return {
    server: null,
    port: 18791,
    resolved: resolveBrowserConfig(cfg.browser, cfg),
    profiles: new Map(),
  };
}

async function withBrowserConfig<T>(
  config: unknown,
  fn: (params: { configPath: string }) => Promise<T>,
): Promise<T> {
  return await withTempHomeConfig(
    config,
    async ({ home, configPath }) =>
      await withEnvOverride(
        {
          OPENCLAW_HOME: home,
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_CONFIG_CACHE_MS: "60000",
        },
        async () => {
          clearRuntimeConfigSnapshot();
          clearConfigCache();
          try {
            return await fn({ configPath });
          } finally {
            clearRuntimeConfigSnapshot();
            clearConfigCache();
          }
        },
      ),
  );
}

describe("resolved browser config refresh with runtime snapshots", () => {
  beforeEach(() => {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
  });

  it("keeps cached reads on the runtime snapshot but lets fresh reads bypass it", async () => {
    await withBrowserConfig(
      buildConfig({
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      }),
      async ({ configPath }) => {
        const runtimeConfig = loadConfig();
        const state = createState(runtimeConfig);
        setRuntimeConfigSnapshot(runtimeConfig);

        await writeConfigFile(
          configPath,
          buildConfig({
            openclaw: { cdpPort: 18800, color: "#FF4500" },
            desktop: { cdpUrl: "http://127.0.0.1:9222", color: "#0066CC" },
          }),
        );

        refreshResolvedBrowserConfigFromDisk({
          current: state,
          refreshConfigFromDisk: true,
          mode: "cached",
        });
        expect(Object.keys(state.resolved.profiles)).not.toContain("desktop");

        refreshResolvedBrowserConfigFromDisk({
          current: state,
          refreshConfigFromDisk: true,
          mode: "fresh",
        });
        expect(Object.keys(state.resolved.profiles)).toContain("desktop");
      },
    );
  });

  it("retries missing profiles from disk when the runtime snapshot is stale", async () => {
    await withBrowserConfig(
      buildConfig({
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      }),
      async ({ configPath }) => {
        const runtimeConfig = loadConfig();
        const state = createState(runtimeConfig);
        setRuntimeConfigSnapshot(runtimeConfig);

        await writeConfigFile(
          configPath,
          buildConfig({
            openclaw: { cdpPort: 18800, color: "#FF4500" },
            desktop: { cdpUrl: "http://127.0.0.1:9222", color: "#0066CC" },
          }),
        );

        const profile = resolveBrowserProfileWithHotReload({
          current: state,
          refreshConfigFromDisk: true,
          name: "desktop",
        });

        expect(profile?.name).toBe("desktop");
        expect(profile?.cdpUrl).toBe("http://127.0.0.1:9222");
        expect(state.resolved.profiles.desktop).toBeDefined();
      },
    );
  });
});

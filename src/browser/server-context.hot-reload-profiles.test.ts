import fs from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot, loadConfig } from "../config/config.js";
import { withEnvOverride, withTempHomeConfig } from "../config/test-helpers.js";
import { resolveBrowserConfig, resolveProfile } from "./config.js";
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

describe("server-context hot-reload profiles", () => {
  beforeEach(() => {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
  });

  it("forProfile hot-reloads newly added profiles from config", async () => {
    await withBrowserConfig(
      buildConfig({
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      }),
      async ({ configPath }) => {
        const cfg = loadConfig();
        const state = createState(cfg);

        expect(cfg.browser?.profiles?.desktop).toBeUndefined();
        expect(
          resolveBrowserProfileWithHotReload({
            current: state,
            refreshConfigFromDisk: true,
            name: "desktop",
          }),
        ).toBeNull();

        await writeConfigFile(
          configPath,
          buildConfig({
            openclaw: { cdpPort: 18800, color: "#FF4500" },
            desktop: { cdpUrl: "http://127.0.0.1:9222", color: "#0066CC" },
          }),
        );

        const staleCfg = loadConfig();
        expect(staleCfg.browser?.profiles?.desktop).toBeUndefined();

        const profile = resolveBrowserProfileWithHotReload({
          current: state,
          refreshConfigFromDisk: true,
          name: "desktop",
        });
        expect(profile?.name).toBe("desktop");
        expect(profile?.cdpUrl).toBe("http://127.0.0.1:9222");
        expect(state.resolved.profiles.desktop).toBeDefined();

        const stillStaleCfg = loadConfig();
        expect(stillStaleCfg.browser?.profiles?.desktop).toBeUndefined();
      },
    );
  });

  it("forProfile still returns null for profiles missing on disk", async () => {
    await withBrowserConfig(
      buildConfig({
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      }),
      async () => {
        const state = createState();

        expect(
          resolveBrowserProfileWithHotReload({
            current: state,
            refreshConfigFromDisk: true,
            name: "nonexistent",
          }),
        ).toBeNull();
      },
    );
  });

  it("forProfile refreshes existing profile config after loadConfig cache updates", async () => {
    await withBrowserConfig(
      buildConfig({
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      }),
      async ({ configPath }) => {
        const state = createState();

        await writeConfigFile(
          configPath,
          buildConfig({
            openclaw: { cdpPort: 19999, color: "#FF4500" },
          }),
        );

        const after = resolveBrowserProfileWithHotReload({
          current: state,
          refreshConfigFromDisk: true,
          name: "openclaw",
        });
        expect(after?.cdpPort).toBe(19999);
        expect(state.resolved.profiles.openclaw?.cdpPort).toBe(19999);
      },
    );
  });

  it("listProfiles refreshes config before enumerating profiles", async () => {
    await withBrowserConfig(
      buildConfig({
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      }),
      async ({ configPath }) => {
        const state = createState();

        await writeConfigFile(
          configPath,
          buildConfig({
            openclaw: { cdpPort: 18800, color: "#FF4500" },
            desktop: { cdpPort: 19999, color: "#0066CC" },
          }),
        );

        refreshResolvedBrowserConfigFromDisk({
          current: state,
          refreshConfigFromDisk: true,
          mode: "cached",
        });
        expect(Object.keys(state.resolved.profiles)).toContain("desktop");
      },
    );
  });

  it("marks existing runtime state for reconcile when profile invariants change", async () => {
    await withBrowserConfig(
      buildConfig({
        openclaw: { cdpPort: 18800, color: "#FF4500" },
      }),
      async ({ configPath }) => {
        const cfg = loadConfig();
        const resolved = resolveBrowserConfig(cfg.browser, cfg);
        const openclawProfile = resolveProfile(resolved, "openclaw");
        expect(openclawProfile).toBeTruthy();
        const state: BrowserServerState = {
          server: null,
          port: 18791,
          resolved,
          profiles: new Map([
            [
              "openclaw",
              {
                profile: openclawProfile!,
                running: { pid: 123 } as never,
                lastTargetId: "tab-1",
                reconcile: null,
              },
            ],
          ]),
        };

        await writeConfigFile(
          configPath,
          buildConfig({
            openclaw: { cdpPort: 19999, color: "#FF4500" },
          }),
        );

        refreshResolvedBrowserConfigFromDisk({
          current: state,
          refreshConfigFromDisk: true,
          mode: "cached",
        });

        const runtime = state.profiles.get("openclaw");
        expect(runtime).toBeTruthy();
        expect(runtime?.profile.cdpPort).toBe(19999);
        expect(runtime?.lastTargetId).toBeNull();
        expect(runtime?.reconcile?.reason).toContain("cdpPort");
      },
    );
  });
});

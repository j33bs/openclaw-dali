import { afterEach, describe, expect, it, vi } from "vitest";

describe("compaction-watcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("node:fs/promises");
  });

  it("warns when diagnostics logging cannot be written", async () => {
    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      return {
        ...actual,
        mkdir: vi.fn(async () => undefined),
        appendFile: vi.fn(async () => {
          throw new Error("blocked");
        }),
      };
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { default: logCompactionEvent } =
      await import("../../hooks/compaction-watcher/handler.ts");

    await logCompactionEvent({
      type: "session:compact:after",
      sessionKey: "sess-1",
      context: { tokensBefore: 50000, tokensAfter: 10000 },
      messages: [],
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[compaction-watcher] diagnostics write skipped:"),
    );
  });
});

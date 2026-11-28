import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, removeTempDir, removeTempDirs, tempDir } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  return cleanup();
});

const failing = (code?: string) =>
  vi.fn(() => {
    throw Object.assign(new Error(`rm failed${code ? `: ${code}` : ""}`), code ? { code } : {});
  }) as unknown as typeof rmSync;

describe("removeTempDir", () => {
  it("retries a busy folder more and for longer", () => {
    const rm = vi.fn();
    removeTempDir("/tmp/zero-x", rm as unknown as typeof rmSync);
    const [dir, opts] = rm.mock.calls[0]!;
    expect(dir).toBe("/tmp/zero-x");
    expect(opts).toMatchObject({ recursive: true, force: true });
    expect(opts.maxRetries).toBeGreaterThanOrEqual(10);
    expect(opts.retryDelay).toBeGreaterThanOrEqual(200);
  });

  it.each(["EBUSY", "EPERM", "ENOTEMPTY"])("warns and does not throw on %s", (code) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => removeTempDir("/tmp/zero-held", failing(code))).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain("/tmp/zero-held");
    expect(String(warn.mock.calls[0]![0])).toContain(code);
  });

  it("throws any other error", () => {
    expect(() => removeTempDir("/tmp/zero-x", failing("EACCES"))).toThrow(/EACCES/);
    expect(() => removeTempDir("/tmp/zero-x", failing())).toThrow(/rm failed/);
  });

  it("keeps removing the other folders after one stays busy", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = tempDir();
    const second = tempDir();
    writeFileSync(join(second, "file.txt"), "x");
    const rm = ((dir: string, opts: Parameters<typeof rmSync>[1]) => {
      if (dir === first) throw Object.assign(new Error("busy"), { code: "EPERM" });
      rmSync(dir, opts);
    }) as typeof rmSync;
    removeTempDirs([first, second], rm);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(false);
  });
});

describe("cleanup", () => {
  it("removes a temp folder with files in it", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), "a");
    cleanup();
    expect(existsSync(dir)).toBe(false);
  });
});

describe("conflict suites", () => {
  it.each(["automerge-conflicts.test.ts", "conflict-agents.test.ts"])("%s sets its own test timeout of at least 180 s", (file) => {
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    const match = source.match(/vi\.setConfig\(\{\s*testTimeout:\s*([\d_]+)\s*\}\)/);
    expect(match).not.toBeNull();
    expect(Number(match![1]!.replace(/_/g, ""))).toBeGreaterThanOrEqual(180_000);
  });
});

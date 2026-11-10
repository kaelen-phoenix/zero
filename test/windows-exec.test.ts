import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProcess } from "../src/engines/cli.js";
import { git, resolveBin, spawnGit, spawnTarget, tryGit } from "../src/shell.js";
import { cleanup, gitIn, gitRepo, tempDir } from "./helpers.js";

vi.mock("node:child_process", async (original) => {
  const real = await original<typeof import("node:child_process")>();
  return { ...real, spawn: vi.fn(real.spawn), spawnSync: vi.fn(real.spawnSync) };
});

const windows = process.platform === "win32";

/** A real program under another name: a copy of this Node, which `-p process.execPath` makes tell which copy ran. */
function plantNode(dir: string, name: string): string {
  const file = join(dir, name);
  try {
    linkSync(process.execPath, file);
  } catch {
    copyFileSync(process.execPath, file);
  }
  return file;
}

/** Any Node started from now on leaves this file behind, whatever arguments it got, so a planted copy that merely fails still shows it ran. */
function watchForNode(): string {
  const dir = tempDir("zero-canary-");
  const canary = join(dir, "ran");
  const preload = join(dir, "canary.cjs");
  writeFileSync(preload, `require("node:fs").writeFileSync(${JSON.stringify(canary)}, process.execPath);\n`);
  vi.stubEnv("NODE_OPTIONS", `--require "${preload.replace(/\\/g, "/")}"`);
  return canary;
}

const real = (path: string) => realpathSync.native(path);

// With this variable set in zero's own environment, Windows leaves the current folder out of the search, which would make these tests pass whatever zero does. A daemon normally runs without it.
beforeEach(() => {
  vi.stubEnv("NoDefaultCurrentDirectoryInExePath", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe.runIf(windows)("a git planted in the working folder", () => {
  it("the canary sees a planted copy that runs", () => {
    const canary = watchForNode();
    const planted = plantNode(tempDir(), "git.exe");
    spawnSync(planted, ["-e", "0"], { windowsHide: true });
    expect(existsSync(canary)).toBe(true);
  });

  it.each(["git.exe", "git.com"])("%s at the root of the repository does not run", (name) => {
    const repo = gitRepo();
    const head = gitIn(repo, "rev-parse", "HEAD");
    plantNode(repo, name);
    const canary = watchForNode();
    expect(git(["rev-parse", "HEAD"], repo)).toBe(head);
    expect(tryGit(["rev-parse", "HEAD"], repo)).toBe(head);
    const direct = spawnGit(["rev-parse", "HEAD"], repo);
    expect(direct.status).toBe(0);
    expect(direct.stdout.trim()).toBe(head);
    expect(existsSync(canary)).toBe(false);
  });

  it("a PATH with the current folder and an empty entry does not bring it back", () => {
    const repo = gitRepo();
    const head = gitIn(repo, "rev-parse", "HEAD");
    plantNode(repo, "git.exe");
    const canary = watchForNode();
    vi.stubEnv("PATH", [".", "", process.env.PATH].join(delimiter));
    const found = resolveBin("git");
    expect(isAbsolute(found)).toBe(true);
    expect(relative(repo, found).startsWith("..")).toBe(true);
    expect(git(["rev-parse", "HEAD"], repo)).toBe(head);
    expect(existsSync(canary)).toBe(false);
  });

  it("without git on PATH the call fails as today and the planted one does not run", () => {
    const repo = gitRepo();
    plantNode(repo, "git.exe");
    const canary = watchForNode();
    vi.stubEnv("PATH", tempDir());
    expect(() => git(["rev-parse", "HEAD"], repo)).toThrow();
    expect(tryGit(["rev-parse", "HEAD"], repo)).toBeUndefined();
    expect(spawnGit(["rev-parse", "HEAD"], repo).status).toBeNull();
    expect(existsSync(canary)).toBe(false);
  });
});

describe.runIf(windows)("an engine planted in the working folder", () => {
  const invocation = (expression: string) => ({ bin: "herramienta", args: ["-p", expression] });

  it("the copy on PATH runs, not the one in the cwd", async () => {
    const cwd = tempDir();
    const onPath = tempDir();
    plantNode(cwd, "herramienta.exe");
    const trusted = plantNode(onPath, "herramienta.exe");
    vi.stubEnv("PATH", onPath);
    const r = await runProcess(invocation("process.execPath"), cwd, 30_000);
    expect(r.code).toBe(0);
    expect(real(r.stdout.trim())).toBe(real(trusted));
  });

  it("the engine keeps working in the cwd it was given", async () => {
    const cwd = tempDir();
    const onPath = tempDir();
    plantNode(onPath, "herramienta.exe");
    vi.stubEnv("PATH", onPath);
    const r = await runProcess(invocation("process.cwd()"), cwd, 30_000);
    expect(real(r.stdout.trim())).toBe(real(cwd));
  });

  it("an engine missing from PATH fails as today and the planted one does not run", async () => {
    const cwd = tempDir();
    plantNode(cwd, "herramienta.exe");
    const canary = watchForNode();
    vi.stubEnv("PATH", tempDir());
    const start = runProcess(invocation("process.execPath"), cwd, 30_000);
    await expect(start).rejects.toThrow('cannot start "herramienta"');
    await expect(start).rejects.toThrow("Is it installed and on PATH?");
    expect(existsSync(canary)).toBe(false);
  });
});

describe.runIf(windows)("resolveBin on Windows", () => {
  /** A folder holding an empty file by that name: resolveBin only looks, it starts nothing. */
  function folderWith(name: string, root = tempDir()): string {
    writeFileSync(join(root, name), "");
    return root;
  }

  it("ignores relative and empty entries", () => {
    const cwd = folderWith("herramienta.exe");
    mkdirSync(join(cwd, "sub"));
    folderWith("herramienta.exe", join(cwd, "sub"));
    const before = process.cwd();
    process.chdir(cwd);
    try {
      vi.stubEnv("PATH", [".", "", "sub"].join(delimiter));
      expect(resolveBin("herramienta")).toBe("herramienta");
    } finally {
      process.chdir(before);
    }
  });

  it("finds a name that already has its extension", () => {
    const dir = folderWith("herramienta.exe");
    vi.stubEnv("PATH", dir);
    expect(resolveBin("herramienta.exe")).toBe(join(dir, "herramienta.exe"));
    expect(resolveBin("herramienta")).toBe(join(dir, "herramienta.exe"));
  });

  it("prefers .com, the order Windows uses", () => {
    const dir = folderWith("herramienta.exe");
    folderWith("herramienta.com", dir);
    vi.stubEnv("PATH", dir);
    expect(resolveBin("herramienta")).toBe(join(dir, "herramienta.com"));
  });

  it("does not take a file without extension for a bare name", () => {
    const dir = folderWith("herramienta");
    vi.stubEnv("PATH", dir);
    expect(resolveBin("herramienta")).toBe("herramienta");
  });

  it("the cache follows changes of PATH", () => {
    const first = folderWith("herramienta.exe");
    const second = folderWith("herramienta.exe");
    vi.stubEnv("PATH", first);
    expect(resolveBin("herramienta")).toBe(join(first, "herramienta.exe"));
    vi.stubEnv("PATH", second);
    expect(resolveBin("herramienta")).toBe(join(second, "herramienta.exe"));
  });

  it("what was not found is not cached", () => {
    const dir = tempDir();
    vi.stubEnv("PATH", dir);
    expect(resolveBin("herramienta")).toBe("herramienta");
    folderWith("herramienta.exe", dir);
    expect(resolveBin("herramienta")).toBe(join(dir, "herramienta.exe"));
  });

  it("leaves paths as they were declared, in the cwd they were given", () => {
    const dir = folderWith("herramienta.exe");
    vi.stubEnv("PATH", dir);
    for (const declared of [".\\herramienta.exe", "./herramienta.exe", join(dir, "herramienta.exe")]) {
      expect(resolveBin(declared)).toBe(declared);
      expect(spawnTarget(declared, "cwd")).toEqual({ bin: declared, cwd: "cwd" });
    }
  });

  it("a missing bare name leaves the folder it would have been planted in", () => {
    vi.stubEnv("PATH", tempDir());
    const target = spawnTarget("herramienta", "cwd");
    expect(target.bin).toBe("herramienta");
    expect(target.cwd).not.toBe("cwd");
    expect(isAbsolute(target.cwd)).toBe(true);
  });
});

describe("resolveBin everywhere", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockClear();
    vi.mocked(spawnSync).mockClear();
  });

  it("gives the name unchanged on other platforms", () => {
    expect(resolveBin("git", "linux")).toBe("git");
    expect(spawnTarget("git", "cwd", "linux")).toEqual({ bin: "git", cwd: "cwd" });
  });

  it("starts no helper process", () => {
    resolveBin("git");
    resolveBin("no-existe-este-programa");
    resolveBin("git", "win32");
    resolveBin("no-existe-este-programa", "win32");
    expect(spawn).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("no file of src starts git by its bare name", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const bare = /\bspawn(Sync)?\(\s*["'`]git["'`]/;
    expect(files.filter((f) => bare.test(readFileSync(join(src, f), "utf8")))).toEqual([]);
    expect(readFileSync(join(src, "shell.ts"), "utf8")).toMatch(/spawnTarget\("git", cwd\)/);
  });
});

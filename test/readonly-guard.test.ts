import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgentRunner, runHere } from "../src/agent.js";
import { parseFactory } from "../src/config.js";
import { resolveEngine, type Engine, type EngineRequest } from "../src/engines/index.js";
import { beingGuarded, runGuarded } from "../src/readonly-guard.js";
import { cleanup, gitIn, gitRepo, tempDir, writeTree } from "./helpers.js";

// spawn runs without a shell, so a fake `.cmd` on PATH would not start on Windows: `codex` is redirected to a node process.
const fake = vi.hoisted(() => ({ script: "", runs: [] as string[][] }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    spawn: (bin: string, args: string[], options: object) => {
      // By its name alone: where codex is installed, zero starts it by its full path.
      if (!/(^|[\\/])codex(\.(com|exe))?$/i.test(bin)) return real.spawn(bin, args, options);
      if (args[0] === "login") return real.spawn(process.execPath, ["-e", "process.exitCode = 1"], options);
      fake.runs.push(args);
      return real.spawn(process.execPath, ["-e", fake.script, "--", ...args], options);
    },
  };
});

// On Windows a codex not found on PATH would start away from the guarded folder: an empty
// codex.exe on PATH makes zero start it by its full path, in the folder, as with a real install.
const fakeBin = mkdtempSync(join(tmpdir(), "zero-fake-codex-"));
writeFileSync(join(fakeBin, "codex.exe"), "");
process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ""}`;

/** A fake codex body with `fs`, `cp` and `git`, answering `{"ok":true}` unless it says otherwise. */
const codex = (body: string) => `
  const fs = require("node:fs");
  const cp = require("node:child_process");
  const git = (...a) => cp.execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdio: "pipe" });
  const last = process.argv[process.argv.indexOf("--output-last-message") + 1];
  fs.writeFileSync(last, '{"ok":true}');
  ${body}
`;

const OFF = parseFactory("lines: []\ncodex: { sandbox: off }\nstations: { review: { engine: codex }, build: { engine: codex } }\n");
const engine = () => resolveEngine("codex", OFF);
const req = (cwd: string, over: Partial<EngineRequest> = {}): EngineRequest => ({ instructions: "i", prompt: "p", cwd, access: "read", timeoutMs: 30_000, ...over });

/** The call, as the stations make it on this machine. */
const call = (cwd: string, script: string, over: Partial<EngineRequest> = {}) => {
  fake.script = codex(script);
  return runHere(engine(), req(cwd, over), undefined, "review");
};

const snapshotFolders = () => readdirSync(tmpdir()).filter((n) => n.startsWith("zero-readonly-"));
const status = (repo: string) => gitIn(repo, "status", "--porcelain");

let before: string[];
beforeEach(() => {
  fake.runs = [];
  before = snapshotFolders();
  vi.stubEnv("CODEX_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  // What a discard kept, for the owner to recover, does not outlive the test.
  for (const name of snapshotFolders()) if (!before.includes(name)) rmSync(join(tmpdir(), name), { recursive: true, force: true });
  cleanup();
});

describe("read-only check", () => {
  it("a call that touches nothing ends ok, with its answer and nothing left behind", async () => {
    const repo = gitRepo();
    writeTree(repo, { "propio.txt": "mío" });
    const was = status(repo);
    const r = await call(repo, "");
    expect(r).toMatchObject({ ok: true, text: '{"ok":true}' });
    expect(status(repo)).toBe(was);
    expect(snapshotFolders().filter((n) => !before.includes(n))).toEqual([]);
  });

  it("the call may run `git status`, which rewrites the index's bytes", async () => {
    const repo = gitRepo();
    expect((await call(repo, `git("status");`)).ok).toBe(true);
  });

  it("a new untracked file is gone and the call failed", async () => {
    const repo = gitRepo();
    const r = await call(repo, `fs.mkdirSync("nueva"); fs.writeFileSync("nueva/intruso.txt", "x");`);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("nueva/intruso.txt");
    expect(existsSync(join(repo, "nueva"))).toBe(false);
    expect(status(repo)).toBe("");
  });

  it("a modified or deleted tracked file comes back", async () => {
    const repo = gitRepo({ "a.txt": "a\r\n", "b.txt": "b\n" });
    const r = await call(repo, `fs.writeFileSync("a.txt", "otro"); fs.rmSync("b.txt");`);
    expect(r.ok).toBe(false);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("a\r\n");
    expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("b\n");
    expect(status(repo)).toBe("");
  });

  it("a file turned into a folder comes back", async () => {
    const repo = gitRepo({ "a.txt": "a\n" });
    const r = await call(repo, `fs.rmSync("a.txt"); fs.mkdirSync("a.txt"); fs.writeFileSync("a.txt/dentro", "x");`);
    expect(r.ok).toBe(false);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("a\n");
  });

  it("a commit is undone: HEAD, branch, index and files as they were", async () => {
    const repo = gitRepo();
    const head = gitIn(repo, "rev-parse", "HEAD");
    const r = await call(repo, `fs.writeFileSync("n.txt", "x"); git("add", "-A"); git("commit", "-q", "-m", "intruso");`);
    expect(r.ok).toBe(false);
    expect(gitIn(repo, "rev-parse", "HEAD")).toBe(head);
    expect(gitIn(repo, "branch", "--show-current")).toBe("main");
    expect(status(repo)).toBe("");
    expect(existsSync(join(repo, "n.txt"))).toBe(false);
  });

  it("an index change, a new branch and a moved HEAD are undone", async () => {
    const repo = gitRepo();
    writeTree(repo, { "suelto.txt": "s" });
    const r = await call(repo, `git("add", "suelto.txt"); git("branch", "intrusa"); git("checkout", "-q", "-b", "otra");`);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("refs/heads/intrusa");
    expect(status(repo)).toBe("?? suelto.txt");
    expect(gitIn(repo, "branch", "--format=%(refname:short)")).toBe("main");
    expect(gitIn(repo, "branch", "--show-current")).toBe("main");
  });

  it("a planted hook is gone and the config is back", async () => {
    const repo = gitRepo();
    const config = readFileSync(join(repo, ".git", "config"), "utf8");
    const r = await call(repo, `fs.mkdirSync(".git/hooks", { recursive: true }); fs.writeFileSync(".git/hooks/pre-commit", "#!/bin/sh"); fs.appendFileSync(".git/config", "\\n[evil]\\n\\tx = 1\\n");`);
    expect(r.ok).toBe(false);
    expect(r.text).toContain(".git/hooks/pre-commit");
    expect(r.text).toContain(".git/config");
    expect(existsSync(join(repo, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(config);
  });

  it("a work copy gets its own branch back; the shared repository's hooks too", async () => {
    const repo = gitRepo();
    const copy = join(tempDir(), "copia");
    gitIn(repo, "worktree", "add", "-q", "-b", "zero/x", copy);
    const head = gitIn(copy, "rev-parse", "HEAD");
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
    const hook = join(repo, ".git", "hooks", "pre-push");
    const r = await call(copy, `fs.writeFileSync("n.txt", "x"); git("add", "-A"); git("commit", "-q", "-m", "intruso"); fs.writeFileSync(${JSON.stringify(hook)}, "#!/bin/sh");`);
    expect(r.ok).toBe(false);
    expect(gitIn(copy, "rev-parse", "HEAD")).toBe(head);
    expect(gitIn(repo, "rev-parse", "zero/x")).toBe(head);
    expect(existsSync(join(copy, "n.txt"))).toBe(false);
    expect(existsSync(hook)).toBe(false);
  });

  it("a branch a work copy's call leaves checked out is the call's", async () => {
    const repo = gitRepo();
    const copy = join(tempDir(), "copia");
    gitIn(repo, "worktree", "add", "-q", "-b", "zero/x", copy);
    expect((await call(copy, `git("checkout", "-q", "-b", "otra");`)).ok).toBe(false);
    expect(gitIn(copy, "branch", "--show-current")).toBe("zero/x");
    expect(gitIn(repo, "branch", "--list", "otra")).toBe("");
  });

  it("files tracked under an ignore rule are compared and come back", async () => {
    const repo = gitRepo({ ".gitignore": "*.log\n" });
    writeTree(repo, { "keep.log": "guardado\n", "borrado.log": "guardado\n", "suelto.log": "ignorado\n" });
    gitIn(repo, "add", "-f", "keep.log", "borrado.log");
    gitIn(repo, "commit", "-q", "-m", "con ignorados");
    const r = await call(repo, `fs.writeFileSync("keep.log", "pisado"); fs.rmSync("borrado.log"); fs.writeFileSync("suelto.log", "cambiado");`);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("keep.log");
    expect(r.text).toContain("descart");
    expect(r.text).not.toContain("suelto.log");
    expect(readFileSync(join(repo, "keep.log"), "utf8")).toBe("guardado\n");
    expect(readFileSync(join(repo, "borrado.log"), "utf8")).toBe("guardado\n");
    expect(status(repo)).toBe("");
  });

  it("a tracked ignored file left alone keeps the call ok", async () => {
    const repo = gitRepo({ ".gitignore": "*.log\n" });
    writeTree(repo, { "keep.log": "guardado\n" });
    gitIn(repo, "add", "-f", "keep.log");
    gitIn(repo, "commit", "-q", "-m", "con ignorados");
    expect((await call(repo, "")).ok).toBe(true);
  });

  it("does not compare ignored files, as `git status` does not", async () => {
    const repo = gitRepo({ ".gitignore": "*.log\n" });
    expect((await call(repo, `fs.writeFileSync("salida.log", "x");`)).ok).toBe(true);
    expect(existsSync(join(repo, "salida.log"))).toBe(true);
  });

  it("a write call keeps its changes and does not fail", async () => {
    const repo = gitRepo();
    const r = await call(repo, `fs.writeFileSync("n.txt", "x");`, { access: "write" });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(repo, "n.txt"), "utf8")).toBe("x");
  });

  it("the web access is checked like read", async () => {
    const repo = gitRepo();
    expect((await call(repo, `fs.writeFileSync("n.txt", "x");`, { access: "web" })).ok).toBe(false);
    expect(existsSync(join(repo, "n.txt"))).toBe(false);
  });

  it("another engine takes no snapshot and keeps its result", async () => {
    const seen = vi.fn();
    const other: Engine = { name: "otro", nativeSchema: false, run: async () => (seen(), { ok: true, text: "hola" }) };
    // A folder that does not exist would fail any snapshot.
    expect(await runHere(other, req(join(tempDir(), "no-existe")), undefined, "review")).toEqual({ ok: true, text: "hola" });
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe("refs the call cannot be blamed for", () => {
  const during = (work: () => void): Engine => ({ name: "codex", nativeSchema: false, unsandboxed: true, run: async () => (work(), { ok: true, text: "ok" }) });
  const commitIn = (dir: string, file: string) => {
    writeTree(dir, { [file]: "x\n" });
    gitIn(dir, "add", file);
    gitIn(dir, "commit", "-q", "-m", file);
    return gitIn(dir, "rev-parse", "HEAD");
  };

  it("in a work copy: a worktree added and a commit in the main checkout stay", async () => {
    const repo = gitRepo();
    const copy = join(tempDir(), "copia");
    gitIn(repo, "worktree", "add", "-q", "-b", "zero/x", copy);
    const other = join(tempDir(), "otra");
    let moved = "";
    const r = await runGuarded(during(() => {
      gitIn(repo, "worktree", "add", "-q", "-b", "zero/y", other);
      gitIn(repo, "branch", "suelta");
      moved = commitIn(repo, "del-dueno.txt");
    }), req(copy));
    expect(r).toMatchObject({ ok: true, text: "ok" });
    expect(gitIn(repo, "rev-parse", "main")).toBe(moved);
    expect(gitIn(other, "branch", "--show-current")).toBe("zero/y");
    expect(gitIn(repo, "branch", "--list", "suelta")).not.toBe("");
    expect(status(repo)).toBe("");
  });

  it("in the main checkout: a job's worktree added and committed to during the call stays", async () => {
    const repo = gitRepo();
    const other = join(tempDir(), "otra");
    let moved = "";
    const r = await runGuarded(during(() => {
      gitIn(repo, "worktree", "add", "-q", "-b", "zero/y", other);
      moved = commitIn(other, "del-trabajo.txt");
    }), req(repo));
    expect(r.ok).toBe(true);
    expect(gitIn(other, "branch", "--show-current")).toBe("zero/y");
    expect(gitIn(other, "rev-parse", "HEAD")).toBe(moved);
  });

  it("in the main checkout: a branch checked out elsewhere and a job's branch with no worktree stay", async () => {
    const repo = gitRepo();
    const other = join(tempDir(), "otra");
    gitIn(repo, "worktree", "add", "-q", "-b", "feature", other);
    let moved = "";
    const r = await runGuarded(during(() => {
      moved = commitIn(other, "del-dueno.txt");
      gitIn(repo, "branch", "zero/publicada", moved);
    }), req(repo));
    expect(r.ok).toBe(true);
    expect(gitIn(repo, "rev-parse", "feature")).toBe(moved);
    expect(gitIn(repo, "rev-parse", "zero/publicada")).toBe(moved);
  });

  it("a new tag, as a fetch brings, stays; a moved or deleted one comes back", async () => {
    const repo = gitRepo();
    const first = gitIn(repo, "rev-parse", "HEAD");
    gitIn(repo, "tag", "movida");
    gitIn(repo, "tag", "borrada");
    expect((await runGuarded(during(() => gitIn(repo, "tag", "nueva")), req(repo))).ok).toBe(true);
    expect(gitIn(repo, "tag", "--list", "nueva")).toBe("nueva");
    const second = commitIn(repo, "b.txt");
    const r = await runGuarded(during(() => {
      gitIn(repo, "tag", "-f", "movida", second);
      gitIn(repo, "tag", "-d", "borrada");
    }), req(repo));
    expect(r.ok).toBe(false);
    expect(gitIn(repo, "rev-parse", "movida")).toBe(first);
    expect(gitIn(repo, "rev-parse", "borrada")).toBe(first);
  });

  it("tells the daemon the folder is being checked, only during the call", async () => {
    const repo = gitRepo();
    let seen = false;
    const running = runGuarded(during(() => (seen = beingGuarded(repo))), req(repo));
    expect(beingGuarded(repo)).toBe(true);
    await running;
    expect(seen).toBe(true);
    expect(beingGuarded(repo)).toBe(false);
  });
});

describe("the owner's earlier changes", () => {
  const dirty = () => {
    const repo = gitRepo({ "cambiado.txt": "base\n", "preparado.txt": "base\n" });
    writeTree(repo, { "cambiado.txt": "sin guardar\n", "preparado.txt": "preparado\n", "suelto.txt": "suelto\n" });
    gitIn(repo, "add", "preparado.txt");
    return repo;
  };

  it("stay in place when the call adds a file", async () => {
    const repo = dirty();
    const was = status(repo);
    const r = await call(repo, `fs.writeFileSync("nuevo.txt", "x");`);
    expect(r.ok).toBe(false);
    expect(existsSync(join(repo, "nuevo.txt"))).toBe(false);
    expect(status(repo)).toBe(was);
    expect(readFileSync(join(repo, "cambiado.txt"), "utf8")).toBe("sin guardar\n");
    expect(readFileSync(join(repo, "suelto.txt"), "utf8")).toBe("suelto\n");
  });

  it("come back, not HEAD's content, when the call overwrites them", async () => {
    const repo = dirty();
    const was = status(repo);
    const r = await call(repo, `fs.writeFileSync("cambiado.txt", "pisado"); fs.writeFileSync("suelto.txt", "pisado"); fs.writeFileSync("preparado.txt", "pisado");`);
    expect(r.ok).toBe(false);
    expect(readFileSync(join(repo, "cambiado.txt"), "utf8")).toBe("sin guardar\n");
    expect(readFileSync(join(repo, "suelto.txt"), "utf8")).toBe("suelto\n");
    expect(readFileSync(join(repo, "preparado.txt"), "utf8")).toBe("preparado\n");
    expect(status(repo)).toBe(was);
  });
});

describe("the notice", () => {
  const Answer = z.object({ ok: z.boolean() });
  const quotaEvent = JSON.stringify({ type: "x", rate_limits: { primary: { used_percent: 10, window_minutes: 300 } } });

  it("fails the run with no output, naming the file and keeping cost and quota", async () => {
    const repo = gitRepo();
    fake.script = codex(`fs.writeFileSync("intruso.txt", "x"); console.log(${JSON.stringify(quotaEvent)});`);
    const run = await createAgentRunner(OFF)({ station: "review", prompt: "p", cwd: repo, schema: Answer });
    expect(run.ok).toBe(false);
    expect(run.output).toBeUndefined();
    expect(run.text).toContain("intruso.txt");
    expect(run.text).toContain("descart");
    expect(run.quota?.windows[0]?.utilization).toBe(0.1);
    const reported: Engine = { name: "pago", nativeSchema: true, unsandboxed: true, run: async (r) => (writeFileSync(join(r.cwd, "z.txt"), "x"), { ok: true, text: "{}", output: {}, costUsd: 0.5, sessionId: "s" }) };
    const paid = await runGuarded(reported, req(repo));
    expect(paid).toMatchObject({ ok: false, costUsd: 0.5, sessionId: "s" });
    expect("output" in paid).toBe(false);
  });

  it("a passing call through the runner keeps its output", async () => {
    fake.script = codex("");
    expect(await createAgentRunner(OFF)({ station: "review", prompt: "p", cwd: gitRepo(), schema: Answer })).toMatchObject({ ok: true, output: { ok: true } });
  });

  it("a call that also failed keeps both messages", async () => {
    const repo = gitRepo();
    const r = await call(repo, `fs.writeFileSync("n.txt", "x"); process.stderr.write("se rompió"); process.exitCode = 3;`);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("descart");
    expect(r.text).toContain("se rompió");
    expect(existsSync(join(repo, "n.txt"))).toBe(false);
  });

  it("an engine that throws after writing: discarded, with the notice", async () => {
    const repo = gitRepo();
    const thrower: Engine = { name: "roto", nativeSchema: false, unsandboxed: true, run: async (r) => { writeFileSync(join(r.cwd, "n.txt"), "x"); throw new Error("no arrancó"); } };
    const r = await runGuarded(thrower, req(repo));
    expect(r.ok).toBe(false);
    expect(r.text).toContain("descart");
    expect(r.text).toContain("no arrancó");
    expect(existsSync(join(repo, "n.txt"))).toBe(false);
  });

  it("an engine that throws having changed nothing throws as before", async () => {
    const thrower: Engine = { name: "roto", nativeSchema: false, unsandboxed: true, run: async () => { throw new Error("no arrancó"); } };
    await expect(runGuarded(thrower, req(gitRepo()))).rejects.toThrow("no arrancó");
  });

  it("what was discarded can be recovered from the folder kept", async () => {
    const repo = gitRepo();
    await call(repo, `fs.writeFileSync("n.txt", "x");`);
    expect(snapshotFolders().filter((n) => !before.includes(n))).toHaveLength(1);
  });
});

describe("folders that are not a repository", () => {
  it("a plain folder ends as it was, with no .git", async () => {
    const dir = tempDir();
    writeTree(dir, { "viejo.txt": "viejo\n" });
    const r = await call(dir, `fs.writeFileSync("nuevo.txt", "x"); fs.writeFileSync("viejo.txt", "otro");`);
    expect(r.ok).toBe(false);
    expect(readdirSync(dir)).toEqual(["viejo.txt"]);
    expect(readFileSync(join(dir, "viejo.txt"), "utf8")).toBe("viejo\n");
  });

  it("a clean call in a plain folder creates nothing in it", async () => {
    const dir = tempDir();
    let during: string[] = [];
    const looker: Engine = { name: "mira", nativeSchema: false, unsandboxed: true, run: async (r) => ((during = readdirSync(r.cwd)), { ok: true, text: "ok" }) };
    expect((await runGuarded(looker, req(dir))).ok).toBe(true);
    expect(during).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a .git created by the call in a plain folder is removed", async () => {
    const dir = tempDir();
    const r = await call(dir, `git("init", "-q");`);
    expect(r.ok).toBe(false);
    expect(existsSync(join(dir, ".git"))).toBe(false);
  });

  it("a subfolder of a repository is not treated as that repository", async () => {
    const repo = gitRepo({ "sub/a.txt": "a\n" });
    writeTree(repo, { "afuera.txt": "fuera\n" });
    const head = gitIn(repo, "rev-parse", "HEAD");
    const was = status(repo);
    const index = readFileSync(join(repo, ".git", "index"));
    const r = await call(join(repo, "sub"), `fs.writeFileSync("n.txt", "x"); fs.writeFileSync("a.txt", "otro");`);
    expect(r.ok).toBe(false);
    expect(readFileSync(join(repo, "sub", "a.txt"), "utf8")).toBe("a\n");
    expect(readdirSync(join(repo, "sub"))).toEqual(["a.txt"]);
    expect(readFileSync(join(repo, ".git", "index")).equals(index)).toBe(true);
    expect(gitIn(repo, "rev-parse", "HEAD")).toBe(head);
    expect(status(repo)).toBe(was);
    expect(readFileSync(join(repo, "afuera.txt"), "utf8")).toBe("fuera\n");
  });

  it("ignores no file of a plain folder because of the machine's global ignores", async () => {
    const dir = tempDir();
    const ignores = join(tempDir(), "ignore");
    writeFileSync(ignores, "*.txt\n");
    const home = tempDir();
    writeFileSync(join(home, ".gitconfig"), `[core]\n\texcludesFile = ${ignores.replace(/\\/g, "/")}\n`);
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    const r = await call(dir, `fs.writeFileSync("n.txt", "x");`);
    expect(r.ok).toBe(false);
    expect(existsSync(join(dir, "n.txt"))).toBe(false);
  });
});

describe("when the check cannot work", () => {
  it("an impossible snapshot: codex does not run", async () => {
    const r = await call(join(tempDir(), "no-existe"), "");
    expect(r.ok).toBe(false);
    expect(fake.runs).toEqual([]);
  });

  it("a .git that git cannot read: codex does not run", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".git"));
    expect((await call(dir, "")).ok).toBe(false);
    expect(fake.runs).toEqual([]);
  });

  it("an impossible restoration says the folder may have changed", async () => {
    const repo = gitRepo();
    fake.script = codex(`fs.writeFileSync("n.txt", "x");`);
    const r = await runGuarded(engine(), req(repo), { restore: async () => { throw new Error("disco lleno"); } });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("pudo quedar modificada");
    expect(r.text).toContain("disco lleno");
  });
});

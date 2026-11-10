import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestWork } from "../src/app.js";
import { killLeftovers, leftoversIn, mentionsFolder, type RunningProcess } from "../src/leftovers.js";
import { createLimiter, verifyTimeoutMs, VERIFY_COMMAND_SPAN, type VerifyHistory } from "../src/line/pace.js";
import { runJob } from "../src/line/runner.js";
import { guardLogStreams, log, lostLogLines } from "../src/log.js";
import { sh } from "../src/shell.js";
import type { SpanRow } from "../src/state/store.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  return cleanup();
});

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("commands of the lines take turns on this machine", () => {
  it("runs at most `max` at once and the rest in order of arrival", async () => {
    const turns = createLimiter();
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const work = (n: number) => async () => {
      most = Math.max(most, ++running);
      order.push(n);
      await tick();
      running--;
      return n;
    };
    expect(await Promise.all([1, 2, 3, 4].map((n) => turns.run(1, work(n))))).toEqual([1, 2, 3, 4]);
    expect(most).toBe(1);
    expect(order).toEqual([1, 2, 3, 4]);

    most = 0;
    await Promise.all([1, 2, 3, 4].map((n) => turns.run(2, work(n))));
    expect(most).toBe(2);
  });

  it("frees the turn when the work throws", async () => {
    const turns = createLimiter();
    await expect(turns.run(1, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await turns.run(1, async () => "next")).toBe("next");
  });

  it("does not run what was aborted while it waited, and keeps the queue moving", async () => {
    const turns = createLimiter();
    const stop = new AbortController();
    let release!: () => void;
    const first = turns.run(1, () => new Promise<string>((r) => (release = () => r("first"))));
    const ran: string[] = [];
    const cut = turns.run(1, async () => ran.push("cut"), stop.signal);
    const last = turns.run(1, async () => ran.push("last"));
    stop.abort();
    expect(await cut).toBeUndefined();
    release();
    expect(await first).toBe("first");
    await last;
    expect(ran).toEqual(["last"]);
  });
});

describe("the time limit of a verify command", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const span = (job: string, minutes: number, over: Partial<SpanRow> = {}, attrs: Record<string, unknown> = {}): SpanRow => ({
    id: `${job}-${minutes}`,
    jobId: job,
    name: VERIFY_COMMAND_SPAN,
    start: "2026-11-09T10:00:00.000Z",
    end: new Date(Date.parse("2026-11-09T10:00:00.000Z") + minutes * 60_000).toISOString(),
    status: "ok",
    attrs: { "process.command_line": "npm test", ...attrs },
    ...over,
  });
  const history = (spans: SpanRow[], lines: Record<string, string> = {}): VerifyHistory => ({
    spansSince: (name, since) => spans.filter((s) => s.name === name && s.start >= since.toISOString()),
    getJob: (id) => ({ line: lines[id] ?? "zero" }),
  });
  const line = { name: "zero" };

  it("is 20 minutes without history, or the line's own", () => {
    expect(verifyTimeoutMs(history([]), line, "npm test", now)).toBe(20 * 60_000);
    expect(verifyTimeoutMs(history([]), { ...line, verifyTimeoutMinutes: 45 }, "npm test", now)).toBe(45 * 60_000);
  });

  it("is never less than twice the slowest of the last passing runs of that command on that line", () => {
    const runs = [span("a", 15), span("b", 19), span("c", 12)];
    expect(verifyTimeoutMs(history(runs), line, "npm test", now)).toBe(38 * 60_000);
    // The line's own limit wins when it is larger.
    expect(verifyTimeoutMs(history(runs), { ...line, verifyTimeoutMinutes: 60 }, "npm test", now)).toBe(60 * 60_000);
  });

  it("counts the time the command ran, not the time it waited for its turn", () => {
    expect(verifyTimeoutMs(history([span("a", 50, {}, { "zero.run_ms": 15 * 60_000 })]), line, "npm test", now)).toBe(30 * 60_000);
  });

  it("leaves out failed runs, other commands, other lines and runs older than the last five", () => {
    const runs = [
      span("old", 100),
      ...[1, 2, 3, 4, 5].map((n) => span(`r${n}`, 11)),
      span("failed", 90, { status: "error" }),
      span("other-command", 90, {}, { "process.command_line": "npm run lint" }),
      span("other-line", 90),
      span("unfinished", 90, { end: undefined }),
    ];
    expect(verifyTimeoutMs(history(runs, { "other-line": "tienda" }), line, "npm test", now)).toBe(22 * 60_000);
  });

  it("gives at most 4 hours from history alone", () => {
    expect(verifyTimeoutMs(history([span("a", 600)]), line, "npm test", now)).toBe(4 * 3_600_000);
  });
});

describe("what a job leaves running", () => {
  it("tells a path inside the folder from a sibling that only starts the same", () => {
    const folder = "C:\\Users\\ana\\.zero\\worktrees\\tienda\\ab12cd34";
    expect(mentionsFolder(`node "C:/Users/ana/.zero/worktrees/tienda/AB12CD34/node_modules/next/dist/bin/next" dev`, folder, true)).toBe(true);
    expect(mentionsFolder(`node C:\\Users\\ana\\.zero\\worktrees\\tienda\\ab12cd34`, folder, true)).toBe(true);
    expect(mentionsFolder(`node C:\\Users\\ana\\.zero\\worktrees\\tienda\\ab12cd34ff\\x.js`, folder, true)).toBe(false);
    expect(mentionsFolder(`node C:\\Users\\ana\\.zero\\worktrees\\tienda\\other\\x.js`, folder, true)).toBe(false);
    expect(mentionsFolder("/home/ana/.zero/worktrees/tienda/AB12CD34/x", "/home/ana/.zero/worktrees/tienda/ab12cd34", false)).toBe(false);
    expect(mentionsFolder("anything", "", true)).toBe(false);
  });

  it("finds the processes of a folder, never this process or its ancestors", () => {
    const folder = "/home/ana/.zero/worktrees/tienda/ab12cd34";
    const procs: RunningProcess[] = [
      { pid: 1, parent: 0, text: ["init"] },
      { pid: 100, parent: 1, text: [`node dist/cli.js start --note ${folder}`] },
      { pid: 200, parent: 100, text: [`vitest ${folder}`] },
      { pid: 300, parent: 1, text: ["next dev --port 3100", folder] },
      { pid: 301, parent: 300, text: [`node ${folder}/node_modules/next/dist/server/lib/start-server.js`] },
      { pid: 400, parent: 1, text: ["node /home/ana/other/server.js", "/home/ana/other"] },
    ];
    // Seen from process 200, a child of the daemon (100): both are left alone even though they name the folder.
    expect(leftoversIn(folder, procs, 200, false)).toEqual([300, 301]);
  });

  it("kills them and says how many; a listing that fails or a folder too short kills nothing", () => {
    const folder = join(tempDir(), "worktrees", "tienda", "ab12cd34");
    const killed: number[] = [];
    const procs = (): RunningProcess[] => [
      { pid: 300, parent: 1, text: [`node ${join(folder, "server.js")}`] },
      { pid: 400, parent: 1, text: ["node elsewhere.js"] },
    ];
    expect(killLeftovers(folder, procs, (pid) => killed.push(pid))).toBe(1);
    expect(killed).toEqual([300]);
    expect(
      killLeftovers(folder, () => {
        throw new Error("no listing");
      }),
    ).toBe(0);
    expect(killLeftovers("/", () => [{ pid: 300, parent: 1, text: ["node /x.js"] }], (pid) => killed.push(pid))).toBe(0);
    expect(killed).toEqual([300]);
  });

  it("a command cut by its time limit dies with what it had started", async () => {
    const dir = tempDir();
    const pidFile = join(dir, "child.pid");
    writeTree(dir, {
      "child.cjs": "require('fs').writeFileSync('child.pid', String(process.pid)); setInterval(() => {}, 1000);",
      "parent.cjs": "require('child_process').spawn(process.execPath, ['child.cjs'], { stdio: 'ignore' }); setInterval(() => {}, 1000);",
    });
    const r = await sh("node parent.cjs", dir, { timeoutMs: 4_000 });
    expect(r).toMatchObject({ timedOut: true });
    expect(r.ms).toBeGreaterThanOrEqual(3_000);
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 100 && alive(); i++) await new Promise((res) => setTimeout(res, 50));
    expect(alive()).toBe(false);
  });
});

describe("a log line that cannot be written", () => {
  it("is dropped and counted, never thrown", () => {
    const before = lostLogLines();
    vi.spyOn(console, "error").mockImplementation(() => {
      throw Object.assign(new Error("UNKNOWN: unknown error, write"), { errno: -4094, code: "UNKNOWN" });
    });
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("EPIPE");
    });
    expect(() => log.warn("proposal issues failed", { error: "x" })).not.toThrow();
    expect(() => log.info("still here")).not.toThrow();
    expect(() => log.error("cannot serialise", { big: 10n })).not.toThrow();
    expect(lostLogLines()).toBe(before + 3);
  });

  it("an 'error' event of the stream does not end the process", async () => {
    const { PassThrough } = await import("node:stream");
    const stream = new PassThrough();
    const before = lostLogLines();
    guardLogStreams([stream as unknown as NodeJS.WriteStream]);
    guardLogStreams([stream as unknown as NodeJS.WriteStream]);
    expect(stream.listenerCount("error")).toBe(1);
    expect(() => stream.emit("error", new Error("UNKNOWN: unknown error, write"))).not.toThrow();
    expect(lostLogLines()).toBe(before + 1);
  });
});

describe("the line with a slow or failing machine", () => {
  const passes = `node -e "process.exit(0)"`;
  const build = (req: { cwd: string }) => writeTree(req.cwd, { "src/health.ts": "export const status = 'ok';\n" });

  it("tries the setup once more in a fresh copy before failing the job", async () => {
    const repo = gitRepo();
    const mark = join(tempDir(), "first-try").replaceAll("\\", "/");
    // Fails the first time it runs and passes from then on.
    const flaky = `node -e "const fs=require('fs');if(fs.existsSync('${mark}'))process.exit(0);fs.writeFileSync('${mark}','x');process.exit(134)"`;
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, setup: [flaky], verify: [passes] }] });
    const agents = fakeAgents({ build });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered" });
    const setups = ctx.store.spansForJob(job.id).filter((s) => s.name === "zero.setup");
    expect(setups.map((s) => [s.status, s.attrs["zero.setup.try"]])).toEqual([["error", 1], ["ok", 2]]);
  });

  it("a verify command over its limit says how long the limit was and where it is set", async () => {
    const repo = gitRepo();
    const hangs = `node -e "setInterval(() => {}, 1000)"`;
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, maxAttempts: 1, verify: [hangs], verifyTimeoutMinutes: 0.05 }] });
    const agents = fakeAgents({ build });
    const { job } = requestWork(ctx, { text: "health" });
    const failed = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(failed.status).toBe("failed");
    expect(failed.reason).toContain("superó el tiempo límite");
    expect(failed.reason).toContain("verifyTimeoutMinutes");
    const command = ctx.store.spansForJob(job.id).find((s) => s.name === VERIFY_COMMAND_SPAN)!;
    expect(command.attrs).toMatchObject({ "zero.timed_out": true, "zero.timeout_ms": 3_000 });
    expect(command.attrs["zero.run_ms"]).toBeGreaterThanOrEqual(2_500);
  });

  it("a verify command gets twice what its slowest passing run on the line took", async () => {
    const repo = gitRepo();
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, verify: [passes] }] });
    const agents = fakeAgents({ build });
    const first = requestWork(ctx, { text: "health" }).job;
    expect(await runJob(first.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered" });
    const ran = ctx.store.spansForJob(first.id).find((s) => s.name === VERIFY_COMMAND_SPAN)!.attrs["zero.run_ms"] as number;
    expect(ran).toBeGreaterThan(0);
    expect(verifyTimeoutMs(ctx.store, { name: "demo", verifyTimeoutMinutes: 0.00001 }, passes, new Date())).toBe(2 * ran);
    expect(verifyTimeoutMs(ctx.store, ctx.config.lines[0]!, passes, new Date())).toBe(20 * 60_000);
  });
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, regenerationDrill } from "../src/app.js";
import { formatDrill } from "../src/format.js";
import { factoryHome } from "../src/home.js";
import { DRILL_SETUP_MS } from "../src/line/drill.js";
import { VERIFY_COMMAND_SPAN } from "../src/line/pace.js";
import { sh, type ShellResult } from "../src/shell.js";
import { cleanup, fakeAgents, gitIn, gitRepo, run, tempDir, testFactory } from "./helpers.js";

afterEach(cleanup);

const MOD = "export const answer = () => 42;\n// ORIGINAL-SECRET-TEXT\n";
const files = {
  "README.md": "# demo\n",
  "src/mod.ts": MOD,
  "test/mod.test.ts": "check answer\n",
  "openspec/specs/cap/spec.md": "# cap\n\n### Requirement: Answer\nThe module SHALL export answer returning 42.\n",
};

/** Passes when src/mod.ts holds `42`, the way the line's tests would. */
const VERIFY = `node -e "process.exit(require('fs').readFileSync('src/mod.ts','utf8').includes('42')?0:3)"`;

function factory(over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) {
  const repo = gitRepo(files);
  const ctx = testFactory({ engine: "fake", isolation: "worktree", limits: { usdPerJob: 3 }, lines: [{ name: "demo", repo, verify: [VERIFY], ...line }], ...over });
  return { ctx, repo };
}

const rebuild = (text = MOD, missing: string[] = []) => (req: { cwd: string }) => {
  writeFileSync(join(req.cwd, "src", "mod.ts"), text);
  return { output: { missing } };
};

const away = () => tempDir("zero-away-");
const snapshot = (repo: string) => ["for-each-ref", "worktree list --porcelain", "rev-parse HEAD", "status --porcelain"].map((c) => gitIn(repo, ...c.split(" ")));

describe("regeneration drill", () => {
  it("leaves the line's repository as it was", async () => {
    const { ctx, repo } = factory();
    const before = snapshot(repo);
    const agents = fakeAgents({ build: rebuild() });
    await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: agents.runner, cwd: away() });
    expect(snapshot(repo)).toEqual(before);
  });

  it("gives the agent a copy without the removed files or any history of them", async () => {
    const { ctx } = factory();
    const seen: { exists: boolean; count: string; log: string; test: boolean; spec: boolean }[] = [];
    const agents = fakeAgents({
      build: (req) => {
        seen.push({
          exists: existsSync(join(req.cwd, "src", "mod.ts")),
          count: run("git", ["rev-list", "--all", "--count"], req.cwd),
          log: run("git", ["log", "--all", "-p"], req.cwd),
          test: existsSync(join(req.cwd, "test", "mod.test.ts")),
          spec: existsSync(join(req.cwd, "openspec", "specs", "cap", "spec.md")),
        });
        return rebuild()(req);
      },
    });
    await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["**/*"] }, { runAgent: agents.runner, cwd: away() });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ exists: false, count: "1", test: true, spec: true });
    expect(seen[0]!.log).not.toContain("ORIGINAL-SECRET-TEXT");
  });

  it("keeps tests and specifications even when the pattern names them", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ build: rebuild() });
    const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/mod.ts", "test/mod.test.ts", "openspec/specs/cap/spec.md"] }, { runAgent: agents.runner, cwd: away() });
    expect(r.removed).toEqual(["src/mod.ts"]);
  });

  it("refuses a pattern with no code files and creates nothing", async () => {
    for (const patterns of [["test/**", "openspec/**"], ["nada/**"]]) {
      const { ctx } = factory();
      const agents = fakeAgents({});
      await expect(regenerationDrill(ctx, { line: "demo", capability: "cap", patterns }, { runAgent: agents.runner, cwd: away() })).rejects.toThrow(/Ningún archivo de código/);
      expect(existsSync(ctx.home.drills)).toBe(false);
      expect(agents.calls).toHaveLength(0);
    }
  });

  it("makes one build call with the given cap and a prompt naming the spec and the file", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ build: rebuild() });
    await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"], usd: 0.5 }, { runAgent: agents.runner, cwd: away() });
    expect(agents.calls).toHaveLength(1);
    const call = agents.calls[0]!;
    expect(call.station).toBe("build");
    expect(call.maxBudgetUsd).toBe(0.5);
    expect(call.cwd.startsWith(ctx.home.drills + sep)).toBe(true);
    expect(call.cwd.endsWith(`${sep}copy`)).toBe(true);
    expect(call.prompt).toContain("openspec/specs/cap/spec.md");
    expect(call.prompt).toContain("src/mod.ts");
  });

  it("caps the call at limits.usdPerJob by default", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ build: rebuild() });
    await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: agents.runner, cwd: away() });
    expect(agents.calls[0]!.maxBudgetUsd).toBe(3);
  });

  it("runs setup before the agent and verify in the copy, never in the line's repository", async () => {
    const mark = (name: string) => `node -e "require('fs').writeFileSync('${name}','x')"`;
    const { ctx, repo } = factory({}, { setup: [mark("setup.mark")], verify: [mark("verify.mark"), VERIFY] });
    let setupFirst = false;
    const agents = fakeAgents({
      build: (req) => {
        setupFirst = existsSync(join(req.cwd, "setup.mark"));
        return rebuild()(req);
      },
    });
    const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"], keep: true }, { runAgent: agents.runner, cwd: away() });
    const copy = agents.calls[0]!.cwd;
    expect(setupFirst).toBe(true);
    expect(existsSync(join(copy, "verify.mark"))).toBe(true);
    expect(existsSync(join(repo, "setup.mark"))).toBe(false);
    expect(existsSync(join(repo, "verify.mark"))).toBe(false);
    expect(r.verify.map((c) => c.code)).toEqual([0, 0]);
    // With keep the copy stays whole and the report names it.
    expect(copy).toBe(join(ctx.home.drills, r.id, "copy"));
    expect(r.copyKept).toBe(true);
    expect(readFileSync(join(copy, "src", "mod.ts"), "utf8")).toBe(MOD);
    const report = readFileSync(r.report, "utf8");
    expect(report).toContain("Copia de trabajo:");
    expect(report).toContain(copy);
    expect(JSON.parse(readFileSync(join(ctx.home.drills, r.id, "resultado.json"), "utf8")).copyKept).toBe(true);
  });

  it("says the specifications are enough when the file comes back and verify passes", async () => {
    const { ctx } = factory();
    const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build: rebuild() }).runner, cwd: away() });
    expect(r.outcome).toBe("alcanzan");
    expect(r.rebuilt).toEqual(["src/mod.ts"]);
  });

  it("says they are not enough when verify fails, with the command, its code and its output", async () => {
    const { ctx } = factory({}, { verify: [`node -e "console.log('falló la respuesta'); process.exit(3)"`] });
    const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build: rebuild("export const answer = () => 41;\n") }).runner, cwd: away() });
    expect(r.outcome).toBe("no alcanzan");
    const report = readFileSync(r.report, "utf8");
    expect(report).toContain("process.exit(3)");
    expect(report).toContain("Código de salida: 3");
    expect(report).toContain("falló la respuesta");
  });

  it("says they are not enough when a removed file is not rebuilt, naming it", async () => {
    const { ctx } = factory({}, { verify: [`node -e "process.exit(0)"`] });
    const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build: () => ({ output: { missing: [] } }) }).runner, cwd: away() });
    expect(r.outcome).toBe("no alcanzan");
    expect(r.notRebuilt).toEqual(["src/mod.ts"]);
    expect(readFileSync(r.report, "utf8")).toMatch(/## No reconstruidos\n\n- src\/mod\.ts/);
  });

  it("says they are not enough when the agent fails or hits its cap, and still writes the report", async () => {
    for (const over of [{ ok: false, text: "no pude" }, { budgetLimited: true }]) {
      const { ctx } = factory();
      const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build: (req) => ({ ...rebuild()(req), ...over }) }).runner, cwd: away() });
      expect(r.outcome).toBe("no alcanzan");
      expect(existsSync(r.report)).toBe(true);
      expect(existsSync(join(ctx.home.drills, r.id, "copy"))).toBe(false);
    }
  });

  it("is invalid when the agent changes a test, naming it", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({
      build: (req) => {
        writeFileSync(join(req.cwd, "test", "mod.test.ts"), "nothing to check\n");
        return rebuild()(req);
      },
    });
    const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: agents.runner, cwd: away() });
    expect(r.outcome).toBe("inválido");
    expect(r.tampered).toEqual(["test/mod.test.ts"]);
    expect(readFileSync(r.report, "utf8")).toContain("test/mod.test.ts");
  });

  it("writes the report and its JSON in ZERO_HOME, with what was missing", async () => {
    const { ctx, repo } = factory();
    const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build: rebuild(MOD, ["el formato de fecha"]) }).runner, cwd: away() });
    expect(r.report).toBe(join(ctx.home.drills, r.id, "informe.md"));
    const report = readFileSync(r.report, "utf8");
    expect(report).toContain("Qué faltaba en las especificaciones");
    expect(report).toContain("el formato de fecha");
    for (const text of ["demo", "cap", gitIn(repo, "rev-parse", "main"), "src/mod.ts", "alcanzan", "US$ 0.10"]) expect(report).toContain(text);
    const json = JSON.parse(readFileSync(join(ctx.home.drills, r.id, "resultado.json"), "utf8"));
    expect(json.outcome).toBe("alcanzan");
    expect(json.missing).toEqual(["el formato de fecha"]);
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
    // Only the report and its JSON stay: the copy is deleted at the end.
    expect(existsSync(join(ctx.home.drills, r.id, "copy"))).toBe(false);
    expect(report).toMatch(/Copia de trabajo:.*borr/);
    expect(json).toMatchObject({ outcome: "alcanzan", copyKept: false });
  });

  describe("time limits", () => {
    const SETUP = `node -e "process.exit(0)"`;
    const SLOW = `node -e "process.exit(5)"`;
    /** Records the limit of each command and answers the chosen ones; the rest run for real. */
    const fakeSh = (answers: Record<string, Partial<ShellResult>> = {}) => {
      const limits: Record<string, number> = {};
      const fn = async (command: string, cwd: string, opts: { timeoutMs: number }): Promise<ShellResult> => {
        limits[command] = opts.timeoutMs;
        const a = answers[command];
        return a ? { code: 0, output: "", timedOut: false, ms: 1, ...a } : sh(command, cwd, opts);
      };
      return { fn, limits };
    };
    const drill = (ctx: ReturnType<typeof factory>["ctx"], s: ReturnType<typeof fakeSh>, build = rebuild()) =>
      regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build }).runner, sh: s.fn, cwd: away() });
    const json = (ctx: ReturnType<typeof factory>["ctx"], id: string) => JSON.parse(readFileSync(join(ctx.home.drills, id, "resultado.json"), "utf8"));
    const resultLine = (report: string) => report.split("\n").find((l) => l.startsWith("- Resultado:"))!;

    it("runs verify with the line's verifyTimeoutMinutes and setup with 20 minutes, and keeps each limit", async () => {
      const { ctx } = factory({}, { setup: [SETUP], verifyTimeoutMinutes: 45 });
      const s = fakeSh();
      const r = await drill(ctx, s);
      expect(s.limits).toEqual({ [SETUP]: 20 * 60_000, [VERIFY]: 45 * 60_000 });
      expect(r.outcome).toBe("alcanzan");
      expect(r.setup[0]!.timeoutMs).toBe(DRILL_SETUP_MS);
      expect(r.verify[0]!.timeoutMs).toBe(2_700_000);
      expect(readFileSync(r.report, "utf8")).not.toContain("cortado a los");
    });

    it("gives verify the limit learned from the line's passing runs", async () => {
      const { ctx } = factory();
      const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });
      const end = new Date(Date.now() - 86_400_000);
      ctx.store.insertSpan({ id: "s1", jobId: job.id, name: VERIFY_COMMAND_SPAN, start: new Date(end.getTime() - 30 * 60_000).toISOString(), end: end.toISOString(), status: "ok", attrs: { "process.command_line": VERIFY, "zero.run_ms": 30 * 60_000 } });
      const s = fakeSh();
      await drill(ctx, s);
      expect(s.limits[VERIFY]).toBe(60 * 60_000);
    });

    it("gives verify 20 minutes without history or a limit of the line", async () => {
      const { ctx } = factory();
      const s = fakeSh();
      await drill(ctx, s);
      expect(s.limits[VERIFY]).toBe(20 * 60_000);
    });

    it("is unmeasured when the only failures are time cuts, with the real limit in the report", async () => {
      const { ctx } = factory({}, { verifyTimeoutMinutes: 45 });
      const r = await drill(ctx, fakeSh({ [VERIFY]: { code: 1, timedOut: true } }));
      expect(r.outcome).toBe("sin medir");
      const report = readFileSync(r.report, "utf8");
      expect(report).toContain("cortado a los 45 minutos");
      expect(report).toContain("verifyTimeoutMinutes");
      expect(report).not.toContain("cortado a los 20 minutos");
      expect(report).toContain("**sin medir**");
      expect(resultLine(report)).toContain("verifyTimeoutMinutes");
      expect(resultLine(report)).not.toContain("no alcanzan");
      expect(json(ctx, r.id)).toMatchObject({ outcome: "sin medir", verify: [{ timeoutMs: 2_700_000, timedOut: true }] });
    });

    it("is not enough when another verify command really failed", async () => {
      const { ctx } = factory({}, { verify: [VERIFY, SLOW] });
      const r = await drill(ctx, fakeSh({ [VERIFY]: { code: 1, timedOut: true }, [SLOW]: { code: 3, timedOut: false } }));
      expect(r.outcome).toBe("no alcanzan");
    });

    it("is invalid when a test was touched, even with a time cut", async () => {
      const { ctx } = factory();
      const build = (req: { cwd: string }) => {
        writeFileSync(join(req.cwd, "test", "mod.test.ts"), "nothing to check\n");
        return rebuild()(req);
      };
      const r = await drill(ctx, fakeSh({ [VERIFY]: { code: 1, timedOut: true } }), build);
      expect(r.outcome).toBe("inválido");
    });

    it("is not enough when a time cut comes with a file not rebuilt or an agent that failed", async () => {
      const builds = [() => ({ output: { missing: [] } }), (req: { cwd: string }) => ({ ...rebuild()(req), ok: false, text: "no pude" }), (req: { cwd: string }) => ({ ...rebuild()(req), budgetLimited: true })];
      for (const build of builds) {
        const { ctx } = factory();
        const r = await drill(ctx, fakeSh({ [VERIFY]: { code: 1, timedOut: true } }), build);
        expect(r.outcome).toBe("no alcanzan");
      }
    });
  });

  describe("working copy", () => {
    const copyOf = (ctx: ReturnType<typeof factory>["ctx"], id: string) => join(ctx.home.drills, id, "copy");
    const json = (ctx: ReturnType<typeof factory>["ctx"], id: string) => JSON.parse(readFileSync(join(ctx.home.drills, id, "resultado.json"), "utf8"));

    it("a failed deletion leaves the result as it was and is only logged as a warning", async () => {
      const { ctx } = factory();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const removeCopy = async () => {
          throw new Error("EBUSY");
        };
        const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build: rebuild() }).runner, removeCopy, cwd: away() });
        expect(r.outcome).toBe("alcanzan");
        expect(existsSync(r.report)).toBe(true);
        expect(json(ctx, r.id).outcome).toBe("alcanzan");
        const lines = errors.mock.calls.map((c) => String(c[0]));
        expect(lines.some((l) => l.includes('"level":"warn"') && l.includes(JSON.stringify(copyOf(ctx, r.id)).slice(1, -1)) && l.includes("EBUSY"))).toBe(true);
      } finally {
        errors.mockRestore();
      }
    });
  });

  describe("time limits", () => {
    type Answer = { code?: number; timedOut?: boolean };
    const cut: Answer = { code: 1, timedOut: true };

    /** A drill whose commands run nothing: each one gives what `answers` says (0 by default) and its limit is recorded. */
    async function drill(line: Record<string, unknown>, answers: Record<string, Answer> = {}, opts: { ctx?: ReturnType<typeof factory>["ctx"]; build?: Parameters<typeof fakeAgents>[0]["build"] } = {}) {
      const ctx = opts.ctx ?? factory({}, line).ctx;
      const limits: Record<string, number> = {};
      const sh = async (command: string, _cwd: string, o: { timeoutMs: number }) => {
        limits[command] = o.timeoutMs;
        return { code: 0, output: "", timedOut: false, ...answers[command] };
      };
      const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build: opts.build ?? rebuild() }).runner, sh, cwd: away() });
      const json = JSON.parse(readFileSync(join(ctx.home.drills, r.id, "resultado.json"), "utf8")) as typeof r;
      return { r, limits, json, report: readFileSync(r.report, "utf8") };
    }

    it("gives a verify command the limit learned from its passing runs", async () => {
      const now = new Date("2026-11-20T12:00:00Z");
      const ctx = testFactory({ engine: "fake", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(files), verify: ["npm test", "npm run lint"] }] }, () => now);
      const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });
      const attrs = { "process.command_line": "npm test", "zero.run_ms": 1_668_000 };
      ctx.store.insertSpan({ id: "s1", jobId: job.id, name: VERIFY_COMMAND_SPAN, start: "2026-11-19T10:00:00.000Z", attrs });
      // It waited for a turn too: what counts is how long the command ran.
      ctx.store.endSpan("s1", "2026-11-19T12:00:00.000Z", "ok", attrs);
      expect((await drill({}, {}, { ctx })).limits).toEqual({ "npm test": 3_336_000, "npm run lint": 1_200_000 });
    });

    it("gives every verify command the line's verifyTimeoutMinutes, and setup 20 minutes, and keeps each limit", async () => {
      const { r, limits, json } = await drill({ setup: ["prepare"], verify: ["a", "b"], verifyTimeoutMinutes: 45 });
      expect(limits).toEqual({ prepare: 1_200_000, a: 2_700_000, b: 2_700_000 });
      for (const result of [r, json]) {
        expect(result.setup.map((c) => c.timeoutMs)).toEqual([1_200_000]);
        expect(result.verify.map((c) => c.timeoutMs)).toEqual([2_700_000, 2_700_000]);
      }
    });

    it("gives verify 20 minutes without history or a limit of its own", async () => {
      expect((await drill({ verify: ["a", "b"] })).limits).toEqual({ a: 1_200_000, b: 1_200_000 });
    });

    it("measures nothing when the only failure is a cut, and the report says why and the real limit", async () => {
      const { r, json, report } = await drill({ verify: ["a", "b"], verifyTimeoutMinutes: 45 }, { b: cut });
      expect(r.outcome).toBe("sin medir");
      expect(json.outcome).toBe("sin medir");
      const result = report.split("\n").find((l) => l.startsWith("- Resultado:"))!;
      expect(result).toContain("**sin medir**");
      expect(result).toMatch(/verify se cortó por tiempo.*no dice nada de las especificaciones/);
      expect(report).toContain("cortado a los 45 minutos");
      expect(report).toContain("verifyTimeoutMinutes");
      expect(report).not.toContain("cortado a los 20 minutos");
    });

    it("says a limit of one minute or less as it is, never 0", async () => {
      for (const [minutes, text] of [[0.05, "cortado a los 0,05 minutos"], [0.0001, "cortado a los 0,01 minutos"], [1, "cortado al cabo de 1 minuto;"]] as const) {
        const { report } = await drill({ verify: ["a"], verifyTimeoutMinutes: minutes }, { a: cut });
        expect(report).toContain(text);
        expect(report).not.toContain("cortado a los 0 minutos");
      }
    });

    it("says a cut setup is not enough, with its own 20 minutes", async () => {
      const { r, report } = await drill({ setup: ["prepare"], verify: ["a"], verifyTimeoutMinutes: 45 }, { prepare: cut });
      expect(r.outcome).toBe("no alcanzan");
      expect(report).toContain("cortado a los 20 minutos");
      expect(report).not.toContain("verifyTimeoutMinutes");
    });

    it("cuts a real command that never ends", async () => {
      const { ctx } = factory({}, { verify: [`node -e "setInterval(() => {}, 1000)"`], verifyTimeoutMinutes: 0.03 });
      const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: fakeAgents({ build: rebuild() }).runner, cwd: away() });
      expect(r.outcome).toBe("sin medir");
      expect(r.verify).toMatchObject([{ timedOut: true, timeoutMs: 1_800 }]);
    });

    it("says a real failure is not enough, alone or next to a cut, in any order", async () => {
      const alone = await drill({ verify: ["a"] }, { a: { code: 3 } });
      expect(alone.r.outcome).toBe("no alcanzan");
      expect(alone.report).toContain("Código de salida: 3");
      expect(alone.report).not.toContain("cortado a los");
      expect((await drill({ verify: ["a", "b"] }, { a: cut, b: { code: 3 } })).r.outcome).toBe("no alcanzan");
      expect((await drill({ verify: ["a", "b"] }, { a: { code: 3 }, b: cut })).r.outcome).toBe("no alcanzan");
    });

    it("does not let a cut cover a missing file or an agent that did not end well", async () => {
      const missing = await drill({ verify: ["a"] }, { a: cut }, { build: () => ({ output: { missing: [] } }) });
      expect(missing.r.outcome).toBe("no alcanzan");
      for (const over of [{ ok: false, text: "no pude" }, { budgetLimited: true }]) {
        const { r } = await drill({ verify: ["a"] }, { a: cut }, { build: (req) => ({ ...rebuild()(req), ...over }) });
        expect(r.verify).toMatchObject([{ timedOut: true }]);
        expect(r.outcome).toBe("no alcanzan");
      }
    });

    it("is invalid when a test was touched, even if verify was cut", async () => {
      const build = (req: { cwd: string }) => {
        writeFileSync(join(req.cwd, "test", "mod.test.ts"), "nothing to check\n");
        return rebuild()(req);
      };
      const { r } = await drill({ verify: ["a"] }, { a: cut }, { build });
      expect(r.outcome).toBe("inválido");
      expect(r.tampered).toEqual(["test/mod.test.ts"]);
    });
  });

  it("tells the result on the terminal, explaining the one that measured nothing", () => {
    const text = formatDrill({ outcome: "sin medir", report: "/h/informe.md" });
    expect(text).toContain("Resultado: sin medir\n");
    expect(text).toContain("se cortó por tiempo");
    expect(text).toContain("verifyTimeoutMinutes");
    expect(text).toContain("Informe: /h/informe.md");
    for (const outcome of ["alcanzan", "no alcanzan", "inválido"] as const) {
      expect(formatDrill({ outcome, report: "/h/informe.md" })).toBe(`Resultado: ${outcome}\nInforme: /h/informe.md`);
    }
    expect(readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8")).toContain("console.log(formatDrill(r))");
  });

  it("refuses when ZERO_HOME is inside the line's repository, without calling the agent", async () => {
    const { ctx, repo } = factory();
    const inside = { ...ctx, home: factoryHome(join(repo, "sub", "home")) };
    const agents = fakeAgents({});
    await expect(regenerationDrill(inside, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: agents.runner, cwd: away() })).rejects.toThrow(/línea "demo".*no se versiona/);
    expect(agents.calls).toHaveLength(0);
    expect(existsSync(inside.home.drills)).toBe(false);
  });

  describe("refuses before spending", () => {
    const refused = async (ctx: ReturnType<typeof factory>["ctx"], input: Partial<Parameters<typeof regenerationDrill>[1]>, message: RegExp) => {
      const agents = fakeAgents({});
      await expect(regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"], ...input }, { runAgent: agents.runner, cwd: away() })).rejects.toThrow(message);
      expect(agents.calls).toHaveLength(0);
      expect(existsSync(ctx.home.drills)).toBe(false);
    };

    it("an unknown line", () => refused(factory().ctx, { line: "otra" }, /otra/));
    it("a capability without a spec", () => refused(factory().ctx, { capability: "fantasma" }, /fantasma/));
    it("the isolation box", () => refused(factory({ isolation: "container" }).ctx, {}, /isolation/));
    it("a line without verify", () => refused(factory({}, { verify: [] }).ctx, {}, /verify/));
    it("a cap above limits.usdPerJob", () => refused(factory().ctx, { usd: 5 }, /usdPerJob/));
    it("a cap that is not a positive number", () => refused(factory().ctx, { usd: Number("x") }, /positivo/));
    it("the andon", () => {
      const { ctx } = factory();
      ctx.store.setKv(ANDON_KEY, "on");
      return refused(ctx, {}, /andon/);
    });
  });
});

describe("regeneration drill documentation", () => {
  const read = (file: string) => readFileSync(join(import.meta.dirname, "..", file), "utf8").replace(/\r\n/g, "\n");
  const after = (text: string, heading: string) => text.split("\n").slice(text.split("\n").indexOf(heading) + 1).find((l) => l.trim())!;

  it("is in both READMEs and in the CLI help, and out of the next steps", () => {
    expect(read("README.md")).toContain("zero simulacro");
    expect(read("README.es.md")).toContain("zero simulacro");
    expect(read("src/cli.ts")).toMatch(/^  zero simulacro <línea> <capacidad> --archivos <patrón>\.\.\. \[--usd N\] \[--conservar\]$/m);
    expect(read("README.md")).toContain("--conservar");
    expect(read("README.es.md")).toContain("--conservar");
    expect(after(read("README.md"), "## Next steps")).not.toContain("Regeneration drill");
    expect(after(read("README.es.md"), "## Próximas etapas")).not.toContain("Simulacro de regeneración");
  });

  it("describes the result that measured nothing and no fixed limit for verify", () => {
    for (const [file, old] of [["README.md", "up to 20 minutes each"], ["README.es.md", "hasta 20 minutos cada uno"], ["docs/agents/production-line.md", "runs `verify` (20 minutes each)"]] as const) {
      expect(read(file)).toContain("sin medir");
      expect(read(file)).not.toContain(old);
    }
  });
});

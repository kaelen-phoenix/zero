import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, regenerationDrill } from "../src/app.js";
import { factoryHome } from "../src/home.js";
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
    const r = await regenerationDrill(ctx, { line: "demo", capability: "cap", patterns: ["src/**"] }, { runAgent: agents.runner, cwd: away() });
    const copy = agents.calls[0]!.cwd;
    expect(setupFirst).toBe(true);
    expect(existsSync(join(copy, "verify.mark"))).toBe(true);
    expect(existsSync(join(repo, "setup.mark"))).toBe(false);
    expect(existsSync(join(repo, "verify.mark"))).toBe(false);
    expect(r.verify.map((c) => c.code)).toEqual([0, 0]);
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
    expect(read("src/cli.ts")).toMatch(/^  zero simulacro <línea> <capacidad> --archivos <patrón>\.\.\. \[--usd N\]$/m);
    expect(after(read("README.md"), "## Next steps")).not.toContain("Regeneration drill");
    expect(after(read("README.es.md"), "## Próximas etapas")).not.toContain("Simulacro de regeneración");
  });
});

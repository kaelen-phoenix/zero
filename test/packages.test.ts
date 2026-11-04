import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentName, createAgentRunner, type EngineExecute } from "../src/agent.js";
import { addSkill, agentList, ANDON_KEY, factoryStatus, npmInstallArgs, packageAdd, packageList, packageRemove, requestWork, skillList, type FactoryContext } from "../src/app.js";
import { stationEngines } from "../src/box/credentials.js";
import { budgetState } from "../src/budget.js";
import { ConfigError, parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import type { EngineRequest } from "../src/engines/index.js";
import { formatPackages, formatStatus } from "../src/format.js";
import { packagesPass, stationLastKey } from "../src/line/packages.js";
import { runJob } from "../src/line/runner.js";
import { scoutSpent } from "../src/line/scout.js";
import { log } from "../src/log.js";
import { factoryConfig, loadPackages } from "../src/packages.js";
import { memoryKeyring, SecretStore } from "../src/keychain.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const passes = `node -e "process.exit(0)"`;
const NOW = new Date("2026-11-04T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

/** A package folder from its manifest and files. */
function pkg(manifest: Record<string, unknown>, files: Record<string, string> = {}): string {
  const dir = tempDir("zero-pkg-");
  writeTree(dir, { "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", ...manifest }), ...files });
  return dir;
}

const reviewer = { agents: [{ name: "hello-review", instructions: "agents/review.md" }] };
const REVIEW_FILES = { "agents/review.md": "# hello-review\nLook at the greetings.\n" };

/** A station whose module appends a line to `marker` per call, with the given body in `pass`. */
function stationPkg(opts: { name?: string; station?: Record<string, unknown>; body?: string; top?: string; marker?: string; extra?: Record<string, unknown>; files?: Record<string, string> } = {}) {
  const marker = opts.marker ?? join(tempDir("zero-marker-"), "calls.txt");
  const mod = `import { appendFileSync } from "node:fs";
const marker = ${JSON.stringify(marker)};
${opts.top ?? ""}
export async function pass(ctx) {
  appendFileSync(marker, "pass\\n");
  ${opts.body ?? ""}
}
`;
  const dir = pkg(
    { name: opts.name ?? "hello", stations: [{ name: "nota", module: "stations/nota.mjs", instructions: "stations/nota.md", ...opts.station }], ...opts.extra },
    { "stations/nota.mjs": mod, "stations/nota.md": "# nota\nWrite a note.\n", ...opts.files },
  );
  return { dir, marker };
}

const calls = (marker: string) => (existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n").length : 0);

/** A factory with these package entries, its config loaded as the daemon does. */
async function factory(packages: unknown[], over: Record<string, unknown> = {}, now?: () => Date): Promise<FactoryContext> {
  const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [{ name: "web", repo: gitRepo(), verify: [passes] }], packages, ...over }, now);
  ctx.config = await factoryConfig(ctx.home);
  return ctx;
}

const problems = (ctx: FactoryContext) => ctx.config.loadedPackages!.problems;
const pass = (ctx: FactoryContext, runner = fakeAgents({}).runner, now = NOW) => packagesPass(ctx, runner, now);

describe("declaring packages in the factory file", () => {
  it("takes a local entry and an npm one, without permission to run code", () => {
    const cfg = parseFactory("packages:\n  - path: ./mine\n  - npm: '@acme/hello'\n    engine: codex\n    model: m\n    config: { saludo: hola }\n");
    expect(cfg.packages).toEqual([
      { path: "./mine", allowCode: false },
      { npm: "@acme/hello", allowCode: false, engine: "codex", model: "m", config: { saludo: "hola" } },
    ]);
    expect(parseFactory("{}").packages).toEqual([]);
  });

  it("refuses both sources at once, or none, naming packages", () => {
    for (const entry of ["{ path: ./a, npm: b }", "{ allowCode: true }"]) {
      expect(() => parseFactory(`packages:\n  - ${entry}\n`)).toThrow(ConfigError);
      expect(() => parseFactory(`packages:\n  - ${entry}\n`)).toThrow(/packages/);
    }
  });

  it("refuses an unknown engine, naming it", () => {
    expect(() => parseFactory("packages:\n  - { path: ./a, engine: ghost }\n")).toThrow(/ghost/);
  });

  it("refuses a credential in its config", () => {
    expect(() => parseFactory(`packages:\n  - path: ./a\n    config: { key: ghp_${"a".repeat(36)} }\n`)).toThrow(ConfigError);
  });

  it("never takes what was loaded from the file", () => {
    expect(parseFactory("loadedPackages: { agents: [{ name: sneaky }] }\n").loadedPackages).toBeUndefined();
  });
});

describe("the manifest", () => {
  it("loads a valid one, with its name and version", async () => {
    const ctx = await factory([{ path: pkg({}) }]);
    expect(ctx.config.loadedPackages!.packages).toMatchObject([{ name: "hello", version: "1.0.0" }]);
    expect(problems(ctx)).toEqual([]);
  });

  it("refuses another interface, naming the one asked for and the one supported", async () => {
    const ctx = await factory([{ path: pkg({ interface: 2 }) }]);
    expect(ctx.config.loadedPackages!.packages).toEqual([]);
    expect(problems(ctx)[0]!.reason).toMatch(/interfaz 2.*interfaz 1/);
  });

  it.each([
    ["instructions", { agents: [{ name: "a", instructions: "../afuera.md" }] }],
    ["a skill", { skills: ["../afuera.md"] }],
    ["a module", { stations: [{ name: "s", module: "../afuera.md" }] }],
  ])("refuses %s leaving the package, naming the path", async (_what, manifest) => {
    const ctx = await factory([{ path: pkg(manifest) }]);
    expect(ctx.config.loadedPackages!.packages).toEqual([]);
    expect(problems(ctx)[0]!.reason).toContain("../afuera.md");
  });

  it("refuses absolute paths and unknown keys", async () => {
    const absolute = await factory([{ path: pkg({ skills: ["/etc/skill"] }) }]);
    expect(problems(absolute)[0]!.reason).toContain("/etc/skill");
    const unknown = await factory([{ path: pkg({ extra: true }) }]);
    expect(problems(unknown)[0]!.reason).toMatch(/extra|no es válido/);
  });

  it("refuses a link that leaves the package", async (t) => {
    const outside = join(tempDir(), "secret.md");
    writeFileSync(outside, "secret");
    const dir = pkg({ agents: [{ name: "a", instructions: "link.md" }] });
    try {
      symlinkSync(outside, join(dir, "link.md"));
    } catch {
      return t.skip();
    }
    const ctx = await factory([{ path: dir }]);
    expect(problems(ctx)[0]!.reason).toContain("link.md");
  });

  it("refuses a link inside a skill that leaves the package", async (t) => {
    const outside = join(tempDir(), "secret.txt");
    writeFileSync(outside, "secret");
    const dir = pkg({ skills: ["skills/s"] }, { "skills/s/SKILL.md": "# s\n" });
    try {
      symlinkSync(outside, join(dir, "skills/s/leak.txt"));
    } catch {
      return t.skip();
    }
    expect(problems(await factory([{ path: dir }]))[0]!.reason).toContain("leak.txt");
  });

  it.each(["engine", "model"])("refuses %s on an agent or a station, as an unknown key", async (key) => {
    const agent = await factory([{ path: pkg({ agents: [{ name: "a", instructions: "a.md", [key]: "claude" }] }, { "a.md": "# a\n" }) }]);
    expect(agent.config.loadedPackages!.packages).toEqual([]);
    expect(problems(agent)[0]!.reason).toContain(key);
    const station = await factory([{ path: stationPkg({ station: { [key]: "claude" } }).dir, allowCode: true }]);
    expect(station.config.loadedPackages!.packages).toEqual([]);
    expect(problems(station)[0]!.reason).toContain(key);
  });
});

describe("a broken package", () => {
  it("stays out without throwing, and the valid one loads", async () => {
    const missing = join(tempDir(), "no-existe");
    const ctx = await factory([{ path: missing }, { path: pkg({}) }]);
    expect(ctx.config.loadedPackages!.packages.map((p) => p.name)).toEqual(["hello"]);
    expect(problems(ctx)).toEqual([{ package: missing, reason: expect.stringContaining("no existe") }]);
  });

  it("shows in the factory's status, with its name or path", async () => {
    const ctx = await factory([{ path: pkg({ interface: 2 }) }]);
    const status = factoryStatus(ctx);
    expect(status.packages[0]!.reason).toContain("interfaz 2");
    expect(formatStatus(status)).toContain("Paquete");
    const missing = await factory([{ npm: "not-installed" }]);
    expect(factoryStatus(missing).packages[0]!.package).toBe("not-installed");
    expect(packageList(missing).problems[0]!.package).toBe("not-installed");
  });

  it("is logged once per distinct message", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const dir = pkg({ interface: 3 });
    const ctx = await factory([{ path: dir }]);
    loadPackages(ctx.config, ctx.home);
    loadPackages(ctx.config, ctx.home);
    expect(warn.mock.calls.filter(([m]) => m.includes("interfaz 3"))).toHaveLength(1);
  });
});

describe("a package's agents", () => {
  const writeHealth = (req: { cwd: string }) => void writeTree(req.cwd, { "src/health.ts": "export const status = 'ok';\n" });

  it("review after security, after the file's global ones, with the package's instructions", async () => {
    const ctx = await factory([{ path: pkg(reviewer, REVIEW_FILES), engine: "codex", model: "m" }], { agents: [{ name: "docs", instructions: "docs.md" }] });
    writeTree(dirname(ctx.home.config), { "docs.md": "# docs\n" });
    const agents = fakeAgents({ build: writeHealth });
    const { job } = requestWork(ctx, { text: "health" });
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered" });
    expect(agents.calls.map(agentName)).toEqual(["spec", "build", "review", "security", "docs", "hello-review"]);
    const call = agents.calls.at(-1)!;
    expect(call.custom).toMatchObject({ access: "read", engine: "codex", model: "m" });
    expect(call.custom!.instructions).toContain("Look at the greetings");
  });

  it("write between build and verify, and zero commits it under their name", async () => {
    const ctx = await factory([{ path: pkg({ agents: [{ name: "hello-writer", type: "build", instructions: "w.md" }] }, { "w.md": "# w\n" }) }]);
    const agents = fakeAgents({ build: writeHealth, "hello-writer": (req) => void writeTree(req.cwd, { "docs/x.md": "# x\n" }) });
    const { job } = requestWork(ctx, { text: "health" });
    const repo = ctx.config.lines[0]!.repo;
    expect(await runJob(job.id, { ...ctx, runAgent: agents.runner })).toMatchObject({ status: "delivered" });
    expect(agents.calls.map(agentName)).toEqual(["spec", "build", "hello-writer", "review", "security"]);
    expect(readFileSync(join(repo, "docs/x.md"), "utf8")).toContain("# x");
    expect(gitIn(repo, "log", "--format=%s", "main")).toContain("hello-writer");
  });

  it("are listed with origin package and the path inside the package", async () => {
    const dir = pkg(reviewer, REVIEW_FILES);
    const ctx = await factory([{ path: dir }]);
    expect(agentList(ctx, "web")[0]!.agents).toEqual([expect.objectContaining({ name: "hello-review", origin: "package", missing: false })]);
    expect(agentList(ctx, "web")[0]!.agents[0]!.path).toMatch(/agents[\\/]review\.md$/);
  });

  it.each([
    ["a fixed station", "review", {}],
    ["an agent in the file", "docs", { agents: [{ name: "docs", instructions: "docs.md" }] }],
    ["an agent of a line", "seo", { lines: [{ name: "web", repo: "/tmp/never", agents: [{ name: "seo" }] }] }],
  ])("refuse the name of %s, naming the agent", async (_what, name, over) => {
    const ctx = await factory([{ path: pkg({ agents: [{ name, instructions: "a.md" }] }, { "a.md": "# a\n" }) }], over);
    expect(ctx.config.loadedPackages!.packages).toEqual([]);
    expect(problems(ctx)[0]!.reason).toContain(`"${name}"`);
  });

  it("refuse the name of another package's agent, and only that package stays out", async () => {
    const a = pkg({ name: "uno", agents: [{ name: "same", instructions: "a.md" }] }, { "a.md": "# a\n" });
    const b = pkg({ name: "dos", agents: [{ name: "same", instructions: "a.md" }] }, { "a.md": "# a\n" });
    const ctx = await factory([{ path: a }, { path: b }]);
    expect(ctx.config.loadedPackages!.packages.map((p) => p.name)).toEqual(["uno"]);
    expect(problems(ctx)).toEqual([{ package: "dos", reason: expect.stringContaining(`"same"`) }]);
  });

  it("are not written to the file by an edit, and stay loaded after it", async () => {
    const ctx = await factory([{ path: pkg(reviewer, REVIEW_FILES) }]);
    await addSkill(ctx, { skill: "anything", station: "build" });
    expect(readFileSync(ctx.home.config, "utf8")).not.toContain("hello-review");
    expect(ctx.config.loadedPackages!.agents.map((a) => a.name)).toEqual(["hello-review"]);
  });

  it("count for the engines the box and the budget look at", async () => {
    const ctx = await factory([{ path: pkg(reviewer, REVIEW_FILES), engine: "codex" }]);
    expect(stationEngines(ctx.config)).toContain("codex");
    const spent = ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "hello-review", "zero.engine": "codex", "zero.billing": "api" } });
    spent.end("ok", { "zero.cost.usd": 100 });
    expect(budgetState(ctx.store, ctx.config).reached).toBe(true);
  });
});

describe("a package's skills", () => {
  const SKILL = "---\nname: greeting\nallowed-tools: Bash\ndescription: How to greet\n---\nSay hello.\n";
  const withSkill = (agent: Record<string, unknown> = {}) => pkg({ skills: ["skills/greeting"], agents: [{ name: "hello-review", instructions: "a.md", skills: ["greeting"], ...agent }] }, { "skills/greeting/SKILL.md": SKILL, "a.md": "# a\n" });
  const seen = () => {
    const out: EngineRequest[] = [];
    const texts: string[] = [];
    const execute: EngineExecute = async (_e, req) => (out.push(req), texts.push(...(req.skills?.skills.map((s) => s.text) ?? [])), { ok: true, text: "ok" });
    return { out, texts, execute };
  };

  it("reach the package's own agent by short name, staged without allowed-tools", async () => {
    const ctx = await factory([{ path: withSkill() }]);
    const { out, texts, execute } = seen();
    const agent = ctx.config.loadedPackages!.agents[0]!;
    expect(agent.skills).toEqual(["hello:greeting"]);
    await createAgentRunner(ctx.config, { execute, claudeHome: tempDir() })({ station: "review", prompt: "p", cwd: tempDir(), custom: { name: agent.name, instructions: "x", access: "read", maxTurns: 1, timeoutMinutes: 1, skills: agent.skills } });
    expect(out[0]!.skills!.skills.map((s) => s.name)).toEqual(["hello:greeting"]);
    expect(texts[0]).toContain("Say hello.");
    expect(texts[0]).not.toContain("allowed-tools");
  });

  it("can be assigned to a fixed station by full name", async () => {
    const ctx = await factory([{ path: withSkill() }], { stations: { build: { skills: ["hello:greeting"] } } });
    expect(skillList(ctx).problems).toEqual([]);
    const { out, execute } = seen();
    await createAgentRunner(ctx.config, { execute, claudeHome: tempDir() })({ station: "build", prompt: "p", cwd: tempDir() });
    expect(out[0]!.skills!.skills.map((s) => s.name)).toEqual(["hello:greeting"]);
  });

  it("do not take the owner's short names", async () => {
    const ctx = await factory([{ path: withSkill() }], { stations: { build: { skills: ["greeting"] } } });
    expect(skillList(ctx).problems.map((p) => p.skill)).toContain("greeting");
  });

  it("need a SKILL.md, naming the folder", async () => {
    const ctx = await factory([{ path: pkg({ skills: ["skills/empty"] }, { "skills/empty/readme.md": "# no\n" }) }]);
    expect(ctx.config.loadedPackages!.packages).toEqual([]);
    expect(problems(ctx)[0]!.reason).toContain("skills/empty");
  });

  it("must exist in the package when its agent asks for them", async () => {
    const ctx = await factory([{ path: pkg({ agents: [{ name: "a", instructions: "a.md", skills: ["ghost"] }] }, { "a.md": "# a\n" }) }]);
    expect(problems(ctx)[0]!.reason).toContain("ghost");
  });
});

describe("permission to run code", () => {
  const importMarker = () => {
    const marker = join(tempDir("zero-marker-"), "imported.txt");
    return { marker, top: `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "imported");` };
  };

  it("without it the module is never imported, the agents stay and the problem names allowCode", async () => {
    const { marker, top } = importMarker();
    const { dir } = stationPkg({ top, extra: reviewer, files: REVIEW_FILES });
    const ctx = await factory([{ path: dir }]);
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, panel: false, agentRunner: () => fakeAgents({}).runner });
    expect(existsSync(marker)).toBe(false);
    expect(ctx.config.loadedPackages!.agents.map((a) => a.name)).toEqual(["hello-review"]);
    expect(problems(ctx)[0]).toMatchObject({ package: "hello", reason: expect.stringContaining("allowCode") });
    expect(packageList(ctx).packages[0]!.stations).toEqual([expect.objectContaining({ name: "nota", allowed: false })]);
  });

  it("inside a line's repository the module is not imported, and the problem says why", async () => {
    const { marker, top } = importMarker();
    const { dir } = stationPkg({ top });
    const repo = gitRepo();
    const inRepo = join(repo, "vendor", "hello");
    mkdirSync(dirname(inRepo), { recursive: true });
    cpSync(dir, inRepo, { recursive: true });
    const ctx = await factory([{ path: inRepo, allowCode: true }], { lines: [{ name: "web", repo, verify: [passes] }] });
    await pass(ctx);
    expect(existsSync(marker)).toBe(false);
    expect(problems(ctx)[0]!.reason).toMatch(/repositorio de la línea "web"/);
  });

  it("inside worktrees or jobs of the factory the module is not imported", async () => {
    const ctx0 = testFactory({ lines: [] });
    const { marker, top } = importMarker();
    const { dir } = stationPkg({ top });
    const inside = join(ctx0.home.jobs, "x", "hello");
    cpSync(dir, inside, { recursive: true });
    writeFileSync(ctx0.home.config, stringify({ packages: [{ path: inside, allowCode: true }] }));
    ctx0.config = await factoryConfig(ctx0.home);
    await pass(ctx0);
    expect(existsSync(marker)).toBe(false);
    expect(problems(ctx0)[0]!.reason).toContain(ctx0.home.jobs);
  });
});

describe("a station's pass in the daemon", () => {
  it("runs once per period", async () => {
    const { dir, marker } = stationPkg({ station: { everyMinutes: 60 } });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    await pass(ctx);
    await pass(ctx);
    expect(calls(marker)).toBe(1);
    await pass(ctx, undefined, later(30));
    expect(calls(marker)).toBe(1);
    await pass(ctx, undefined, later(61));
    expect(calls(marker)).toBe(2);
  });

  it("runs in a one-shot daemon with nothing pending, and keeps its last run", async () => {
    const { dir, marker } = stationPkg();
    const ctx = await factory([{ path: dir, allowCode: true }]);
    await runDaemon(ctx, { once: true, pollMs: 5, packages: true, panel: false, agentRunner: () => fakeAgents({}).runner });
    expect(calls(marker)).toBe(1);
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBeTruthy();
  });

  it("stays off in a one-shot daemon unless asked", async () => {
    const { dir, marker } = stationPkg();
    const ctx = await factory([{ path: dir, allowCode: true }]);
    await runDaemon(ctx, { once: true, pollMs: 5, panel: false, agentRunner: () => fakeAgents({}).runner });
    expect(calls(marker)).toBe(0);
  });

  it("does not run with a job queued, the andon on or the budget used up", async () => {
    const { dir, marker } = stationPkg();
    const queued = await factory([{ path: dir, allowCode: true }]);
    requestWork(queued, { text: "algo" });
    await pass(queued);
    expect(calls(marker)).toBe(0);

    const stopped = await factory([{ path: dir, allowCode: true }]);
    stopped.store.setKv(ANDON_KEY, "on");
    await pass(stopped);
    expect(calls(marker)).toBe(0);

    const broke = await factory([{ path: dir, allowCode: true }], { limits: { usdPerDay: 1 } });
    const span = broke.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } });
    span.end("ok", { "zero.cost.usd": 5 });
    expect(budgetState(broke.store, broke.config).reached).toBe(true);
    await pass(broke, undefined, new Date());
    expect(calls(marker)).toBe(0);
  });

  it("keeps a failure in the log without its secrets' values, and the next station runs", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const bad = stationPkg({ name: "uno", station: { secrets: ["HELLO_TOKEN"] }, body: `throw new Error("boom " + ctx.secrets.get("HELLO_TOKEN"));` });
    const good = stationPkg({ name: "dos" });
    const ctx = await factory([{ path: bad.dir, allowCode: true }, { path: good.dir, allowCode: true }]);
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { HELLO_TOKEN: "very-secret-value" });
    await pass(ctx);
    expect(calls(good.marker)).toBe(1);
    const failure = warn.mock.calls.find(([m]) => m.includes("uno/nota"))!;
    expect(JSON.stringify(failure)).toContain("boom");
    expect(JSON.stringify(failure)).not.toContain("very-secret-value");
  });

  it("aborts a pass that hangs and goes on with the next station", async () => {
    const seen = join(tempDir(), "aborted.txt");
    const hung = stationPkg({
      name: "uno",
      station: { timeoutMinutes: 0.001 },
      top: `import { writeFileSync } from "node:fs";`,
      body: `ctx.signal.addEventListener("abort", () => writeFileSync(${JSON.stringify(seen)}, "aborted")); await new Promise(() => {});`,
    });
    const good = stationPkg({ name: "dos" });
    const ctx = await factory([{ path: hung.dir, allowCode: true }, { path: good.dir, allowCode: true }]);
    await pass(ctx);
    expect(existsSync(seen)).toBe(true);
    expect(calls(good.marker)).toBe(1);
  });

  it("runs nothing from a module without pass, and logs why", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const dir = pkg({ stations: [{ name: "nota", module: "m.mjs" }] }, { "m.mjs": `export const other = 1;\n` });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    await pass(ctx);
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBeUndefined();
    expect(warn.mock.calls.some(([m]) => m.includes("hello/nota") && m.includes("pass"))).toBe(true);
  });
});

describe("a station's config", () => {
  it("reaches pass through parseConfig", async () => {
    const out = join(tempDir(), "config.json");
    const { dir } = stationPkg({ top: `import { writeFileSync } from "node:fs"; export function parseConfig(c) { return { ...c, parsed: true }; }`, body: `writeFileSync(${JSON.stringify(out)}, JSON.stringify(ctx.config));` });
    const ctx = await factory([{ path: dir, allowCode: true, config: { saludo: "hola" } }]);
    await pass(ctx);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ saludo: "hola", parsed: true });
  });

  it("skips the pass when parseConfig throws, keeps no last run and logs why", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { dir, marker } = stationPkg({ top: `export function parseConfig() { throw new Error("falta el saludo"); }` });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    await pass(ctx);
    expect(calls(marker)).toBe(0);
    expect(ctx.store.getKv(stationLastKey("hello", "nota"))).toBeUndefined();
    expect(warn.mock.calls.some(([m]) => m.includes("falta el saludo"))).toBe(true);
  });
});

describe("a station's secrets", () => {
  const reading = (out: string) => `writeFileSync(${JSON.stringify(out)}, JSON.stringify({ declared: ctx.secrets.get("HELLO_TOKEN"), other: ctx.secrets.get("OTHER_TOKEN") ?? null }));`;

  it("gives only the declared ones", async () => {
    const out = join(tempDir(), "secrets.json");
    const { dir } = stationPkg({ station: { secrets: ["HELLO_TOKEN"] }, top: `import { writeFileSync } from "node:fs";`, body: reading(out) });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { HELLO_TOKEN: "abc", OTHER_TOKEN: "xyz" });
    await pass(ctx);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ declared: "abc", other: null });
  });

  it("skips the pass when one is missing, and the list names it without any value", async () => {
    const { dir, marker } = stationPkg({ station: { secrets: ["HELLO_TOKEN", "OTHER_TOKEN"] } });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { OTHER_TOKEN: "visible-value" });
    await pass(ctx);
    expect(calls(marker)).toBe(0);
    const text = formatPackages(packageList(ctx));
    expect(text).toContain("HELLO_TOKEN");
    expect(text).not.toContain("visible-value");
  });
});

describe("a station's agents and budget", () => {
  const callsAgent = (body = `await ctx.runAgent({ prompt: "p" });`) => stationPkg({ body });

  it("calls a read-only agent in an empty folder, recorded under the station's name", async () => {
    const { dir } = callsAgent();
    const ctx = await factory([{ path: dir, allowCode: true, engine: "codex", model: "m" }]);
    let empty = false;
    const agents = fakeAgents({ "package:hello/nota": (req) => void (empty = readdirSync(req.cwd).length === 0) });
    await pass(ctx, agents.runner);
    const call = agents.calls[0]!;
    expect(call.custom).toMatchObject({ access: "read", name: "package:hello/nota", engine: "codex", model: "m" });
    expect(call.custom!.instructions).toContain("Write a note.");
    expect(call.engine).toMatchObject({ name: "codex", model: "m" });
    expect(call.cwd).toContain(join("package-stations", "hello", "nota"));
    expect(empty).toBe(true);
  });

  it("gives the agent the station's own skills", async () => {
    const { dir } = stationPkg({ body: `await ctx.runAgent({ prompt: "p" });`, station: { skills: ["greeting"] }, extra: { skills: ["skills/greeting"] }, files: { "skills/greeting/SKILL.md": "# g\n" } });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    const agents = fakeAgents({});
    await pass(ctx, agents.runner);
    expect(agents.calls[0]!.custom!.skills).toEqual(["hello:greeting"]);
  });

  it("counts what they spend with the idle stations", async () => {
    const ctx = await factory([]);
    const since = new Date(Date.now() - 60_000);
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "package:hello/nota" } }).end("ok", { "zero.cost.usd": 0.4 });
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build" } }).end("ok", { "zero.cost.usd": 9 });
    expect(scoutSpent(ctx.store, since)).toBeCloseTo(0.4);
  });

  it("never calls the engine with the night cap used up", async () => {
    const out = join(tempDir(), "run.json");
    const { dir } = stationPkg({ top: `import { writeFileSync } from "node:fs";`, body: `writeFileSync(${JSON.stringify(out)}, JSON.stringify(await ctx.runAgent({ prompt: "p" })));` });
    const ctx = await factory([{ path: dir, allowCode: true }], { limits: { usdPerNight: 0.3 } });
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "scout" } }).end("ok", { "zero.cost.usd": 0.3 });
    const agents = fakeAgents({});
    await pass(ctx, agents.runner, new Date());
    expect(agents.calls).toEqual([]);
    expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({ ok: false });
  });

  it("checks the output against the schema, whatever the engine says", async () => {
    const out = join(tempDir(), "run.json");
    const { dir } = stationPkg({ top: `import { writeFileSync } from "node:fs";`, body: `writeFileSync(${JSON.stringify(out)}, JSON.stringify(await ctx.runAgent({ prompt: "p", schema: ctx.z.object({ sentence: ctx.z.string() }) })));` });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    await pass(ctx, fakeAgents({ "package:hello/nota": () => ({ output: { wrong: 1 } }) }).runner);
    expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({ ok: false });
  });
});

describe("what a station receives from the factory", () => {
  it("keeps each station's state apart, between passes", async () => {
    const write = (value: string) => `ctx.state.set("same", ${JSON.stringify(value)});`;
    const uno = stationPkg({ name: "uno", body: write("de uno") });
    const dos = stationPkg({ name: "dos", body: write("de dos") });
    const ctx = await factory([{ path: uno.dir, allowCode: true }, { path: dos.dir, allowCode: true }]);
    await pass(ctx);
    const reader = (name: string) => JSON.parse(ctx.store.getKv(`package:${name}/nota:state:same`)!);
    expect([reader("uno"), reader("dos")]).toEqual(["de uno", "de dos"]);
  });

  it("gives the rest of the context, with line names only", async () => {
    const out = join(tempDir(), "ctx.json");
    const { dir } = stationPkg({
      top: `import { writeFileSync } from "node:fs";`,
      body: `writeFileSync(${JSON.stringify(out)}, JSON.stringify({ package: ctx.package, station: ctx.station, now: ctx.now, lines: ctx.lines, aborted: ctx.signal.aborted, z: typeof ctx.z.object, state: ctx.state.get("nothing") ?? null }));`,
    });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    await pass(ctx);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ package: "hello", station: "nota", now: NOW.toISOString(), lines: ["web"], aborted: false, z: "function", state: null });
  });

  it("gives delivered jobs without ids, branches or paths", async () => {
    const out = join(tempDir(), "jobs.json");
    const { dir } = stationPkg({ top: `import { writeFileSync } from "node:fs";`, body: `writeFileSync(${JSON.stringify(out)}, JSON.stringify(ctx.deliveredJobs(new Date(0))));` });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    const { job } = requestWork(ctx, { text: "algo" });
    ctx.store.updateJob(job.id, { title: `Arreglo ${job.id} en /home/ana/proyecto/secreto.ts`, status: "delivered", finishedAt: new Date().toISOString(), branch: `zero/${job.id}` });
    await pass(ctx, undefined, new Date());
    const [delivered] = JSON.parse(readFileSync(out, "utf8"));
    expect(delivered).toMatchObject({ line: "web", summary: "" });
    expect(delivered.title).toContain("Arreglo");
    expect(JSON.stringify(delivered)).not.toContain(job.id);
    expect(JSON.stringify(delivered)).not.toContain("/home");
    expect(Object.keys(delivered).sort()).toEqual(["at", "line", "summary", "title"]);
  });

  it("leaves out jobs born from business material", async () => {
    const out = join(tempDir(), "jobs.json");
    const { dir } = stationPkg({ top: `import { writeFileSync } from "node:fs";`, body: `writeFileSync(${JSON.stringify(out)}, JSON.stringify(ctx.deliveredJobs(new Date(0))));` });
    const ctx = await factory([{ path: dir, allowCode: true }]);
    const note = ctx.store.createResearchNote({ line: "web", topic: "t", findings: "f", sources: [], serves: "s", maturity: "m", business: true });
    const { job } = requestWork(ctx, { text: "algo", source: { kind: "research", note: note.id } });
    ctx.store.updateJob(job.id, { status: "delivered", finishedAt: new Date().toISOString() });
    await pass(ctx, undefined, new Date());
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual([]);
  });
});

describe("installing and seeing packages", () => {
  const commented = async (packages: unknown[] = []) => {
    const ctx = await factory(packages);
    writeFileSync(ctx.home.config, `# mi fábrica\n${readFileSync(ctx.home.config, "utf8")}`);
    return ctx;
  };
  const neverInstall = vi.fn(async () => undefined);

  it("adds a folder, keeping the file's comments, without allowCode", async () => {
    const ctx = await commented();
    const dir = pkg(reviewer, REVIEW_FILES);
    expect(await packageAdd(ctx, { source: dir })).toContain("hello");
    const text = readFileSync(ctx.home.config, "utf8");
    expect(text).toContain("# mi fábrica");
    const entry = parseFactory(text).packages[0]!;
    expect(entry).toEqual({ path: dir, allowCode: false });
    expect(text).not.toContain("allowCode");
    expect(ctx.config.loadedPackages!.agents.map((a) => a.name)).toEqual(["hello-review"]);
  });

  it("adds with code when asked", async () => {
    const ctx = await commented();
    const { dir } = stationPkg();
    expect(await packageAdd(ctx, { source: dir, allowCode: true })).toContain("permisos de tu usuario");
    expect(parseFactory(readFileSync(ctx.home.config, "utf8")).packages[0]!.allowCode).toBe(true);
    expect(ctx.config.loadedPackages!.stations).toHaveLength(1);
  });

  it("warns that stations do not run without the permission, and giving it later does not repeat the entry", async () => {
    const ctx = await commented();
    const { dir } = stationPkg();
    expect(await packageAdd(ctx, { source: dir })).toMatch(/no corren hasta que des el permiso/);
    await packageAdd(ctx, { source: dir, allowCode: true });
    const entries = parseFactory(readFileSync(ctx.home.config, "utf8")).packages;
    expect(entries).toEqual([{ path: dir, allowCode: true }]);
  });

  it("refuses an invalid manifest and leaves the file as it was", async () => {
    const ctx = await commented();
    const before = readFileSync(ctx.home.config, "utf8");
    await expect(packageAdd(ctx, { source: tempDir() })).rejects.toThrow(/zero-package\.yaml/);
    await expect(packageAdd(ctx, { source: pkg({ interface: 2 }) })).rejects.toThrow(/interfaz 2/);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });

  it("refuses a package that does not fit with the others, and leaves the file as it was", async () => {
    const ctx = await commented([{ path: pkg(reviewer, REVIEW_FILES) }]);
    const before = readFileSync(ctx.home.config, "utf8");
    await expect(packageAdd(ctx, { source: pkg({ name: "otro", ...reviewer }, REVIEW_FILES) })).rejects.toThrow(/"hello-review"/);
    expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
  });

  it("installs from npm through the installer, into the factory's folder", async () => {
    const ctx = await commented();
    const install = vi.fn(async (dir: string, name: string) => void writeTree(join(dir, "node_modules", name), { "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "2.0.0" }) }));
    await packageAdd(ctx, { source: "@acme/hello-zero", install });
    expect(install).toHaveBeenCalledWith(ctx.home.packages, "@acme/hello-zero");
    expect(parseFactory(readFileSync(ctx.home.config, "utf8")).packages).toEqual([{ npm: "@acme/hello-zero", allowCode: false }]);
    expect(ctx.config.loadedPackages!.packages).toMatchObject([{ name: "hello", version: "2.0.0" }]);
    expect(npmInstallArgs(ctx.home.packages, "x")).toContain("--ignore-scripts");
    expect(npmInstallArgs(ctx.home.packages, "x").slice(-3)).toEqual(["--prefix", ctx.home.packages, "x"]);
  });

  it.each(["--foo", "uno dos", "algo;rm", "a&b"])("refuses the dangerous name %s without calling the installer", async (source) => {
    const ctx = await commented();
    await expect(packageAdd(ctx, { source, install: neverInstall })).rejects.toThrow();
    expect(neverInstall).not.toHaveBeenCalled();
  });

  it("removes the entry and leaves the folder", async () => {
    const dir = pkg(reviewer, REVIEW_FILES);
    const ctx = await commented([{ path: dir }]);
    expect(await packageRemove(ctx, { name: "hello" })).toContain(dir.split(/[\\/]/).at(-1)!);
    expect(parseFactory(readFileSync(ctx.home.config, "utf8")).packages).toEqual([]);
    expect(ctx.config.loadedPackages!.agents).toEqual([]);
    expect(existsSync(join(dir, "zero-package.yaml"))).toBe(true);
  });

  it("removes a package left out by a problem, by its manifest's name", async () => {
    const ctx = await commented([{ path: pkg({ name: "roto", agents: [{ name: "review", instructions: "a.md" }] }, { "a.md": "# a\n" }) }]);
    expect(problems(ctx)[0]!.package).toBe("roto");
    await packageRemove(ctx, { name: "roto" });
    expect(parseFactory(readFileSync(ctx.home.config, "utf8")).packages).toEqual([]);
  });

  it("says when there is no such package", async () => {
    const ctx = await commented();
    expect(await packageRemove(ctx, { name: "ghost" })).toContain("no tiene un paquete");
  });

  it("lists what each package brings", async () => {
    const { dir } = stationPkg({ extra: { ...reviewer, skills: ["skills/s"] }, files: { ...REVIEW_FILES, "skills/s/SKILL.md": "# s\n" } });
    const ctx = await commented([{ path: dir, allowCode: true }]);
    await pass(ctx);
    const text = formatPackages(packageList(ctx));
    for (const piece of ["hello 1.0.0", "hello-review", "hello:s", "estación nota", "última pasada"]) expect(text).toContain(piece);
    expect(formatPackages({ packages: [], problems: [] })).toContain("zero package add");
  });
});

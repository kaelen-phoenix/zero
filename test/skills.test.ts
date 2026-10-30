import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentInstructions, createAgentRunner, type EngineExecute } from "../src/agent.js";
import { addSkill, agentSkills, factoryStatus, removeSkill, skillList, trace } from "../src/app.js";
import { boxRunArgs, type BoxRunSpec } from "../src/box/run.js";
import { parseFactory } from "../src/config.js";
import { claudeOptions } from "../src/engines/claude.js";
import type { EngineRequest } from "../src/engines/types.js";
import { formatSkills, formatStatus } from "../src/format.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { assignedSkills, discoverSkills, resolveSkill, shortDescription, skillDescription, skillView, stageSkills, stripAllowedTools, unstageSkills, type Skill } from "../src/skills.js";
import { cleanup, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

/** A Claude home with a personal skill `pdf` and the plugin `vercel@mkt` carrying `nextjs`. */
function claudeHome(extra: Record<string, string> = {}): string {
  const home = tempDir("claude-home-");
  const plugin = tempDir("plugin-");
  writeTree(home, { "skills/pdf/SKILL.md": "---\nname: pdf\n---\nPDF-BODY\n", ...extra });
  writeTree(plugin, { "skills/nextjs/SKILL.md": "---\nname: nextjs\n---\nNEXT-BODY\n" });
  writeTree(home, { "plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { "vercel@mkt": [{ scope: "user", installPath: plugin, version: "1" }] } }) });
  return home;
}

const prevHome = process.env.CLAUDE_CONFIG_DIR;
beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = claudeHome();
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevHome;
  cleanup();
});

const skill = (name: string, fullName = name, plugin?: string): Skill => ({ name, fullName, source: plugin ? "plugin" : "personal", plugin, dir: `/s/${fullName}` });

describe("discovery", () => {
  it("finds personal and plugin skills", () => {
    const home = claudeHome();
    const found = discoverSkills(home);
    expect(found.map((s) => [s.fullName, s.source, s.plugin])).toEqual([
      ["pdf", "personal", undefined],
      ["vercel:nextjs", "plugin", "vercel"],
    ]);
    expect(existsSync(join(found[0]!.dir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(found[1]!.dir, "SKILL.md"))).toBe(true);
  });

  it("returns nothing when there is no Claude home", () => {
    expect(discoverSkills(join(tempDir(), "missing"))).toEqual([]);
  });
});

describe("resolution", () => {
  it("resolves a unique short name to its plugin skill", () => {
    expect(resolveSkill("nextjs", [skill("pdf"), skill("nextjs", "vercel:nextjs", "vercel")]).skill?.fullName).toBe("vercel:nextjs");
  });

  it("refuses an ambiguous short name and accepts the full name", () => {
    const available = [skill("lint"), skill("lint", "tools:lint", "tools")];
    const r = resolveSkill("lint", available);
    expect(r.skill).toBeUndefined();
    expect(r.problem).toContain("tools:lint");
    expect(r.problem).toMatch(/lint, tools:lint/);
    expect(resolveSkill("tools:lint", available).skill?.fullName).toBe("tools:lint");
  });
});

describe("assignment", () => {
  it("adds a line's skills to the global ones", () => {
    const cfg = parseFactory(
      "stations:\n  build:\n    skills: [a]\nlines:\n  - name: solilok\n    repo: /r\n    stations:\n      build:\n        skills: [nextjs, shadcn, a]\n  - name: other\n    repo: /o\n",
    );
    expect(assignedSkills(cfg, "build", "solilok")).toEqual(["a", "nextjs", "shadcn"]);
    expect(assignedSkills(cfg, "build", "other")).toEqual(["a"]);
    expect(assignedSkills(cfg, "review", "solilok")).toEqual([]);
  });

  it("rejects skills for a station without an agent", () => {
    expect(() => parseFactory("lines:\n  - name: demo\n    repo: /r\n    stations:\n      verify:\n        skills: [x]\n")).toThrow(/no es válido/);
  });
});

describe("missing skills", () => {
  it("are warned in the status and the agent runs without them", async () => {
    const ctx = testFactory({ stations: { review: { skills: ["ghost"] } }, lines: [{ name: "demo", repo: gitRepo(), stations: { build: { skills: ["ghost2"] } } }] });
    const status = factoryStatus(ctx);
    expect(status.skills).toEqual([
      { skill: "ghost", station: "review", reason: expect.stringContaining("no está instalada") },
      { skill: "ghost2", station: "build", line: "demo", reason: expect.stringContaining("no está instalada") },
    ]);
    const text = formatStatus(status);
    expect(text).toContain("Skill ghost (agente review)");
    expect(text).toContain("Skill ghost2 (agente build, línea demo)");

    const seen: EngineRequest[] = [];
    const execute: EngineExecute = async (_e, req) => (seen.push(req), { ok: true, text: "ok" });
    const run = await createAgentRunner(ctx.config, { execute })({ station: "review", prompt: "p", cwd: tempDir(), line: "demo" });
    expect(run.ok).toBe(true);
    expect(seen[0]!.skills).toBeUndefined();
    expect(seen[0]!.instructions).toBe(await agentInstructions("review"));
  });
});

describe("skill commands", () => {
  const factory = () => {
    const ctx = testFactory({ stations: { build: { skills: ["a"] } }, lines: [{ name: "solilok", repo: gitRepo() }] });
    writeFileSync(ctx.home.config, `# my factory\n${readFileSync(ctx.home.config, "utf8")}`);
    return ctx;
  };

  it("adds per line, keeping comments and without duplicates", async () => {
    const ctx = factory();
    await addSkill(ctx, { skill: "nextjs", station: "build", line: "solilok" });
    expect(await addSkill(ctx, { skill: "nextjs", station: "build", line: "solilok" })).toContain("ya estaba");
    const text = readFileSync(ctx.home.config, "utf8");
    expect(text).toContain("# my factory");
    expect(parseFactory(text).lines[0]!.stations?.build?.skills).toEqual(["nextjs"]);
    expect(ctx.config.lines[0]!.stations?.build?.skills).toEqual(["nextjs"]);
  });

  it("removes a global skill", async () => {
    const ctx = factory();
    await removeSkill(ctx, { skill: "a", station: "build" });
    expect(parseFactory(readFileSync(ctx.home.config, "utf8")).stations.build.skills).toEqual([]);
  });

  it("refuses unknown agents and lines", async () => {
    const ctx = factory();
    await expect(addSkill(ctx, { skill: "pdf", station: "verify" })).rejects.toThrow(/spec, build, review, security, reply/);
    await expect(addSkill(ctx, { skill: "pdf", station: "build", line: "nope" })).rejects.toThrow(/No existe la línea "nope"/);
  });

  it("lists assignments and the available skills", () => {
    const text = formatSkills(skillList(factory()));
    expect(text).toContain("- build: a");
    expect(text).toMatch(/^- pdf \(personal\)$/m);
    expect(text).toMatch(/^- vercel:nextjs \(plugin vercel\)$/m);
  });

  it("work from the CLI", () => {
    const ctx = factory();
    const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "" });
    expect(cli("skill", "add", "pdf", "--station", "review").status).toBe(0);
    const list = cli("skill", "list");
    expect(list.stdout).toContain("- review: pdf");
    expect(list.stdout).toContain("vercel:nextjs");
    const bad = cli("skill", "add", "pdf", "--station", "verify");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("spec, build, review, security, reply");
  });

  it("are not offered to the chat", async () => {
    const server = createZeroMcpServer(factory().home, { autoStart: false });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    for (const t of (await client.listTools()).tools) expect(`${t.name} ${t.description}`).not.toMatch(/skill/i);
  });
});

describe("claude options", () => {
  const req = (over: Partial<EngineRequest> = {}): EngineRequest => ({ instructions: "I", prompt: "p", cwd: "/w", access: "read", timeoutMs: 1000, ...over });
  const staged = { dir: "/stage/D", skills: [{ name: "pdf", id: "pdf", text: "x" }] };

  it("enables only the assigned skills from zero's plugin", () => {
    const o = claudeOptions(req({ skills: staged }), new AbortController());
    expect(o.plugins).toEqual([{ type: "local", path: "/stage/D" }]);
    expect(o.skills).toEqual(["pdf"]);
  });

  it("enables none without skills", () => {
    const o = claudeOptions(req(), new AbortController());
    expect(o.skills).toEqual([]);
    expect(o.plugins).toBeUndefined();
  });

  it("never changes the tools", () => {
    const ac = new AbortController();
    expect(claudeOptions(req({ skills: staged }), ac).allowedTools).toEqual(claudeOptions(req(), ac).allowedTools);
    expect(claudeOptions(req(), ac).allowedTools).not.toContain("Bash");
    expect(claudeOptions(req({ access: "write", skills: staged }), ac).allowedTools).toEqual(claudeOptions(req({ access: "write" }), ac).allowedTools);
  });
});

describe("skill text for engines", () => {
  const config = (engine: string) =>
    parseFactory(`engine: ${engine}\nengines:\n  mycli:\n    command: [echo]\nstations:\n  review:\n    skills: [pdf]\n`);

  it("appends SKILL.md for engines without native skills", async () => {
    const seen: EngineRequest[] = [];
    const execute: EngineExecute = async (_e, req) => (seen.push(req), { ok: true, text: "ok" });
    await createAgentRunner(config("mycli"), { execute })({ station: "review", prompt: "p", cwd: tempDir() });
    const original = await agentInstructions("review");
    expect(seen[0]!.instructions.startsWith(original)).toBe(true);
    expect(seen[0]!.instructions.slice(original.length)).toMatch(/# Skill: pdf[\s\S]*PDF-BODY/);
  });

  it("leaves the instructions alone for claude", async () => {
    const seen: EngineRequest[] = [];
    const execute: EngineExecute = async (_e, req) => (seen.push(req), { ok: true, text: "ok" });
    await createAgentRunner(config("claude"), { execute })({ station: "review", prompt: "p", cwd: tempDir() });
    expect(seen[0]!.instructions).toBe(await agentInstructions("review"));
    expect(seen[0]!.skills?.skills.map((s) => s.id)).toEqual(["pdf"]);
  });
});

describe("staging", () => {
  it("strips allowed-tools and keeps the rest", () => {
    const text = "---\nname: x\nallowed-tools: Bash\ndescription: d\n---\nBody\nallowed-tools: stays in the body\n";
    expect(stripAllowedTools(text)).toBe("---\nname: x\ndescription: d\n---\nBody\nallowed-tools: stays in the body\n");
    expect(stripAllowedTools("---\nallowed-tools:\n  - Bash\n  - Write\nname: y\n---\nB")).toBe("---\nname: y\n---\nB");
  });

  it("stages a sanitized copy as a plugin", async () => {
    const home = claudeHome({ "skills/tool/SKILL.md": "---\nname: tool\nallowed-tools: Bash\n---\nT\n", "skills/tool/run.sh": "echo hi\n" });
    const staged = await stageSkills(discoverSkills(home).filter((s) => s.name !== "pdf"));
    expect(staged.skills.map((s) => s.id)).toEqual(["tool", "vercel-nextjs"]);
    expect(readFileSync(join(staged.dir, "skills", "tool", "SKILL.md"), "utf8")).toBe("---\nname: tool\n---\nT\n");
    expect(existsSync(join(staged.dir, "skills", "tool", "run.sh"))).toBe(true);
    expect(existsSync(join(staged.dir, ".claude-plugin", "plugin.json"))).toBe(true);
    await unstageSkills(staged);
    expect(existsSync(staged.dir)).toBe(false);
  });

  it("removes the copy when the run fails", async () => {
    const cfg = parseFactory("stations:\n  build:\n    skills: [pdf]\n");
    const dirs: string[] = [];
    const failing: EngineExecute = async (_e, req) => (dirs.push(req.skills!.dir), { ok: false, text: "boom" });
    expect((await createAgentRunner(cfg, { execute: failing })({ station: "build", prompt: "p", cwd: tempDir() })).ok).toBe(false);
    const throwing: EngineExecute = async (_e, req) => {
      dirs.push(req.skills!.dir);
      throw new Error("crash");
    };
    await expect(createAgentRunner(cfg, { execute: throwing })({ station: "build", prompt: "p", cwd: tempDir() })).rejects.toThrow("crash");
    expect(dirs).toHaveLength(2);
    for (const d of dirs) expect(existsSync(d)).toBe(false);
  });
});

describe("skills in the box", () => {
  const spec = (over: Partial<BoxRunSpec> = {}): BoxRunSpec => ({
    runtime: "podman",
    image: "zero-box:abc",
    copy: "/work-copy",
    mount: "rw",
    limits: { runtime: "auto", cpus: 2, memoryGb: 4, pids: 512 },
    secretNames: [],
    command: ["node", "/opt/zero/dist/box/agent.js"],
    name: "zero-j1-abc",
    platform: "win32",
    ...over,
  });

  it("mounts the staged skills read-only, also for build", () => {
    expect(boxRunArgs(spec({ skills: "/stage/S" })).join(" ")).toContain("-v /stage/S:/skills:ro");
    expect(boxRunArgs(spec({ skills: "/stage/S", mount: "ro" })).join(" ")).toContain("-v /stage/S:/skills:ro");
  });

  it("adds no mount without skills", () => {
    expect(boxRunArgs(spec()).join(" ")).not.toContain("/skills");
  });
});

describe("skill descriptions", () => {
  it("reads the frontmatter description", () => {
    const home = claudeHome({ "skills/pdf/SKILL.md": "---\nname: pdf\ndescription: Lee y genera PDF\n---\nPDF-BODY\n" });
    expect(discoverSkills(home).find((s) => s.name === "pdf")!.description).toBe("Lee y genera PDF");
  });

  it("discovers skills without frontmatter or with invalid YAML, without a description", () => {
    const home = claudeHome({ "skills/plain/SKILL.md": "just text\n", "skills/broken/SKILL.md": "---\ndescription: [unclosed\n  : : x\n---\nbody\n" });
    const found = discoverSkills(home);
    for (const name of ["plain", "broken"]) {
      const s = found.find((k) => k.name === name)!;
      expect(s).toBeDefined();
      expect(s.description).toBeUndefined();
    }
    expect(skillDescription("---\ndescription: 3\n---\n")).toBeUndefined();
  });

  it("cuts long descriptions to one line of at most 200 characters", () => {
    const long = Array.from({ length: 10 }, () => "palabra ".repeat(6).trim()).join("\n  ");
    const text = `---\ndescription: |\n  ${long}\n  ${"x".repeat(500 - long.length)}\n---\n`;
    const d = skillDescription(text)!;
    expect(d).not.toContain("\n");
    expect(d.length).toBeLessThanOrEqual(200);
    expect(d.endsWith("…")).toBe(true);
    expect(shortDescription("a\n  b")).toBe("a b");
  });
});

/** A Claude home where pdf and vercel:nextjs have descriptions; the second one carries markup. */
function describedHome(): string {
  const home = tempDir("claude-home-");
  const plugin = tempDir("plugin-");
  writeTree(home, { "skills/pdf/SKILL.md": "---\nname: pdf\ndescription: Lee y genera PDF\n---\nPDF-BODY\n" });
  writeTree(plugin, { "skills/nextjs/SKILL.md": "---\nname: nextjs\ndescription: Next.js <script>alert(1)</script>\n---\nNEXT-BODY\n" });
  writeTree(home, { "plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { "vercel@mkt": [{ scope: "user", installPath: plugin, version: "1" }] } }) });
  return home;
}

const assigned = () => ({
  stations: { build: { skills: ["pdf"] }, review: { skills: ["nope"] } },
  lines: [{ name: "solilok", repo: gitRepo(), stations: { build: { skills: ["vercel:nextjs"] } } }],
});

describe("skills per agent", () => {
  beforeEach(() => {
    process.env.CLAUDE_CONFIG_DIR = describedHome();
  });

  it("views a skill as resolved or missing", () => {
    const available = discoverSkills();
    expect(skillView("pdf", available)).toEqual({ name: "pdf", fullName: "pdf", description: "Lee y genera PDF" });
    expect(skillView("nope", available)).toEqual({ name: "nope", missing: "no está instalada en Claude Code" });
  });

  it("lists general and per-line skills for every agent", () => {
    const all = agentSkills(testFactory(assigned()).config);
    expect(all.map((a) => a.station)).toEqual(["spec", "build", "review", "security", "reply", "scout"]);
    const build = all.find((a) => a.station === "build")!;
    expect(build.general).toEqual([{ name: "pdf", fullName: "pdf", description: "Lee y genera PDF" }]);
    expect(build.lines).toEqual([{ line: "solilok", skills: [{ name: "vercel:nextjs", fullName: "vercel:nextjs", description: expect.stringContaining("Next.js") }] }]);
    expect(all.find((a) => a.station === "review")!.general).toEqual([{ name: "nope", missing: "no está instalada en Claude Code" }]);
    expect(all.find((a) => a.station === "spec")).toEqual({ station: "spec", general: [], lines: [] });
  });

  it("are shown read-only on the panel's agents page", async () => {
    const ctx = testFactory(assigned());
    const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
      const html = await (await fetch(base + "/agents", { headers: { cookie } })).text();
      const card = (station: string) => html.split(`class="card agent" data-station="${station}"`)[1]!.split('class="card')[0]!;
      const build = card("build");
      expect(build).toContain("<code>pdf</code>");
      expect(build).toContain("Lee y genera PDF");
      const group = build.split('data-line="solilok"')[1]!;
      expect(group).toContain("<b>solilok</b>");
      expect(group).toContain("<code>vercel:nextjs</code>");
      expect(card("review")).toMatch(/nope[\s\S]*faltante[\s\S]*no está instalada en Claude Code/);
      expect(card("spec")).toContain("No tiene skills asignadas.");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<script>alert(1)");
      for (const tag of ["<form", "<button", "<input"]) expect(html).not.toContain(tag);
      const before = readFileSync(ctx.home.config, "utf8");
      const r = await fetch(base + "/agents", { method: "POST", headers: { cookie, origin: base, "content-type": "application/x-www-form-urlencoded" }, body: "skill=pdf", redirect: "manual" });
      expect(r.status).toBe(404);
      expect(readFileSync(ctx.home.config, "utf8")).toBe(before);
    } finally {
      await new Promise((r) => (server.closeAllConnections(), server.close(r)));
    }
  });

  it("are shown to the chat by zero_lines, which stays read-only", async () => {
    const ctx = testFactory(assigned());
    const server = createZeroMcpServer(ctx.home, { autoStart: false });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    expect((await client.listTools()).tools.find((t) => t.name === "zero_lines")!.annotations?.readOnlyHint).toBe(true);
    const r = (await client.callTool({ name: "zero_lines", arguments: {} })) as { content: { text: string }[] };
    const out = JSON.parse(r.content[0]!.text);
    expect(out.skills.build).toEqual([{ name: "pdf", fullName: "pdf", description: "Lee y genera PDF" }]);
    expect(out.skills.review).toEqual([{ name: "nope", missing: "no está instalada en Claude Code" }]);
    expect(out.lines[0]).toMatchObject({ name: "solilok", repo: ctx.config.lines[0]!.repo, baseBranch: ctx.config.lines[0]!.baseBranch });
    expect(out.lines[0].skills.build).toEqual([{ name: "vercel:nextjs", fullName: "vercel:nextjs", description: expect.stringContaining("Next.js") }]);
  });
});

describe("skills in the trace", () => {
  const ok: EngineExecute = async () => ({ ok: true, text: "ok", costUsd: 0.01 });
  const agentSpans = (ctx: ReturnType<typeof testFactory>, job: string) => ctx.store.spansForJob(job).filter((s) => s.name === "gen_ai.invoke_agent");

  const jobTrace = (ctx: ReturnType<typeof testFactory>) => {
    const job = ctx.store.createJob({ line: "solilok", kind: "request", request: "x", budgetUsd: 3 });
    return { job, trace: { tracer: ctx.tracer, jobId: job.id, parentId: ctx.tracer.start("zero.job", { jobId: job.id }).id } };
  };

  async function tracedRun(definition: Record<string, unknown>, station: "build" | "spec" = "build") {
    const ctx = testFactory(definition);
    const { job, trace: t } = jobTrace(ctx);
    await createAgentRunner(ctx.config, { execute: ok })({ station, prompt: "p", cwd: tempDir(), line: "solilok", trace: t });
    return { attrs: agentSpans(ctx, job.id)[0]!.attrs, text: trace(ctx, job.id) };
  }
  const line = (build?: string[]) => [{ name: "solilok", repo: gitRepo(), ...(build && { stations: { build: { skills: build } } }) }];

  it("records the skills of each run", async () => {
    const { attrs, text } = await tracedRun({ stations: { build: { skills: ["pdf"] } }, lines: line(["vercel:nextjs"]) });
    expect(attrs["zero.skills"]).toBe("pdf, vercel:nextjs");
    expect(attrs).not.toHaveProperty("zero.skills.missing");
    expect(text).toContain("skills: pdf, vercel:nextjs");
    expect(text).not.toContain("skills faltantes");
  });

  it("records the missing ones", async () => {
    const { attrs, text } = await tracedRun({ stations: { build: { skills: ["pdf", "nope"] } }, lines: line(["vercel:nextjs"]) });
    expect(attrs["zero.skills"]).toBe("pdf, vercel:nextjs");
    expect(attrs["zero.skills.missing"]).toBe("nope");
    expect(text).toContain("skills faltantes: nope");
  });

  it("records nothing without skills", async () => {
    const { attrs, text } = await tracedRun({ lines: line() }, "spec");
    expect(attrs).not.toHaveProperty("zero.skills");
    expect(attrs).not.toHaveProperty("zero.skills.missing");
    expect(text).not.toContain("skills");
  });

  it("records each run on its own span", async () => {
    const ctx = testFactory({ stations: { build: { skills: ["pdf"] } }, lines: line() });
    const { job, trace: t } = jobTrace(ctx);
    const req = { station: "build" as const, prompt: "p", cwd: tempDir(), line: "solilok", trace: t };
    await createAgentRunner(ctx.config, { execute: ok })(req);
    await createAgentRunner(parseFactory(readFileSync(ctx.home.config, "utf8").replace("- pdf", "- vercel:nextjs")), { execute: ok })(req);
    expect(agentSpans(ctx, job.id).map((s) => s.attrs["zero.skills"])).toEqual(["pdf", "vercel:nextjs"]);
  });
});

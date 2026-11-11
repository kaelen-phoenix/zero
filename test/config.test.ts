import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_ACCESS } from "../src/agent.js";
import { lineServices } from "../src/billing/records.js";
import { AGENT_STATIONS, ConfigError, editFactory, effectiveLevel, findLine, FIXED_STATIONS, lineAutonomy, parseFactory } from "../src/config.js";
import { factoryHome } from "../src/home.js";
import { addLine, detectClients, detectCommands, initFactory, slug } from "../src/init.js";
import { SKILL_STATIONS } from "../src/skills.js";
import { cleanup, gitRepo, tempDir } from "./helpers.js";

afterEach(cleanup);

describe("factory definition", () => {
  it("fills safe defaults around a single line", () => {
    const cfg = parseFactory("lines:\n  - name: api\n    repo: /work/api\n");
    expect(cfg).toMatchObject({ level: "L3", engine: "claude", isolation: "container", limits: { usdPerDay: 10, usdPerJob: 3 }, box: { runtime: "auto", cpus: 2 } });
    expect(cfg.lines[0]).toMatchObject({ integrate: "merge", baseBranch: "main", maxAttempts: 3 });
    expect(cfg.limits.protectedPaths).toEqual([".github/**", ".zero/**", ".claude/**", ".agents/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]);
  });

  it("replaces the default protected paths with the owner's list", () => {
    const cfg = parseFactory('limits:\n  protectedPaths: ["docs/**"]\nlines:\n  - name: api\n    repo: /work/api\n');
    expect(cfg.limits.protectedPaths).toEqual(["docs/**"]);
    expect(cfg.limits.protectedPaths).not.toContain(".agents/**");
  });

  it("rejects an unknown level naming the field", () => {
    expect(() => parseFactory("level: L9\n")).toThrow(/level/);
  });

  it("refuses credentials in the file", () => {
    expect(() => parseFactory("engine: claude\n# key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz\n")).toThrow(ConfigError);
    expect(() => parseFactory("engine: claude\n# key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz\n")).toThrow(/secretos/);
  });

  it("rejects duplicate line names", () => {
    expect(() => parseFactory("lines:\n  - { name: a, repo: /x }\n  - { name: a, repo: /y }\n")).toThrow(/duplicate/);
  });

  it("asks which line when there are several", () => {
    const cfg = parseFactory("lines:\n  - { name: api, repo: /x }\n  - { name: web, repo: /y }\n");
    expect(() => findLine(cfg)).toThrow(/api, web/);
    expect(findLine(cfg, "web").repo).toBe("/y");
  });
});

describe("line services", () => {
  const line = (services: string) => `lines:\n  - name: tienda\n    repo: /x\n    services: ${services}\n`;

  it("loads github, vercel and supabase", () => {
    const cfg = parseFactory(line("{ github: {}, vercel: { project: prj_1, team: team_1 }, supabase: { project: abcd } }"));
    expect(cfg.lines[0]!.services).toEqual({ github: { type: "user" }, vercel: { project: "prj_1", team: "team_1" }, supabase: { project: "abcd" } });
    expect(lineServices(cfg.lines[0])).toEqual(["github", "vercel", "supabase"]);
  });

  it("takes an organization's account and repository", () => {
    const cfg = parseFactory(line("{ github: { account: acme, type: organization, repository: acme/tienda } }"));
    expect(cfg.lines[0]!.services?.github).toEqual({ account: "acme", type: "organization", repository: "acme/tienda" });
  });

  it("refuses a token, an unknown service and a missing project", () => {
    expect(() => parseFactory(line("{ vercel: { project: prj_1, token: x } }"))).toThrow(ConfigError);
    expect(() => parseFactory(line("{ netlify: { site: x } }"))).toThrow(ConfigError);
    expect(() => parseFactory(line("{ supabase: {} }"))).toThrow(ConfigError);
    expect(() => parseFactory(line("{ github: { repository: no-slash } }"))).toThrow(ConfigError);
  });

  it("leaves a line without the section as before", () => {
    const cfg = parseFactory("lines:\n  - name: api\n    repo: /work/api\n");
    expect(cfg.lines[0]!.services).toBeUndefined();
    expect(lineServices(cfg.lines[0])).toEqual([]);
  });
});

describe("effective level", () => {
  it("runs L3 as L2 without the isolation box, and says why", () => {
    const lvl = effectiveLevel({ level: "L3", isolation: "worktree" });
    expect(lvl.level).toBe("L2");
    expect(lvl.configured).toBe("L3");
    expect(lvl.reason).toMatch(/caja de aislamiento/);
  });

  it("keeps L3 when the box is configured and available", () => {
    expect(effectiveLevel({ level: "L3", isolation: "container" }, { ready: true, problems: [] })).toEqual({ level: "L3", configured: "L3" });
  });

  it("leaves lower levels alone", () => {
    expect(effectiveLevel({ level: "L1", isolation: "worktree" })).toEqual({ level: "L1", configured: "L1" });
  });
});

describe("zero init", () => {
  it("creates the factory with the current repository as a line", async () => {
    const repo = gitRepo({ "package.json": JSON.stringify({ scripts: { test: "vitest", typecheck: "tsc" } }), "package-lock.json": "{}" });
    const home = factoryHome(tempDir());
    const r = await initFactory(home, repo, (bin) => bin === "codex");
    expect(r).toMatchObject({ created: true, engine: "codex", clients: ["codex"] });
    const cfg = parseFactory(readFileSync(home.config, "utf8"));
    expect(cfg.lines).toHaveLength(1);
    expect(cfg.lines[0]).toMatchObject({ baseBranch: "main", setup: ["npm ci"], verify: ["npm run typecheck", "npm test"] });
    expect(cfg.isolation).toBe("container");
  });

  it("never overwrites an existing definition", async () => {
    const home = factoryHome(tempDir());
    writeFileSync(home.config, "level: L1\n");
    const r = await initFactory(home, tempDir(), () => false);
    expect(r.created).toBe(false);
    expect(readFileSync(home.config, "utf8")).toBe("level: L1\n");
  });

  it("works outside a repository", async () => {
    const home = factoryHome(tempDir());
    const r = await initFactory(home, tempDir(), () => false);
    expect(r).toMatchObject({ created: true, engine: "claude" });
    expect(parseFactory(readFileSync(home.config, "utf8")).lines).toEqual([]);
  });

  it("adds lines keeping the file's comments", async () => {
    const home = factoryHome(tempDir());
    await initFactory(home, tempDir(), () => false);
    const line = await addLine(home, gitRepo(), "web");
    expect(line.name).toBe("web");
    const text = readFileSync(home.config, "utf8");
    expect(text).toContain("# Fábrica zero");
    expect(parseFactory(text).lines.map((l) => l.name)).toEqual(["web"]);
    await expect(addLine(home, gitRepo(), "web")).rejects.toThrow(/Ya existe/);
  });
});

describe("factory home", () => {
  it("lives in ZERO_HOME when it is set, and in ~/.zero otherwise", () => {
    const previous = process.env.ZERO_HOME;
    try {
      process.env.ZERO_HOME = join(tempDir(), "fab");
      expect(factoryHome().config).toBe(join(process.env.ZERO_HOME, "zero.factory.yaml"));
      delete process.env.ZERO_HOME;
      expect(factoryHome().root).toMatch(/\.zero$/);
    } finally {
      if (previous === undefined) delete process.env.ZERO_HOME;
      else process.env.ZERO_HOME = previous;
    }
  });
});

describe("detection", () => {
  it("guesses commands from repository files", () => {
    const cargo = gitRepo({ "Cargo.toml": "" });
    expect(detectCommands(cargo)).toEqual({ setup: [], verify: ["cargo test"] });
    expect(existsSync(join(cargo, ".git"))).toBe(true);
  });

  it("prefers claude, then codex, then antigravity", () => {
    expect(detectClients(() => true)).toEqual(["claude", "codex", "antigravity"]);
    expect(detectClients((b) => b === "agy")).toEqual(["antigravity"]);
  });

  it("slugifies names with accents", () => {
    expect(slug("Mi Tienda Ñandú!")).toBe("mi-tienda-nandu");
  });
});

describe("night shift configuration", () => {
  it("defaults to on, at any hour, proposing", () => {
    const cfg = parseFactory("");
    expect(cfg.nightShift).toEqual({ autonomy: "propose", maxAutoJobsPerDay: 3 });
    expect(cfg.limits.usdPerNight).toBe(1);
    expect(cfg.stations.scout).toMatchObject({ maxTurns: 40, timeoutMinutes: 15 });
  });

  it("accepts the owner's per-line autonomy", () => {
    const cfg = parseFactory(
      [
        "nightShift: { maxAutoJobsPerDay: 3 }",
        "lines:",
        "  - { name: zero, repo: /r/zero, nightShift: { autonomy: auto } }",
        "  - { name: newoman, repo: /r/newoman, nightShift: { autonomy: auto } }",
        "  - { name: solilok, repo: /r/solilok, nightShift: { autonomy: propose } }",
        "  - { name: otra, repo: /r/otra }",
      ].join("\n"),
    );
    expect(cfg.lines.map((l) => lineAutonomy(cfg, l))).toEqual(["auto", "auto", "propose", "propose"]);
    expect(lineAutonomy(parseFactory("nightShift: { autonomy: build }"), { nightShift: undefined })).toBe("build");
  });

  it("turns off", () => {
    expect(parseFactory("nightShift: off").nightShift).toBe("off");
  });

  it("refuses bad hours and autonomy", () => {
    for (const hours of ["25:00-08:00", "tonight"]) {
      expect(() => parseFactory(`nightShift: { hours: "${hours}" }`)).toThrow(ConfigError);
      expect(() => parseFactory(`nightShift: { hours: "${hours}" }`)).toThrow(/nightShift\.hours/);
    }
    expect(() => parseFactory("lines:\n  - { name: a, repo: /r/a, nightShift: { autonomy: yolo } }")).toThrow(ConfigError);
  });
});

describe("a file with retired keys", () => {
  /** The notice is once per process: a fresh copy of the module stands for a new process. */
  async function fresh() {
    vi.resetModules();
    const { log } = await import("../src/log.js");
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const config = await import("../src/config.js");
    return { parse: config.parseFactory, ConfigError: config.ConfigError, warn };
  }

  afterEach(() => vi.restoreAllMocks());

  it.each(["social: off", "social: { postsPerDay: 2 }", "social: { otra: 1 }"])("ignores %s with a notice", async (text) => {
    const { parse, warn } = await fresh();
    const cfg = parse(text);
    expect(cfg).not.toHaveProperty("social");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("social");
  });

  it("ignores the global station with a notice", async () => {
    const { parse, warn } = await fresh();
    expect(parse("stations: { community: { skills: [x] } }").stations).not.toHaveProperty("community");
    expect(warn.mock.calls[0]![0]).toContain("stations.community");
  });

  it("ignores the keys of a line, even though its stations are strict", async () => {
    const { parse, warn } = await fresh();
    const cfg = parse("lines:\n  - name: a\n    repo: /r/a\n    social: { enabled: true }\n    stations: { community: { skills: [x] }, build: { skills: [y] } }\n");
    expect(cfg.lines[0]).not.toHaveProperty("social");
    expect(cfg.lines[0]!.stations).toEqual({ build: { skills: ["y"] } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("lines[].social");
    expect(warn.mock.calls[0]![0]).toContain("lines[].stations.community");
  });

  it("still refuses any other unknown station of a line", async () => {
    const { parse, ConfigError: Refused } = await fresh();
    expect(() => parse("lines:\n  - name: a\n    repo: /r/a\n    stations: { noexiste: {} }\n")).toThrow(Refused);
  });

  it("warns once, however many times the file is parsed", async () => {
    const { parse, warn } = await fresh();
    parse("social: off");
    parse("social: off");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a file without them", async () => {
    const { parse, warn } = await fresh();
    parse("lines:\n  - name: a\n    repo: /r/a\n");
    expect(warn).not.toHaveBeenCalled();
  });

  it("still refuses a credential inside them", async () => {
    const { parse, ConfigError: Refused } = await fresh();
    expect(() => parse(`social: { signature: IGAA${"a".repeat(36)} }`)).toThrow(Refused);
  });

  it("keeps them written in the file when editing another key", async () => {
    const path = join(tempDir(), "zero.factory.yaml");
    writeFileSync(path, "social: { postsPerDay: 2 } # mine\nconcurrency: 1\n");
    const cfg = await editFactory(path, (doc) => doc.set("concurrency", 3));
    expect(cfg.concurrency).toBe(3);
    expect(readFileSync(path, "utf8")).toContain("social: { postsPerDay: 2 } # mine");
  });

  it("frees the name for a custom agent", () => {
    const cfg = parseFactory("agents:\n  - { name: community, instructions: agents/c.md }\n");
    expect(cfg.agents[0]!.name).toBe("community");
  });

  it("lists the remaining agent stations in order", () => {
    const stations = ["spec", "build", "review", "security", "reply", "scout", "research", "unjam"];
    expect(AGENT_STATIONS).toEqual(stations);
    expect(SKILL_STATIONS).toEqual(stations);
    expect(Object.keys(AGENT_ACCESS)).toEqual(stations);
    expect(FIXED_STATIONS).not.toContain("community");
  });
});

describe("panel.host", () => {
  it("defaults to 127.0.0.1 and takes the file's value", () => {
    expect(parseFactory("lines: []\n").panel).toEqual({ port: 4848, host: "127.0.0.1" });
    expect(parseFactory("panel: { host: 0.0.0.0 }\nlines: []\n").panel.host).toBe("0.0.0.0");
  });
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, effectiveLevel, findLine, parseFactory } from "../src/config.js";
import { factoryHome } from "../src/home.js";
import { addLine, detectClients, detectCommands, initFactory, slug } from "../src/init.js";
import { cleanup, gitRepo, tempDir } from "./helpers.js";

afterEach(cleanup);

describe("factory definition", () => {
  it("fills safe defaults around a single line", () => {
    const cfg = parseFactory("lines:\n  - name: api\n    repo: /work/api\n");
    expect(cfg).toMatchObject({ level: "L3", engine: "claude", isolation: "container", limits: { usdPerDay: 10, usdPerJob: 3 }, box: { runtime: "auto", cpus: 2 } });
    expect(cfg.lines[0]).toMatchObject({ integrate: "merge", baseBranch: "main", maxAttempts: 3 });
    expect(cfg.limits.protectedPaths).toContain(".github/**");
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

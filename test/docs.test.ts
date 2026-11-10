import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packagesPass, scheduledPass } from "../src/line/packages.js";
import { SecretStore, memoryKeyring } from "../src/keychain.js";
import { factoryConfig } from "../src/packages.js";
import { TabDataSchema } from "../src/package-tabs.js";
import { cleanup, fakeAgents, tempDir, testFactory, writeTree } from "./helpers.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const en = read("README.md");
const es = read("README.es.md");

const levels = (text: string) => text.split("\n").filter((l) => /^###? /.test(l)).map((l) => l.indexOf(" "));

/** Every fenced block as its info string and body. */
const blocks = (text: string) => [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```$/gm)].map((m) => ({ info: m[1]!.trim(), body: m[2]! }));

/** sh and yaml blocks without the translatable parts: double-quoted strings and trailing comments. */
const normalize = (body: string) =>
  body.split("\n").map((l) => l.replace(/"[^"\n]*"/g, "").replace(/ #.*$/, "").trimEnd()).join("\n").trim();

/** From a heading to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const start = text.split("\n").findIndex((l) => l.startsWith(heading));
  expect(start, heading).toBeGreaterThan(-1);
  const lines = text.split("\n").slice(start + 1);
  const end = lines.findIndex((l) => /^## /.test(l));
  return lines.slice(0, end === -1 ? undefined : end).join("\n");
}

function markdownFiles(dir: string): string[] {
  return readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownFiles(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name).replace(/\\/g, "/")] : [],
  );
}

describe("README in English and Spanish", () => {
  it("explain how Codex is billed in both languages", () => {
    for (const readme of [en, es]) {
      for (const word of ["ChatGPT", "CODEX_API_KEY", "OPENAI_API_KEY", "usdPerNight", "reservePercent"]) expect(readme).toContain(word);
    }
  });

  it("document Codex without its sandbox in both languages", () => {
    for (const text of [en, es]) {
      expect(blocks(text).map((b) => b.body).join("\n")).toContain("codex: { sandbox: off }");
      expect(text).toContain("danger-full-access");
    }
  });

  it("links the other language at the top", () => {
    const enTop = en.split("\n").slice(0, 3).join("\n");
    const esTop = es.split("\n").slice(0, 3).join("\n");
    expect(enTop).toContain("](README.es.md)");
    expect(enTop).toContain("English");
    expect(esTop).toContain("](README.md)");
    expect(esTop).toContain("Español");
  });

  it("documents the custom agents that write, in the code blocks of both", () => {
    for (const text of [en, es]) {
      const code = blocks(text).map((b) => b.body).join("\n");
      for (const piece of ["type: build", "files:", "--tipo build"]) expect(code).toContain(piece);
      expect(section(text, text === en ? "## Custom agents" : "## Agentes a medida")).not.toMatch(/For now they are read-only|Por ahora son revisores/);
    }
  });

  it("each file is in its language", () => {
    expect(en).toContain("## How it works");
    expect(en).not.toContain("## Cómo funciona");
    expect(es).toContain("## Cómo funciona");
  });

  it("state the freed-time principle in the principles of both", () => {
    const bullets = (text: string, heading: string) =>
      section(text, heading).split("\n").filter((line) => line.startsWith("- "));
    expect(bullets(en, "## How it works").some((line) => line.includes("zero automates software development with AI, freeing people's time to focus on strategy, creativity, oversight and professional collaboration."))).toBe(true);
    expect(bullets(es, "## Cómo funciona").some((line) => line.includes("zero automatiza el desarrollo de software con IA, liberando tiempo para que las personas se enfoquen en estrategia, creatividad, supervisión y colaboración profesional."))).toBe(true);
  });

  it("has the same heading levels in the same order", () => {
    expect(levels(en).length).toBeGreaterThan(0);
    expect(levels(en)).toEqual(levels(es));
  });

  it("document the Linear intake in both, and leave only Jira on the roadmap", () => {
    for (const [text, heading, roadmap] of [
      [en, "## Linear issues", "## Next steps"],
      [es, "## Issues de Linear", "## Próximas etapas"],
    ] as const) {
      const linear = section(text, heading);
      expect(linear).toContain("LINEAR_API_KEY");
      expect(blocks(linear).some((b) => b.info === "yaml" && b.body.includes("linear: { team: ENG, label: zero }"))).toBe(true);
      expect(blocks(linear).some((b) => b.info === "sh" && b.body.includes("zero secret set LINEAR_API_KEY"))).toBe(true);
      expect(linear).toContain("zero approve");
      const next = section(text, roadmap);
      expect(next).toContain("Jira");
      expect(next).not.toMatch(/linear/i);
    }
  });

  it("has the same code blocks, with identical commands and configuration", () => {
    const a = blocks(en);
    const b = blocks(es);
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((x) => x.info)).toEqual(b.map((x) => x.info));
    a.forEach((block, i) => {
      if (block.info === "sh" || block.info === "yaml") expect(normalize(block.body), `block ${i}`).toBe(normalize(b[i]!.body));
    });
  });
});

describe("motto", () => {
  it("uses the site's motto in both languages", () => {
    expect(en).toContain("zero in the loop");
    expect(es).toContain("zero in the loop");
    expect(en).toContain("you decide where to step back in");
    expect(es).toContain("vos decidís dónde volver a entrar");
  });

  it("leaves no Kaelen mention nor the old motto in the documentation", () => {
    const files = ["README.md", "README.es.md", "AGENTS.md", ...markdownFiles("docs"), "openspec/config.yaml"];
    for (const file of files) {
      // The repository's GitHub address is an identifier, not prose.
      const text = read(file).replaceAll("github.com/kaelen-phoenix/zero", "");
      expect(text, file).not.toMatch(/kaelen/i);
      expect(text, file).not.toContain("Zero human intervention required");
    }
  });

  it("describes the package in package.json without Kaelen nor the old motto", () => {
    const hasForbidden = (text: string) => /kaelen/i.test(text) || text.includes("Zero human intervention required");
    const pkg = JSON.parse(read("package.json")) as { name: string; description: string };
    expect(pkg.description).toBe("An open source software factory that runs on your machine: it turns requests into delivered changes, and you decide where to step back in.");
    expect(hasForbidden(pkg.description)).toBe(false);
    // The package name is an identifier, not prose.
    expect(pkg.name).toBe("@kaelen/zero");
    expect(hasForbidden("Kaelen Global Defence: autonomous agent network. Continuous execution. Zero human intervention required.")).toBe(true);
    expect(hasForbidden("Zero human intervention required")).toBe(true);
    expect(hasForbidden("KAELEN")).toBe(true);
  });
});

describe("documentation up to date", () => {
  it("names every chat tool in both READMEs", () => {
    const tools = new Set([...read("src/mcp/server.ts").matchAll(/"(zero_[a-z_]+)"/g)].map((m) => m[1]!));
    expect(tools.size).toBeGreaterThan(10);
    for (const tool of tools) {
      expect(en, tool).toContain(`\`${tool}\``);
      expect(es, tool).toContain(`\`${tool}\``);
    }
  });

  it("lists nothing as upcoming that already exists", () => {
    const upcoming = [
      section(es, "## Próximas etapas"), section(es, "## Hacia dónde va"),
      section(en, "## Next steps"), section(en, "## Where it is going"),
    ];
    for (const text of upcoming) {
      expect(text).not.toMatch(/Turno nocturno|Night shift/i);
      expect(text).not.toMatch(/Skills asignables|assignable skills/i);
    }
    expect(es).not.toContain("Turno nocturno (en camino)");
  });

  it("documents OTLP export as available in both READMEs", () => {
    for (const [text, observability, next] of [[es, "## Observabilidad", "## Próximas etapas"], [en, "## Observability", "## Next steps"]] as const) {
      const body = section(text, observability);
      expect(body).toContain("telemetry:");
      expect(body).toContain("otlp:");
      expect(section(text, next)).not.toContain("OTLP");
    }
  });

  it("shows a complete custom agent in both READMEs", () => {
    for (const [text, heading] of [[es, "## Agentes a medida"], [en, "## Custom agents"]] as const) {
      // The section ends at the example's own `## ` headings, so the instructions file is looked up in the whole README.
      const found = blocks(section(text, heading));
      expect(found.some((b) => b.info === "yaml" && b.body.includes("lines:") && b.body.includes("agents:"))).toBe(true);
      expect(blocks(text).some((b) => b.info === "markdown" && b.body.startsWith("# Agent: a11y"))).toBe(true);
      expect(blocks(text).some((b) => b.info === "sh" && b.body.includes("zero agent add"))).toBe(true);
    }
    expect(blocks(en).find((b) => b.body.startsWith("# Agent: a11y"))!.body).toBe(blocks(es).find((b) => b.body.startsWith("# Agent: a11y"))!.body);
  });

  it("no longer documents the removed proof of concept", () => {
    for (const text of [en, es]) {
      for (const piece of ["## Social media", "## Redes sociales", "zero social", "INSTAGRAM_ACCESS_TOKEN"]) expect(text, piece).not.toContain(piece);
    }
    const guide = read("AGENTS.md");
    for (const piece of ["src/social/", "src/line/community.ts", "communityPass"]) expect(guide, piece).not.toContain(piece);
    expect(guide).toContain("(`idlePasses`: scout, then research, then the packages' stations)");
    expect(read("docs/revision-linea-produccion.md")).not.toMatch(/community|zero social/);
    const agents = readdirSync(new URL("../agents/", import.meta.url));
    expect(agents).not.toContain("community.md");
    expect(agents).not.toContain("community-style.md");
    expect(read("agents/research.md")).not.toContain("community");
  });

  it("shows .agents/** in the protected paths example of both READMEs", () => {
    // normalize drops double-quoted strings, so the block comparison above cannot see this line.
    const line = '  protectedPaths: [".github/**", ".claude/**", ".agents/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]';
    for (const text of [en, es]) expect(text.split("\n")).toContain(line);
  });

  it("starts Getting started with the one-step installer and keeps the clone as the manual way", () => {
    const firsts: string[] = [];
    for (const [text, heading] of [[es, "## Empezar"], [en, "## Getting started"]] as const) {
      const sh = blocks(section(text, heading)).filter((b) => b.info === "sh");
      firsts.push(normalize(sh[0]!.body));
      expect(sh[0]!.body).toContain("curl -fsSL https://zerointheloop.com/install.sh | sh");
      expect(sh[0]!.body).toContain("irm https://zerointheloop.com/install.ps1 | iex");
      const manual = sh.find((b) => b.body.includes("git clone https://github.com/kaelen-phoenix/zero"));
      expect(manual, heading).toBeDefined();
      expect(manual!.body).toContain("npm install && npm run build");
    }
    expect(firsts[0]).toBe(firsts[1]);
  });

  it("says what the installer does and no longer lists it as a next step", () => {
    for (const [text, heading, words] of [
      [en, "## Getting started", ["Node 22", "npm", "git", "asks before changing anything", "administrator", "`zero setup`"]],
      [es, "## Empezar", ["Node 22", "npm", "git", "te pregunta antes de cambiar nada", "administrador", "`zero setup`"]],
    ] as const) {
      for (const word of words) expect(section(text, heading), word).toContain(word);
    }
    expect(section(en, "## Next steps")).not.toMatch(/installer/i);
    expect(section(es, "## Próximas etapas")).not.toMatch(/instalador/i);
  });
});

describe("install with Docker", () => {
  it("documents it right after Getting started, with the same pieces in the code blocks of both", () => {
    for (const [text, heading, previous] of [[en, "## Install with Docker", "## Getting started"], [es, "## Instalar con Docker", "## Empezar"]] as const) {
      const titles = text.split("\n").filter((l) => /^## /.test(l));
      expect(titles.indexOf(heading)).toBe(titles.indexOf(previous) + 1);
      const body = section(text, heading);
      const code = blocks(body).map((b) => b.body).join("\n");
      for (const piece of ["docker compose run --rm zero setup", "ZERO_CLIS", "zero_master_key", "compose.box.yaml", "ZERO_PANEL_PORT"]) expect(code, piece).toContain(piece);
      expect(body).toContain("socket");
      expect(body).toContain("--privileged");
      expect(body).toContain("worktree");
    }
  });

  it("warns about both ways of working in each language", () => {
    expect(section(en, "## Install with Docker")).toContain("control over your machine");
    expect(section(en, "## Install with Docker")).toContain("same container as the key and the secrets");
    expect(section(es, "## Instalar con Docker")).toContain("control sobre tu máquina");
    expect(section(es, "## Instalar con Docker")).toContain("mismo contenedor que la llave y los secretos");
  });

  it("describes it in AGENTS.md", () => {
    const guide = read("AGENTS.md");
    for (const piece of ["src/setup.ts", "encryptedFileKeyring", "ZERO_CONTAINER", "panel.host"]) expect(guide, piece).toContain(piece);
  });
});

describe("agent packages", () => {
  afterEach(cleanup);
  const HEADINGS = [[en, "## Agent packages"], [es, "## Paquetes de agentes"]] as const;

  it("documents the format in the same place of both", () => {
    for (const [text, heading] of HEADINGS) {
      const body = section(text, heading);
      for (const piece of ["zero-package.yaml", "interface: 1", "allowCode", "zero package add", "export async function pass", "ctx.runAgent", "ctx.deliveredJobs", "ctx.requestJob", "perLinePerDay", "schedule:", "export async function scheduled"]) expect(body, piece).toContain(piece);
    }
    const order = (text: string, a: string, b: string) => expect(text.indexOf(a)).toBeLessThan(text.indexOf(b));
    order(en, "## Agent packages", "## Night shift");
    order(es, "## Paquetes de agentes", "## Turno nocturno");
    expect(section(en, "## Agent packages")).toMatch(/your user's permissions/);
    expect(section(es, "## Paquetes de agentes")).toMatch(/permisos de tu usuario/);
  });

  it("documents git sources and updates in the code blocks of both", () => {
    for (const [text, heading] of HEADINGS) {
      const code = blocks(section(text, heading)).map((b) => b.body).join("\n");
      expect(code).toContain("zero package add github:");
      expect(code).toContain("zero package update");
    }
  });

  it("presents packages only as a way to extend zero", () => {
    for (const [text, heading] of HEADINGS) {
      const body = section(text, heading);
      expect(body, heading).not.toMatch(/community|enterprise|premium|commercial|comercial|edition|edición/i);
      expect(body, heading).toMatch(/third-party|terceros/);
    }
  });

  it.each(HEADINGS)("documents panel tabs with a manifest and data that load (%#)", async (text, heading) => {
    const body = section(text, heading);
    for (const word of ["tabs", "package-data", "ctx.dataDir", "categoria", "http", "1 MiB", "500", "#k="]) expect(body, word).toContain(word);
    const found = blocks(body);
    const tabs = found.find((b) => b.info === "yaml" && b.body.startsWith("tabs:"))!.body;
    const dir = tempDir("zero-example-");
    writeTree(dir, { "zero-package.yaml": `interface: 1\nname: hello\nversion: 1.0.0\n${tabs}` });
    const ctx = testFactory({ packages: [{ path: dir }] });
    ctx.config = await factoryConfig(ctx.home);
    expect(ctx.config.loadedPackages!.problems).toEqual([]);
    expect(ctx.config.loadedPackages!.packages[0]!.tabs.map((t) => t.name)).toEqual(["news"]);
    expect(TabDataSchema.safeParse(JSON.parse(found.find((b) => b.info === "json" && b.body.includes('"items"'))!.body)).success).toBe(true);
  });

  it.each(HEADINGS)("has an example that works when copied (%#)", async (text, heading) => {
    const found = blocks(section(text, heading));
    const manifest = found.find((b) => b.info === "yaml" && b.body.includes("interface: 1"))!.body;
    const code = found.find((b) => b.info === "js" && b.body.includes("export async function pass"))!.body;
    const dir = tempDir("zero-example-");
    writeTree(dir, {
      "zero-package.yaml": manifest,
      "stations/note.mjs": code,
      "stations/note.md": "# note\nOne sentence.\n",
      "agents/hello-review.md": "# hello-review\n",
      "skills/greeting/SKILL.md": "# greeting\n",
    });
    const ctx = testFactory({ packages: [{ path: dir, allowCode: true, config: { greeting: "Hello" } }], lines: [] });
    ctx.config = await factoryConfig(ctx.home);
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { HELLO_TOKEN: "abc" });
    expect(ctx.config.loadedPackages!.problems).toEqual([]);
    const agents = fakeAgents({ "package:hello/note": () => ({ output: { sentence: "Hola." } }) });
    await packagesPass(ctx, agents.runner, new Date());
    expect(agents.calls).toHaveLength(1);
    expect(agents.calls[0]!.prompt).toContain("Hello");
    expect(JSON.parse(ctx.store.getKv("package:hello/note:state:last")!)).toBe("Hola.");
  });

  it.each(HEADINGS)("has a schedule that works when copied (%#)", async (text, heading) => {
    const found = blocks(section(text, heading));
    const dir = tempDir("zero-example-");
    writeTree(dir, {
      "zero-package.yaml": found.find((b) => b.info === "yaml" && b.body.includes("interface: 1"))!.body,
      "stations/note.mjs": found.find((b) => b.info === "js" && b.body.includes("export async function scheduled"))!.body,
      "stations/note.md": "# note\nOne sentence.\n",
      "agents/hello-review.md": "# hello-review\n",
      "skills/greeting/SKILL.md": "# greeting\n",
    });
    const ctx = testFactory({ packages: [{ path: dir, allowCode: true, config: { greeting: "Hello" } }], lines: [] });
    ctx.config = await factoryConfig(ctx.home);
    ctx.secrets = new SecretStore(ctx.home, memoryKeyring(), { HELLO_TOKEN: "abc" });
    expect(ctx.config.loadedPackages!.problems).toEqual([]);
    expect(ctx.config.loadedPackages!.stations[0]!.schedule).toEqual(["08:00", "12:00", "18:00"]);
    await scheduledPass(ctx, new Date(2026, 10, 4, 12, 0));
    expect(JSON.parse(ctx.store.getKv("package:hello/note:state:lastCheck")!)).toBe("12:00");
  });

  it("describes the scheduled passes in AGENTS.md", () => {
    expect(read("AGENTS.md")).toContain("scheduledPass");
  });
});

describe("zero, CI and quality tools", () => {
  const EN_HEADING = "## zero, your CI and your quality tools";
  const ES_HEADING = "## zero, tu CI y tus herramientas de calidad";
  const enCi = section(en, EN_HEADING);
  const esCi = section(es, ES_HEADING);

  it("sits after auto-merge and before the browser panel", () => {
    for (const [text, heading, after, before] of [
      [en, EN_HEADING, "### Auto-merge", "## Browser panel"],
      [es, ES_HEADING, "### Fusión automática", "## Panel en el navegador"],
    ] as const) {
      const lines = text.split("\n");
      const at = (h: string) => lines.findIndex((l) => l === h);
      expect(at(heading)).toBeGreaterThan(at(after));
      expect(at(after)).toBeGreaterThan(-1);
      expect(at(before)).toBeGreaterThan(at(heading));
    }
  });

  it("names CI and the quality tools, and says zero does not replace them", () => {
    for (const text of [enCi, esCi]) {
      for (const tool of ["GitHub Actions", "CI/CD", "SonarQube", "SonarCloud", "CodeQL", "Dependabot", "Snyk"]) expect(text, tool).toContain(tool);
    }
    expect(enCi).toContain("does not replace");
    expect(esCi).toContain("no reemplaza");
  });

  it("describes local verification, auto-merge on checks, the no-checks caveat and the platform's deploys", () => {
    for (const text of [enCi, esCi]) {
      for (const fact of ["`pull-request`", "`autoMerge`", "Vercel", "checks"]) expect(text, fact).toContain(fact);
    }
    expect(enCi).toContain("verification");
    expect(esCi).toContain("verificación");
    expect(enCi).toContain("no checks");
    expect(esCi).toContain("ningún check");
  });

  it("recommends CI and static analysis", () => {
    expect(enCi).toContain("Recommendation");
    expect(enCi).toContain("static analysis");
    expect(esCi).toContain("Recomendación");
    expect(esCi).toContain("análisis estático");
  });

  it("draws the path from the request to the platform's deploy", () => {
    for (const [text, deploy] of [[enCi, "deploy"], [esCi, "despliegue"]] as const) {
      const diagram = blocks(text).find((b) => b.info === "")!;
      expect(diagram).toBeDefined();
      const at = ["spec", "build", "verify", "review", "security", "pull request", "merge"].map((w) => diagram.body.indexOf(w));
      expect(at.every((i) => i > -1)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(diagram.body).toContain(deploy);
    }
  });
});

describe("what the factory produces", () => {
  it("is documented in a section of each README, with allowedArtifacts in the code blocks of both", () => {
    for (const [text, heading] of [[en, "## What stays on your machine"], [es, "## Lo que queda en tu máquina"]] as const) {
      const part = section(text, heading);
      for (const word of ["allowedArtifacts", "ZERO_HOME", "ZERO_HOME/reports"]) expect(part).toContain(word);
      expect(blocks(text).map((b) => b.body).join("\n")).toContain("allowedArtifacts:");
    }
  });

  it("is a rule of AGENTS.md", () => {
    const agents = read("AGENTS.md");
    for (const word of ["allowedArtifacts", "operationArtifacts", "saveReport"]) expect(agents).toContain(word);
    expect(agents.split("## Conventions")[1]).toContain("stays only in ZERO_HOME");
  });
});

describe("AGENTS.md", () => {
  it("states the language rule for the documentation", () => {
    const conventions = read("AGENTS.md").split("## Conventions")[1]!;
    const rule = conventions.split("\n").find((l) => l.includes("README.md") && l.includes("README.es.md"));
    expect(rule).toBeDefined();
    expect(rule).toContain("both");
    expect(rule).toContain("Spanish");
  });
});

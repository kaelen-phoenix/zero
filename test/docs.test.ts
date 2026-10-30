import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
  it("links the other language at the top", () => {
    const enTop = en.split("\n").slice(0, 3).join("\n");
    const esTop = es.split("\n").slice(0, 3).join("\n");
    expect(enTop).toContain("](README.es.md)");
    expect(enTop).toContain("English");
    expect(esTop).toContain("](README.md)");
    expect(esTop).toContain("Español");
  });

  it("each file is in its language", () => {
    expect(en).toContain("## How it works");
    expect(en).not.toContain("## Cómo funciona");
    expect(es).toContain("## Cómo funciona");
  });

  it("has the same heading levels in the same order", () => {
    expect(levels(en).length).toBeGreaterThan(0);
    expect(levels(en)).toEqual(levels(es));
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
    expect(en).toContain("the owner decides where to step back in");
    expect(es).toContain("el dueño decide dónde vuelve a entrar");
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

  it("starts Getting started with the clone", () => {
    for (const [text, heading] of [[es, "## Empezar"], [en, "## Getting started"]] as const) {
      const first = blocks(section(text, heading)).find((b) => b.info === "sh")!;
      expect(first.body).toContain("git clone https://github.com/kaelen-phoenix/zero");
      expect(first.body).toContain("npm install && npm run build");
    }
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

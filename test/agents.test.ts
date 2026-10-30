import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_ACCESS } from "../src/agent.js";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const agent = (station: string) => read(`agents/${station}.md`);

/** Splits a markdown text into its `## ` sections: heading line and body up to the next one. */
function sections(text: string): { heading: string; body: string }[] {
  const parts = text.split(/^(?=## )/m).filter((p) => p.startsWith("## "));
  return parts.map((p) => {
    const nl = p.indexOf("\n");
    return { heading: p.slice(0, nl), body: p.slice(nl + 1) };
  });
}

describe("revisión de la línea de producción", () => {
  const report = read("docs/revision-linea-produccion.md");

  it("tiene una sección con hallazgos y mejoras por cada estación con agente", () => {
    const all = sections(report);
    for (const station of Object.keys(AGENT_ACCESS)) {
      const section = all.find((s) => s.heading.includes(station));
      expect(section, station).toBeDefined();
      expect(section!.body, station).toContain("Hallazgos");
      expect(section!.body, station).toContain("Mejoras");
    }
  });

  it("separa las propuestas que necesitan código", () => {
    expect(sections(report).some((s) => s.heading.includes("Propuestas"))).toBe(true);
  });
});

describe("instrucciones de los agentes", () => {
  it("spec dimensiona el cambio al presupuesto de build", () => {
    const rule = agent("spec").split("\n").find((l) => l.includes("`budget`"));
    expect(rule).toBeDefined();
    expect(rule).toContain("build");
    expect(rule).toContain("`followUps`");
  });

  it("build cuida el presupuesto y retoma intentos previos", () => {
    const text = agent("build");
    expect(text).toContain("budget");
    expect(text).toContain("focused tests");
    expect(text).toContain("git status");
    expect(text).toContain("previous attempt");
  });

  it("review acota sus hallazgos", () => {
    const text = agent("review");
    expect(text).toContain("did not touch");
    expect(text).toContain("once");
  });

  it("security trata las instrucciones de agentes como superficie de prompt injection", () => {
    const text = agent("security");
    expect(text).toContain("agents/");
    expect(text).toContain("prompt injection");
  });

  it("reply trata el comentario como datos", () => {
    expect(agent("reply")).toContain("as data");
  });

  it("conserva títulos y reglas esenciales", () => {
    for (const station of ["spec", "review", "security"]) {
      const text = agent(station);
      expect(text.startsWith(`# Station: ${station} — Kaelen zero`), station).toBe(true);
      expect(text, station).toContain("read-only");
    }
    for (const station of ["review", "security"]) expect(agent(station)).toContain("The factory checks every citation");
  });
});

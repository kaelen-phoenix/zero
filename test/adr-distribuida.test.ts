import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("../docs/adr/", import.meta.url));
const read = (name: string) => readFileSync(`${dir}${name}`, "utf8").replace(/\r\n/g, "\n");

describe("docs/adr numbering", () => {
  it("never repeats a four-digit prefix", () => {
    const prefixes = readdirSync(dir).filter((name) => /^\d{4}-/.test(name)).map((name) => name.slice(0, 4));
    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes.filter((prefix, i) => prefixes.indexOf(prefix) !== i)).toEqual([]);
  });

  it("numbers the self-update ADR 0006", () => {
    expect(existsSync(`${dir}0006-autoactualizacion.md`)).toBe(true);
    expect(existsSync(`${dir}0005-autoactualizacion.md`)).toBe(false);
    expect(read("0006-autoactualizacion.md").split("\n")[0]).toMatch(/^# ADR 0006/);
  });
});

describe("docs/adr/0007-fabrica-distribuida.md", () => {
  const name = "0007-fabrica-distribuida.md";

  it("exists with the ADR header and sections", () => {
    expect(existsSync(`${dir}${name}`)).toBe(true);
    const file = read(name);
    expect(file.split("\n")[0]).toMatch(/^# ADR 0007/);
    for (const piece of ["**Estado:**", "**Fecha:**", "## Contexto", "## Decisión", "## Consecuencias"]) expect(file).toContain(piece);
  });

  it("covers every topic", () => {
    const file = read(name);
    for (const piece of [
      "atómic", "latido", "plazo", "sin subir", "conflicto", "privado",
      "githubMeter", "GitHub Actions", "presupuesto", "zero unirse",
      "una sola máquina", "secretos", "Etapa",
    ]) expect(file).toContain(piece);
  });

  it("records the second part: the probe, the closing record, the shared queue and resuming", () => {
    const file = read(name);
    for (const piece of ["probeCoord", "coord:probe", "registro de cierre", "queue/<trabajo>", "sources/<clave>", "progress/<trabajo>", "--force-with-lease", "Segunda parte"]) expect(file).toContain(piece);
    expect(file).not.toContain("no verificado contra GitHub real");
  });

  it("records the third part: lines, the shared budget and control from any machine", () => {
    const file = read(name);
    for (const piece of ["lines/<nombre>", "spend/<id>", "status/<id>", "decisions/<clave>", "ZERO_HOME/lines", "platforms", "La única excepción es agregar una línea nueva", "--add-readme", "Tercera parte"]) expect(file).toContain(piece);
    for (const gone of ["**Después:**", "En etapas siguientes", "en etapas siguientes", "todavía se cuenta en cada máquina"]) expect(file).not.toContain(gone);
  });

  it("has one subsection per topic", () => {
    const headings = read(name).split("\n").filter((line) => line.startsWith("### "));
    for (const topic of [/toma un trabajo/, /máquina caída/, /sin subir/, /Conflictos/, /Seguridad/, /Cuota de GitHub/, /Presupuesto/, /Las líneas/, /Desde cualquier máquina/, /Unirse/, /una sola máquina/, /Etapas/]) {
      expect(headings.filter((h) => topic.test(h))).toHaveLength(1);
    }
  });
});

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

  it("has one subsection per topic", () => {
    const headings = read(name).split("\n").filter((line) => line.startsWith("### "));
    for (const topic of [/toma un trabajo/, /máquina caída/, /sin subir/, /Conflictos/, /Seguridad/, /Cuota de GitHub/, /Presupuesto/, /Unirse/, /una sola máquina/, /Etapas/]) {
      expect(headings.filter((h) => topic.test(h))).toHaveLength(1);
    }
  });
});

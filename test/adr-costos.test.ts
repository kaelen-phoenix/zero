import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("../docs/adr/", import.meta.url));
const path = fileURLToPath(new URL("../docs/adr/0005-costos-de-ci.md", import.meta.url));
const read = () => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("docs/adr/0005-costos-de-ci.md", () => {
  it("exists with the ADR header and sections", () => {
    expect(existsSync(path)).toBe(true);
    const file = read();
    expect(file.split("\n")[0]).toMatch(/^# ADR 0005/);
    for (const piece of ["**Estado:**", "**Fecha:**", "## Contexto", "## Decisión", "## Consecuencias"]) expect(file).toContain(piece);
  });

  it("is the only ADR numbered 0005", () => {
    expect(readdirSync(dir).filter((name) => name.startsWith("0005-"))).toEqual(["0005-costos-de-ci.md"]);
  });

  it("states the measured figures and lines", () => {
    const file = read();
    for (const piece of ["55,63", "25,63", "soliloq", "android", "ios", "e2e-flujos", "newoman", "glowingsanhair", "zero-plus"]) expect(file).toContain(piece);
  });

  it("has six proposals, each with savings and risk", () => {
    const sections = read().split(/^### Propuesta /m).slice(1);
    expect(sections.length).toBeGreaterThanOrEqual(6);
    for (const section of sections) {
      expect(section).toMatch(/^\*\*Ahorro estimado:\*\*/m);
      expect(section).toMatch(/^\*\*Riesgo:\*\*/m);
    }
  });

  it("covers every topic of the request", () => {
    const file = read();
    for (const piece of [
      "tren de integración", "merge queue", "bisección",
      "src/intake/security-alerts.ts", "groups",
      "GITHUB_BILLING_TOKEN", "ChecksBilling", "`user`",
      "paths", "concurrency", "cancel-in-progress", "cache",
      "ChecksOutage", "staging",
      "Claude", "Vercel", "Supabase", "services",
    ]) expect(file).toContain(piece);
    expect(file).toMatch(/no verificado/i);
  });
});

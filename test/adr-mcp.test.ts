import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const path = fileURLToPath(new URL("../docs/adr/0004-servidores-mcp.md", import.meta.url));
const read = () => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("docs/adr/0004-servidores-mcp.md", () => {
  it("exists with the ADR header and sections", () => {
    expect(existsSync(path)).toBe(true);
    const file = read();
    expect(file.split("\n")[0]).toMatch(/^# ADR 0004/);
    for (const piece of ["**Estado:**", "**Fecha:**", "## Contexto", "## Decisión", "## Consecuencias"]) expect(file).toContain(piece);
  });

  it("covers every station", () => {
    const file = read();
    for (const station of ["spec", "build", "verify", "review", "security", "scout", "research", "reply"]) expect(file).toContain(`\`${station}\``);
  });

  it("evaluates the named catalog servers", () => {
    const file = read();
    for (const server of ["Playwright", "Chrome DevTools", "GitHub", "Serena", "Skyvern"]) expect(file).toContain(server);
  });

  it("states the risks and the guarantee rule", () => {
    const file = read();
    for (const word of ["credencial", "puerta", "copia de trabajo", "garantías"]) expect(file).toContain(word);
  });

  it("records what each engine loads today", () => {
    const file = read();
    expect(file).toContain("strictMcpConfig");
    expect(file).toContain("mcpServers");
    expect(file).toMatch(/no verificado/i);
  });

  it("decides on publishing zero's own server", () => {
    const file = read();
    expect(file).toContain("zero mcp");
    expect(file).toContain("catálogo");
  });

  it("lists at least three next requests", () => {
    const lines = read().split("\n");
    const at = lines.findIndex((l) => /^#+ .*Próximos pedidos/.test(l));
    expect(at).toBeGreaterThan(-1);
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((l) => /^#/.test(l));
    const items = (end === -1 ? rest : rest.slice(0, end)).filter((l) => /^\s*[-*] /.test(l));
    expect(items.length).toBeGreaterThanOrEqual(3);
  });
});

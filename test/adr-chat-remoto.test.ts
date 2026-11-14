import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const path = fileURLToPath(new URL("../docs/adr/0005-chat-remoto.md", import.meta.url));
const read = () => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

/** The lines under the first heading matching `title`, up to the next heading of the same or a higher level. */
function section(title: RegExp): string {
  const lines = read().split("\n");
  const at = lines.findIndex((l) => /^#+ /.test(l) && title.test(l));
  if (at === -1) return "";
  const level = /^#+/.exec(lines[at]!)![0].length;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => { const m = /^(#+) /.exec(l); return !!m && m[1]!.length <= level; });
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("docs/adr/0005-chat-remoto.md", () => {
  it("exists with the ADR header and sections", () => {
    expect(existsSync(path)).toBe(true);
    const file = read();
    expect(file.split("\n")[0]).toMatch(/^# ADR 0005 — /);
    for (const piece of ["**Estado:**", "**Fecha:**", "## Contexto", "## Decisión", "## Consecuencias"]) expect(file).toContain(piece);
  });

  it("names the clients and the protocol pieces", () => {
    const file = read();
    for (const word of ["ChatGPT", "Claude", "OAuth", "PKCE", "streamable HTTP"]) expect(file).toContain(word);
  });

  it("cites official sources of OpenAI and Anthropic", () => {
    const urls = read().match(/https:\/\/[^\s)]+/g) ?? [];
    expect(urls.some((u) => /^https:\/\/([a-z0-9-]+\.)*openai\.com\//.test(u))).toBe(true);
    expect(urls.some((u) => /^https:\/\/([a-z0-9-]+\.)*(anthropic|claude)\.com\//.test(u))).toBe(true);
  });

  it("marks what could not be read at the source", () => {
    expect(read()).toMatch(/no verificado/i);
  });

  it("covers plans, write tools and the phone app", () => {
    const file = read();
    for (const word of ["modo desarrollador", "conector propio", "Plus", "Pro", "celular", "escriben"]) expect(file).toContain(word);
  });

  it("recommends not publishing in either directory and names an alternative", () => {
    const text = section(/Directorios/);
    expect(text).toMatch(/no se publica/i);
    expect(text).toContain("ChatGPT");
    expect(text).toContain("Claude");
    expect(text).toMatch(/conector propio de cada persona con su URL/i);
  });

  it("evaluates a stable address", () => {
    const text = section(/Dirección estable/);
    for (const option of ["Túnel rápido", "Túnel con nombre", "Dominio propio"]) expect(text).toContain(option);
    expect(text).toContain("consentimiento");
  });

  it("keeps the remote server off by default and approved with the panel key", () => {
    const file = read();
    for (const piece of ["zero mcp remote on", "apagado por defecto", "clave", "zero:read", "zero:act", "SHA-256"]) expect(file).toContain(piece);
  });
});

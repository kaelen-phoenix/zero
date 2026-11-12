import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("../docs/adr/", import.meta.url));

describe("docs/adr numbering", () => {
  it("gives every ADR its own number", () => {
    const numbers = readdirSync(dir).filter((f) => /^\d{4}-/.test(f)).map((f) => f.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("keeps the self-update decisions as ADR 0005", () => {
    const file = readFileSync(`${dir}0005-autoactualizacion.md`, "utf8");
    expect(file.split(/\r?\n/)[0]).toMatch(/^# ADR 0005/);
  });
});

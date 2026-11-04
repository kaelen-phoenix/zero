import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = (dir: string) => {
  const root = new URL(`../${dir}/`, import.meta.url);
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(new URL(f.replace(/\\/g, "/"), root), "utf8") }));
};

/** The text filter's own tests live in test/public-text.test.ts, next to the function. */
describe("folder of the removed proof of concept", () => {
  it("is gone", () => {
    expect(existsSync(new URL("../src/social/", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/line/community.ts", import.meta.url))).toBe(false);
  });

  it("is imported by nothing", () => {
    const importers = [...sources("src"), ...sources("test")].filter(({ text }) => /^import [^\n]* from "[^"]*social\//m.test(text));
    expect(importers.map(({ file }) => file)).toEqual([]);
  });

  it("no longer hosts the filter the packages' stations rely on", () => {
    expect(readFileSync(new URL("../src/line/packages.ts", import.meta.url), "utf8")).toContain('from "../public-text.js"');
  });
});

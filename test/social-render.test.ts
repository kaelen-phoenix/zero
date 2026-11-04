import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Image rendering left with the removed proof of concept, and nothing else used these. */
describe("dependencies of the removed proof of concept", () => {
  it.each(["@resvg/resvg-js", "@expo-google-fonts/anton", "dejavu-fonts-ttf", "jpeg-js"])("%s is not a direct dependency", (name) => {
    expect(JSON.parse(read("package.json")).dependencies).not.toHaveProperty([name]);
    expect(JSON.parse(read("package-lock.json")).packages[""].dependencies).not.toHaveProperty([name]);
  });
});

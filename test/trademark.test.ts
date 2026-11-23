import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** Read inside each test, so a missing file fails the scenarios and not the collection. */
const policy = () => read("TRADEMARK.md");
const headings = (text: string) => text.split("\n").filter((l) => l.startsWith("## "));
const bullets = (text: string) => text.split("\n").filter((l) => l.startsWith("- "));

/** The text under a second-level heading, up to the next one. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return rest.slice(0, end === -1 ? undefined : end).join("\n");
}

const ALLOWED = "## Uses that do not need permission";
const RESTRICTED = "## Uses that need permission";

describe("the trademark policy", () => {
  it("has a title and names the marks it covers", () => {
    expect(policy()).toMatch(/^# \S/);
    const marks = bullets(section(policy(), "## The marks")).join("\n");
    for (const piece of ["zero in the loop", "logo", "site/brand/"]) expect(marks).toContain(piece);
  });

  it("keeps the marks apart from the license and points to it", () => {
    const license = section(policy(), "## The code's license");
    for (const piece of ["Apache-2.0", "](LICENSE)"]) expect(license).toContain(piece);
    expect(license).toContain("section 6 of the license grants no permission to use the marks");
    expect(license).toContain("does not change the license of the code");
    expect(license).toContain("does not restrict any right the license gives you over the code");
  });

  it("leaves the license as it was", () => {
    expect(read("LICENSE")).toMatch(/^\s*6\. Trademarks\. This License does not grant permission to use the trade$/m);
    expect((JSON.parse(read("package.json")) as { license: string }).license).toBe("Apache-2.0");
  });

  it("lists the uses allowed without permission", () => {
    const allowed = bullets(section(policy(), ALLOWED)).join("\n");
    for (const piece of ["Fork and modify", "works with zero in the loop", "unmodified copies", "`zero` command", "signature"]) {
      expect(allowed).toContain(piece);
    }
    expect(allowed).toMatch(/signature.*does not mean that the project endorses/);
  });

  it("lists apart the uses that need prior written permission", () => {
    expect(headings(policy())).toEqual(expect.arrayContaining([ALLOWED, RESTRICTED]));
    const restricted = section(policy(), RESTRICTED);
    expect(restricted).toContain("prior written permission");
    const list = bullets(restricted).join("\n");
    for (const piece of ["product", "fork", "hosted", "training", "logos", "official", "endorsement", "affiliation", "similar enough to cause confusion"]) {
      expect(list).toContain(piece);
    }
    expect(restricted).toMatch(/distribute a modified version.*use another name and remove the logos/);
  });

  it("claims no exclusivity over the generic word and is not legal advice", () => {
    expect(policy()).toContain('claims no exclusivity over the word "zero" on its own');
    expect(policy()).toContain("not legal advice");
  });

  it("does not present the marks as registered", () => {
    expect(policy()).not.toContain("®");
    expect(policy()).not.toMatch(/registered\s+trademark/i);
  });

  it("asks for permission through the site's contact section, with no address or phone", () => {
    expect(section(policy(), "## How to ask for permission")).toContain("https://zerointheloop.com/#contact");
    expect(read("site/index.html")).toContain('id="contact"');
    expect(policy()).not.toContain("mailto:");
    expect(policy()).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
    expect(policy()).not.toContain("wa.me");
    expect(policy()).not.toMatch(/\d[\d\s()-]{6,}\d/);
  });

  it("follows the wording for people", () => {
    const text = policy().replaceAll("github.com/kaelen-phoenix/zero", "");
    expect(text).not.toMatch(/\bowner/i);
    expect(text).not.toMatch(/kaelen/i);
  });
});

describe("where the policy is linked", () => {
  it("closes both READMEs with the license and the trademark", () => {
    for (const [file, heading] of [["README.md", "## License and trademark"], ["README.es.md", "## Licencia y marca"]] as const) {
      const text = read(file);
      expect(headings(text).at(-1)).toBe(heading);
      const last = section(text, heading);
      for (const piece of ["](LICENSE)", "](TRADEMARK.md)", "Apache-2.0", "zero in the loop", "logos"]) expect(last).toContain(piece);
    }
  });

  it("is named in the guide's entry about the logos", () => {
    const entry = read("docs/agents/site.md").split("\n").filter((l) => l.startsWith("- `site/brand/`"));
    expect(entry).toHaveLength(1);
    expect(entry[0]).toContain("TRADEMARK.md");
  });
});

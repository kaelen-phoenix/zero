import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { requestWork } from "../src/app.js";
import { finalizeJob, reasonForOthers, rejectedByYou, STOPPED_BY_YOU } from "../src/line/finish.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Every file under a folder with the given extension, relative to the repository. */
function filesUnder(dir: string, ext: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) return filesUnder(path, ext);
    return name.endsWith(ext) ? [path] : [];
  });
}

const FORBIDDEN = new RegExp("due\\u00f1", "i");
const siteEn = () => {
  const context: { zeroSite?: { EN: Record<string, string> } } = {};
  runInNewContext(read("site/main.js"), context);
  return context.zeroSite!.EN;
};
const heroLabel = () => /<text class="([^"]+)"[^>]*data-i18n="fig\.owner">([^<]*)<\/text>/.exec(read("site/index.html"));
const heroDesc = () => /<desc id="fig-desc" data-i18n="fig\.desc">([^<]+)<\/desc>/.exec(read("site/index.html"))![1]!;

describe("what a person reads", () => {
  it("never uses the old word for the person in charge", () => {
    const files = [...filesUnder("src", ".ts"), "site/index.html", "site/main.js", "README.es.md", ...filesUnder("docs", ".md")];
    expect(files).toContain("src/app.ts");
    expect(files).toContain("docs/adr/0001-construir-vs-adoptar.md");
    expect(files.filter((f) => FORBIDDEN.test(read(f)))).toEqual([]);
  });

  it("says no owner in the English README's prose", () => {
    const prose = read("README.md")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "");
    expect(prose.split("\n").filter((l) => /\bowner/i.test(l))).toEqual([]);
  });

  it("says no owner in the English site", () => {
    const en = siteEn();
    expect(Object.entries(en).filter(([, text]) => /\bowner/i.test(text))).toEqual([]);
    expect(en["fig.owner"]).toBe("you");
  });
});

describe("the hero figure", () => {
  it("labels the person as vos and keeps its class", () => {
    expect(heroLabel()?.[1]).toBe("owner-label");
    expect(heroLabel()?.[2]).toBe("vos");
  });

  it("speaks to the person in its accessible description", () => {
    const es = heroDesc();
    const en = siteEn()["fig.desc"]!;
    expect(es).toContain("vos");
    expect(es).toContain("decidís");
    expect(en).toContain("you");
    for (const text of [es, en]) for (const station of ["spec", "build", "verify", "review", "security", "integrate"]) expect(text).toContain(station);
  });
});

describe("reasons", () => {
  it("speak to the person when stored", () => {
    expect(STOPPED_BY_YOU).toBe("Lo detuviste vos.");
    expect(rejectedByYou("no era esto")).toBe("Lo rechazaste vos: no era esto");
    expect(rejectedByYou()).toBe("Lo rechazaste vos.");
  });

  it("go to the third person for everyone else, leaving other reasons alone", () => {
    expect(reasonForOthers("Lo rechazaste vos: no era esto")).toBe("Lo rechazó la persona responsable: no era esto");
    expect(reasonForOthers("Lo detuviste vos.")).toBe("Lo detuvo la persona responsable.");
    expect(reasonForOthers("La rama está en conflicto")).toBe("La rama está en conflicto");
  });

  it("reach the townhall in the third person", async () => {
    const ctx = testFactory({ lines: [{ name: "demo", repo: gitRepo(), verify: [] }] });
    const { job } = requestWork(ctx, { text: "algo", line: "demo" });
    await finalizeJob(ctx, job, "stopped", { reason: STOPPED_BY_YOU });
    const posts = await ctx.townhall.recall({ line: "demo" });
    expect(posts.map((p) => p.body)).toContain("Lo detuvo la persona responsable.");
    expect(JSON.stringify(posts)).not.toContain("detuviste");
  });
});

describe("agents that write for people", () => {
  it.each(["spec", "scout", "research", "reply", "unjam"])("%s carries the wording rule", (station) => {
    const text = read(`agents/${station}.md`);
    expect(text).toContain("la persona responsable");
    expect(text).toContain("the person in charge");
    expect(text).not.toMatch(FORBIDDEN);
  });
});

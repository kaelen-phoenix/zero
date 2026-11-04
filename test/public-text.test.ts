import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { ConfigError, parseFactory } from "../src/config.js";
import { publicText } from "../src/public-text.js";
import { findSecret, redact } from "../src/secrets.js";

const REPO = "/srv/obra/zero";
const WIN_REPO = "C:\\Users\\Ana María\\obra\\zero";
const repos = [REPO, WIN_REPO];
const clean = (text: string) => publicText(text, repos);
const IG_TOKEN = `IGAA${"x1".repeat(18)}`;

describe("public text filter", () => {
  it("breaks mentions with a zero-width space and removes nothing", () => {
    expect(clean("Gracias @alguien")).toEqual({ text: "Gracias @\u200balguien", removed: false });
  });

  it("flags recognisable credentials", () => {
    for (const secret of ["ghp_" + "a".repeat(36), IG_TOKEN, "token: abcdefgh12345"]) {
      const out = clean(`mirá ${secret} acá`);
      expect(out.removed, secret).toBe(true);
    }
    expect(clean(`mirá ${IG_TOKEN}`).text).not.toContain(IG_TOKEN);
  });

  it("flags secrets inside a web address", () => {
    expect(clean(`https://a.example/?x=${IG_TOKEN}`).removed).toBe(true);
  });

  it.each([
    ["a path with spaces under a known root", "/home/ana maria/obra/x"],
    ["a Windows path with spaces", "C:\\Program Files\\zero\\x"],
    ["a line's repository with spaces", `${WIN_REPO}\\src`],
    ["a sibling folder sharing the repository's prefix", "/srv/obra/zero-viejo/x"],
    ["a sibling of the Windows repository", `${WIN_REPO}-viejo\\x`],
    ["an absolute path outside the home", "/opt/app/x"],
    ["a system root alone", "en /opt quedó"],
    ["a path between parentheses", "ver (/var/lib/zero)"],
    ["a file URL", "file:///etc/hosts"],
    ["a network path", "\\\\servidor\\compartido\\x"],
    ["a path from the home", "~/obra/x"],
    ["the home folder", `${homedir()}/x`],
  ])("flags %s", (_name, text) => {
    const out = clean(`Mirá ${text} y seguí`);
    expect(out.removed).toBe(true);
    expect(out.text).not.toContain("obra");
    expect(out.text).not.toContain("maria");
  });

  it.each([
    "https://zerointheloop.com/a/b",
    "http://zerointheloop.com/a/b?c=d#e",
    "https://github.com/zero/@alguien/x",
  ])("leaves the web address %s intact", (url) => {
    expect(clean(`Mirá ${url} hoy`)).toEqual({ text: `Mirá ${url} hoy`, removed: false });
  });

  it.each(["CI/CD y TCP/IP", "la vista /line del panel", "el 04/11/2026", "y/o", "zerointheloop.com/a/b", "50% más rápido: listo"])("does not take %s for a path", (text) => {
    expect(clean(text)).toEqual({ text, removed: false });
  });

  it("still flags a path after a web address", () => {
    const out = clean("https://zerointheloop.com/a y /opt/app/x");
    expect(out.removed).toBe(true);
    expect(out.text).toContain("https://zerointheloop.com/a");
    expect(out.text).not.toContain("/opt/app");
  });
});

describe("Instagram token shape", () => {
  it("is recognised by redact and findSecret", () => {
    const token = `IGAA${"a".repeat(36)}`;
    expect(token).toHaveLength(40);
    expect(findSecret(`x ${token} y`)).toBe(token);
    expect(redact(`x ${token} y`)).not.toContain(token);
  });
});

describe("Facebook Page tokens", () => {
  const PAGE_TOKEN = `EAA${"a".repeat(40)}`;

  it("are recognized as secrets", () => {
    expect(findSecret(`x ${PAGE_TOKEN} y`)).toBe(PAGE_TOKEN);
    expect(findSecret(`EAA${"a".repeat(19)}`)).toBeUndefined();
    expect(() => parseFactory(`social: { signature: ${PAGE_TOKEN} }\n`)).toThrow(ConfigError);
    expect(publicText(`token ${PAGE_TOKEN}`, []).removed).toBe(true);
  });
});

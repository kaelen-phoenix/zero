import { describe, expect, it } from "vitest";
import { DEFAULT_SOCIAL_SIGNATURE } from "../src/config.js";
import { auditCaption, auditImageText, MAX_TEXT } from "../src/social/audit.js";

const signature = DEFAULT_SOCIAL_SIGNATURE;
const TAGS = "#zero #fabrica #software #ia";
const caption = (body: string, tags = TAGS) => `${body}\n\n${tags}`;
const audit = (text: string) => auditCaption(text, signature);

describe("the caption's shape", () => {
  it("passes a short opening sentence and a closing paragraph of 4 hashtags", () => {
    expect(audit(caption(`${"a".repeat(59)}. Después sigue el resto del texto con calma.`))).toEqual([]);
  });

  it("counts a first line as the end of the hook", () => {
    expect(audit(`Una línea corta sin punto\nDespués viene ${"mucho ".repeat(40)}\n\n${TAGS}`)).toEqual([]);
  });

  it("does not take a web address's dot for the end of a sentence", () => {
    expect(audit(caption(`Mirá zerointheloop.com y ${"x".repeat(150)}`)).join()).toContain("hook");
  });

  it("reports a first sentence that ends at character 180", () => {
    expect(audit(caption(`${"a".repeat(179)}. Sigue.`)).join()).toContain("hook");
  });

  it("takes a hook that ends exactly at character 125", () => {
    expect(audit(caption(`${"a".repeat(124)}. Sigue.`))).toEqual([]);
  });

  it.each([
    ["2", "#uno #dos"],
    ["6", "#uno #dos #tres #cuatro #cinco #seis"],
    ["0", ""],
  ])("refuses %s hashtags", (_n, tags) => {
    expect(audit(tags ? caption("Una frase.", tags) : "Una frase.").join()).toContain("hashtags");
  });

  it.each(["3", "5"])("takes %s hashtags", (n) => {
    expect(audit(caption("Una frase.", n === "3" ? "#uno #dos #tres" : "#uno #dos #tres #cuatro #cinco"))).toEqual([]);
  });

  it("refuses a hashtag in the middle of a sentence", () => {
    expect(audit(`Una frase con #hashtag adentro.\n\n#uno #dos #tres`).join()).toContain("hashtags");
    expect(audit(`Una frase.\n\nOtra con #uno #dos y #tres en el medio.`).join()).toContain("hashtags");
  });

  it("refuses a text of nothing but hashtags", () => {
    expect(audit(TAGS).join()).toContain("hook");
  });

  it("does not take a link's fragment for a hashtag", () => {
    expect(audit(caption("Mirá https://zerointheloop.com/#precios acá.", "#uno #dos #tres"))).toEqual([]);
  });

  it("refuses what does not fit with the signature, instead of cutting the hashtags", () => {
    const fits = caption(`Una frase. ${"a".repeat(MAX_TEXT - signature.length - 2 - TAGS.length - 13)}`);
    expect(fits.length + 2 + signature.length).toBe(MAX_TEXT);
    expect(audit(fits)).toEqual([]);
    expect(audit(fits.replace("Una frase.", "Una frase!!")).join()).toContain("length");
  });
});

describe("the tone", () => {
  it.each([
    ["hollow opening", "En el mundo actual todo cambia."],
    ["hollow opening", "In today's fast-paced world we ship."],
    ["reveal bridge", "Hablemos de la fábrica."],
    ["reveal bridge", "Let's talk about the factory."],
    ["reveal bridge", "Todo salió bien. ¿El resultado? Menos trabajo."],
    ["reveal bridge", "The result? Less work."],
    ["sincerity announcement", "Seamos honestos: nadie lee esto."],
    ["sincerity announcement", "Real talk, this hurt."],
    ["engagement bait", "Comentá SÍ si te gustó."],
    ["engagement bait", "Tag 3 friends who need this."],
    ["dead closing", "Publicamos algo nuevo. ¿Qué opinás?"],
    ["dead closing", "We shipped it. What do you think?"],
    ["negative parallelism", "No es una herramienta, es una fábrica."],
    ["negative parallelism", "No hace falta saber, sino mirar."],
    ["negative parallelism", "It's not a tool, it's a factory."],
  ])("reports a %s in: %s", (problem, text) => {
    expect(auditImageText(text)).toContain(problem);
    expect(audit(caption(text))).toContain(problem);
  });

  it("does not mind ordinary sentences", () => {
    for (const text of ["No hace falta saber programar.", "Hoy salió una función nueva.", "Guardá esto para cuando lo necesites.", "¿Te pasó alguna vez?", "It is not hard to use."]) expect(auditImageText(text), text).toEqual([]);
  });

  it("counts vocabulary markers per paragraph: 3 fail, 1 and 2 pass, split across paragraphs too", () => {
    expect(auditImageText("Un sistema robusto.")).toEqual([]);
    expect(auditImageText("Un sistema robusto y crucial.")).toEqual([]);
    expect(auditImageText("Un sistema robusto, crucial y con ecosistema.").join()).toContain("vocabulary");
    expect(auditImageText("A robust, seamless ecosystem.").join()).toContain("vocabulary");
    expect(auditImageText("Un sistema robusto y crucial.\n\nCon su ecosistema.")).toEqual([]);
  });

  it("allows long dashes up to the minimum of 2, or one per 100 words", () => {
    expect(auditImageText("Una — sola raya.")).toEqual([]);
    expect(auditImageText("Dos — rayas — pasan.")).toEqual([]);
    expect(auditImageText("Tres — rayas — no — pasan.").join()).toContain("dashes");
    const long = `${"palabra ".repeat(300)}— a — b — c`;
    expect(auditImageText(long)).toEqual([]);
    expect(auditImageText(`${long} — d`).join()).toContain("dashes");
  });

  it("never quotes the draft in its problems", () => {
    const secret = "ESTE-TEXTO-NO-VA";
    const problems = audit(`${secret} no es esto, es aquello ${"x".repeat(200)} #a`);
    expect(problems.length).toBeGreaterThan(1);
    expect(problems.join()).not.toContain(secret);
  });
});

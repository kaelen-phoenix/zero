import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { DEFAULT_SOCIAL_SIGNATURE } from "../src/config.js";
import { cardSvg, renderCard, SLIDE_TYPES, wrap, type Card, type SlideType } from "../src/social/render.js";

const signature = DEFAULT_SOCIAL_SIGNATURE;
const decode = (data: Uint8Array) => jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
type Image = ReturnType<typeof decode>;
const pixel = (img: Image, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)] as [number, number, number];
const near = (a: readonly number[], b: readonly number[], tolerance: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

const ORANGE = [0xff, 0x8a, 0x5c];
const card = (type: SlideType, over: Partial<Card> = {}): Card => ({ kind: "post", type, title: "Algo nuevo", body: "Otra parte del texto", signature, ...over });

/** Every `text` element: where it is and what it says. */
const texts = (svg: string) => [...svg.matchAll(/<text x="(\d+)" y="(\d+)"[^>]*font-size="(\d+)"[^>]*fill="([^"]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]), fill: m[4]!, text: m[5]! }));
const images = (svg: string) => [...svg.matchAll(/<image x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"[^>]*href="data:image\/png;base64,[^"]+"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) }));

describe("sizes", { timeout: 60_000 }, () => {
  it("renders a post and a carousel slide at 1080x1350 and a story at 1080x1920", () => {
    for (const [kind, type, height] of [["post", undefined, 1350], ["carousel", "step", 1350], ["story", "cover", 1920]] as const) {
      const img = decode(renderCard({ kind, type, title: "Algo", signature }));
      expect([img.width, img.height]).toEqual([1080, height]);
    }
  });
});

describe("the symbol", { timeout: 60_000 }, () => {
  it.each(SLIDE_TYPES)("is embedded in a %s", (type) => {
    expect(images(cardSvg(card(type)))).toHaveLength(1);
  });

  it("shows its orange and its warm white over black in the pixels of a step", () => {
    const svg = cardSvg(card("step"));
    const box = images(svg)[0]!;
    const img = decode(renderCard(card("step")));
    const found = { orange: 0, white: 0, black: 0 };
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) {
        const p = pixel(img, x, y);
        if (near(p, ORANGE, 30)) found.orange++;
        if (p.every((v) => v > 200)) found.white++;
        if (p.every((v) => v < 30)) found.black++;
      }
    }
    expect(found.orange).toBeGreaterThan(300);
    expect(found.white).toBeGreaterThan(300);
    expect(found.black).toBeGreaterThan(1000);
  });

  it("sits on its own black tile over the orange", () => {
    const box = images(cardSvg(card("stat")))[0]!;
    const inTile = pixel(decode(renderCard(card("stat"))), box.x + 10, box.y + Math.round(box.height / 2));
    expect(inTile.every((v) => v < 30)).toBe(true);
  });

  it("is larger on a cover", () => {
    expect(images(cardSvg(card("cover")))[0]!.width).toBeGreaterThan(images(cardSvg(card("step")))[0]!.width);
  });
});

describe("the signature", { timeout: 60_000 }, () => {
  const long = "palabra ".repeat(400);

  it.each(SLIDE_TYPES)("stays in the footer of a %s, with nothing reaching it however long the text", (type) => {
    for (const kind of ["post", "story"] as const) {
      const svg = cardSvg(card(type, { kind, title: long, body: long }));
      expect(svg).toContain(signature);
      const all = texts(svg);
      const sign = all.find((t) => t.text === signature)!;
      expect(sign.y).toBe(Math.max(...all.map((t) => t.y)));
      for (const t of all.filter((a) => a !== sign)) expect(t.y, t.text.slice(0, 20)).toBeLessThan(sign.y - sign.size);
      expect(svg).toContain("…");
    }
    expect(() => decode(renderCard(card(type, { title: long, body: long })))).not.toThrow();
  });

  it("wraps a signature too long for one line without losing it", () => {
    const words = "Una firma bastante larga ".repeat(5).trim();
    const lines = texts(cardSvg(card("step", { signature: words }))).slice(-3).map((t) => t.text).join(" ");
    expect(lines).toContain("Una firma bastante larga");
  });
});

describe("visual direction", { timeout: 60_000 }, () => {
  it.each(["cover", "stat", "cta"] as const)("draws a %s on full orange with near black text", (type) => {
    const img = decode(renderCard(card(type)));
    for (const [x, y] of [[5, 5], [1074, 5], [5, 1344], [1074, 1344]] as const) expect(near(pixel(img, x, y), ORANGE, 4), `${x},${y}`).toBe(true);
    const title = texts(cardSvg(card(type)))[0]!;
    expect(title.fill).toBe("#141210");
  });

  it.each(["myth", "before-after"] as const)("splits a %s in two contrasted blocks, with both texts", (type) => {
    const img = decode(renderCard(card(type)));
    const [upper, lower] = [pixel(img, 20, 337), pixel(img, 20, 1012)];
    expect(upper.map((v, i) => Math.abs(v - lower[i]!)).reduce((a, b) => a + b)).toBeGreaterThan(150);
    const said = texts(cardSvg(card(type))).map((t) => t.text).join(" ");
    expect(said).toContain("Algo nuevo");
    expect(said).toContain("Otra parte del texto");
    expect(near(lower, ORANGE, 4)).toBe(true);
  });

  it("draws a quote as a light card over the orange", () => {
    const img = decode(renderCard(card("quote")));
    expect(near(pixel(img, 5, 5), ORANGE, 4)).toBe(true);
    expect(near(pixel(img, 70, 900), [0xff, 0xf4, 0xea], 4)).toBe(true);
  });

  it("draws a step on near black, with its number", () => {
    const img = decode(renderCard(card("step")));
    expect(pixel(img, 5, 5).every((v) => v < 30)).toBe(true);
    expect(texts(cardSvg(card("step", { number: 3 })))[0]!.text).toBe("3");
  });

  it("never has the first stage's light background", () => {
    for (const type of SLIDE_TYPES) expect(cardSvg(card(type))).not.toContain("#fbfbf9");
  });

  it("draws a post with no type as a cover", () => {
    const bare = cardSvg({ kind: "post", title: "Algo nuevo", body: "Otra parte del texto", signature });
    expect(bare).toBe(cardSvg(card("cover")));
  });
});

describe("robustness", { timeout: 60_000 }, () => {
  it.each(SLIDE_TYPES)("escapes markup and survives odd characters in a %s", (type) => {
    const title = `<script>alert("x")</script> & a\u0001b \uD83D c \u{1F680} d`;
    const svg = cardSvg(card(type, { title, body: "<b>&" }));
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("\u0001");
    expect(svg).not.toContain("\u{1F680}");
    expect(() => decode(renderCard(card(type, { title, body: "<b>&" })))).not.toThrow();
  });

  it.each(["Cuarenta y dos mil novecientos", "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", "MMMMMMMMMMMMMMM%%%%%%%%%%%%%%%"])("keeps the margins clear for the stat %s, shrinking before cutting", (title) => {
    const img = decode(renderCard(card("stat", { title })));
    for (let y = 300; y < 1200; y += 2) {
      for (const x of [20, 60, 1020, 1060]) expect(near(pixel(img, x, y), ORANGE, 12), `${x},${y}`).toBe(true);
    }
    expect(texts(cardSvg(card("stat", { title }))).filter((t) => t.text.includes("…"))).toHaveLength(0);
  });

  it("shrinks a title before cutting it", () => {
    const short = texts(cardSvg(card("stat", { title: "9", body: "" })))[0]!;
    const long = texts(cardSvg(card("stat", { title: "Cuarenta y dos mil novecientos", body: "" })))[0]!;
    expect(long.size).toBeLessThan(short.size);
  });

  it.each(SLIDE_TYPES)("keeps text and symbol of a %s story between 250 and 1670", (type) => {
    const long = "palabra ".repeat(400);
    for (const over of [{}, { title: long, body: long }]) {
      const svg = cardSvg(card(type, { kind: "story", ...over }));
      for (const t of texts(svg)) {
        expect(t.y - t.size).toBeGreaterThanOrEqual(250 - t.size * 0.2);
        expect(t.y).toBeLessThanOrEqual(1670);
      }
      const box = images(svg)[0]!;
      expect(box.y).toBeGreaterThanOrEqual(250);
      expect(box.y + box.height).toBeLessThanOrEqual(1670);
    }
  });

  it("uses only the bundled fonts", () => {
    for (const type of SLIDE_TYPES) {
      const families = new Set([...cardSvg(card(type)).matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]));
      for (const family of families) expect(["Anton", "DejaVu Sans"]).toContain(family);
    }
  });
});

describe("wrap", () => {
  it("breaks at spaces, cuts words longer than a line and marks what it leaves out", () => {
    expect(wrap("uno dos tres", 7, 5)).toEqual(["uno dos", "tres"]);
    expect(wrap("abcdefghij", 4, 5)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("uno dos tres cuatro", 3, 2)).toEqual(["uno", "do…"]);
    expect(wrap("", 3, 2)).toEqual([]);
  });

  it("measures with what it is given", () => {
    const wide = (s: string) => s.length * 2;
    expect(wrap("uno dos", 6, 5, wide)).toEqual(["uno", "dos"]);
  });
});

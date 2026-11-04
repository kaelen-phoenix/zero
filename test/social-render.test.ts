import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { DEFAULT_SOCIAL_SIGNATURE } from "../src/config.js";
import { cardSvg, renderCard, wrap } from "../src/social/render.js";

const signature = DEFAULT_SOCIAL_SIGNATURE;
const decode = (data: Uint8Array) => jpeg.decode(data, { useTArray: true, formatAsRGBA: true });
const pixel = (img: ReturnType<typeof decode>, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];

/** Pixels clearly darker than the background in a box. */
function darkIn(img: ReturnType<typeof decode>, box: { x: number; y: number; w: number; h: number }) {
  let dark = 0;
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) if (pixel(img, x, y)[0]! < 80) dark++;
  return dark;
}

const TITLE_BOX = { x: 80, y: 190, w: 920, h: 150 };

describe("social cards", { timeout: 60_000 }, () => {
  it("renders a JPEG of 1080x1080 for a post and 1080x1920 for a story", () => {
    const post = decode(renderCard({ kind: "post", title: "Algo nuevo", signature }));
    const story = decode(renderCard({ kind: "story", title: "Algo nuevo", signature }));
    expect([post.width, post.height]).toEqual([1080, 1080]);
    expect([story.width, story.height]).toEqual([1080, 1920]);
  });

  it("has the site's background in its corners", () => {
    const img = decode(renderCard({ kind: "post", title: "Colores", signature }));
    for (const [x, y] of [[0, 0], [1079, 0], [0, 1079], [1079, 1079]] as const) {
      const [r, g, b] = pixel(img, x, y);
      expect(Math.abs(r! - 0xfb), "rojo").toBeLessThanOrEqual(3);
      expect(Math.abs(g! - 0xfb), "verde").toBeLessThanOrEqual(3);
      expect(Math.abs(b! - 0xf9), "azul").toBeLessThanOrEqual(3);
    }
  });

  it("draws the text with the bundled font", () => {
    const a = decode(renderCard({ kind: "post", title: "Primera tarjeta", signature }));
    const b = decode(renderCard({ kind: "post", title: "Otra cosa distinta", signature }));
    expect(darkIn(a, TITLE_BOX)).toBeGreaterThan(500);
    expect(darkIn(b, TITLE_BOX)).toBeGreaterThan(500);
    let different = 0;
    for (let y = TITLE_BOX.y; y < TITLE_BOX.y + TITLE_BOX.h; y++) for (let x = TITLE_BOX.x; x < TITLE_BOX.x + TITLE_BOX.w; x++) if (pixel(a, x, y)[0] !== pixel(b, x, y)[0]) different++;
    expect(different).toBeGreaterThan(500);
  });

  it("keeps a body on the card, and never reaches the signature with text that is too long", () => {
    const long = "palabra ".repeat(400);
    const svg = cardSvg({ kind: "post", title: long, body: long, signature });
    const ys = [...svg.matchAll(/<text x="80" y="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(1080);
    expect(svg).toContain("…");
    const signY = ys.at(-1)!;
    expect(ys.slice(0, -1).every((y) => y < signY - 40)).toBe(true);
    const story = [...cardSvg({ kind: "story", title: long, body: long, signature }).matchAll(/<text x="80" y="(\d+)"/g)].map((m) => Number(m[1]));
    expect(story.slice(0, -1).every((y) => y < story.at(-1)! - 40)).toBe(true);
    renderCard({ kind: "post", title: long, body: long, signature });
  });

  it("keeps the story's title and signature apart from the areas the app covers", () => {
    const svg = cardSvg({ kind: "story", title: "Historia", signature });
    const ys = [...svg.matchAll(/<text x="80" y="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(250);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1920 - 250);
  });

  it("carries the signature in a story's SVG, since stories have no separate text", () => {
    expect(cardSvg({ kind: "story", title: "Historia", signature })).toContain(signature);
  });

  it("escapes markup, so the SVG stays well formed and renders", () => {
    const title = `<script>alert("x")</script> & 'cosas'`;
    const svg = cardSvg({ kind: "post", title, signature });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
    expect(() => decode(renderCard({ kind: "post", title, body: "<b>&", signature }))).not.toThrow();
  });

  it("survives control characters, broken surrogates and emoji", () => {
    expect(() => decode(renderCard({ kind: "post", title: "a\u0001b \uD83D c \u{1F680} d", signature }))).not.toThrow();
    expect(cardSvg({ kind: "post", title: "a\u0001b \uD83D c \u{1F680} d", signature })).not.toContain("\u0001");
  });
});

describe("wrap", () => {
  it("breaks at spaces, cuts words longer than a line and marks what it leaves out", () => {
    expect(wrap("uno dos tres", 7, 5)).toEqual(["uno dos", "tres"]);
    expect(wrap("abcdefghij", 4, 5)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("uno dos tres cuatro", 3, 2)).toEqual(["uno", "do…"]);
    expect(wrap("", 3, 2)).toEqual([]);
  });
});

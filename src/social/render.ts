import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
import type { SocialKind } from "../state/store.js";

/** The brand: the symbol's orange, its warm white, and a near black. */
const COLORS = { orange: "#ff8a5c", ink: "#141210", cream: "#fff4ea" };
const JPEG_QUALITY = 90;
const DISPLAY = "Anton";
const SANS = "DejaVu Sans";

const require = createRequire(import.meta.url);
/** Bundled with zero, so a card looks the same on every machine. DejaVu also draws what the display font has no glyph for. */
const FONTS = [
  join(dirname(require.resolve("@expo-google-fonts/anton/package.json")), "400Regular", "Anton_400Regular.ttf"),
  ...["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((f) => join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf", f)),
];
const fontOptions = { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: SANS };

export const SLIDE_TYPES = ["cover", "step", "myth", "stat", "before-after", "quote", "cta"] as const;
export type SlideType = (typeof SLIDE_TYPES)[number];

export interface Card {
  kind: SocialKind;
  /** Absent: a cover, what a simple post is drawn as. */
  type?: SlideType;
  title: string;
  body?: string;
  signature: string;
  /** The step's position in its carousel. */
  number?: number;
}

const MARGIN = 80;
const MAX_CHARS = 4000;
const POST = { width: 1080, height: 1350, top: 70, bottom: 1280 };
// Stories keep text and symbol out of the areas the app covers with its own controls.
const STORY = { width: 1080, height: 1920, top: 250, bottom: 1670 };

// Measured widths of each font, in em and rounded up: a line must not leave the card, and nothing measures it for us.
const WIDTHS = {
  [DISPLAY]: { narrow: 0.31, regular: 0.5, upper: 0.5, wide: 0.78, huge: 1.06 },
  [SANS]: { narrow: 0.48, regular: 0.72, upper: 0.85, wide: 1.1, huge: 1.1 },
};
type Font = keyof typeof WIDTHS;

function charEm(c: string, font: Font): number {
  const w = WIDTHS[font];
  if (/[ ijltfI.,:;!¡'|]/.test(c)) return w.narrow;
  if (/[%@]/.test(c) || c > "ɏ") return /[…—–]/.test(c) ? w.wide : w.huge;
  if (/[mwMW#]/.test(c)) return w.wide;
  return /\p{Lu}/u.test(c) ? w.upper : w.regular;
}

const textWidth = (text: string, font: Font, size: number) => [...text].reduce((sum, c) => sum + charEm(c, font), 0) * size;

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** One line of plain text the font can draw and XML can hold: no control characters, no broken surrogates, no emoji (the fonts have none). */
const drawable = (text: string) =>
  text
    .replace(/[\p{Cc}\p{Cs}￾￿]/gu, " ")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** Greedy wrap, in characters unless `width` measures otherwise; a word longer than a line is cut, and text past `maxLines` ends in an ellipsis. */
export function wrap(text: string, perLine: number, maxLines: number, width: (s: string) => number = (s) => s.length): string[] {
  const lines: string[] = [];
  let line = "";
  for (let word of text.split(" ").filter(Boolean)) {
    while (width(word) > perLine && word.length > 1) {
      if (line) lines.push(line);
      line = "";
      let cut = 1;
      while (cut < word.length - 1 && width(word.slice(0, cut + 1)) <= perLine) cut++;
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    if (line && width(`${line} ${word}`) > perLine) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  if (maxLines === 0) return [];
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last && width(`${last}…`) > perLine) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

interface Style {
  font: Font;
  weight?: number;
  fill: string;
  max: number;
  min: number;
  lead: number;
}

interface Fit {
  style: Style;
  size: number;
  step: number;
  lines: string[];
}

/** The largest size at which the whole text fits with no word cut; only at the smallest size does it cut. */
function fit(raw: string, style: Style, width: number, height: number): Fit {
  // Far more than any card holds: the rest would only be measured to be cut.
  const text = drawable(raw).slice(0, MAX_CHARS);
  const empty: Fit = { style, size: style.min, step: 0, lines: [] };
  if (!text) return empty;
  for (let size = style.max; size > style.min; size = Math.max(style.min, Math.round(size * 0.92))) {
    const measure = (s: string) => textWidth(s, style.font, size);
    const step = Math.round(size * style.lead);
    const longest = Math.max(...text.split(" ").map(measure));
    if (longest > width) continue;
    const lines = wrap(text, width, Infinity, measure);
    if (lines.length * step <= height) return { style, size, step, lines };
  }
  const step = Math.round(style.min * style.lead);
  return { style, size: style.min, step, lines: wrap(text, width, Math.floor(height / step), (s) => textWidth(s, style.font, style.min)) };
}

const fitHeight = (f: Fit) => f.lines.length * f.step;

/** Each line as its own `text`, the first one's top at `top`. */
function draw(f: Fit, x: number, top: number): string {
  const { font, weight, fill } = f.style;
  return f.lines.map((l, i) => `<text x="${x}" y="${Math.round(top + f.size + i * f.step)}" font-family="${font}"${weight ? ` font-weight="${weight}"` : ""} font-size="${f.size}" fill="${fill}">${xml(l)}</text>`).join("");
}

/** Title then body inside a box, the title first served; `end` pushes them to the bottom of the box. */
function stack(card: Card, title: Style, body: Style, box: { x: number; width: number; top: number; bottom: number }, end = false): string {
  const room = box.bottom - box.top;
  const gap = 28;
  const hasBody = Boolean(drawable(card.body ?? ""));
  const heading = fit(card.title, title, box.width, hasBody ? Math.round(room * 0.65) : room);
  const rest = fit(card.body ?? "", body, box.width, room - fitHeight(heading) - gap);
  const total = fitHeight(heading) + (rest.lines.length ? gap + fitHeight(rest) : 0);
  const top = end ? box.bottom - total : box.top;
  return draw(heading, box.x, top) + draw(rest, box.x, top + fitHeight(heading) + gap);
}

const display = (fill: string, max: number, min = 44): Style => ({ font: DISPLAY, fill, max, min, lead: 1.2 });
const prose = (fill: string, max = 44, min = 22): Style => ({ font: SANS, weight: 700, fill, max, min, lead: 1.3 });

const SYMBOL_PIXELS = 420;
let symbolData: string | undefined;

/** The brand's symbol as a data URL, read and scaled once: the original is far larger than any card needs. */
function symbolUrl(): string {
  if (symbolData) return symbolData;
  const original = readFileSync(fileURLToPath(new URL("../../site/brand/zero-symbol.png", import.meta.url))).toString("base64");
  const scaled = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SYMBOL_PIXELS}" height="${SYMBOL_PIXELS}"><image width="${SYMBOL_PIXELS}" height="${SYMBOL_PIXELS}" href="data:image/png;base64,${original}"/></svg>`,
    { font: fontOptions },
  ).render();
  symbolData = `data:image/png;base64,${scaled.asPng().toString("base64")}`;
  return symbolData;
}

/** The symbol on its own black tile, so it reads the same over any color. */
function symbol(x: number, y: number, size: number): string {
  const id = `tile${x}${y}`;
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.round(size * 0.14)}"/></clipPath><image x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#${id})" href="${symbolUrl()}"/>`;
}

const rect = (x: number, y: number, width: number, height: number, fill: string, rx = 0) => `<rect x="${x}" y="${y}" width="${width}" height="${height}"${rx ? ` rx="${rx}"` : ""} fill="${fill}"/>`;

/** The card as SVG; every text is escaped, stays inside the margins and above the signature, which is always in the footer. */
export function cardSvg(card: Card): string {
  const frame = card.kind === "story" ? STORY : POST;
  const { width, height, top, bottom } = frame;
  const inner = width - 2 * MARGIN;
  const { orange, ink, cream } = COLORS;
  const type = card.type ?? "cover";
  const small = 130;
  const corner = symbol(width - MARGIN - small, top, small);
  const twoBlocks = type === "myth" || type === "before-after";

  // The footer first: what is left above it is what the text gets, so nothing ever covers the signature.
  const signFill = type === "step" ? cream : ink;
  const signStyle: Style = { font: SANS, fill: signFill, max: 26, min: 18, lead: 1.3 };
  // On one line whenever it fits, however small; only a very long signature takes more.
  const oneLine = fit(card.signature, signStyle, inner, 34);
  const sign = oneLine.lines.join(" ") === drawable(card.signature) ? oneLine : fit(card.signature, signStyle, inner, 34 * 3);
  const signTop = bottom - fitHeight(sign) + Math.round(sign.step - sign.size);
  const limit = signTop - 30;

  const box = (from: number, to: number, x = MARGIN, w = inner) => ({ x, width: w, top: from, bottom: to });
  const label = (text: string, y: number, fill: string) => `<text x="${MARGIN}" y="${y}" font-family="${DISPLAY}" font-size="64" fill="${fill}">${text}</text>`;
  const parts: string[] = [];

  if (type === "cover") {
    const big = card.kind === "story" ? 300 : 260;
    parts.push(rect(0, 0, width, height, orange), symbol(MARGIN, top, big), stack(card, display(ink, 190), prose(ink), box(top + big + 40, limit), true));
  } else if (type === "stat") {
    parts.push(rect(0, 0, width, height, orange), corner, stack(card, display(ink, 320), prose(ink, 48), box(top + small + 40, limit), true));
  } else if (type === "cta") {
    parts.push(rect(0, 0, width, height, orange), corner, rect(MARGIN, limit - 12, inner, 12, ink), stack(card, display(ink, 170), prose(ink), box(top + small + 40, limit - 44), true));
  } else if (type === "step") {
    const head = card.number === undefined ? rect(MARGIN, top + 40, 200, 28, orange) : `<text x="${MARGIN}" y="${top + 190}" font-family="${DISPLAY}" font-size="200" fill="${orange}">${card.number}</text>`;
    parts.push(rect(0, 0, width, height, ink), corner, head, stack(card, display(cream, 130), prose(cream), box(top + 250, limit)));
  } else if (twoBlocks) {
    const mid = Math.round(height / 2);
    const [upper, upperText, accent, topLabel, bottomLabel] = type === "myth" ? [ink, cream, orange, "MITO", "VERDAD"] : [cream, ink, ink, "ANTES", "DESPUÉS"];
    const titleBox = box(top + small + 16, mid - 36);
    const bodyBox = box(mid + 116, limit);
    parts.push(
      rect(0, 0, width, mid, upper),
      rect(0, mid, width, height - mid, orange),
      corner,
      label(topLabel!, top + 90, accent!),
      draw(fit(card.title, display(upperText!, 110, 30), titleBox.width, titleBox.bottom - titleBox.top), MARGIN, titleBox.top),
      label(bottomLabel!, mid + 90, ink),
      draw(fit(card.body ?? "", display(ink, 110, 30), bodyBox.width, bodyBox.bottom - bodyBox.top), MARGIN, bodyBox.top),
    );
  } else {
    // A tweet card: who says it, then the words, on a light card over the orange.
    const avatar = 110;
    const x = MARGIN + 10;
    parts.push(
      rect(0, 0, width, height, orange),
      rect(40, top, width - 80, limit - top, cream, 48),
      symbol(x, top + 40, avatar),
      `<text x="${x + avatar + 28}" y="${top + 88}" font-family="${SANS}" font-weight="700" font-size="38" fill="${ink}">La fábrica zero</text>`,
      `<text x="${x + avatar + 28}" y="${top + 132}" font-family="${SANS}" font-size="30" fill="${ink}">Una IA que cuenta lo que hace</text>`,
      stack(card, prose(ink, 96, 26), { ...prose(ink, 40, 20), weight: undefined }, box(top + 190, limit - 40, x, width - 2 * x)),
    );
  }
  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`, ...parts, draw(sign, MARGIN, signTop), `</svg>`].join("");
}

/** The card as a JPEG, the only image format the channel takes: no model and no system font involved. */
export function renderCard(card: Card): Uint8Array {
  const rendered = new Resvg(cardSvg(card), { fitTo: { mode: "original" }, font: fontOptions }).render();
  return jpeg.encode({ data: rendered.pixels, width: rendered.width, height: rendered.height }, JPEG_QUALITY).data;
}

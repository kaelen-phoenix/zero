import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
import type { SocialKind } from "../state/store.js";

/** The site's colors (site/styles.css). */
const COLORS = { bg: "#fbfbf9", fg: "#111111", muted: "#5c5c58", accent: "#a8360b", rule: "#dcdcd6" };
const JPEG_QUALITY = 90;
const SANS = "DejaVu Sans";
const MONO = "DejaVu Sans Mono";

/** Bundled with zero, so a card looks the same on every machine. */
const FONTS = (() => {
  const dir = join(dirname(createRequire(import.meta.url).resolve("dejavu-fonts-ttf/package.json")), "ttf");
  return ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf"].map((f) => join(dir, f));
})();

// Stories keep their text out of the areas the app covers with its own controls.
const LAYOUT: Record<SocialKind, { width: number; height: number; brandY: number; titleY: number; titleSize: number; titleLines: number; bodySize: number; bodyLines: number }> = {
  post: { width: 1080, height: 1080, brandY: 120, titleY: 250, titleSize: 72, titleLines: 6, bodySize: 36, bodyLines: 5 },
  story: { width: 1080, height: 1920, brandY: 300, titleY: 480, titleSize: 84, titleLines: 8, bodySize: 42, bodyLines: 8 },
};
const MARGIN = 80;
// Wide estimates of each font's average width, in em: a line must not leave the card, and nothing measures it for us.
const SANS_WIDTH = 0.62;
const BOLD_WIDTH = 0.72;
const MONO_WIDTH = 0.61;

export interface Card {
  kind: SocialKind;
  title: string;
  body?: string;
  signature: string;
}

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** One line of plain text the font can draw and XML can hold: no control characters, no broken surrogates, no emoji (the font has none). */
const drawable = (text: string) =>
  text
    .replace(/[\p{Cc}\p{Cs}￾￿]/gu, " ")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** Greedy wrap by characters; a word longer than a line is cut, and text past `maxLines` ends in an ellipsis. */
export function wrap(text: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (let word of text.split(" ").filter(Boolean)) {
    while (word.length > perLine) {
      if (line) lines.push(line);
      line = "";
      lines.push(word.slice(0, perLine));
      word = word.slice(perLine);
    }
    if (line && line.length + 1 + word.length > perLine) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  if (maxLines === 0) return [];
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!.slice(0, perLine - 1).trimEnd()}…`;
  return kept;
}

const textLines = (lines: string[], attrs: string, x: number, y: number, step: number) => lines.map((l, i) => `<text x="${x}" y="${y + i * step}" ${attrs}>${xml(l)}</text>`).join("");

/** The card as SVG; every text is escaped, and the signature is always in the footer. */
export function cardSvg(card: Card): string {
  const l = LAYOUT[card.kind];
  const inner = l.width - 2 * MARGIN;
  const fits = (size: number, em: number) => Math.floor(inner / (size * em));
  const title = wrap(drawable(card.title), fits(l.titleSize, BOLD_WIDTH), l.titleLines);
  const titleStep = Math.round(l.titleSize * 1.2);
  const bodyY = l.titleY + title.length * titleStep + l.bodySize;
  const bodyStep = Math.round(l.bodySize * 1.4);
  const signSize = 26;
  const signature = wrap(drawable(card.signature), fits(signSize, MONO_WIDTH), 3);
  const signStep = Math.round(signSize * 1.4);
  // In a story the footer also stays above the bottom controls.
  const bottom = card.kind === "story" ? l.height - 280 : l.height - MARGIN;
  const signY = bottom - (signature.length - 1) * signStep;
  const ruleY = signY - signSize - 24;
  // The body gets what the title leaves above the footer, so the signature is never covered.
  const roomForBody = Math.max(0, Math.floor((ruleY - bodyY - 16) / bodyStep) + 1);
  const body = wrap(drawable(card.body ?? ""), fits(l.bodySize, SANS_WIDTH), Math.min(l.bodyLines, roomForBody));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}">`,
    `<rect width="${l.width}" height="${l.height}" fill="${COLORS.bg}"/>`,
    `<text x="${MARGIN}" y="${l.brandY}" font-family="${MONO}" font-weight="700" font-size="34" fill="${COLORS.fg}">zero <tspan fill="${COLORS.accent}">in the loop</tspan></text>`,
    textLines(title, `font-family="${SANS}" font-weight="700" font-size="${l.titleSize}" fill="${COLORS.fg}"`, MARGIN, l.titleY, titleStep),
    textLines(body, `font-family="${SANS}" font-size="${l.bodySize}" fill="${COLORS.muted}"`, MARGIN, bodyY, bodyStep),
    `<rect x="${MARGIN}" y="${ruleY}" width="${inner}" height="2" fill="${COLORS.rule}"/>`,
    textLines(signature, `font-family="${MONO}" font-size="${signSize}" fill="${COLORS.muted}"`, MARGIN, signY, signStep),
    `</svg>`,
  ].join("");
}

/** The card as a JPEG, the only image format the channel takes: no model and no system font involved. */
export function renderCard(card: Card): Uint8Array {
  const rendered = new Resvg(cardSvg(card), {
    background: COLORS.bg,
    fitTo: { mode: "original" },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: SANS },
  }).render();
  return jpeg.encode({ data: rendered.pixels, width: rendered.width, height: rendered.height }, JPEG_QUALITY).data;
}

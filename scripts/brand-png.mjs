// Renders the brand symbol SVGs (site/brand/zero-logo*.svg) into 512×512 RGBA PNGs with a transparent background.
// Node built-ins only: run `node scripts/brand-png.mjs` after changing a symbol SVG.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 512;
const SCALE = SIZE / 32;
const SAMPLES = 4;

const OUTPUTS = [
  { svg: "site/brand/zero-logo.svg", png: "site/brand/zero-logo-transparent.png" },
  { svg: "site/brand/zero-logo-light.svg", png: "site/brand/zero-logo-transparent-light.png" },
];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];

/** The ring and the dot of a symbol SVG, in SVG units. */
function shapes(svg) {
  const circles = [...svg.matchAll(/<circle\b[^>]*>/g)].map((m) => m[0]);
  const ring = circles.find((c) => attr(c, "fill") === "none");
  const dot = circles.find((c) => attr(c, "fill") !== "none");
  if (!ring || !dot) throw new Error("the SVG needs a ring and a dot");
  const num = (tag, name) => Number(attr(tag, name));
  return [
    { kind: "ring", cx: num(ring, "cx"), cy: num(ring, "cy"), r: num(ring, "r"), w: num(ring, "stroke-width"), color: hex(attr(ring, "stroke")) },
    { kind: "dot", cx: num(dot, "cx"), cy: num(dot, "cy"), r: num(dot, "r"), color: hex(attr(dot, "fill")) },
  ];
}

/** The color of the topmost shape at a point, or undefined. */
function colorAt(list, x, y) {
  let found;
  for (const s of list) {
    const d = Math.hypot(x - s.cx, y - s.cy);
    const inside = s.kind === "ring" ? Math.abs(d - s.r) <= s.w / 2 : d <= s.r;
    if (inside) found = s.color;
  }
  return found;
}

function render(list) {
  const rows = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let py = 0; py < SIZE; py++) {
    const row = py * (SIZE * 4 + 1);
    rows[row] = 0;
    for (let px = 0; px < SIZE; px++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = colorAt(list, (px + (sx + 0.5) / SAMPLES) / SCALE, (py + (sy + 0.5) / SAMPLES) / SCALE);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; n++;
        }
      }
      const at = row + 1 + px * 4;
      if (n === 0) continue;
      rows[at] = Math.round(r / n);
      rows[at + 1] = Math.round(g / n);
      rows[at + 2] = Math.round(b / n);
      rows[at + 3] = Math.round((255 * n) / (SAMPLES * SAMPLES));
    }
  }
  return rows;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const { svg, png: out } of OUTPUTS) {
  writeFileSync(out, png(render(shapes(readFileSync(svg, "utf8")))));
  console.log(out);
}

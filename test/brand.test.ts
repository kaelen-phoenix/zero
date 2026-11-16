import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const bytes = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const read = (path: string) => bytes(path).toString("utf8");

/** SHA-256 of the brand PNGs at the base commit; they must never change. */
const KEPT = {
  "site/brand/zero-logo.png": "ff99108a2ffcca728b02fd3aac2e6e4ba77476da9cc659411716e355aab3fbb6",
  "site/brand/zero-symbol.png": "ff99108a2ffcca728b02fd3aac2e6e4ba77476da9cc659411716e355aab3fbb6",
};

const FORBIDDEN = ["<rect", "<text", "<image", "href=", "url("];

interface Png {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  pixel(x: number, y: number): [number, number, number, number];
}

/** A minimal decoder for 8-bit RGBA PNGs: chunks, inflated IDAT and filters 0–4. */
function decodePng(buf: Buffer): Png {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  let offset = 8;
  let ihdr: Buffer | undefined;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  if (!ihdr) throw new Error("no IHDR");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8]!;
  const colorType = ihdr[9]!;
  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`filter ${filter}`);
      out[y * stride + i] = (line[i]! + predicted) & 0xff;
    }
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    pixel: (x, y) => {
      const at = y * stride + x * bpp;
      return [out[at]!, out[at + 1]!, out[at + 2]!, out[at + 3]!];
    },
  };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe("transparent symbol SVGs", () => {
  const dark = read("site/brand/zero-logo.svg");
  const light = read("site/brand/zero-logo-light.svg");

  it("draws the dark ring and the dot without background", () => {
    expect(dark).toMatch(/^<svg\b[^>]*viewBox="0 0 32 32"/);
    const ring = dark.match(/<circle\b[^>]*\br="8"[^>]*>/)?.[0];
    expect(ring).toBeDefined();
    expect(ring).toContain('stroke="#111111"');
    expect(ring).toContain('stroke-width="3"');
    expect(ring).toContain('fill="none"');
    expect(dark).toMatch(/<circle cx="25" cy="7" r="3.5" fill="#ff8a5c"\/>/);
    for (const word of FORBIDDEN) expect(dark).not.toContain(word);
  });

  it("the light one differs only in the ring's color", () => {
    expect(light).toContain('stroke="#fbfbf9"');
    expect(light.replaceAll("#fbfbf9", "#111111")).toBe(dark);
    for (const word of FORBIDDEN) expect(light).not.toContain(word);
  });
});

describe("transparent symbol PNGs", () => {
  const variants = [
    { file: "site/brand/zero-logo-transparent.png", ring: "#111111" },
    { file: "site/brand/zero-logo-transparent-light.png", ring: "#fbfbf9" },
  ];

  for (const { file, ring } of variants) {
    const png = decodePng(bytes(file));

    it(`${file} is 512×512 RGBA at 8 bits`, () => {
      expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([512, 512, 8, 6]);
    });

    it(`${file} is transparent outside the drawing and inside the ring`, () => {
      for (const [x, y] of [[0, 0], [511, 511], [0, 511], [256, 256]] as const) {
        expect(png.pixel(x, y)[3], `${x},${y}`).toBe(0);
      }
    });

    it(`${file} has an opaque ring and dot of their colors`, () => {
      expect(png.pixel(256, 128)).toEqual([...rgb(ring), 255]);
      expect(png.pixel(400, 112)).toEqual([...rgb("#ff8a5c"), 255]);
    });
  }
});

describe("horizontal logo with the word", () => {
  const dark = read("site/brand/zero-logo-horizontal.svg");
  const light = read("site/brand/zero-logo-horizontal-light.svg");

  for (const [svg, color] of [[dark, "#111111"], [light, "#fbfbf9"]] as const) {
    it(`is wide, draws the word and has no background (${color})`, () => {
      const box = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(/\s+/).map(Number);
      expect(box).toHaveLength(4);
      expect(box![2]!).toBeGreaterThan(box![3]!);
      expect(svg).toContain('fill="#ff8a5c"');
      expect(svg).toContain("<path");
      expect(svg).toContain(color);
      for (const word of [...FORBIDDEN, "font-family", "@font-face"]) expect(svg).not.toContain(word);
    });
  }

  it("the light one differs only in color", () => {
    expect(light.replaceAll("#fbfbf9", "#111111")).toBe(dark);
  });
});

describe("the visible site is unchanged", () => {
  it("keeps the existing brand PNGs", () => {
    for (const [file, hash] of Object.entries(KEPT)) {
      expect(createHash("sha256").update(bytes(file)).digest("hex"), file).toBe(hash);
    }
  });

  it("keeps the favicon's background", () => {
    expect(read("site/favicon.svg")).toMatch(/<rect\b[^>]*fill="#111111"/);
  });

  it("no page references the brand files", () => {
    for (const file of ["site/index.html", "site/styles.css", "site/main.js"]) {
      expect(read(file), file).not.toContain("brand/");
    }
  });
});

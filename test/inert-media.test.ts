import { describe, expect, it } from "vitest";
import { inertMedia } from "../src/intake/inert-media.js";

describe("inertMedia", () => {
  it("escapes a direct image", () => {
    expect(inertMedia("![x](https://sitio.example/?d=1)")).toBe("!\\[x](https://sitio.example/?d=1)");
  });

  it("escapes reference images in their three forms", () => {
    const full = inertMedia("![x][ref]\n\n[ref]: https://sitio.example/?d=1");
    expect(full).toContain("https://sitio.example/?d=1");
    for (const out of [full, inertMedia("![x][]"), inertMedia("![x]")]) {
      expect(out).not.toContain("![");
      expect(out).toContain("!\\[x]");
    }
  });

  it("escapes images across lines and nested in links", () => {
    const cases = { "![a\nb](https://sitio.example/x)": ["https://sitio.example/x"], "[![a](https://sitio.example/i)](https://sitio.example/l)": ["https://sitio.example/i", "https://sitio.example/l"] };
    for (const [text, urls] of Object.entries(cases)) {
      const out = inertMedia(text);
      expect(out).not.toContain("![");
      for (const url of urls) expect(out).toContain(url);
    }
  });

  it.each(["img", "picture", "source", "video", "audio", "iframe"])("turns the opening of <%s> into an entity", (tag) => {
    const out = inertMedia(`<${tag} src="https://sitio.example/?d=1">`);
    expect(out).toBe(`&lt;${tag} src="https://sitio.example/?d=1">`);
    expect(out).not.toContain(`<${tag}`);
    expect(inertMedia(`</${tag}>`)).toBe(`&lt;/${tag}>`);
    expect(inertMedia(`<${tag}>`)).toBe(`&lt;${tag}>`);
  });

  it("catches capitals, several lines and tags without an end", () => {
    expect(inertMedia('<IMG\nSRC="https://sitio.example/a">')).toBe('&lt;IMG\nSRC="https://sitio.example/a">');
    expect(inertMedia("<iMg/src=x>")).toBe("&lt;iMg/src=x>");
    expect(inertMedia("<video")).toBe("&lt;video");
    expect(inertMedia("</VIDEO>")).toBe("&lt;/VIDEO>");
    expect(inertMedia("<img\tsrc=x>")).toBe("&lt;img\tsrc=x>");
  });

  it("works inside an HTML block", () => {
    expect(inertMedia('<div>\n<img src="https://sitio.example/a">\n</div>')).toBe('<div>\n&lt;img src="https://sitio.example/a">\n</div>');
  });

  it("catches every occurrence, not only the first", () => {
    const out = inertMedia("![a](u) ![b](v) <img src=a> <IMG src=b>");
    expect(out).toBe("!\\[a](u) !\\[b](v) &lt;img src=a> &lt;IMG src=b>");
  });

  it("leaves everything else as it is", () => {
    const text = "Ver [doc](https://a.example/?x=1) y https://b.example/?y=2, 1 < 2, <imgx> y <div>. ¡Bien!";
    expect(inertMedia(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = inertMedia("![x](https://a.example) <img src=y>");
    expect(inertMedia(once)).toBe(once);
  });
});

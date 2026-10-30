import { existsSync, readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("site/index.html");
const css = read("site/styles.css");
const js = read("site/main.js");
const siteFiles = readdirSync(new URL("../site/", import.meta.url));
const textFiles = siteFiles.filter((f) => /\.(html|css|js|svg|txt|xml)$/.test(f)).map((f) => ({ file: f, text: read(`site/${f}`) }));

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The HTML of one section, from its opening tag to the next section or the end of main. */
function section(id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const end = rest.search(/<section |<\/main>/);
  return rest.slice(0, end);
}

/** Every element carrying data-i18n, with its markup content. Translatable elements never nest the same tag. */
function translatable(source: string): { key: string; inner: string }[] {
  const re = /<([a-z][a-z0-9]*)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  return [...source.matchAll(re)].map((m) => ({ key: m[2]!, inner: m[3]! }));
}

function labels(source: string): { key: string; label: string }[] {
  return [...source.matchAll(/<[^>]*\bdata-i18n-label="([^"]+)"[^>]*>/g)].map((m) => ({ key: m[1]!, label: /aria-label="([^"]*)"/.exec(m[0])?.[1] ?? "" }));
}

/** The custom properties of the first rule whose selector matches, as name → value. */
function vars(source: string, selector: RegExp): Record<string, string> {
  const m = new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(source);
  expect(m, String(selector)).not.toBeNull();
  return Object.fromEntries([...m![1]!.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((v) => [v[1]!, v[2]!.trim()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// ---- A minimal DOM for main.js: just what its functions touch. ----

class FakeElement {
  innerHTML = "";
  textContent = "";
  private attrs = new Map<string, string>();
  listeners: Record<string, () => void> = {};
  constructor(attrs: Record<string, string> = {}, inner = "") {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    this.innerHTML = inner;
    this.textContent = inner;
  }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  hasAttribute(name: string) { return this.attrs.has(name); }
  addEventListener(type: string, fn: () => void) { this.listeners[type] = fn; }
}

function fakeDocument() {
  const elements: FakeElement[] = [
    ...translatable(html).map((t) => new FakeElement({ "data-i18n": t.key }, t.inner)),
    ...labels(html).map((l) => new FakeElement({ "data-i18n-label": l.key, "aria-label": l.label })),
    new FakeElement({ "data-lang": "es" }), new FakeElement({ "data-lang": "en" }),
    ...["auto", "light", "dark"].map((t) => new FakeElement({ "data-theme-choice": t })),
  ];
  const byId: Record<string, FakeElement> = {
    "install-code": new FakeElement({}, "npm install && npm run build"),
    announce: new FakeElement(),
  };
  return {
    title: /<title>([^<]*)<\/title>/.exec(html)![1]!,
    documentElement: new FakeElement({ lang: "es" }),
    elements,
    querySelectorAll(selector: string) {
      const attr = /^\[([\w-]+)\]$/.exec(selector)![1]!;
      return elements.filter((e) => e.hasAttribute(attr));
    },
    getElementById: (id: string) => byId[id] ?? null,
    byId,
  };
}

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

type Site = {
  EN: Record<string, string>;
  applyLanguage(doc: unknown, lang: string, storage: unknown): string;
  setTheme(doc: unknown, theme: string, storage: unknown): string;
  copyCode(doc: unknown, button: unknown, nav: unknown): Promise<boolean>;
};

/** Runs main.js in a context without a document, as the tests' stand-in for a browser. */
function loadSite(): Site {
  const context: { zeroSite?: Site } = {};
  runInNewContext(js, context);
  return context.zeroSite!;
}

describe("sitio del proyecto: archivos", () => {
  it("es estático: index.html sin package.json, node_modules ni configuración de build", () => {
    expect(siteFiles).toContain("index.html");
    for (const f of ["package.json", "node_modules", "vercel.json", "package-lock.json", "vite.config.js", "tsconfig.json"]) expect(siteFiles).not.toContain(f);
  });

  it("solo carga recursos relativos dentro de site/", () => {
    const refs = [
      ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)].map((m) => m[1]!),
      ...[...html.matchAll(/<link\b[^>]*\bhref="([^"]*)"/g)].filter((m) => !/rel="canonical"/.test(m[0])).map((m) => m[1]!),
      ...[...css.matchAll(/url\(\s*['"]?([^'")]+)/g)].map((m) => m[1]!),
      ...[...css.matchAll(/@import\s+(?:url\()?['"]?([^'");]+)/g)].map((m) => m[1]!),
    ];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref, ref).not.toMatch(/^(https?:)?\/\//);
      expect(existsSync(new URL(`../site/${ref}`, import.meta.url)), ref).toBe(true);
    }
  });
});

describe("sitio del proyecto: contenido", () => {
  it("presenta las secciones en orden, con marcadores numerados", () => {
    const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["hero", "synopsis", "line", "autonomy", "night-shift", "guarantees", "install", "workflow", "compatibility", "links"]);
    ids.slice(1).forEach((id, i) => {
      const marker = /<span class="marker">(\d+)<\/span>/.exec(section(id!));
      expect(marker?.[1], id).toBe(String(i + 1).padStart(2, "0"));
    });
  });

  it("título y bajada: zero in the loop, y el dueño decide dónde vuelve a entrar", () => {
    const hero = section("hero");
    expect(hero).toContain("<h1>zero in the loop</h1>");
    expect(hero).toContain("el dueño decide dónde vuelve a entrar");
  });

  it("nombra las estaciones, los niveles, las autonomías y el turno nocturno", () => {
    for (const fact of ["spec", "build", "verify", "review", "security", "integrate", "L0", "L1", "L2", "L3", "propose", "auto", "scout", "research"]) {
      expect(html, fact).toContain(fact);
    }
    for (const station of ["spec", "build", "verify", "review", "security", "integrate"]) expect(section("line")).toContain(`<code>${station}</code>`);
    for (const level of ["L0", "L1", "L2", "L3"]) expect(section("autonomy")).toContain(`<code>${level}</code>`);
    for (const autonomy of ["propose", "build", "auto"]) expect(section("autonomy")).toContain(`<dt><code>${autonomy}</code></dt>`);
    for (const station of ["scout", "research"]) expect(section("night-shift")).toContain(`<dt><code>${station}</code></dt>`);
    const guarantees = section("guarantees");
    for (const g of ["Rutas protegidas", "Verificación", "Secretos fuera de los archivos", "Caja de aislamiento"]) expect(guarantees).toContain(g);
  });

  it("no publica métricas, estrellas, clientes ni testimonios", () => {
    const text = squash(html.replace(/<[^>]+>/g, " ")).toLowerCase();
    for (const word of ["stars", "estrellas", "testimonio", "testimonial", "clientes satisfechos", "customers", "usuarios activos", "descargas"]) expect(text).not.toContain(word);
  });

  it("marca como en camino lo de las próximas etapas", () => {
    const soon = [...html.matchAll(/<span class="soon" data-i18n="soon">([^<]*)<\/span>/g)];
    expect(soon.length).toBeGreaterThanOrEqual(2);
    for (const s of soon) expect(s[1]).toBe("en camino");
    expect(loadSite().EN["soon"]).toBe("coming");
    for (const item of ["Instalador", "OTLP"]) {
      const line = html.split("\n").find((l) => l.includes(item) && l.includes('class="soon"'));
      expect(line, item).toBeDefined();
    }
  });
});

describe("sitio del proyecto: FIG. 1", () => {
  const svg = /<svg class="line-fig"[^>]*>[\s\S]*?<\/svg>/.exec(section("hero"))![0];

  it("es una figura accesible con un nodo por estación", () => {
    expect(svg).toMatch(/<svg[^>]*role="img"/);
    expect(svg).toMatch(/<title id="fig-title"[^>]*>[^<]+<\/title>/);
    expect(svg).toMatch(/aria-labelledby="fig-title/);
    expect(section("hero")).toMatch(/<figcaption[^>]*>FIG\. 1 \/ LÍNEA<\/figcaption>/);
    const nodes = [...svg.matchAll(/<g class="node" data-station="([^"]+)">/g)].map((m) => m[1]);
    expect(nodes).toEqual(["spec", "build", "verify", "review", "security", "integrate"]);
    expect(svg).toContain('class="work"');
    expect(svg).toContain('class="owner"');
  });

  it("detiene las animaciones con prefers-reduced-motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/animation:\s*none/);
    expect(block![1]).toMatch(/transition:\s*none/);
  });
});

describe("sitio del proyecto: instalación y flujo", () => {
  it("muestra los comandos reales del README con un botón de copiar", () => {
    const install = section("install");
    const code = /<pre><code id="install-code">([\s\S]*?)<\/code><\/pre>/.exec(install)![1]!.replace(/&amp;/g, "&");
    for (const cmd of ["git clone https://github.com/kaelen-phoenix/zero", "npm install && npm run build", "node dist/cli.js init", "node dist/cli.js install", "node dist/cli.js box setup"]) {
      expect(code).toContain(cmd);
    }
    expect(install).toMatch(/<button type="button" class="copy" data-copy="install-code"/);
    expect(html).toMatch(/<div id="announce"[^>]*aria-live="polite"/);
  });

  it("el botón de copiar escribe el texto del bloque en el portapapeles y lo anuncia", async () => {
    const site = loadSite();
    const doc = fakeDocument();
    const written: string[] = [];
    const nav = { clipboard: { writeText: (text: string) => { written.push(text); return Promise.resolve(); } } };
    const button = new FakeElement({ "data-copy": "install-code" });
    expect(await site.copyCode(doc, button, nav)).toBe(true);
    expect(written).toEqual(["npm install && npm run build"]);
    expect(doc.byId["announce"]!.textContent).toBe("Comando copiado.");

    const failing = { clipboard: { writeText: () => Promise.reject(new Error("denied")) } };
    expect(await site.copyCode(doc, button, failing)).toBe(false);
    expect(doc.byId["announce"]!.textContent).toMatch(/No se pudo copiar/);
  });

  it("el flujo es una lista numerada con cada comando y su descripción", () => {
    const list = /<ol class="flow">([\s\S]*?)<\/ol>/.exec(section("workflow"))![1]!;
    const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
    for (const cmd of ["zero request", "zero status", "zero approve", "zero proposals", "zero trace", "zero briefing", "zero stop"]) {
      const item = items.find((i) => new RegExp(`^<code[^>]*>${cmd}\\b`).test(i));
      expect(item, cmd).toBeDefined();
      expect(item, cmd).toMatch(/<\/code><p data-i18n="[^"]+">[^<]+/);
    }
  });
});

describe("sitio del proyecto: compatibilidad, encabezado y pie", () => {
  it("lista los motores y clientes de hoy, y nada más", () => {
    const compat = section("compatibility");
    const items = [...compat.matchAll(/data-item="([^"]+)"/g)].map((m) => m[1]);
    expect(items).toEqual(["claude", "codex", "antigravity", "custom-cli", "claude-code", "codex", "opencode", "terminal"]);
    for (const name of ["Claude", "Codex", "Antigravity", "CLI propio", "Claude Code", "OpenCode", "Terminal"]) expect(compat).toContain(name);
    for (const other of ["Gemini", "Cursor", "Copilot", "Windsurf", "Aider", "ChatGPT"]) expect(compat).not.toContain(other);
  });

  it("el encabezado enlaza Docs y GitHub", () => {
    const header = /<header class="top">([\s\S]*?)<\/header>/.exec(html)![1]!;
    expect(header).toContain('<a href="https://github.com/kaelen-phoenix/zero#readme">Docs</a>');
    expect(header).toContain('<a href="https://github.com/kaelen-phoenix/zero">GitHub</a>');
  });

  it("el pie muestra GitHub, la versión de package.json, la licencia y el selector de tema", () => {
    const footer = /<footer class="foot">([\s\S]*?)<\/footer>/.exec(html)![1]!;
    const version = /<span id="version">([^<]+)<\/span>/.exec(footer)![1];
    expect(version).toBe(JSON.parse(read("package.json")).version);
    expect(footer).toContain('href="https://github.com/kaelen-phoenix/zero">GitHub</a>');
    expect(footer).toContain("Apache-2.0");
    const choices = [...footer.matchAll(/<button type="button" data-theme-choice="([^"]+)"/g)].map((m) => m[1]);
    expect(choices).toEqual(["auto", "light", "dark"]);
  });
});

describe("sitio del proyecto: tema", () => {
  it("guarda la elección explícita en localStorage y auto quita el atributo", () => {
    const site = loadSite();
    const doc = fakeDocument();
    const storage = fakeStorage();
    site.setTheme(doc, "dark", storage);
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(storage.data.get("zero-site-theme")).toBe("dark");
    expect(doc.elements.find((e) => e.getAttribute("data-theme-choice") === "dark")!.getAttribute("aria-pressed")).toBe("true");
    site.setTheme(doc, "auto", storage);
    expect(doc.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(storage.data.has("zero-site-theme")).toBe(false);
  });

  it("auto sigue a prefers-color-scheme cuando no hay tema explícito", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{/);
    expect(vars(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)/)).toEqual(vars(css, /:root\[data-theme="dark"\]/));
  });

  it("no usa cookies: solo localStorage", () => {
    for (const { file, text } of textFiles) expect(text, file).not.toMatch(/document\.cookie|sessionStorage|indexedDB/);
  });
});

describe("sitio del proyecto: idiomas", () => {
  const site = loadSite();

  it("arranca en español", () => {
    expect(html).toMatch(/^<!doctype html>\s*<html lang="es">/);
    expect(html).toContain('<button type="button" data-lang="es" aria-pressed="true">ES</button>');
  });

  it("cada clave traducible tiene su versión en inglés, y ninguna sobra", () => {
    const keys = new Set([...translatable(html).map((t) => t.key), ...labels(html).map((l) => l.key), "meta.title"]);
    expect(Object.keys(site.EN).sort()).toEqual([...keys].sort());
    for (const [key, value] of Object.entries(site.EN)) expect(value.trim(), key).not.toBe("");
  });

  it("todo el texto visible está bajo una clave traducible, salvo nombres y comandos", () => {
    let rest = html.replace(/<head>[\s\S]*<\/head>/, "").replace(/<pre>[\s\S]*?<\/pre>/g, "");
    rest = rest
      .replace(/<([a-z][a-z0-9]*)\b[^>]*\bdata-i18n="[^"]+"[^>]*>[\s\S]*?<\/\1>/g, "").replace(/<code>[\s\S]*?<\/code>/g, "").replace(/<text x="\d+" y="186">\w+<\/text>/g, "");
    const words = squash(rest.replace(/<[^>]+>/g, " ")).split(" ").filter(Boolean);
    const names = ["zero", "Docs", "GitHub", "ES", "EN", "zero in the loop", "SH", "Claude", "Agent SDK", "Codex", "CLI", "Antigravity", "Claude Code", "OpenCode", "Terminal", "v", "0.1.0", "Apache-2.0"];
    const allowed = new Set(names.flatMap((n) => n.split(" ")));
    expect(words.filter((w) => !allowed.has(w) && !/^\d\d$/.test(w))).toEqual([]);
  });

  it("cambia a inglés y vuelve a español sin perder textos", () => {
    const doc = fakeDocument();
    const storage = fakeStorage();
    const spanish = doc.elements.filter((e) => e.hasAttribute("data-i18n")).map((e) => e.innerHTML);
    site.applyLanguage(doc, "en", storage);
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(storage.data.get("zero-site-lang")).toBe("en");
    expect(doc.title).toBe(site.EN["meta.title"]);
    for (const el of doc.elements.filter((e) => e.hasAttribute("data-i18n"))) expect(el.innerHTML).toBe(site.EN[el.getAttribute("data-i18n")!]);
    for (const el of doc.elements.filter((e) => e.hasAttribute("data-i18n-label"))) expect(el.getAttribute("aria-label")).toBe(site.EN[el.getAttribute("data-i18n-label")!]);
    expect(doc.elements.find((e) => e.getAttribute("data-lang") === "en")!.getAttribute("aria-pressed")).toBe("true");
    expect(doc.elements.find((e) => e.getAttribute("data-i18n") === "fig.caption")!.innerHTML).toBe("FIG. 1 / LINE");

    site.applyLanguage(doc, "es", storage);
    expect(doc.documentElement.getAttribute("lang")).toBe("es");
    expect(doc.elements.filter((e) => e.hasAttribute("data-i18n")).map((e) => e.innerHTML)).toEqual(spanish);
  });
});

describe("sitio del proyecto: accesibilidad", () => {
  it("los colores de texto de los dos temas tienen contraste AA", () => {
    const themes = { light: vars(css, /:root/), dark: vars(css, /:root\[data-theme="dark"\]/) };
    for (const [name, v] of Object.entries(themes)) {
      for (const [fg, bg] of [["fg", "bg"], ["muted", "bg"], ["accent", "bg"], ["fg", "code-bg"], ["muted", "code-bg"], ["accent", "code-bg"], ["bg", "fg"]] as const) {
        const ratio = contrast(v[fg]!, v[bg]!);
        expect(ratio, `${name}: --${fg} sobre --${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("tiene salto al contenido, foco visible, textos alternativos y viewport", () => {
    expect(html).toMatch(/<a class="skip" href="#main"/);
    expect(html).toContain('<main id="main"');
    expect(css).toMatch(/:focus-visible\s*\{/);
    for (const img of html.match(/<img\b[^>]*>/g) ?? []) expect(img).toMatch(/\balt="[^"]+"/);
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
    expect(css).toMatch(/@media \(max-width: 40rem\)/);
  });
});

describe("sitio del proyecto: metadatos y rastreo", () => {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)![1]!;
  const meta = (attr: string) => new RegExp(`<meta (?:property|name)="${attr}" content="([^"]+)"`).exec(head)?.[1];

  it("trae título, descripción, Open Graph, Twitter, canónica y favicon", () => {
    expect(head).toMatch(/<title>[^<]+<\/title>/);
    expect(meta("description")).toBeTruthy();
    expect(meta("og:title")).toBeTruthy();
    expect(meta("og:description")).toBeTruthy();
    expect(meta("og:url")).toBe("https://zerointheloop.com/");
    expect(meta("twitter:card")).toBe("summary_large_image");
    for (const image of [meta("og:image")!, meta("twitter:image")!]) {
      expect(image).toMatch(/^https:\/\/zerointheloop\.com\//);
      expect(existsSync(new URL(`../site/${image.replace("https://zerointheloop.com/", "")}`, import.meta.url)), image).toBe(true);
    }
    expect(head).toContain('<link rel="canonical" href="https://zerointheloop.com/">');
    const icon = /<link rel="icon" href="([^"]+)"/.exec(head)![1]!;
    expect(existsSync(new URL(`../site/${icon}`, import.meta.url))).toBe(true);
  });

  it("la imagen Open Graph es un PNG de 1200×630", () => {
    const png = readFileSync(new URL("../site/og.png", import.meta.url));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it("robots.txt y sitemap.xml apuntan a zerointheloop.com", () => {
    const robots = read("site/robots.txt");
    expect(robots).toMatch(/User-agent: \*/);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).not.toMatch(/^Disallow: \/$/m);
    expect(robots).toContain("Sitemap: https://zerointheloop.com/sitemap.xml");
    expect(read("site/sitemap.xml")).toContain("<loc>https://zerointheloop.com/</loc>");
  });
});

describe("sitio del proyecto: privacidad", () => {
  it("no tiene formularios, cookies, pedidos de red ni analítica", () => {
    for (const { file, text } of textFiles) {
      expect(text, file).not.toMatch(/<form\b|document\.cookie|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
      expect(text, file).not.toMatch(/google-analytics|googletagmanager|gtag\(|plausible|segment\.(io|com)|hotjar|mixpanel|vercel-insights|_vercel\/insights|clarity\.ms/i);
    }
  });

  it("no publica claves, links del panel, rutas de la PC ni la configuración de la fábrica", () => {
    for (const { file, text } of textFiles) {
      expect(text, file).not.toMatch(/127\.0\.0\.1|localhost|#key=?/i);
      expect(text, file).not.toMatch(/\b[A-Za-z]:\\|\/Users\/|\/home\/|~\/\.zero/);
      expect(text, file).not.toMatch(/sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY/);
      expect(text, file).not.toMatch(/protectedPaths|usdPerDay|zero\.factory\.yaml/);
    }
  });
});

describe("README", () => {
  it("menciona el sitio, que vive en site/ y cómo lo publica Vercel", () => {
    const paragraph = read("README.md").split(/\n\s*\n/).find((p) => p.includes("zerointheloop.com"));
    expect(paragraph).toBeDefined();
    expect(paragraph).toContain("site/");
    expect(paragraph).toContain("Vercel");
  });
});

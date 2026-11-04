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

/** Every element carrying data-i18n-href, with its markup href and opening tag. */
function hrefs(source: string): { key: string; href: string; tag: string }[] {
  return [...source.matchAll(/<[^>]*\bdata-i18n-href="([^"]+)"[^>]*>/g)].map((m) => ({ key: m[1]!, href: /\shref="([^"]*)"/.exec(m[0])?.[1] ?? "", tag: m[0] }));
}

const README_ES = "https://github.com/kaelen-phoenix/zero/blob/main/README.es.md";
const README_EN = "https://github.com/kaelen-phoenix/zero#readme";

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
  parent: FakeElement | null = null;
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
  /** Only single '[attr]' selectors, like querySelectorAll. */
  closest(selector: string): FakeElement | null {
    const attr = /^\[([\w-]+)\]$/.exec(selector)![1]!;
    for (let el: FakeElement | null = this; el; el = el.parent) if (el.hasAttribute(attr)) return el;
    return null;
  }
}

/** Elements marked data-lang-only and section markers, in document order; a marker's parent is the data-lang-only section around it. */
function scoped(source: string): FakeElement[] {
  const re = /<(a|section)\b[^>]*\bdata-lang-only="([^"]+)"[^>]*>|<span class="marker" data-marker>(\d+)<\/span>/g;
  const out: FakeElement[] = [];
  let open: { el: FakeElement; end: number } | null = null;
  for (const m of source.matchAll(re)) {
    if (open && m.index! >= open.end) open = null;
    if (m[3] !== undefined) {
      const marker = new FakeElement({ "data-marker": "" }, m[3]);
      marker.parent = open?.el ?? null;
      out.push(marker);
      continue;
    }
    const el = new FakeElement({ "data-lang-only": m[2]! });
    out.push(el);
    if (m[1] === "section") {
      const rest = source.slice(m.index! + 1);
      open = { el, end: m.index! + 1 + rest.search(/<section |<\/main>/) };
    }
  }
  return out;
}

function fakeDocument() {
  const elements: FakeElement[] = [
    ...translatable(html).map((t) => new FakeElement({ "data-i18n": t.key }, t.inner)),
    ...labels(html).map((l) => new FakeElement({ "data-i18n-label": l.key, "aria-label": l.label })),
    ...hrefs(html).map((h) => new FakeElement({ "data-i18n-href": h.key, href: h.href })),
    new FakeElement({ "data-lang": "es" }), new FakeElement({ "data-lang": "en" }),
    ...["auto", "light", "dark"].map((t) => new FakeElement({ "data-theme-choice": t })),
    ...scoped(html),
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
    expect(ids).toEqual(["hero", "synopsis", "line", "autonomy", "night-shift", "guarantees", "ci", "install", "workflow", "compatibility", "training", "links"]);
    ids.slice(1).forEach((id, i) => {
      const marker = /<span class="marker" data-marker[^>]*>(\d+)<\/span>/.exec(section(id!));
      expect(marker?.[1], id).toBe(String(i + 1).padStart(2, "0"));
    });
  });

  it("título y bajada: zero in the loop, y zero se suma al circuito al lado de la persona", () => {
    const hero = section("hero");
    expect(hero).toContain("<h1>zero in the loop</h1>");
    const tagline = translatable(hero).find((t) => t.key === "hero.tagline")!.inner;
    for (const word of ["ocupa el lugar", "vuelve a entrar"]) expect(tagline).not.toContain(word);
    for (const word of ["zero", "persona"]) expect(tagline).toContain(word);
    const en = loadSite().EN["hero.tagline"]!;
    for (const word of ["place", "step back in"]) expect(en).not.toContain(word);
    expect(en).toContain("zero");
    expect(en).toMatch(/person|people/);
  });

  it("la sinopsis cuenta que la persona delega según lo que sabe y la confianza que tiene", () => {
    const loop = translatable(section("synopsis")).find((t) => t.key === "synopsis.loop");
    expect(loop?.inner.trim()).toBeTruthy();
    expect(loop!.inner).toMatch(/delega|delegás/);
    expect(loop!.inner).toContain("confianza");
    const en = loadSite().EN["synopsis.loop"]!;
    for (const word of ["delegate", "trust"]) expect(en).toContain(word);
  });

  it("la autonomía conecta la delegación con L0 a L3 antes de la tabla", () => {
    const autonomy = section("autonomy");
    const intro = /<p data-i18n="autonomy\.intro">([\s\S]*?)<\/p>/.exec(autonomy);
    expect(intro).not.toBeNull();
    expect(intro!.index).toBeLessThan(autonomy.indexOf("<table>"));
    for (const level of ["L0", "L3"]) {
      expect(intro![1]).toContain(level);
      expect(loadSite().EN["autonomy.intro"]).toContain(level);
    }
  });

  it("ningún texto dice que zero hace el trabajo de las personas u ocupa su lugar", () => {
    const texts = [html, ...Object.values(loadSite().EN)].join("\n").toLowerCase();
    for (const phrase of ["lugar del humano", "ocupa el lugar", "trabajo de las personas", "human's place", "takes the place", "work of the people"]) {
      expect(texts, phrase).not.toContain(phrase);
    }
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)![1]!;
    for (const name of ['name="description"', 'property="og:description"']) {
      const content = new RegExp(`<meta ${name} content="([^"]+)"`).exec(head)?.[1];
      expect(content, name).toBeTruthy();
      expect(content, name).not.toContain("vuelve a entrar");
    }
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

  it("explica que zero no reemplaza el CI ni las herramientas de calidad", () => {
    const ci = section("ci");
    for (const fact of ["GitHub Actions", "SonarQube", "SonarCloud", "CodeQL", "Dependabot", "Snyk", "<code>autoMerge</code>", "no reemplaza", "análisis estático", "ningún check"]) {
      expect(ci, fact).toContain(fact);
    }
    const en = loadSite().EN;
    const values = Object.entries(en).filter(([k]) => k.startsWith("ci.")).map(([, v]) => v).join("\n");
    for (const fact of ["does not replace", "static analysis", "Sonar", "Vercel", "no checks"]) expect(values, fact).toContain(fact);
  });

  it("muestra el recorrido del pedido hasta el despliegue, traducible", () => {
    const list = /<ol class="path">([\s\S]*?)<\/ol>/.exec(section("ci"))![1]!;
    const items = [...list.matchAll(/<li data-i18n="([^"]+)">([\s\S]*?)<\/li>/g)].map((m) => ({ key: m[1]!, inner: m[2]! }));
    expect(items).toHaveLength(6);
    expect(items[1]!.inner).toContain("<code>spec</code>");
    expect(items[1]!.inner).toContain("<code>security</code>");
    const text = items.map((i) => i.inner).join("\n");
    const at = ["pull request", "merge", "despliegue"].map((w) => text.indexOf(w));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const en = loadSite().EN;
    for (const item of items) expect(en[item.key], item.key).toBeTruthy();
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
    const line = html.split("\n").find((l) => l.includes("Instalador") && l.includes('class="soon"'));
    expect(line, "Instalador").toBeDefined();
  });

  it("da la exportación OTLP como disponible, no en camino", () => {
    expect(html.split("\n").filter((l) => l.includes('class="soon"') && l.includes("OTLP"))).toEqual([]);
    expect(html).not.toContain("next.otlp");
    expect(loadSite().EN["next.otlp"]).toBeUndefined();
    expect(/<p data-i18n="workflow\.trace">([^<]*)<\/p>/.exec(html)![1]).toContain("OTLP");
    expect(loadSite().EN["workflow.trace"]).toContain("OTLP");
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

  it("es una línea de montaje: una cinta y varios trabajos en posiciones distintas", () => {
    expect(svg).toMatch(/class="[^"]*\b(rail|belt)\b/);
    const works = [...svg.matchAll(/<[a-z]+\b[^>]*\bclass="[^"]*\bwork\b[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(works.length).toBeGreaterThanOrEqual(2);
    const positions = works.map((w) => /\b(?:cx|x|transform)="([^"]+)"/.exec(w)?.[1]);
    expect(positions.every(Boolean)).toBe(true);
    expect(new Set(positions).size).toBe(works.length);
  });

  it("describe la figura en los dos idiomas, con la persona al lado de la línea", () => {
    expect(svg).toMatch(/aria-labelledby="fig-title fig-desc"/);
    const desc = /<desc id="fig-desc" data-i18n="fig\.desc">([^<]+)<\/desc>/.exec(svg)?.[1];
    expect(desc).toBeTruthy();
    const en = loadSite().EN;
    expect(en["fig.title"]!.trim()).not.toBe("");
    for (const text of [desc!, en["fig.desc"]!]) {
      for (const station of ["spec", "build", "verify", "review", "security", "integrate"]) expect(text).toContain(station);
      expect(text).not.toMatch(/vuelve a entrar|steps? back in/);
    }
  });

  it("no tiene colores fijos ni recursos externos: usa las variables del sitio", () => {
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|fill="(?!none)|stroke="/i);
    expect(svg).not.toMatch(/<script|<image|href=|src=/);
    const rules = [...css.matchAll(/\.line-fig[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const color of rule.matchAll(/(?:^|;)\s*(?:fill|stroke|color):\s*([^;]+)/g)) expect(color[1]!.trim()).toMatch(/^(var\(--[\w-]+\)|none)$/);
    }
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

describe("sitio del proyecto: capacitaciones", () => {
  const FORMATS = ["talk", "workshop", "mentoring"];
  const INSTAGRAM_CHAT = "https://ig.me/m/zerointheloop";

  /** The call-to-action links of the section: opening tag, format, i18n key and visible text. */
  function ctaLinks(): { tag: string; format: string; key: string; text: string }[] {
    return [...section("training").matchAll(/(<a\b[^>]*\bdata-training="([^"]+)"[^>]*\bdata-i18n="([^"]+)"[^>]*>)([^<]*)<\/a>/g)]
      .map((m) => ({ tag: m[1]!, format: m[2]!, key: m[3]!, text: m[4]! }));
  }

  it("el menú enlaza la sección, marcada solo para español", () => {
    const header = /<header class="top">([\s\S]*?)<\/header>/.exec(html)![1]!;
    const link = /<a href="#training" data-lang-only="es" data-i18n="([^"]+)">Capacitaciones<\/a>/.exec(header);
    expect(link).not.toBeNull();
    expect(loadSite().EN[link![1]!]).toBe("Training");
    expect(header).toContain(`<a href="${README_ES}" data-i18n-href="href.readme">Docs</a>`);
    expect(header).toContain('<a href="https://github.com/kaelen-phoenix/zero">GitHub</a>');
  });

  it("lista los tres formatos, a consultar y sin precios", () => {
    const training = section("training");
    expect([...training.matchAll(/data-training="([^"]+)"/g)].map((m) => m[1])).toEqual(FORMATS);
    for (const title of ["Charla abierta", "Taller grupal", "Mentoría individual"]) expect(training).toContain(title);
    expect(training).not.toContain("Empresas");
    const site = loadSite();
    for (const format of FORMATS) {
      const titleKey = `training.${format}.title`;
      expect(translatable(training).some((t) => t.key === titleKey), titleKey).toBe(true);
      expect(translatable(training).some((t) => t.key === `training.${format}`), format).toBe(true);
    }
    const onRequest = translatable(training).filter((t) => t.inner === "a consultar");
    expect(onRequest).toHaveLength(3);
    for (const t of onRequest) expect(site.EN[t.key]).toBe("on request");
    const text = squash(training.replace(/<[^>]+>/g, " "));
    expect(text).not.toMatch(/\$|USD|ARS|€|precio|price/i);
  });

  it("los temas van más allá de zero", () => {
    const training = section("training");
    for (const topic of ["Claude Code", "OpenSpec", "zero"]) expect(training).toContain(topic);
    const topics = translatable(training).find((t) => t.inner.includes("OpenSpec"));
    expect(topics).toBeDefined();
    expect(loadSite().EN[topics!.key]!.trim()).not.toBe("");
  });

  it("cada formato tiene un enlace con estilo de botón al chat de Instagram", () => {
    const links = ctaLinks();
    expect(links.map((l) => l.format)).toEqual(FORMATS);
    for (const { tag } of links) {
      expect(tag, tag).toMatch(/\sclass="button"/);
      expect(tag, tag).toContain(` href="${INSTAGRAM_CHAT}"`);
      expect(tag, tag).toContain(' target="_blank"');
      expect(tag, tag).toMatch(/\srel="[^"]*\bnoopener\b[^"]*"/);
    }
  });

  it("la sección no tiene elementos button", () => {
    expect(section("training")).not.toMatch(/<button/);
  });

  it("el texto del enlace se traduce: La quiero / I want this", () => {
    const EN = loadSite().EN;
    const links = ctaLinks();
    expect(links).toHaveLength(3);
    for (const { key, text } of links) {
      expect(text).toBe("La quiero");
      expect(key).toBe("training.cta");
      expect(EN[key]).toBe("I want this");
    }
  });

  it("el destino del enlace es el mismo en los dos idiomas", () => {
    const links = ctaLinks();
    expect(links).toHaveLength(3);
    for (const { tag } of links) {
      expect(tag, tag).not.toContain("data-i18n-href");
      expect(tag, tag).toContain(` href="${INSTAGRAM_CHAT}"`);
    }
  });

  it("el enlace funciona sin JavaScript: main.js no arma ni intercepta nada", () => {
    expect((loadSite() as unknown as Record<string, unknown>).trainingMailto).toBeUndefined();
    for (const code of ["trainingMailto", "MAIL_PARTS", "mailto:", "data-training"]) expect(js, code).not.toContain(code);
  });

  it("sin aviso de noscript sobre el correo", () => {
    expect(section("training")).not.toMatch(/<noscript/);
    expect(loadSite().EN).not.toHaveProperty(["training.noscript"]);
  });

  it("el enlace conserva el aspecto del botón: texto centrado y monoespaciada de peso 500", () => {
    const rule = /\.training \.button \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("text-align: center");
    expect(rule![1]).toMatch(/font:\s*500\b[^;]*var\(--mono\)/);
  });

  it("no hay capacitaciones para empresas en ninguna parte del sitio", () => {
    const EN = loadSite().EN;
    expect(EN).not.toHaveProperty(["training.companies.title"]);
    expect(EN).not.toHaveProperty(["training.companies"]);
    expect(html).not.toMatch(/data-i18n="training\.companies/);
    for (const { file, text } of textFiles) expect(text, file).not.toMatch(/empresa|compan(y|ies)/i);
  });

  it("no queda rastro de la dirección de correo en ningún archivo del sitio", () => {
    for (const { file, text } of textFiles) {
      for (const trace of ["mailto:", "kaelen.dev", "gmail.com"]) expect(text, `${file}: ${trace}`).not.toContain(trace);
    }
  });

  it("solo el enlace del menú y la sección llevan data-lang-only, sin hidden en el marcado", () => {
    const marked = [...html.matchAll(/<[^>]*\bdata-lang-only="[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(marked).toHaveLength(2);
    expect(marked[0]).toMatch(/^<a href="#training" data-lang-only="es"/);
    expect(marked[1]).toMatch(/^<section id="training" data-lang-only="es"/);
    for (const tag of marked) expect(tag).not.toMatch(/\shidden\b/);
  });

  it("se oculta en inglés y reaparece en español", () => {
    const site = loadSite();
    const doc = fakeDocument();
    const storage = fakeStorage();
    const only = doc.elements.filter((e) => e.hasAttribute("data-lang-only"));
    expect(only).toHaveLength(2);
    site.applyLanguage(doc, "en", storage);
    for (const el of only) expect(el.hasAttribute("hidden")).toBe(true);
    site.applyLanguage(doc, "es", storage);
    for (const el of only) expect(el.hasAttribute("hidden")).toBe(false);
  });

  it("la numeración de las secciones es correlativa en los dos idiomas", () => {
    const site = loadSite();
    const doc = fakeDocument();
    const storage = fakeStorage();
    const markers = doc.elements.filter((e) => e.hasAttribute("data-marker"));
    const visible = () => markers.filter((m) => !m.closest("[hidden]")).map((m) => m.textContent);
    const numbers = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, "0"));
    const [training, links] = [markers[9]!, markers[10]!];
    expect(training.parent?.getAttribute("data-lang-only")).toBe("es");
    expect(visible()).toEqual(numbers(11));
    site.applyLanguage(doc, "es", storage);
    expect(visible()).toEqual(numbers(11));
    site.applyLanguage(doc, "en", storage);
    expect(visible()).toEqual(numbers(10));
    expect(links.textContent).toBe("10");
    site.applyLanguage(doc, "es", storage);
    expect(visible()).toEqual(numbers(11));
    expect([training.textContent, links.textContent]).toEqual(["10", "11"]);
  });

  it("styles.css oculta [hidden] aunque una clase fije display", () => {
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none/);
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
    expect(header).toContain(`<a href="${README_ES}" data-i18n-href="href.readme">Docs</a>`);
    expect(header).toContain('<a href="https://github.com/kaelen-phoenix/zero">GitHub</a>');
  });

  it("enlaza al README en español desde el encabezado, el inicio y los enlaces", () => {
    const header = /<header class="top">([\s\S]*?)<\/header>/.exec(html)![1]!;
    for (const part of [header, section("hero"), section("links")]) {
      expect(hrefs(part).some((h) => h.tag.startsWith("<a ") && h.href === README_ES)).toBe(true);
    }
    expect(html).not.toContain("#readme");
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

  it("el pie dice que el sitio lo construyó zero in the loop, en los dos idiomas", () => {
    const footer = /<footer class="foot">([\s\S]*?)<\/footer>/.exec(html)![1]!;
    const built = /<span data-i18n="foot.built">([\s\S]*?)<\/span>/.exec(footer)![1]!;
    expect(built).toContain("Este sitio lo construyó");
    expect(built).toContain('<a href="https://zerointheloop.com">zero in the loop</a>');
    expect(loadSite().EN["foot.built"]).toContain("This site was built by");
    expect(loadSite().EN["foot.built"]).toContain('<a href="https://zerointheloop.com">zero in the loop</a>');
  });

  describe("enlace de Instagram", () => {
    const footer = /<footer class="foot">([\s\S]*?)<\/footer>/.exec(html)![1]!;
    const instagram = /<a\b[^>]*href="https:\/\/www\.instagram\.com\/zerointheloop\/"[^>]*>([\s\S]*?)<\/a>/.exec(footer);

    it("abre en una pestaña nueva, con noopener", () => {
      expect(instagram).not.toBeNull();
      const tag = /^<a\b[^>]*>/.exec(instagram![0])![0];
      expect(tag).toContain('target="_blank"');
      expect(/\srel="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/)).toContain("noopener");
    });

    it("viene justo después de GitHub y antes del selector de tema", () => {
      const links = [...footer.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)];
      const at = links.findIndex((m) => m[1] === "https://github.com/kaelen-phoenix/zero");
      expect(links[at + 1]![1]).toBe("https://www.instagram.com/zerointheloop/");
      expect(links[at + 1]!.index).toBeLessThan(footer.indexOf('class="switch"'));
    });

    it("muestra solo un ícono decorativo que sigue el color del texto", () => {
      const inner = instagram![1]!;
      const svg = /<svg\b[^>]*>[\s\S]*?<\/svg>/.exec(inner)![0];
      expect(svg).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(svg).toContain("currentColor");
      expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
      expect(svg).not.toMatch(/\b(href|src)=|<image|<script/);
      expect(inner.replace(svg, "").trim()).toBe("");
    });

    it("el ícono tiene ancho y alto explícitos en el CSS", () => {
      const rule = /\.foot \.social svg\s*\{([^}]*)\}/.exec(read("site/styles.css"))?.[1];
      expect(rule).toMatch(/(^|[\s;])width:\s*[\d.]+[a-z]+/);
      expect(rule).toMatch(/(^|[\s;])height:\s*[\d.]+[a-z]+/);
    });

    it("su nombre accesible cambia con el idioma", () => {
      const tag = /^<a\b[^>]*>/.exec(instagram![0])![0];
      expect(tag).toContain('aria-label="Instagram de zero in the loop"');
      expect(tag).toContain('data-i18n-label="foot.instagram"');
      const site = loadSite();
      expect(site.EN["foot.instagram"]).toBe("zero in the loop on Instagram");
      const doc = fakeDocument();
      const link = doc.elements.find((e) => e.getAttribute("data-i18n-label") === "foot.instagram")!;
      site.applyLanguage(doc, "en", fakeStorage());
      expect(link.getAttribute("aria-label")).toBe("zero in the loop on Instagram");
      site.applyLanguage(doc, "es", fakeStorage());
      expect(link.getAttribute("aria-label")).toBe("Instagram de zero in the loop");
    });
  });
});

describe("sitio del proyecto: WhatsApp", () => {
  const WHATSAPP = "https://wa.me/5491159813335";
  const MESSAGE_ES = "Hola, quiero saber más sobre zero in the loop";
  const MESSAGE_EN = "Hi, I want to know more about zero in the loop";
  const NUMBER = "+54 9 11 5981-3335";
  const footer = /<footer class="foot">([\s\S]*?)<\/footer>/.exec(html)![1]!;
  const footerLink = /<a\b[^>]*\bdata-i18n-href="href\.whatsapp"[^>]*>([\s\S]*?)<\/a>/.exec(footer)!;
  const icon = /<svg\b[\s\S]*<\/svg>/.exec(footerLink[1]!)![0];

  /** Checks an anchor's opening tag: destination, decoded message, new tab and rel. */
  function expectLink(tag: string, message: string) {
    const url = new URL(/\shref="([^"]*)"/.exec(tag)![1]!);
    expect(url.origin + url.pathname).toBe(WHATSAPP);
    expect(url.searchParams.get("text")).toBe(message);
    expect(tag).toMatch(/\starget="_blank"/);
    expect(/\srel="([^"]*)"/.exec(tag)![1]!.split(/\s+/)).toContain("noopener");
  }

  /** The opening tag of the only anchor in some markup. */
  function onlyAnchor(markup: string): string {
    const anchors = markup.match(/<a\b[^>]*>/g) ?? [];
    expect(anchors).toHaveLength(1);
    return anchors[0]!;
  }

  it("el pie enlaza a WhatsApp con el mensaje en español, en otra pestaña", () => {
    expectLink(/^<a\b[^>]*>/.exec(footerLink[0])![0], MESSAGE_ES);
  });

  it("el enlace viene después de GitHub (e Instagram) y antes de la versión y el tema", () => {
    const at = footer.indexOf(footerLink[0]);
    expect(footer.indexOf('href="https://github.com/kaelen-phoenix/zero">GitHub</a>')).toBeGreaterThan(-1);
    expect(footer.indexOf('href="https://github.com/kaelen-phoenix/zero">GitHub</a>')).toBeLessThan(at);
    expect(footer.indexOf("instagram.com")).toBeLessThan(at);
    expect(at).toBeLessThan(footer.indexOf('id="version"'));
    expect(at).toBeLessThan(footer.indexOf("data-theme-choice"));
  });

  it("el ícono es decorativo, de un solo color y sin recursos externos", () => {
    expect(icon).toMatch(/<svg\b[^>]*\saria-hidden="true"/);
    const paints = [...icon.matchAll(/\s(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1]);
    expect(paints).toContain("currentColor");
    for (const paint of paints) expect(["none", "currentColor"]).toContain(paint);
    expect(icon).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(icon).not.toMatch(/\s(?:xlink:)?href=|\ssrc=|<image\b|<script\b/i);
  });

  it("el ícono tiene ancho y alto en styles.css", () => {
    const rule = /\.foot \.social svg\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/\bwidth:\s*[\d.]+\w+/);
    expect(rule).toMatch(/\bheight:\s*[\d.]+\w+/);
  });

  it("el enlace del pie no agrega texto visible", () => {
    expect(footerLink[1]!.replace(/<[^>]+>/g, "").trim()).toBe("");
  });

  it("el nombre accesible está en los dos idiomas", () => {
    expect(footerLink[0]).toMatch(/\saria-label="WhatsApp de zero in the loop"/);
    expect(footerLink[0]).toMatch(/\sdata-i18n-label="foot\.whatsapp"/);
    const site = loadSite();
    const doc = fakeDocument();
    const link = doc.elements.find((e) => e.getAttribute("data-i18n-label") === "foot.whatsapp")!;
    site.applyLanguage(doc, "en", fakeStorage());
    expect(link.getAttribute("aria-label")).toBe("zero in the loop on WhatsApp");
    site.applyLanguage(doc, "es", fakeStorage());
    expect(link.getAttribute("aria-label")).toBe("WhatsApp de zero in the loop");
  });

  it("el mensaje inicial sigue el idioma elegido", () => {
    const site = loadSite();
    const doc = fakeDocument();
    const link = doc.elements.find((e) => e.getAttribute("data-i18n-href") === "href.whatsapp")!;
    const markup = link.getAttribute("href")!;
    const message = () => {
      const url = new URL(link.getAttribute("href")!);
      expect(url.origin + url.pathname).toBe(WHATSAPP);
      return url.searchParams.get("text");
    };
    site.applyLanguage(doc, "en", fakeStorage());
    expect(message()).toBe(MESSAGE_EN);
    site.applyLanguage(doc, "es", fakeStorage());
    expect(link.getAttribute("href")).toBe(markup);
    expect(message()).toBe(MESSAGE_ES);
  });

  it("Capacitaciones ofrece WhatsApp con el número, en español", () => {
    const line = translatable(section("training")).find((t) => t.key === "training.whatsapp")!;
    expect(line.inner).toContain(NUMBER);
    expectLink(onlyAnchor(line.inner), MESSAGE_ES);
  });

  it("la línea de Capacitaciones tiene su versión en inglés", () => {
    const line = loadSite().EN["training.whatsapp"]!;
    expect(line).toContain(NUMBER);
    expectLink(onlyAnchor(line), MESSAGE_EN);
  });

  it("los tres formatos de Capacitaciones siguen igual", () => {
    expect([...section("training").matchAll(/data-training="([^"]+)"/g)].map((m) => m[1])).toEqual(["talk", "workshop", "mentoring"]);
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
    const keys = new Set([...translatable(html).map((t) => t.key), ...labels(html).map((l) => l.key), ...hrefs(html).map((h) => h.key), "meta.title"]);
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

  it("el nivel auto no promete despliegues que zero no hace", () => {
    const doc = fakeDocument();
    const auto = doc.elements.find((e) => e.getAttribute("data-i18n") === "autonomy.auto")!;
    for (const part of ["se integra", "autoMerge", "pull request"]) expect(auto.innerHTML).toContain(part);
    expect(auto.innerHTML).not.toMatch(/despleg|desplieg/i);
    for (const part of ["integrated", "autoMerge", "pull request"]) expect(site.EN["autonomy.auto"]).toContain(part);
    expect(site.EN["autonomy.auto"]).not.toMatch(/deploy/i);
    site.applyLanguage(doc, "en", fakeStorage());
    expect(auto.innerHTML).toBe(site.EN["autonomy.auto"]);
    expect(auto.innerHTML).not.toMatch(/deploy/i);
  });

  it("los enlaces al README siguen el idioma elegido", () => {
    const doc = fakeDocument();
    const links = doc.elements.filter((e) => e.getAttribute("data-i18n-href") === "href.readme");
    expect(links).toHaveLength(3);
    site.applyLanguage(doc, "en", fakeStorage());
    for (const el of links) expect(el.getAttribute("href")).toBe(README_EN);
    site.applyLanguage(doc, "es", fakeStorage());
    for (const el of links) expect(el.getAttribute("href")).toBe(README_ES);
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
  it.each(["README.md", "README.es.md"])("%s menciona el sitio, que vive en site/ y cómo lo publica Vercel", (file) => {
    const paragraph = read(file).split(/\n\s*\n/).find((p) => p.includes("zerointheloop.com"));
    expect(paragraph).toBeDefined();
    expect(paragraph).toContain("site/");
    expect(paragraph).toContain("Vercel");
  });

  it.each([["README.md", "Training"], ["README.es.md", "Capacitaciones"]])("%s menciona la sección %s del sitio", (file, name) => {
    const paragraph = read(file).split(/\n\s*\n/).find((p) => p.includes("zerointheloop.com"));
    expect(paragraph).toContain(name);
  });

  it.each([["README.md", "Spanish"], ["README.es.md", "español"]])("%s aclara que la sección está solo en la versión en español", (file, word) => {
    const paragraph = read(file).split(/\n\s*\n/).find((p) => p.includes("zerointheloop.com"));
    expect(paragraph).toContain(word);
  });

  it.each([["README.md", "email"], ["README.es.md", "correo"]])("%s dice que los botones abren el chat de Instagram, no un correo", (file, mail) => {
    const paragraph = read(file).split(/\n\s*\n/).find((p) => p.includes("zerointheloop.com"));
    expect(paragraph).toContain("Instagram");
    expect(paragraph).not.toContain(mail);
  });
});

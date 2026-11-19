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
const GENERIC_ES = "Hola, quiero saber más sobre zero in the loop";

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
  listeners: Record<string, (event?: { preventDefault(): void }) => void> = {};
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

/** The section markers, in document order. */
function markers(source: string): FakeElement[] {
  return [...source.matchAll(/<span class="marker" data-marker>(\d+)<\/span>/g)].map((m) => new FakeElement({ "data-marker": "" }, m[1]));
}

function fakeDocument() {
  const elements: FakeElement[] = [
    ...translatable(html).map((t) => new FakeElement({ "data-i18n": t.key }, t.inner)),
    ...labels(html).map((l) => new FakeElement({ "data-i18n-label": l.key, "aria-label": l.label })),
    ...hrefs(html).map((h) => new FakeElement({ "data-i18n-href": h.key, href: h.href })),
    new FakeElement({ "data-lang": "es" }), new FakeElement({ "data-lang": "en" }),
    ...["auto", "light", "dark"].map((t) => new FakeElement({ "data-theme-choice": t })),
    ...markers(html),
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
    expect(ids).toEqual(["hero", "synopsis", "line", "autonomy", "night-shift", "guarantees", "ci", "install", "workflow", "compatibility", "contact", "links"]);
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

  it("la sinopsis dice, después de la delegación, que zero libera tiempo para las personas", () => {
    const synopsis = section("synopsis");
    const time = translatable(synopsis).find((t) => t.key === "synopsis.time");
    expect(time?.inner.trim()).toBe("zero automatiza el desarrollo de software con IA, liberando tiempo para que las personas se enfoquen en estrategia, creatividad, supervisión y colaboración profesional.");
    expect(time!.inner).toContain("las personas");
    expect(synopsis.indexOf('data-i18n="synopsis.loop"')).toBeGreaterThanOrEqual(0);
    expect(synopsis.indexOf('data-i18n="synopsis.time"')).toBeGreaterThan(synopsis.indexOf('data-i18n="synopsis.loop"'));
    expect(loadSite().EN["synopsis.time"]).toBe("zero automates software development with AI, freeing people's time to focus on strategy, creativity, oversight and professional collaboration.");
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

  it("marca como en camino solo lo que falta de las próximas etapas", () => {
    const soon = [...html.matchAll(/<span class="soon" data-i18n="soon">([^<]*)<\/span>/g)];
    for (const s of soon) expect(s[1]).toBe("en camino");
    // Hoy no queda nada en camino, así que su traducción tampoco: vuelve con el próximo ítem pendiente.
    expect(loadSite().EN["soon"] !== undefined).toBe(soon.length > 0);
    const lines = html.split("\n").filter((l) => l.includes('class="soon"'));
    // Los motores ACP/OpenCode, Linear, Jira, el simulacro y el instalador ya están: ninguno sigue en camino.
    expect(lines.filter((l) => /instalador|installer/i.test(l))).toEqual([]);
    for (const item of ["next.engines", "next.linear", "next.intake", "next.regen"]) expect(lines.filter((l) => l.includes(`data-i18n="${item}"`)), item).toEqual([]);
  });

  it("da los motores ACP y OpenCode como disponibles, no en camino", () => {
    expect(html.split("\n").filter((l) => l.includes("next.engines") && l.includes('class="soon"'))).toEqual([]);
    const engines = html.split("\n").filter((l) => l.includes('data-i18n="next.engines"'));
    expect(engines).toHaveLength(1);
    expect(engines[0]).toContain('<span class="ready" data-i18n="ready">disponible</span>');
  });

  it("da los pedidos desde Jira como disponibles, no en camino", () => {
    const lines = html.split("\n");
    expect(lines.filter((l) => l.includes('class="soon"') && l.includes("Jira"))).toEqual([]);
    const intake = lines.filter((l) => l.includes('data-i18n="next.intake"'));
    expect(intake).toHaveLength(1);
    expect(/data-i18n="next\.intake">([^<]*)</.exec(intake[0]!)![1]).toBe("Pedidos desde Jira");
    expect(intake[0]).toContain('<span class="ready" data-i18n="ready">disponible</span>');
    expect(loadSite().EN["next.intake"]).toBe("Requests from Jira");
    const request = /<p data-i18n="workflow\.request">([^<]*)<\/p>/.exec(html)![1]!;
    for (const tracker of ["GitHub", "Linear", "Jira"]) {
      expect(request).toContain(tracker);
      expect(loadSite().EN["workflow.request"]).toContain(tracker);
    }
  });

  it("da la exportación OTLP como disponible, no en camino", () => {
    expect(html.split("\n").filter((l) => l.includes('class="soon"') && l.includes("OTLP"))).toEqual([]);
    expect(html).not.toContain("next.otlp");
    expect(loadSite().EN["next.otlp"]).toBeUndefined();
    expect(/<p data-i18n="workflow\.trace">([^<]*)<\/p>/.exec(html)![1]).toContain("OTLP");
    expect(loadSite().EN["workflow.trace"]).toContain("OTLP");
  });

  it("da los pedidos desde Linear como disponibles, no en camino", () => {
    const lines = html.split("\n");
    expect(lines.filter((l) => l.includes('class="soon"') && /linear/i.test(l))).toEqual([]);
    const linear = lines.filter((l) => l.includes('data-i18n="next.linear"'));
    expect(linear).toHaveLength(1);
    expect(linear[0]).toContain('<span class="ready" data-i18n="ready">disponible</span>');
    expect(loadSite().EN["ready"]).toBe("available");
    expect(loadSite().EN["next.linear"]).toContain("Linear");
    expect(loadSite().EN["next.intake"]).not.toContain("Linear");
  });

  it("da el simulacro de regeneración como disponible, no en camino", () => {
    const lines = html.split("\n");
    const regen = lines.filter((l) => l.includes('data-i18n="next.regen"'));
    expect(regen).toHaveLength(1);
    expect(regen[0]).toContain('<span class="ready" data-i18n="ready">disponible</span>');
    expect(lines.filter((l) => l.includes('class="soon"') && l.includes("next.regen"))).toEqual([]);
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

  it("muestra a la persona como un ícono de cabeza y hombros en el color de acento", () => {
    const owner = /<g class="owner">([\s\S]*?)<\/g>/.exec(svg);
    expect(owner).not.toBeNull();
    expect(owner![1]).toMatch(/<circle\b/);
    expect(owner![1]).toMatch(/<path\b/);
    expect(svg).not.toMatch(/<circle class="owner"/);
    const rules = [...css.matchAll(/\.line-fig \.owner\b(?!-)[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules.some((r) => /(?:fill|stroke):\s*var\(--accent\)/.test(r))).toBe(true);
    for (const rule of rules) {
      for (const color of rule.matchAll(/(?:^|;)\s*(?:fill|stroke):\s*([^;]+)/g)) expect(color[1]!.trim()).toMatch(/^(var\(--[\w-]+\)|none)$/);
    }
  });

  it("conserva el pulso suave de la persona", () => {
    const rule = /\.line-fig \.owner \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/animation:[^;]*\bpulse\b/);
    expect(rule).toMatch(/transform-origin:\s*360px 46px/);
    const pulse = /@keyframes pulse\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
    const scales = [...pulse.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(scales.length).toBeGreaterThan(0);
    for (const n of scales) expect(n).toBeLessThanOrEqual(1.35);
  });

  it("muestra el rótulo de la persona más grande y con más peso, también en celular", () => {
    const outside = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "");
    const rule = /\.line-fig \.owner-label \{([^}]*)\}/.exec(outside)![1]!;
    expect(Number(/font-size:\s*(\d+)px/.exec(rule)![1])).toBeGreaterThanOrEqual(15);
    expect(Number(/font-weight:\s*(\d+)/.exec(rule)![1])).toBeGreaterThanOrEqual(600);
    expect(rule).toMatch(/fill:\s*var\(--accent\)/);
    const mobile = /@media \(max-width: 40rem\)\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
    const small = /\.line-fig \.owner-label \{([^}]*)\}/.exec(mobile)![1]!;
    expect(Number(/font-size:\s*(\d+)px/.exec(small)![1])).toBeGreaterThanOrEqual(20);
    expect(svg).toMatch(/<text class="owner-label"[^>]*data-i18n="fig\.owner">vos<\/text>/);
    expect(loadSite().EN["fig.owner"]).toBe("you");
    const label = Number(/<text class="owner-label"[^>]*\by="([\d.]+)"/.exec(svg)![1]);
    const head = /<g class="owner">[\s\S]*?<circle\b[^>]*\bcy="([\d.]+)"[^>]*\br="([\d.]+)"/.exec(svg)!;
    expect(label).toBeLessThan(Number(head[1]) - Number(head[2]));
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

  it("muestra el instalador en un solo paso para cada sistema, cada bloque con su botón de copiar", () => {
    const install = section("install");
    const code = (id: string) => new RegExp(`<pre><code id="${id}">([\\s\\S]*?)</code></pre>`).exec(install)![1]!.replace(/&amp;/g, "&");
    expect(code("install-unix")).toBe("curl -fsSL https://zerointheloop.com/install.sh | sh");
    expect(code("install-windows")).toBe("irm https://zerointheloop.com/install.ps1 | iex");
    const blocks = [...install.matchAll(/<pre><code id="([^"]+)">/g)].map((m) => m[1]!);
    expect(blocks).toEqual(["install-unix", "install-windows", "install-code"]);
    for (const id of blocks) expect(install).toContain(`<button type="button" class="copy" data-copy="${id}"`);
    expect(install).not.toContain('class="soon"');
  });

  it("traduce cada texto de la sección de instalación", () => {
    const en = loadSite().EN;
    const keys = [...section("install").matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]!);
    expect(keys).toContain("install.oneStep");
    expect(keys).toContain("install.manual");
    for (const key of keys) expect(en[key], key).toBeTruthy();
    expect(en["install.installer"]).toBeUndefined();
    expect(en["next.installer"]).toBeUndefined();
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

describe("sitio del proyecto: contacto", () => {
  const WHATSAPP_CHAT = "https://wa.me/5491159813335";
  const INSTAGRAM_CHAT = "https://ig.me/m/zerointheloop";
  const GENERIC_EN = "Hi, I want to know more about zero in the loop";
  const FORBIDDEN = /capacitaci|training|charla abierta|taller grupal|mentor[ií]a|mentoring|workshop|la quiero|i want this/i;

  /** The contact section's anchors: opening tag and inner markup. */
  function links() {
    return [...section("contact").matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map((m) => ({ tag: m[1]!, inner: m[2]! }));
  }

  const hrefOf = (tag: string) => /\shref="([^"]*)"/.exec(tag)![1]!;
  const svgOf = (markup: string) => squash(/<svg\b[\s\S]*?<\/svg>/.exec(markup)![0]);

  it("ningún archivo del sitio menciona capacitaciones", () => {
    expect(textFiles.length).toBeGreaterThan(0);
    for (const { file, text } of textFiles) expect(text, file).not.toMatch(FORBIDDEN);
  });

  it("el marcado no deja restos de la sección de capacitaciones", () => {
    expect(html).not.toContain('<section id="training"');
    expect(html).not.toContain('href="#training"');
    expect(html).not.toMatch(/\bdata-training/);
  });

  it("main.js no tiene claves ni funciones de capacitaciones", () => {
    const site = loadSite();
    for (const key of Object.keys(site.EN)) {
      expect(key.startsWith("training."), key).toBe(false);
      expect(key).not.toBe("nav.training");
    }
    expect(site).not.toHaveProperty("setTrainingLinks");
    expect(site).not.toHaveProperty("copyTrainingMessage");
  });

  it("la sección va después de compatibilidad y antes de enlaces, con rótulo y título traducidos", () => {
    const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.indexOf("contact")).toBe(ids.indexOf("compatibility") + 1);
    expect(ids.indexOf("links")).toBe(ids.indexOf("contact") + 1);
    expect(html).toContain('<section id="contact" aria-labelledby="contact-h">');
    const contact = section("contact");
    expect(contact).toMatch(/<span class="marker" data-marker>10<\/span> <span data-i18n="contact\.label">Contacto<\/span>/);
    expect(contact).toMatch(/<h2 id="contact-h" data-i18n="contact\.title">/);
    const EN = loadSite().EN;
    expect(EN["contact.label"]).toBe("Contact");
    expect(EN["contact.title"]?.trim()).not.toBe("");
  });

  it("tiene solo dos enlaces, WhatsApp y después Instagram, en otra pestaña", () => {
    const found = links();
    expect(found).toHaveLength(2);
    for (const { tag } of found) {
      expect(tag).toMatch(/\sclass="button"/);
      expect(tag).toContain(' target="_blank"');
      expect(/\srel="([^"]*)"/.exec(tag)![1]!.split(/\s+/)).toContain("noopener");
    }
    expect(found.map(({ inner }) => squash(inner.replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ")))).toEqual(["WhatsApp", "Instagram"]);
    const whatsapp = new URL(hrefOf(found[0]!.tag));
    expect(whatsapp.origin + whatsapp.pathname).toBe(WHATSAPP_CHAT);
    expect(whatsapp.searchParams.get("text")).toBe(GENERIC_ES);
    expect(found[0]!.tag).toContain('data-i18n-href="href.whatsapp"');
    expect(hrefOf(found[1]!.tag)).toBe(INSTAGRAM_CHAT);
  });

  it("no ofrece ningún otro medio de contacto", () => {
    const contact = section("contact");
    expect(contact).not.toMatch(/<button|<form|<noscript|mailto:|tel:/);
    expect(contact).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(js).not.toContain("mailto:");
  });

  it("el enlace de WhatsApp sigue el idioma elegido", () => {
    const site = loadSite();
    const doc = fakeDocument();
    const contactHref = hrefOf(links()[0]!.tag);
    const link = doc.elements.find((e) => e.getAttribute("data-i18n-href") === "href.whatsapp" && e.getAttribute("href") === contactHref)!;
    const message = () => {
      const url = new URL(link.getAttribute("href")!);
      expect(url.origin + url.pathname).toBe(WHATSAPP_CHAT);
      return url.searchParams.get("text");
    };
    site.applyLanguage(doc, "en", fakeStorage());
    expect(message()).toBe(GENERIC_EN);
    site.applyLanguage(doc, "es", fakeStorage());
    expect(message()).toBe(GENERIC_ES);
  });

  it("cada ícono es el mismo que el del enlace de esa red en el pie", () => {
    const footer = /<footer class="foot">([\s\S]*?)<\/footer>/.exec(html)![1]!;
    const footerIcon = (href: RegExp) => svgOf([...footer.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].find((m) => href.test(/^<a\b[^>]*>/.exec(m[0])![0]))![0]);
    const [whatsapp, instagram] = links();
    expect(svgOf(whatsapp!.inner)).toBe(footerIcon(/wa\.me/));
    expect(svgOf(instagram!.inner)).toBe(footerIcon(/instagram\.com/));
    for (const { inner } of links()) expect(svgOf(inner)).toMatch(/^<svg\b[^>]*\saria-hidden="true"/);
  });

  it("los íconos tienen ancho y alto en styles.css", () => {
    const rule = /\.contact \.button svg\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/(^|[\s;])width:\s*[\d.]+[a-z]+/);
    expect(rule).toMatch(/(^|[\s;])height:\s*[\d.]+[a-z]+/);
  });

  it("el menú enlaza el contacto, junto a Docs y GitHub", () => {
    const header = /<header class="top">([\s\S]*?)<\/header>/.exec(html)![1]!;
    expect(header).toContain('<a href="#contact" data-i18n="nav.contact">Contacto</a>');
    expect(header.indexOf('href="#contact"')).toBeLessThan(header.indexOf(">Docs</a>"));
    expect(header.indexOf('href="#contact"')).toBeLessThan(header.indexOf(">GitHub</a>"));
    expect(header).not.toMatch(/<a\b[^>]*data-lang-only/);
    expect(loadSite().EN["nav.contact"]).toBe("Contact");
  });

  it("ningún elemento se muestra en un solo idioma", () => {
    expect(html).not.toMatch(/data-lang-only/);
  });

  it("la numeración de las secciones es correlativa en los dos idiomas", () => {
    const site = loadSite();
    const doc = fakeDocument();
    const storage = fakeStorage();
    const found = doc.elements.filter((e) => e.hasAttribute("data-marker"));
    const numbers = Array.from({ length: 11 }, (_, i) => String(i + 1).padStart(2, "0"));
    const [contact, last] = [found[9]!, found[10]!];
    expect(found.map((m) => m.textContent)).toEqual(numbers);
    for (const lang of ["es", "en", "es"]) {
      site.applyLanguage(doc, lang, storage);
      expect(found.map((m) => m.textContent), lang).toEqual(numbers);
      expect([contact.textContent, last.textContent]).toEqual(["10", "11"]);
      expect(doc.elements.some((e) => e.hasAttribute("hidden")), lang).toBe(false);
    }
  });

  it("no hay capacitaciones para empresas en ninguna parte del sitio", () => {
    for (const { file, text } of textFiles) expect(text, file).not.toMatch(/empresa|compan(y|ies)/i);
  });

  it("no queda rastro de la dirección de correo en ningún archivo del sitio", () => {
    for (const { file, text } of textFiles) {
      for (const trace of ["mailto:", "kaelen.dev", "gmail.com"]) expect(text, `${file}: ${trace}`).not.toContain(trace);
    }
  });

  it("styles.css oculta [hidden] aunque una clase fije display", () => {
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none/);
  });
});

describe("sitio del proyecto: compatibilidad, encabezado y pie", () => {
  it("lista los motores y clientes de hoy, y nada más", () => {
    const compat = section("compatibility");
    const items = [...compat.matchAll(/data-item="([^"]+)"/g)].map((m) => m[1]);
    expect(items).toEqual(["claude", "codex", "antigravity", "opencode", "acp", "custom-cli", "claude-code", "codex", "opencode", "terminal"]);
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
  const MESSAGE_ES = GENERIC_ES;
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

  it("el contacto no muestra el número de WhatsApp", () => {
    expect(section("contact")).not.toContain(NUMBER);
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
    const names = ["zero", "Docs", "GitHub", "ES", "EN", "zero in the loop", "SH", "Claude", "Agent SDK", "Codex", "CLI", "Antigravity", "ACP", "Claude Code", "OpenCode", "Terminal", "v", "0.1.0", "Apache-2.0", "WhatsApp", "Instagram", "macOS · Linux", "Windows · PowerShell"];
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

  it.each([["README.md", "contact", "email"], ["README.es.md", "contacto", "correo"]])("%s dice que el sitio tiene un %s por WhatsApp e Instagram, sin capacitaciones", (file, contact, mail) => {
    const paragraph = read(file).split(/\n\s*\n/).find((p) => p.includes("zerointheloop.com"))!;
    expect(paragraph).not.toMatch(/training|capacitaci/i);
    for (const part of ["WhatsApp", "Instagram", "site/", "Vercel"]) expect(paragraph).toContain(part);
    expect(paragraph.toLowerCase()).toContain(contact);
    expect(paragraph).not.toContain(mail);
  });
});

import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { requestWork } from "../src/app.js";
import { saveBoxStatus } from "../src/box/status.js";
import { esc } from "../src/panel/html.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

async function panel(over: Record<string, unknown> = {}, before?: (ctx: ReturnType<typeof testFactory>) => void) {
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...over });
  before?.(ctx);
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string, headers: Record<string, string> = { cookie }) => fetch(base + path, { headers, redirect: "manual" });
  const text = async (path: string) => {
    const r = await get(path);
    expect(r.status).toBe(200);
    return r.text();
  };
  return { ctx, base, cookie, get, text };
}

/** The visible text, without tags, so phrases split by markup still match. */
const plain = (html: string) => html.replace(/<[^>]+>/g, "");

/** The section of /agents that holds one station's card. */
const card = (html: string, station: string) => html.split(`class="card agent" data-station="${station}"`)[1]!.split('class="card')[0]!;

describe("panel guide pages", () => {
  it("adds both tabs to the menu", async () => {
    const p = await panel();
    const home = await p.text("/");
    expect(home).toMatch(/<a href="\/about"[^>]*><svg[^>]*>[\s\S]*?<\/svg><span class="lb">Qué es zero<\/span><\/a>/);
    expect(home).toMatch(/<a href="\/agents"[^>]*><svg[^>]*>[\s\S]*?<\/svg><span class="lb">Agentes<\/span><\/a>/);
  });

  it("asks for the session and shows no factory data without it", async () => {
    const p = await panel();
    for (const path of ["/about", "/agents"]) {
      const r = await p.get(path, {});
      expect(r.status).toBe(401);
      const html = await r.text();
      expect(html).toContain("Panel de tu fábrica");
      expect(html).not.toContain("tienda");
      expect(html).not.toContain("claude");
    }
  });

  it("is read-only: no forms, and a POST changes nothing", async () => {
    const p = await panel();
    for (const path of ["/about", "/agents"]) {
      // The side menu's collapse checkbox is the only input: it changes nothing but the menu.
      const html = (await p.text(path)).replace('<input type="checkbox" id="nav-toggle" class="nav-toggle">', "");
      for (const tag of ["<form", "<textarea", "<input", "<select"]) expect(html).not.toContain(tag);
    }
    const before = readFileSync(p.ctx.home.config, "utf8");
    for (const path of ["/agents", "/about"]) {
      const r = await fetch(p.base + path, { method: "POST", headers: { cookie: p.cookie, origin: p.base, "content-type": "application/x-www-form-urlencoded" }, body: "level=L0", redirect: "manual" });
      expect(r.status).toBe(404);
    }
    expect(readFileSync(p.ctx.home.config, "utf8")).toBe(before);
    expect(p.ctx.store.listJobs()).toHaveLength(0);
  });

  it("explains zero and draws the path of a request in order", async () => {
    const html = await (await panel()).text("/about");
    expect(html).toContain("fábrica de software");
    expect(html).toContain("pedidos");
    const ol = /<ol class="route">([\s\S]*?)<\/ol>/.exec(html)![1]!;
    const steps = [...ol.matchAll(/<li><b>([^<]+)<\/b><span>([^<]*)<\/span><\/li>/g)];
    expect(steps.map((s) => s[1])).toEqual(["especificación", "construcción", "verificación", "revisión", "seguridad", "integración"]);
    for (const s of steps) expect(s[2]!.trim()).not.toBe("");
  });

  it("says how long it waits and what happens without an answer", async () => {
    const approve = plain(await (await panel({ approvals: { timeoutHours: 6, onTimeout: "approve" } })).text("/about"));
    expect(approve).toContain("hasta 6 horas");
    expect(approve).toContain("la fábrica aprueba sola");
    const reject = plain(await (await panel({ approvals: { timeoutHours: 6, onTimeout: "reject" } })).text("/about"));
    expect(reject).toContain("el trabajo se rechaza y se detiene");
    expect(reject).not.toContain("aprueba sola");
  });

  it("lists when the factory asks at the effective level", async () => {
    const l1 = plain(await (await panel({ level: "L1", isolation: "worktree" })).text("/about"));
    expect(l1).toContain("apruebes la especificación");
    expect(l1).toContain("ruta protegida");
    const l3 = plain(
      await (
        await panel({ level: "L3", isolation: "container" }, (ctx) => {
          saveBoxStatus(ctx.store, { ready: true, runtime: "podman", image: "t", problems: [], checkedAt: "" });
          ctx.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "tok-value-123");
        })
      ).text("/about"),
    );
    expect(l3).toContain("Nivel efectivo: L3");
    expect(l3).toContain("nunca te consulta");
    expect(l3).toContain("el trabajo se detiene");
    expect(l3).not.toContain("apruebes la especificación");
    expect(l3).toContain("Caja de aislamiento: activa");
  });

  it("names the four request channels and each line's label", async () => {
    const html = await (await panel({ lines: [{ name: "tienda", repo: gitRepo(), issues: { label: "zero" } }] })).text("/about");
    for (const word of ["chat", "terminal", "panel", "GitHub"]) expect(html).toContain(word);
    expect(html).toContain("etiqueta <b>zero</b>");
  });

  it("shows the real configuration", async () => {
    const p = await panel({ level: "L3", isolation: "worktree", engine: "claude", limits: { usdPerDay: 10, usdPerJob: 3 } });
    const html = plain(await p.text("/about"));
    expect(html).toContain("Nivel de autonomía configurado: L3");
    expect(html).toContain("Nivel efectivo: L2");
    expect(html).toContain("L3 requiere la caja de aislamiento");
    expect(html).toContain("Motor: claude");
    expect(html).toContain("$10.00");
    expect(html).toContain("$3.00");
    expect(html).toContain("Caja de aislamiento: no está activa");
    expect(html).toContain("Líneas: 1");
  });

  it("shows one card per agent station with its engine, model, limits and access", async () => {
    const p = await panel({ stations: { security: { engine: "codex", model: "gpt-x", timeoutMinutes: 20, maxTurns: 30 } } });
    const html = await p.text("/agents");
    const order = [...html.matchAll(/class="card agent" data-station="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["spec", "build", "review", "security", "reply", "scout", "research"]);
    expect(html).not.toContain("community");
    const security = plain(card(html, "security"));
    expect(security).toContain("Motor: codex");
    expect(security).toContain("Modelo: gpt-x");
    expect(security).toContain("Máximo de turnos: 30");
    expect(security).toContain("Máximo de minutos: 20");
    const spec = plain(card(html, "spec"));
    expect(spec).toContain("Motor: claude");
    expect(spec).toContain("el predeterminado del motor");

    expect(card(html, "build")).toContain("puede modificar el código");
    expect(card(html, "build")).not.toContain("solo lectura");
    for (const s of ["spec", "review", "security"]) expect(card(html, s)).toContain("solo lectura");
  });

  it("unfolds each station's original instructions, escaped", async () => {
    const html = await (await panel()).text("/agents");
    for (const s of ["spec", "build", "review", "security"]) {
      const c = card(html, s);
      expect(c).toContain("<summary>ver instrucciones completas</summary>");
      expect(c).toContain(esc(readFileSync(new URL(`../agents/${s}.md`, import.meta.url), "utf8")));
    }
    expect(html).toContain("# Station: build — Kaelen zero");
  });

  it("shows a card per line, or that there are none", async () => {
    const repo = gitRepo();
    const html = await (
      await panel({ lines: [{ name: "tienda", repo, baseBranch: "main", verify: ["npm test"], integrate: "pull-request", autoMerge: true, issues: { label: "zero" } }] })
    ).text("/agents");
    const lines = plain(html.split("<h2>Líneas</h2>")[1]!);
    for (const text of ["tienda", repo, "Rama base: main", "npm test", "Entrega: pull request", "Se funde sola", "etiqueta zero", ".github/**"]) expect(lines).toContain(text);

    const branch = plain((await (await panel({ lines: [{ name: "tienda", repo, integrate: "branch" }] })).text("/agents")).split("<h2>Líneas</h2>")[1]!);
    expect(branch).toContain("Entrega: rama");
    expect(branch).toContain("No se funde sola");
    expect(branch).toContain("No toma issues de GitHub");
    expect(plain((await (await panel({ lines: [] })).text("/agents")).split("<h2>Líneas</h2>")[1]!)).toContain("Todavía no hay líneas");
  });

  it("lists each line's own agents in running order, with their type and escaped patterns", async () => {
    const repo = gitRepo();
    const html = await (
      await panel({ lines: [{ name: "tienda", repo, agents: [{ name: "a11y" }, { name: "docs", type: "build", files: ["<site>/**"] }] }] })
    ).text("/agents");
    const line = html.split("<h2>Líneas</h2>")[1]!;
    expect(line.indexOf('data-agent="docs"')).toBeGreaterThan(-1);
    expect(line.indexOf('data-agent="docs"')).toBeLessThan(line.indexOf('data-agent="a11y"'));
    const [docs, a11y] = line.split('data-agent="a11y"') as [string, string];
    expect(docs).toContain("modifica el código");
    expect(docs).toContain(esc("<site>/**"));
    expect(line).not.toContain("<site>");
    expect(a11y).toContain("solo lectura");
    expect(plain(line)).not.toContain("No tiene agentes a medida");
  });

  it("says when a line has no agents of its own", async () => {
    expect(plain((await (await panel()).text("/agents")).split("<h2>Líneas</h2>")[1]!)).toContain("No tiene agentes a medida");
  });

  it("never shows keys or secrets", async () => {
    const p = await panel(
      { level: "L3", isolation: "container", engine: "mine", engines: { mine: { command: ["mine-cli", "--token-from-env"], secrets: ["MY_API_TOKEN"] } } },
      (ctx) => {
        saveBoxStatus(ctx.store, { ready: true, runtime: "podman", image: "t", problems: [], checkedAt: "" });
        ctx.secrets.set("OTHER_SECRET", "s3cr3t-value-xyz");
      },
    );
    const key = panelKey(p.ctx.secrets);
    for (const path of ["/about", "/agents"]) {
      const html = await p.text(path);
      for (const hidden of [key, sessionFor(key), "s3cr3t-value-xyz", "MY_API_TOKEN", "mine-cli"]) expect(html).not.toContain(hidden);
    }
  });

  it("uses the phone layout and the same security headers", async () => {
    const p = await panel();
    const about = await p.text("/about");
    expect(about).toContain(`<meta name="viewport" content="width=device-width, initial-scale=1">`);
    expect(about).toMatch(/@media \(max-width: \d+px\) \{[^}]*ol\.route/);
    for (const path of ["/about", "/agents"]) expect(await p.text(path)).not.toMatch(/ on[a-z]+=/);
    const csp = (r: Response) => r.headers.get("content-security-policy")!.replace(/'nonce-[^']+'/, "'nonce'");
    expect(csp(await p.get("/agents"))).toBe(csp(await p.get("/")));
  });
});

const SECTIONS = ["/", "/line", "/egress", "/proposals", "/research", "/monitor", "/briefing", "/report", "/about", "/agents"];
const sideNav = (html: string) => {
  const navs = html.match(/<nav class="side"[\s\S]*?<\/nav>/g) ?? [];
  expect(navs).toHaveLength(1);
  return navs[0]!;
};
const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;

describe("panel layout and brand", () => {
  it("puts the side menu on every page, with an icon and a label per section and the current one marked", async () => {
    const p = await panel();
    for (const path of ["/", "/line", "/proposals", "/research", "/report", "/about", "/agents"]) {
      const html = await p.text(path);
      const nav = sideNav(html);
      expect([...nav.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])).toEqual(SECTIONS);
      for (const link of nav.match(/<a [\s\S]*?<\/a>/g)!) {
        expect(link).toMatch(/<svg[^>]*aria-hidden="true"/);
        expect(link).toMatch(/<span class="lb">[^<]+<\/span>/);
      }
      expect([...html.matchAll(/<a href="([^"]+)" aria-current="page"/g)].map((m) => m[1])).toEqual([path]);
      expect(html.match(/<[a-z][^>]*\saria-current=/gi)).toHaveLength(1);
      expect(html).toContain(`<meta name="viewport" content="width=device-width, initial-scale=1">`);
    }
  });

  it("collapses with a checkbox and a label, and turns into a dropdown on a phone, all in CSS", async () => {
    const p = await panel();
    const html = await p.text("/");
    expect(html).toContain(`<input type="checkbox" id="nav-toggle"`);
    expect(html).toMatch(/<label for="nav-toggle"[^>]*aria-label="[^"]+"/);
    const css = styleOf(html);
    expect(css).toMatch(/#nav-toggle:checked ~ \.side \{[^}]*width:/);
    expect(css).toMatch(/#nav-toggle:checked ~ \.side \.lb[^{]*\{[^}]*display:none/);
    const phone = /@media \(max-width: \d+px\) \{\n([\s\S]*?)\n\}/.exec(css)![1]!;
    expect(phone).toMatch(/\.side ul\.links \{[^}]*display:none/);
    expect(phone).toMatch(/#nav-toggle:checked ~ \.side ul\.links \{[^}]*display:flex;[^}]*flex-direction:column/);
    expect(await p.text("/about")).not.toContain("<script");
    for (const path of ["/about", "/line"]) expect([...(await p.text(path)).matchAll(/<[a-z][^>]*>/gi)].some((t) => /\son[a-z]+=/i.test(t[0]))).toBe(false);
  });

  it("uses the site's palette, fonts and logo, in light and dark", async () => {
    const p = await panel();
    const html = await p.text("/");
    const css = styleOf(html);
    for (const color of ["#fbfbf9", "#111111", "#a8360b", "#0e0e0f", "#ececea", "#ff8a5c"]) expect(css).toContain(color);
    expect(css).toMatch(/--sans:\s*system-ui/);
    expect(css).toMatch(/--mono:\s*ui-monospace/);
    expect(css).toMatch(/color-scheme:\s*light dark/);
    const dark = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?\})\s*\}/.exec(css)![1]!;
    for (const token of ["--bg:", "--fg:", "--accent:", "--st-ok:", "--st-bad:", "--st-waiting:", "--st-active:"]) expect(dark).toContain(token);
    const login = await (await p.get("/", {})).text();
    expect(login).not.toContain(`<nav class="side"`);
    for (const page of [html, login]) {
      expect(page).toMatch(/<svg class="logo"[^>]*>(?:(?!<\/svg>)[\s\S])*<circle(?:(?!<\/svg>)[\s\S])*#ff8a5c/);
      expect(page).not.toContain("<img");
    }
  });

  it("loads nothing from outside and keeps the same policy", async () => {
    const p = await panel();
    for (const path of ["/", "/line", "/about", "/agents"]) {
      const html = await p.text(path);
      for (const outside of ["<link ", "<img", "@import", "url(http", 'src="http']) expect(html, `${path}: ${outside}`).not.toContain(outside);
    }
    const csp = async (path: string) => (await p.get(path)).headers.get("content-security-policy")!.replace(/'nonce-[^']+'/, "'nonce'");
    const home = await csp("/");
    expect(home).toMatch(/default-src 'none'.*script-src 'nonce'.*frame-ancestors 'none'/);
    for (const path of ["/line", "/agents"]) expect(await csp(path)).toBe(home);
    for (const path of ["/proposals", "/about"]) expect((await p.get(path, {})).status).toBe(401);
  });

  it("shows each job's status as a chip on the overview", async () => {
    const p = await panel();
    requestWork(p.ctx, { text: "en cola" });
    const { job } = requestWork(p.ctx, { text: "listo" });
    p.ctx.store.finishJob(job.id, "delivered", { delivery: { mode: "branch", branch: "zero/x" } });
    const html = await p.text("/");
    expect(html).toContain(`class="chip" data-status="queued"`);
    expect(html).toContain(`class="chip" data-status="delivered"`);
  });
});

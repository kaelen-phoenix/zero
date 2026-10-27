import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(home).toContain(`<a href="/about">Qué es zero</a>`);
    expect(home).toContain(`<a href="/agents">Agentes</a>`);
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
      const html = await p.text(path);
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
    expect(order).toEqual(["spec", "build", "review", "security", "reply"]);
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

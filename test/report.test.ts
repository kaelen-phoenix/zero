import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { monthlyReport, requestWork, saveReport, type FactoryContext } from "../src/app.js";
import { BILLING_SERVICES, billingKey, type BillingRecord } from "../src/billing/records.js";
import { factoryHome } from "../src/home.js";
import { finalizeJob } from "../src/line/finish.js";
import { createZeroMcpServer } from "../src/mcp/server.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { monthlyMarkdown, previousMonth, reportFileName, reportHtml, reportMarkdown, type LineReport } from "../src/report.js";
import type { Delivery, Job, JobSource } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, gitIn, gitRepo, tempDir, testFactory, validSpec } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const OCT_1 = new Date(2026, 9, 1, 9);

/** A factory with two lines and a clock the tests move, so createdAt and finishedAt are exact. */
function factory(lines?: { name: string; repo: string; services?: Record<string, unknown> }[]) {
  const clock = { at: new Date(2026, 10, 15, 12) };
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: lines ?? [{ name: "tienda", repo: gitRepo() }, { name: "blog", repo: gitRepo() }] }, () => clock.at);
  return { ctx, clock };
}

interface JobInput {
  line?: string;
  title?: string;
  request?: string;
  summary?: string;
  status?: "delivered" | "failed" | "stopped";
  at?: Date;
  ms?: number;
  attempt?: number;
  costUsd?: number;
  delivery?: Delivery;
  source?: JobSource;
  reason?: string;
  worktree?: string;
  billing?: { billing?: string; usd: number }[];
}

let spanId = 0;

/** A finished job, opened `ms` before `at` and closed exactly at `at`. */
async function finished(f: { ctx: FactoryContext; clock: { at: Date } }, input: JobInput = {}): Promise<Job> {
  const at = input.at ?? OCT_1;
  f.clock.at = new Date(at.getTime() - (input.ms ?? 3_600_000));
  const { job } = requestWork(f.ctx, { text: input.request ?? input.title ?? "pedido", line: input.line ?? "tienda", source: input.source });
  f.ctx.store.updateJob(job.id, {
    title: input.title ?? null,
    spec: input.summary === undefined ? null : validSpec({ summary: input.summary }),
    attempt: input.attempt ?? 1,
    costUsd: input.costUsd ?? 0,
    worktree: input.worktree ?? null,
  });
  for (const b of input.billing ?? []) {
    f.ctx.store.insertSpan({ id: `span-${++spanId}`, jobId: job.id, name: AGENT_SPAN, start: f.clock.at.toISOString(), attrs: { "zero.cost.usd": b.usd, ...(b.billing ? { "zero.billing": b.billing } : {}) } });
  }
  f.clock.at = at;
  return finalizeJob(f.ctx, f.ctx.store.getJob(job.id)!, input.status ?? "delivered", { delivery: input.status && input.status !== "delivered" ? undefined : (input.delivery ?? { mode: "branch", branch: "zero/x" }), reason: input.reason });
}

const one = (f: { ctx: FactoryContext }, line = "tienda", month = "2026-10"): LineReport => monthlyReport(f.ctx, { line, month }).lines[0]!;

describe("monthly report: jobs of the month", () => {
  it("takes only this line's jobs finished inside the local month", async () => {
    const f = factory();
    await finished(f, { title: "Dentro", at: new Date(new Date(2026, 10, 1).getTime() - 1) });
    await finished(f, { title: "Del mes siguiente", at: new Date(2026, 10, 1) });
    await finished(f, { title: "De otra línea", line: "blog", at: OCT_1 });
    expect(one(f).jobs.map((j) => j.title)).toEqual(["Dentro"]);
  });

  it("ignores queued, running and waiting jobs", () => {
    const f = factory();
    f.clock.at = OCT_1;
    const queued = requestWork(f.ctx, { text: "en cola", line: "tienda" }).job;
    const running = requestWork(f.ctx, { text: "en curso", line: "tienda" }).job;
    const waiting = requestWork(f.ctx, { text: "esperando", line: "tienda" }).job;
    f.ctx.store.updateJob(running.id, { status: "running", attempt: 2, costUsd: 1 });
    f.ctx.store.updateJob(waiting.id, { status: "waiting", costUsd: 1 });
    expect(queued.status).toBe("queued");
    const report = one(f);
    expect(report.jobs).toEqual([]);
    expect(report.totals).toMatchObject({ delivered: 0, attempts: 0, ms: 0, costUsd: 0 });
  });
});

describe("monthly report: month and lines", () => {
  it("defaults to the previous calendar month, across the year", () => {
    expect(previousMonth(new Date(2026, 0, 15))).toBe("2025-12");
    const f = factory();
    f.clock.at = new Date(2026, 0, 15);
    expect(monthlyReport(f.ctx).month).toBe("2025-12");
  });

  it.each(["2026-13", "2026-1", "2026-00", "octubre", ""])("rejects the month %j in Spanish", (month) => {
    const f = factory();
    expect(() => monthlyReport(f.ctx, { month })).toThrow(/AAAA-MM/);
  });

  it("brings every configured line, even without activity, with totals in zero", async () => {
    const f = factory();
    await finished(f, { title: "Hecho", costUsd: 1 });
    const report = monthlyReport(f.ctx, { month: "2026-10" });
    expect(report.lines.map((l) => l.line)).toEqual(["tienda", "blog"]);
    expect(report.lines[1]!.totals).toEqual({ delivered: 0, failed: 0, stopped: 0, attempts: 0, ms: 0, costUsd: 0, subscriptionUsd: 0 });
  });

  it("includes a line no longer configured that finished jobs that month, and rejects an unknown one", async () => {
    const f = factory([{ name: "tienda", repo: gitRepo() }, { name: "blog", repo: gitRepo() }, { name: "retirada", repo: gitRepo() }]);
    await finished(f, { title: "Vieja", line: "retirada" });
    f.ctx.config.lines = f.ctx.config.lines.filter((l) => l.name !== "retirada");
    expect(monthlyReport(f.ctx, { month: "2026-10" }).lines.map((l) => l.line)).toEqual(["tienda", "blog", "retirada"]);
    expect(one(f, "retirada").jobs.map((j) => j.title)).toEqual(["Vieja"]);
    expect(() => monthlyReport(f.ctx, { month: "2026-09", line: "retirada" })).toThrow(/retirada/);
    expect(() => monthlyReport(f.ctx, { month: "2026-10", line: "fantasma" })).toThrow(/La línea "fantasma" no está configurada/);
  });
});

describe("monthly report: each delivered job", () => {
  it("shows the title, the summary and both dates", async () => {
    const f = factory();
    await finished(f, { title: "Login", summary: "Vas a poder entrar con Google.", ms: 2 * 86_400_000, at: new Date(2026, 9, 5, 12) });
    const row = reportMarkdown(one(f)).split("\n").find((l) => l.startsWith("- **Login"))!;
    for (const text of ["Vas a poder entrar con Google.", "2026-10-03", "2026-10-05"]) expect(row).toContain(text);
  });

  it("shows a placeholder when no spec was stored", async () => {
    const f = factory();
    await finished(f, { title: "Sin spec" });
    expect(reportMarkdown(one(f))).toContain("(sin descripción guardada)");
  });

  it("names each origin with its own label", async () => {
    const f = factory();
    const sources: (JobSource | undefined)[] = [
      undefined,
      { kind: "github-issue", repository: "o/r", number: 12, url: "https://github.com/o/r/issues/12" },
      { kind: "night-shift", proposal: "p1" },
      { kind: "night-shift", proposal: "p2", autonomy: "build" },
      { kind: "research", note: "n1" },
      { kind: "jira-issue", site: "https://acme.atlassian.net", key: "ABC-7", url: "https://acme.atlassian.net/browse/ABC-7" },
    ];
    for (const source of sources) await finished(f, { title: "x", source });
    const origins = one(f).jobs.map((j) => j.origin);
    expect(new Set(origins).size).toBe(6);
    expect(origins).toContain("Issue de Jira ABC-7");
    expect(origins.find((o) => o.includes("#12"))).toContain("Issue de GitHub");
    expect(origins).toContain("Pedido de la persona responsable");
    expect(origins).toContain("Investigación");
    expect(origins).toContain("Propuesta del turno nocturno aprobada por la persona responsable");
    expect(origins).toContain("Propuesta que el turno nocturno tomó por su cuenta");
  });

  it("links the pull request even when it has a commit", async () => {
    const f = factory();
    await finished(f, { title: "x", delivery: { mode: "pull-request", branch: "zero/x", url: "https://github.com/o/r/pull/3", commit: "abcdef1234567890" } });
    expect(reportMarkdown(one(f))).toContain("(https://github.com/o/r/pull/3)");
    expect(reportHtml(one(f))).toContain('href="https://github.com/o/r/pull/3"');
  });

  it("links the commit on a GitHub remote", async () => {
    const repo = gitRepo();
    gitIn(repo, "remote", "add", "origin", "https://github.com/o/r.git");
    const f = factory([{ name: "tienda", repo }]);
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    await finished(f, { title: "x", delivery: { mode: "merge", branch: "zero/x", commit: sha } });
    expect(reportMarkdown(one(f))).toContain(`(https://github.com/o/r/commit/${sha})`);
  });

  it("shows the short commit as text without a GitHub remote", async () => {
    const f = factory();
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    await finished(f, { title: "x", delivery: { mode: "merge", branch: "zero/x", commit: sha } });
    const report = one(f);
    expect(report.jobs[0]!.link).toEqual({ text: "abcdef12" });
    expect(reportMarkdown(report)).toContain("Entrega: abcdef12");
    expect(reportMarkdown(report)).not.toContain(sha);
    expect(reportHtml(report)).not.toContain("/commit/");
  });

  it("shows only the branch as text", async () => {
    const f = factory();
    await finished(f, { title: "x", delivery: { mode: "branch", branch: "zero/x" } });
    expect(one(f).jobs[0]!.link).toEqual({ text: "zero/x" });
    expect(reportMarkdown(one(f))).toContain("Entrega: zero/x");
  });

  it("never links an address that is not on the web", async () => {
    const f = factory();
    await finished(f, { title: "x", delivery: { mode: "pull-request", branch: "zero/x", url: "javascript:alert(1)" } });
    const html = reportHtml(one(f));
    expect(html).toContain("javascript:alert(1)");
    expect(html).not.toMatch(/href="javascript/i);
    expect(reportMarkdown(one(f))).not.toContain("](javascript");
  });
});

describe("monthly report: totals", () => {
  async function mixed() {
    const f = factory();
    await finished(f, { title: "Entregado", attempt: 2, costUsd: 1.25, ms: 2 * 3_600_000 });
    await finished(f, { title: "Título fallido", status: "failed", attempt: 3, costUsd: 0.5, ms: 3_600_000, reason: "motivo secreto del fallo" });
    await finished(f, { title: "Título detenido", status: "stopped", attempt: 0, costUsd: 0.25, ms: 1_800_000, reason: "motivo secreto del freno" });
    return f;
  }

  it("adds exactly, failed and stopped included and apart", async () => {
    const f = await mixed();
    const report = one(f);
    expect(report.totals).toMatchObject({ delivered: 1, failed: 1, stopped: 1, attempts: 5, ms: 3.5 * 3_600_000, costUsd: 2 });
    const md = reportMarkdown(report);
    for (const text of ["Trabajos entregados: 1", "Intentos: 5", "Tiempo: 3 h 30 min", "Costo del mes: $2.00", "fallidos: 1, detenidos: 1", "incluidos los fallidos y los detenidos", "incluye las esperas"]) expect(md).toContain(text);
  });

  it("keeps failed and stopped titles out of the list and their reasons out of everything", async () => {
    const f = await mixed();
    for (const out of [reportMarkdown(one(f)), reportHtml(one(f))]) {
      for (const text of ["Título fallido", "Título detenido", "motivo secreto"]) expect(out).not.toContain(text);
    }
  });

  it("says a month without jobs had no deliveries, with every total in zero", () => {
    const md = reportMarkdown(one(factory()));
    for (const text of ["No hubo trabajos entregados", "Trabajos entregados: 0", "Intentos: 0", "Tiempo: 0 min", "Costo del mes: $0.00", "fallidos: 0, detenidos: 0"]) expect(md).toContain(text);
  });
});

describe("monthly report: subscription cost", () => {
  it("says all of it is an estimate that was not charged", async () => {
    const f = factory();
    await finished(f, { title: "x", costUsd: 3, billing: [{ billing: "subscription", usd: 3 }] });
    const md = reportMarkdown(one(f));
    expect(md).toContain("$3.00");
    expect(md).toContain("estimado con suscripción");
    expect(md).toContain("no se cobró");
  });

  it("does not mention it on per-use billing", async () => {
    const f = factory();
    await finished(f, { title: "x", costUsd: 3, billing: [{ billing: "api", usd: 3 }] });
    const md = reportMarkdown(one(f));
    expect(md).toContain("$3.00");
    expect(md).not.toMatch(/suscripción/i);
    expect(reportHtml(one(f))).not.toMatch(/suscripción/i);
  });

  it("separates a mix", async () => {
    const f = factory();
    await finished(f, { title: "x", costUsd: 3, billing: [{ billing: "subscription", usd: 2 }, { billing: "api", usd: 1 }] });
    const md = reportMarkdown(one(f));
    expect(md).toContain("$3.00");
    expect(md).toContain("$2.00 son estimados con suscripción y no se cobraron");
  });

  it("does not count a call without billing data as subscription", async () => {
    const f = factory();
    await finished(f, { title: "x", costUsd: 3, billing: [{ usd: 1 }, { billing: "subscription", usd: 2 }] });
    expect(one(f).totals.subscriptionUsd).toBe(2);
    expect(reportMarkdown(one(f))).toContain("$2.00 son estimados");
  });

  it("only reads the spans of the agents", async () => {
    const f = factory();
    const job = await finished(f, { title: "x", costUsd: 1, billing: [{ billing: "api", usd: 1 }] });
    f.ctx.store.insertSpan({ id: `span-${++spanId}`, jobId: job.id, name: "zero.station", start: job.createdAt, attrs: { "zero.cost.usd": 9, "zero.billing": "subscription" } });
    expect(one(f).totals.subscriptionUsd).toBe(0);
  });
});

describe("monthly report: code only", () => {
  it("gives the same text twice and writes nothing", async () => {
    const f = factory();
    const job = await finished(f, { title: "x", summary: "y", costUsd: 1, billing: [{ billing: "api", usd: 1 }] });
    const state = () => JSON.stringify([f.ctx.store.listJobs(), f.ctx.store.spansForJob(job.id), f.ctx.store.kvWithPrefix("")]);
    const before = state();
    const first = monthlyMarkdown(monthlyReport(f.ctx, { month: "2026-10" }));
    expect(monthlyMarkdown(monthlyReport(f.ctx, { month: "2026-10" }))).toBe(first);
    expect(state()).toBe(before);
  });

  it("is never generated by the daemon, and the renderer has nothing to send with", () => {
    const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
    expect(source("daemon.ts")).not.toContain("monthlyReport");
    expect(source("report.ts")).not.toMatch(/\bfetch\b|intake\/|githubIssues|signedIssues/);
  });
});

describe("monthly report: nothing private", () => {
  it("drops a credential from the Markdown and the HTML", async () => {
    const f = factory();
    const token = `ghp_${"a1B2".repeat(10)}`;
    await finished(f, { title: "x", summary: `Se usó ${token} para probar` });
    expect(reportMarkdown(one(f))).not.toContain(token);
    expect(reportHtml(one(f))).not.toContain(token);
  });

  it("drops the owner's paths, including the ~/ that scrub leaves", async () => {
    const f = factory();
    await finished(f, { title: `Revisar ${homedir()}${sep}subcarpeta`, summary: "Movido de C:\\otra\\cosa y de /home/alguien/x." });
    const md = reportMarkdown(one(f));
    for (const text of ["subcarpeta", "C:\\otra", "otra\\\\cosa", "/home/alguien", "~/"]) expect(md).not.toContain(text);
    expect(md).toContain("(ruta local)");
  });

  it("removes another line's repository whole, even with spaces", async () => {
    const other = join(tempDir(), "mi proyecto b");
    const f = factory([{ name: "a", repo: gitRepo() }, { name: "b", repo: other }]);
    const variants = [other, other.replace(/\\/g, "/"), `${other}${sep}src${sep}x.ts`];
    await finished(f, { title: "x", line: "a", summary: variants.map((v) => `Mira ${v} ahora.`).join(" ") });
    const md = reportMarkdown(one(f, "a"));
    for (const text of ["mi proyecto", "proyecto b", "x.ts"]) expect(md).not.toContain(text);
    expect(md).toContain("(ruta local)");
  });

  it("keeps a path inside the line's own repository relative", async () => {
    const repo = gitRepo();
    const f = factory([{ name: "tienda", repo }]);
    await finished(f, { title: "x", summary: `Cambia ${repo}${sep}src${sep}login.ts` });
    const summary = one(f).jobs[0]!.summary;
    expect(summary).toContain("login.ts");
    expect(summary).not.toContain(repo);
  });

  it("leaves out the worktree, the request, the id, engines and neighbours", async () => {
    const f = factory();
    const wt = join(tempDir(), "copia");
    const job = await finished(f, { title: "Título público", request: "texto privado del pedido", worktree: wt });
    await finished(f, { title: "Título del vecino", line: "blog" });
    for (const out of [reportMarkdown(one(f)), reportHtml(one(f))]) {
      for (const text of [wt, "texto privado del pedido", job.id, "Título del vecino", "claude"]) expect(out).not.toContain(text);
    }
  });
});

describe("monthly report: rendering", () => {
  it("escapes hostile text in HTML, with no scripts or outside resources", async () => {
    const f = factory();
    await finished(f, { title: "<script>alert(1)</script>", summary: "<img src=x onerror=alert(1)>" });
    const html = reportHtml(one(f));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<script|<img|<link|src=["']/i);
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("keeps a multi-line summary on the job's row in Markdown", async () => {
    const f = factory();
    await finished(f, { title: "Varias", summary: "Primera línea\n\n## Encabezado\nTercera [falso](javascript:x) <b>" });
    const md = reportMarkdown(one(f));
    expect(md.split("\n").filter((l) => l.startsWith("## "))).toEqual(["## Trabajos entregados", "## Totales"]);
    const row = md.split("\n").find((l) => l.startsWith("- **Varias"))!;
    expect(row).toContain("Primera línea ## Encabezado Tercera");
    expect(row).not.toContain("[falso](");
    expect(row).not.toContain(" <b>");
  });

  it("names the line and the month in Spanish", () => {
    const f = factory();
    const report = one(f);
    expect(reportMarkdown(report).split("\n")[0]).toBe("# Informe mensual de tienda: octubre de 2026");
    expect(reportHtml(report)).toContain("<h1>Informe mensual de tienda: octubre de 2026</h1>");
  });
});

describe("monthly report: services", () => {
  const ALL = { github: {}, vercel: { project: "prj_1" }, supabase: { project: "abcd" } };
  const withServices = (services: Record<string, unknown> = ALL) => factory([{ name: "tienda", repo: gitRepo(), services }, { name: "blog", repo: gitRepo() }]);
  const store = (f: { ctx: FactoryContext }, record: Partial<BillingRecord> & { service: BillingRecord["service"] }, month = "2026-10") =>
    f.ctx.store.setKv(
      billingKey("tienda", record.service, month),
      JSON.stringify({ month, source: BILLING_SERVICES[record.service].source, readAt: new Date(2026, 10, 2, 3).toISOString(), status: "ok", figures: [], ...record }),
    );
  const actions = { label: "Minutos brutos", value: "500" };

  it("lists each service with its source and date, and adds factory and services", async () => {
    const f = withServices({ github: {}, vercel: { project: "prj_1" } });
    await finished(f, { title: "x", costUsd: 5 });
    store(f, { service: "github", costUsd: 2, figures: [actions, { label: "Cubierto por el plan", value: "$8.00" }] });
    store(f, { service: "vercel", costUsd: 4.75 });
    const report = one(f);
    expect(report.total).toEqual({ usd: 11.75, missing: [] });
    const md = reportMarkdown(report);
    expect(md).toContain("## Servicios");
    expect(md).toContain("- GitHub Actions: $2.00 · Minutos brutos: 500 · Cubierto por el plan: $8.00 · Fuente: API de facturación de GitHub · leído el 2026-11-02");
    expect(md).toContain("- Vercel: $4.75 · Fuente: API de Vercel · leído el 2026-11-02");
    expect(md).toContain("- Total del mes (fábrica + servicios): $11.75");
    const html = reportHtml(report);
    expect(html).toContain("<h2>Servicios</h2>");
    expect(html).toContain("<b>Total del mes (fábrica + servicios)</b>: $11.75");
  });

  it("adds only known costs and names the services without one", async () => {
    const f = withServices();
    await finished(f, { title: "x", costUsd: 5 });
    store(f, { service: "github", costUsd: 2 });
    store(f, { service: "supabase", figures: [{ label: "Plan", value: "pro" }] });
    const md = reportMarkdown(one(f));
    expect(md).toContain("- Supabase: sin dato (la API no da el costo) · Plan: pro · Fuente: Management API de Supabase · leído el 2026-11-02");
    expect(md).toContain("- Vercel: sin dato (todavía no se leyó) · Fuente: API de Vercel · sin lectura");
    expect(md).toContain("- Total del mes (fábrica + servicios): $7.00 (sin dato: Vercel, Supabase)");
  });

  it("says why a service has no figure, without numbers it was not given", () => {
    const f = withServices({ vercel: { project: "prj_1" } });
    store(f, { service: "vercel", status: "sin-dato", reason: "sin-token", costUsd: 99 });
    const report = one(f);
    expect(report.services).toEqual([{ name: "Vercel", figures: [], source: "API de Vercel", readAt: "2026-11-02", missing: "falta el token" }]);
    expect(reportMarkdown(report)).toContain("- Vercel: sin dato (falta el token)");
    expect(report.total).toEqual({ usd: 0, missing: ["Vercel"] });
  });

  it("does not throw on a broken record, another month's or another line's", () => {
    const f = withServices({ vercel: { project: "prj_1" }, supabase: { project: "abcd" } });
    f.ctx.store.setKv(billingKey("tienda", "vercel", "2026-10"), "{no es json");
    store(f, { service: "supabase", costUsd: 3 }, "2026-09");
    f.ctx.store.setKv(billingKey("blog", "supabase", "2026-10"), JSON.stringify({ service: "supabase", month: "2026-10", readAt: new Date().toISOString(), status: "ok", costUsd: 3, figures: [] }));
    expect(one(f).services!.map((s) => s.missing)).toEqual(["todavía no se leyó", "todavía no se leyó"]);
  });

  it("keeps the subscription estimate visible in the total", async () => {
    const f = withServices({ vercel: { project: "prj_1" } });
    await finished(f, { title: "x", costUsd: 4, billing: [{ billing: "subscription", usd: 4 }] });
    store(f, { service: "vercel", costUsd: 1 });
    expect(reportMarkdown(one(f))).toContain("- Total del mes (fábrica + servicios): $5.00 (incluye $4.00 estimados con suscripción que no se cobraron)");
  });

  it("cleans stored text and escapes it in HTML", () => {
    const f = withServices({ vercel: { project: "prj_1" } });
    const token = `ghp_${"a1B2".repeat(10)}`;
    store(f, { service: "vercel", costUsd: 1, source: `API ${token}`, figures: [{ label: "<script>x</script>", value: `${homedir()}${sep}secreto` }] });
    for (const out of [reportMarkdown(one(f)), reportHtml(one(f))]) {
      expect(out).not.toContain(token);
      expect(out).not.toContain("secreto");
      expect(out).not.toContain("<script>");
    }
  });

  it("renders a line without services exactly as before", async () => {
    const f = withServices();
    await finished(f, { title: "Del blog", line: "blog", costUsd: 2 });
    const report = one(f, "blog");
    expect(report).not.toHaveProperty("services");
    expect(report).not.toHaveProperty("total");
    const md = reportMarkdown(report);
    expect(md).not.toContain("Servicios");
    expect(md).not.toContain("Total del mes");
    expect(md.endsWith("El tiempo va del pedido al cierre e incluye las esperas.")).toBe(true);
    expect(reportHtml(report)).not.toContain("Servicios");
  });

  it("reads only the store: no fetch, no writes", async () => {
    const f = withServices();
    store(f, { service: "github", costUsd: 2 });
    await finished(f, { title: "x", costUsd: 1 });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("el informe no debe llamar a la red");
    }) as typeof fetch;
    try {
      const before = JSON.stringify(f.ctx.store.kvWithPrefix(""));
      expect(monthlyMarkdown(monthlyReport(f.ctx, { month: "2026-10" }))).toContain("## Servicios");
      expect(JSON.stringify(f.ctx.store.kvWithPrefix(""))).toBe(before);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

/** Runs the real CLI on a factory whose database the test filled. */
function cli(ctx: FactoryContext, ...args: string[]) {
  return cliIn(fileURLToPath(new URL("..", import.meta.url)), ctx, ...args);
}

/** The real CLI with the current folder somewhere else; the loader and the script go by full path. */
function cliIn(cwd: string, ctx: FactoryContext, ...args: string[]) {
  const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const r = spawnSync(process.execPath, ["--import", loader, fileURLToPath(new URL("../src/cli.ts", import.meta.url)), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ZERO_HOME: ctx.home.root },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("zero informe", () => {
  async function filled() {
    const f = factory();
    await finished(f, { title: "Trabajo de tienda" });
    await finished(f, { title: "Trabajo de blog", line: "blog" });
    return f;
  }

  it("prints one line and one month, with nothing of the others", async () => {
    const f = await filled();
    const r = cli(f.ctx, "informe", "tienda", "--mes", "2026-10");
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(reportMarkdown(one(f)));
    expect(r.out).not.toContain("Trabajo de blog");
    expect(r.err).not.toContain("Aviso");
  });

  it("prints every line with a warning on stderr", async () => {
    const f = await filled();
    const r = cli(f.ctx, "informe", "--mes", "2026-10");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Trabajo de tienda");
    expect(r.out).toContain("Trabajo de blog");
    expect(r.err).toContain("junta todas las líneas");
    expect(r.out).not.toContain("junta todas las líneas");
  });

  it("saves HTML for one line in ZERO_HOME, prints only its path and refuses it without a line", async () => {
    const f = await filled();
    const repo = gitRepo();
    const html = cliIn(repo, f.ctx, "informe", "tienda", "--mes", "2026-10", "--html");
    expect(html.code).toBe(0);
    const file = join(f.ctx.home.reports, "informe-tienda-2026-10.html");
    expect(html.out.trim()).toBe(file);
    expect(readFileSync(file, "utf8")).toBe(reportHtml(one(f)));
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
    const refused = cli(f.ctx, "informe", "--html");
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain("indicá la línea");
    expect(refused.out).toBe("");
  });

  it("writes no file for Markdown", async () => {
    const f = await filled();
    const r = cli(f.ctx, "informe", "tienda", "--mes", "2026-10");
    expect(r.out.trim()).toBe(reportMarkdown(one(f)));
    expect(existsSync(f.ctx.home.reports)).toBe(false);
  });

  it("exits with the reason when ZERO_HOME is inside the current repository", async () => {
    const f = await filled();
    gitIn(f.ctx.home.root, "init", "-q");
    const r = cliIn(f.ctx.home.root, f.ctx, "informe", "tienda", "--mes", "2026-10", "--html");
    expect(r.code).toBe(1);
    expect(r.err).toContain("repositorio de la carpeta actual");
    expect(existsSync(f.ctx.home.reports)).toBe(false);
  });

  it("fails on a bad month and is listed in the help", async () => {
    const f = await filled();
    const r = cli(f.ctx, "informe", "tienda", "--mes", "2026-13");
    expect(r.code).toBe(1);
    expect(r.err).toContain("AAAA-MM");
    expect(cli(f.ctx, "help").out).toContain("zero informe");
  });
});

describe("panel: monthly report tab", () => {
  async function panel() {
    const f = factory();
    await finished(f, { title: "Trabajo de tienda" });
    await finished(f, { title: "Trabajo de blog", line: "blog" });
    const server = createPanelServer(f.ctx, { key: () => panelKey(f.ctx.secrets) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookie = `zero_panel=${sessionFor(panelKey(f.ctx.secrets))}`;
    return { ...f, base, get: (path: string) => fetch(base + path, { headers: { cookie }, redirect: "manual" }) };
  }

  it("shows the chosen line and month, with downloads", async () => {
    const p = await panel();
    const r = await p.get("/report?line=tienda&mes=2026-10");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Trabajo de tienda");
    expect(html).not.toContain("Trabajo de blog");
    expect(html).toContain('href="/report/export?line=tienda&amp;mes=2026-10&amp;format=md"');
    expect(html).toContain('href="/report/export?line=tienda&amp;mes=2026-10&amp;format=html"');
    expect(html).toContain('<option value="tienda" selected>');
  });

  it("defaults to every line and the previous month", async () => {
    const p = await panel();
    p.clock.at = new Date(2026, 10, 3);
    const html = await (await p.get("/report")).text();
    expect(html).toContain("Trabajo de tienda");
    expect(html).toContain("Trabajo de blog");
    expect(html).toContain('value="2026-10"');
  });

  it("is linked from the navigation", async () => {
    const p = await panel();
    for (const path of ["/", "/line", "/proposals", "/report"]) expect(await (await p.get(path)).text()).toMatch(/<a href="\/report"[^>]*>[\s\S]*?<span class="lb">Informe mensual<\/span><\/a>/);
  });

  it("asks for a session", async () => {
    const p = await panel();
    for (const path of ["/report?line=tienda&mes=2026-10", "/report/export?line=tienda&mes=2026-10&format=md"]) {
      const r = await fetch(p.base + path);
      expect(r.status).toBe(401);
      expect(await r.text()).not.toContain("Trabajo de tienda");
    }
  });

  it("explains a bad month and shows no report", async () => {
    const p = await panel();
    const html = await (await p.get("/report?mes=2026-13")).text();
    expect(html).toContain("AAAA-MM");
    expect(html).not.toContain("Trabajo de tienda");
    expect(html).not.toContain("/report/export");
  });

  it("downloads Markdown", async () => {
    const p = await panel();
    const r = await p.get("/report/export?line=tienda&mes=2026-10&format=md");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/markdown");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="informe-tienda-2026-10.md"');
    const text = await r.text();
    expect(text).toBe(reportMarkdown(one(p)));
    expect(readFileSync(join(p.ctx.home.reports, "informe-tienda-2026-10.md"), "utf8")).toBe(text);
  });

  it("leaves a copy of the HTML download in ZERO_HOME too", async () => {
    const p = await panel();
    const text = await (await p.get("/report/export?line=tienda&mes=2026-10&format=html")).text();
    expect(readFileSync(join(p.ctx.home.reports, "informe-tienda-2026-10.html"), "utf8")).toBe(text);
  });

  it("writes nothing for an invalid request or without a session", async () => {
    const p = await panel();
    expect((await p.get("/report/export?line=tienda&mes=2026-10&format=pdf")).status).toBe(400);
    expect((await fetch(`${p.base}/report/export?line=tienda&mes=2026-10&format=md`)).status).toBe(401);
    expect(existsSync(p.ctx.home.reports)).toBe(false);
  });

  it("answers with the reason, and downloads nothing, when the copy would land in a line's repository", async () => {
    const repo = gitRepo();
    const f = factory([{ name: "tienda", repo }]);
    await finished(f, { title: "Trabajo de tienda" });
    const ctx = { ...f.ctx, home: factoryHome(join(repo, "home")), secrets: f.ctx.secrets };
    const server = createPanelServer(ctx, { key: () => panelKey(f.ctx.secrets) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/report/export?line=tienda&mes=2026-10&format=md`, { headers: { cookie: `zero_panel=${sessionFor(panelKey(f.ctx.secrets))}` }, redirect: "manual" });
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(text).toContain("tienda");
    expect(text).not.toContain("Trabajo de tienda");
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
  });

  it("downloads standalone HTML, without the panel's navigation", async () => {
    const p = await panel();
    const r = await p.get("/report/export?line=tienda&mes=2026-10&format=html");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const html = await r.text();
    expect(html).toContain("Trabajo de tienda");
    expect(html).not.toContain("<header>");
    expect(html).not.toContain('href="/report"');
  });

  it("cleans the file name", () => {
    const report = { ...one(factory()), line: 'tié"nda/x' };
    expect(reportFileName(report, "md")).toBe("informe-ti--nda-x-2026-10.md");
  });

  it("asks for a line and a format before downloading", async () => {
    const p = await panel();
    for (const path of ["/report/export?format=md", "/report/export?line=tienda&format=pdf", "/report/export?line=tienda&mes=2026-13&format=md"]) {
      const r = await p.get(path);
      expect(r.status).not.toBe(200);
      expect(await r.text()).not.toContain("Trabajo de tienda");
    }
  });
});

describe("saving a report", () => {
  const away = () => tempDir("zero-away-");

  it("refuses when ZERO_HOME is inside a line's repository, naming the line", async () => {
    const repo = gitRepo();
    const f = factory([{ name: "tienda", repo }]);
    const ctx = { ...f.ctx, home: factoryHome(join(repo, "sub", "home")) };
    expect(() => saveReport(ctx, one(f), "html", away())).toThrow(/línea "tienda"/);
    expect(existsSync(ctx.home.reports)).toBe(false);
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
  });

  it("refuses when ZERO_HOME is inside the current folder's repository, which is no line", () => {
    const f = factory();
    const repo = gitRepo();
    const cwd = join(repo, "deep");
    mkdirSync(cwd);
    const ctx = { ...f.ctx, home: factoryHome(join(repo, "home")) };
    expect(() => saveReport(ctx, one(f), "md", cwd)).toThrow(/carpeta actual/);
    expect(existsSync(ctx.home.reports)).toBe(false);
  });

  it("saves when the current folder is a work copy under ZERO_HOME", () => {
    const f = factory();
    const cwd = join(f.ctx.home.worktrees, "tienda", "j1");
    mkdirSync(cwd, { recursive: true });
    gitIn(cwd, "init", "-q");
    const path = saveReport(f.ctx, one(f), "md", cwd);
    expect(path).toBe(join(f.ctx.home.reports, "informe-tienda-2026-10.md"));
    expect(readFileSync(path, "utf8")).toBe(reportMarkdown(one(f)));
  });

  it("saves outside any repository", () => {
    const f = factory();
    expect(existsSync(saveReport(f.ctx, one(f), "html", away()))).toBe(true);
  });
});

describe("chat: zero_monthly_report", () => {
  async function connect(ctx: FactoryContext) {
    const server = createZeroMcpServer(ctx.home, { autoStart: false });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    return client;
  }

  it("returns the same Markdown as the CLI, without writing", async () => {
    const f = factory();
    await finished(f, { title: "Trabajo de tienda" });
    const client = await connect(f.ctx);
    const before = JSON.stringify(f.ctx.store.listJobs());
    const r = (await client.callTool({ name: "zero_monthly_report", arguments: { line: "tienda", month: "2026-10" } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toBe(cli(f.ctx, "informe", "tienda", "--mes", "2026-10").out.trim());
    expect(JSON.stringify(f.ctx.store.listJobs())).toBe(before);
  });

  it("is registered as read-only and explains errors", async () => {
    const f = factory();
    const client = await connect(f.ctx);
    const tool = (await client.listTools()).tools.find((t) => t.name === "zero_monthly_report");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const r = (await client.callTool({ name: "zero_monthly_report", arguments: { month: "2026-1" } })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("AAAA-MM");
  });
});

describe("documentation", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  it("documents the report in both READMEs and says nothing is sent on its own", () => {
    for (const [text, nothing] of [[read("README.md"), "Nothing is sent on its own"], [read("README.es.md"), "Nada se envía solo"]] as const) {
      for (const fact of ["zero informe", "--mes", "--html", "Informe mensual", "`zero_monthly_report`", nothing]) expect(text, fact).toContain(fact);
    }
  });
});

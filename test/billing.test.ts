import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BILLING_TIMEOUT_MS, billingReaders, type ReaderDeps } from "../src/billing/readers.js";
import { LineSchema } from "../src/config.js";
import { log } from "../src/log.js";

const NOW = new Date(2026, 10, 10, 12);
const TOKEN = "secreto-que-no-se-ve";

const line = (services: Record<string, unknown>) => LineSchema.parse({ name: "tienda", repo: "/x", services });

interface Call {
  url: string;
  auth: string | undefined;
}

/** A fetch that answers by path and records what it was asked. */
function fake(routes: Record<string, (url: URL) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), auth: new Headers(init?.headers).get("authorization") ?? undefined });
    const route = Object.entries(routes).find(([path]) => url.pathname === path);
    return route ? route[1](url) : new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function deps(fetch: typeof globalThis.fetch, secrets: Record<string, string> = {}, extra: Partial<ReaderDeps> = {}): ReaderDeps {
  return { fetch, secrets: { get: (name) => secrets[name] }, repository: () => "acme/tienda", ...extra };
}

const read = (d: ReaderDeps, service: "github" | "vercel" | "supabase", services: Record<string, unknown>, month = "2026-11") =>
  billingReaders(d)[service].read({ line: line(services), month, now: NOW });

beforeEach(() => void vi.spyOn(log, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("billing: GitHub Actions", () => {
  const items = {
    usageItems: [
      { product: "actions", sku: "linux", quantity: 300, unitType: "Minutes", grossAmount: 6, discountAmount: 5, netAmount: 1, repositoryName: "acme/tienda" },
      { product: "actions", sku: "windows", quantity: 200, unitType: "Minutes", grossAmount: 4, discountAmount: 3, netAmount: 1, repositoryName: "ACME/Tienda" },
      { product: "actions", sku: "linux", quantity: 900, unitType: "Minutes", grossAmount: 18, discountAmount: 0, netAmount: 18, repositoryName: "acme/otro" },
      { product: "packages", sku: "storage", quantity: 1, unitType: "GigabyteHours", grossAmount: 7, discountAmount: 0, netAmount: 7, repositoryName: "acme/tienda" },
    ],
  };

  it("keeps only the line's repository Actions items", async () => {
    const f = fake({ "/users/acme/settings/billing/usage": () => json(items) });
    const r = await read(deps(f.fetch, { GITHUB_BILLING_TOKEN: TOKEN }), "github", { github: {} });
    expect(r).toMatchObject({ service: "github", month: "2026-11", status: "ok", costUsd: 2, readAt: NOW.toISOString(), source: "API de facturación de GitHub" });
    expect(r.figures).toEqual([
      { label: "Minutos brutos", value: "500" },
      { label: "Bruto", value: "$10.00" },
      { label: "Cubierto por el plan", value: "$8.00" },
      { label: "Facturado", value: "$2.00" },
    ]);
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get("year")).toBe("2026");
    expect(url.searchParams.get("month")).toBe("11");
    expect(f.calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("asks the organizations path for an organization", async () => {
    const f = fake({ "/organizations/acme/settings/billing/usage": () => json(items) });
    const r = await read(deps(f.fetch, { GITHUB_BILLING_TOKEN: TOKEN }, { repository: () => undefined }), "github", { github: { account: "acme", type: "organization", repository: "acme/tienda" } });
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(["/organizations/acme/settings/billing/usage"]);
    expect(r.costUsd).toBe(2);
  });

  it("falls back to the factory's GitHub token", async () => {
    const f = fake({ "/users/acme/settings/billing/usage": () => json(items) });
    await read(deps(f.fetch, {}, { githubToken: () => "gh-token" }), "github", { github: {} });
    expect(f.calls[0]!.auth).toBe("Bearer gh-token");
  });

  it("is sin dato without a token or a repository", async () => {
    const f = fake({});
    expect(await read(deps(f.fetch), "github", { github: {} })).toMatchObject({ status: "sin-dato", reason: "sin-token" });
    expect(await read(deps(f.fetch, { GITHUB_BILLING_TOKEN: TOKEN }, { repository: () => undefined }), "github", { github: {} })).toMatchObject({ status: "sin-dato", reason: "sin-repositorio" });
    expect(f.calls).toEqual([]);
  });

  it("is sin dato on an answer without usage items", async () => {
    const f = fake({ "/users/acme/settings/billing/usage": () => json({ message: "algo" }) });
    const r = await read(deps(f.fetch, { GITHUB_BILLING_TOKEN: TOKEN }), "github", { github: {} });
    expect(r).toMatchObject({ status: "sin-dato", reason: "respuesta-invalida", figures: [] });
    expect(r).not.toHaveProperty("costUsd");
  });
});

describe("billing: Vercel", () => {
  const charges = [
    { BilledCost: 3.5, ServiceName: "Functions", Tags: { ProjectId: "prj_1", ProjectName: "tienda" } },
    { BilledCost: "1.25", ServiceName: "Bandwidth", Tags: { ProjectId: "prj_1" } },
    { BilledCost: 9, ServiceName: "Functions", Tags: { ProjectId: "prj_2" } },
    { BilledCost: 20, ServiceName: "Pro plan" },
  ];

  it("adds the billed cost of the project's records, read as JSON lines", async () => {
    const f = fake({ "/v1/billing/charges": () => new Response(charges.map((c) => JSON.stringify(c)).join("\n")) });
    const r = await read(deps(f.fetch, { VERCEL_TOKEN: TOKEN }), "vercel", { vercel: { project: "prj_1", team: "team_1" } });
    expect(r).toMatchObject({ status: "ok", costUsd: 4.75, source: "API de Vercel" });
    expect(r.figures).toEqual([
      { label: "Facturado", value: "$4.75" },
      { label: "Registros", value: "2" },
    ]);
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get("teamId")).toBe("team_1");
    expect(url.searchParams.get("from")).toBe(new Date(2026, 10, 1).toISOString());
    expect(url.searchParams.get("to")).toBe(NOW.toISOString());
  });

  it("has no cost when no record is attributed to a project", async () => {
    const f = fake({ "/v1/billing/charges": () => json([{ BilledCost: 20, ServiceName: "Pro plan" }]) });
    const r = await read(deps(f.fetch, { VERCEL_TOKEN: TOKEN }), "vercel", { vercel: { project: "prj_1" } });
    expect(r).toMatchObject({ status: "sin-dato", reason: "sin-costo" });
    expect(r).not.toHaveProperty("costUsd");
    expect(new URL(f.calls[0]!.url).searchParams.has("teamId")).toBe(false);
  });

  it("is sin dato without VERCEL_TOKEN, calling nothing", async () => {
    const f = fake({});
    expect(await read(deps(f.fetch), "vercel", { vercel: { project: "prj_1" } })).toMatchObject({ status: "sin-dato", reason: "sin-token" });
    expect(f.calls).toEqual([]);
  });

  it("is sin dato on a 500 or a rejected fetch, and logs no token or body", async () => {
    const warn = vi.mocked(log.warn);
    const down = fake({ "/v1/billing/charges": () => new Response(`error ${TOKEN}`, { status: 500 }) });
    expect(await read(deps(down.fetch, { VERCEL_TOKEN: TOKEN }), "vercel", { vercel: { project: "prj_1" } })).toMatchObject({ status: "sin-dato", reason: "sin-respuesta" });
    const rejecting = (async () => {
      throw new Error(`connect ECONNREFUSED ${TOKEN}`);
    }) as typeof fetch;
    const r = await read(deps(rejecting, { VERCEL_TOKEN: TOKEN }), "vercel", { vercel: { project: "prj_1" } });
    expect(r).toMatchObject({ status: "sin-dato", reason: "sin-respuesta" });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    expect(warn.mock.calls[0]).toEqual(["billing read without data", { line: "tienda", service: "vercel", reason: "sin-respuesta" }]);
  });

  it("gives up a request after the time limit", async () => {
    expect(BILLING_TIMEOUT_MS).toBe(10_000);
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const r = await read(deps(hanging, { VERCEL_TOKEN: TOKEN }, { timeoutMs: 20 }), "vercel", { vercel: { project: "prj_1" } });
    expect(r).toMatchObject({ status: "sin-dato", reason: "sin-respuesta" });
  });
});

describe("billing: Supabase", () => {
  it("shows the organization's plan and no cost", async () => {
    const f = fake({
      "/v1/projects/abcd": () => json({ id: "abcd", name: "tienda", status: "ACTIVE_HEALTHY", organization_id: "acme-org" }),
      "/v1/organizations/acme-org": () => json({ id: "acme-org", name: "Acme", plan: "pro" }),
    });
    const r = await read(deps(f.fetch, { SUPABASE_ACCESS_TOKEN: TOKEN }), "supabase", { supabase: { project: "abcd" } });
    expect(r).toMatchObject({ status: "ok", source: "Management API de Supabase" });
    expect(r).not.toHaveProperty("costUsd");
    expect(r.figures).toContainEqual({ label: "Plan", value: "pro" });
    expect(f.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("uses the configured organization", async () => {
    const f = fake({ "/v1/projects/abcd": () => json({ id: "abcd" }), "/v1/organizations/mi-org": () => json({ plan: "free" }) });
    const r = await read(deps(f.fetch, { SUPABASE_ACCESS_TOKEN: TOKEN }), "supabase", { supabase: { project: "abcd", organization: "mi-org" } });
    expect(r.figures).toEqual([{ label: "Plan", value: "free" }]);
  });

  it("is sin dato without a token or when the project does not answer", async () => {
    const f = fake({});
    expect(await read(deps(f.fetch), "supabase", { supabase: { project: "abcd" } })).toMatchObject({ status: "sin-dato", reason: "sin-token" });
    expect(await read(deps(f.fetch, { SUPABASE_ACCESS_TOKEN: TOKEN }), "supabase", { supabase: { project: "abcd" } })).toMatchObject({ status: "sin-dato", reason: "sin-respuesta" });
  });
});

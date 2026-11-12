import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monthlyReport } from "../src/app.js";
import { billingPass } from "../src/billing/pass.js";
import { billingReaders } from "../src/billing/readers.js";
import { billingDayKey, billingKey, parseBillingRecord, type BillingReader, type BillingRecord, type BillingService } from "../src/billing/records.js";
import { runDaemon } from "../src/daemon.js";
import { log } from "../src/log.js";
import { reportMarkdown } from "../src/report.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

beforeEach(() => void vi.spyOn(log, "warn").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

/** A factory with one line using the given services, and a clock the test moves. */
function billingFactory(services: Record<string, unknown> = { vercel: { project: "prj_1" } }, start = new Date(2026, 10, 10, 12)) {
  const clock = { now: start };
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo(), services }] }, () => clock.now);
  return { ctx, clock };
}

/** A reader that answers a fixed cost and records the months it was asked for. */
function fakeReader(service: BillingService, cost = 4.75) {
  const calls: { month: string; at: string }[] = [];
  const reader: BillingReader = {
    service,
    async read({ month, now }): Promise<BillingRecord> {
      calls.push({ month, at: now.toISOString() });
      return { service, month, source: "fake", readAt: now.toISOString(), status: "ok", costUsd: cost, figures: [{ label: "Facturado", value: `$${cost.toFixed(2)}` }] };
    },
  };
  return { reader, calls };
}

const stored = (ctx: ReturnType<typeof billingFactory>["ctx"], service: BillingService, month: string) => parseBillingRecord(ctx.store.getKv(billingKey("tienda", service, month)), service, month);

/** A record of the previous month read in the current one, so only the current month is read. */
function closePrevious(ctx: ReturnType<typeof billingFactory>["ctx"], service: BillingService, month: string, readAt: Date) {
  ctx.store.setKv(billingKey("tienda", service, month), JSON.stringify({ service, month, source: "fake", readAt: readAt.toISOString(), status: "ok", costUsd: 1, figures: [] }));
}

describe("billingPass", () => {
  it("reads each service once per local day and stores the record", async () => {
    const { ctx, clock } = billingFactory();
    closePrevious(ctx, "vercel", "2026-10", new Date(2026, 10, 1, 3));
    const vercel = fakeReader("vercel");
    await billingPass(ctx, { vercel: vercel.reader }, clock.now);
    clock.now = new Date(2026, 10, 10, 23);
    await billingPass(ctx, { vercel: vercel.reader }, clock.now);
    expect(vercel.calls).toEqual([{ month: "2026-11", at: new Date(2026, 10, 10, 12).toISOString() }]);
    expect(stored(ctx, "vercel", "2026-11")).toMatchObject({ status: "ok", costUsd: 4.75, readAt: new Date(2026, 10, 10, 12).toISOString() });
    expect(ctx.store.getKv(billingDayKey("tienda", "vercel"))).toBe("2026-11-10");
  });

  it("reads again on the next local day and replaces the record", async () => {
    const { ctx, clock } = billingFactory();
    closePrevious(ctx, "vercel", "2026-10", new Date(2026, 10, 1, 3));
    const first = fakeReader("vercel", 1);
    await billingPass(ctx, { vercel: first.reader }, clock.now);
    clock.now = new Date(2026, 10, 11, 0, 5);
    const second = fakeReader("vercel", 2.5);
    await billingPass(ctx, { vercel: second.reader }, clock.now);
    expect(second.calls.map((c) => c.month)).toEqual(["2026-11"]);
    expect(stored(ctx, "vercel", "2026-11")).toMatchObject({ costUsd: 2.5, readAt: clock.now.toISOString() });
  });

  it("closes the previous month once, with a read made in the current month", async () => {
    const { ctx, clock } = billingFactory({ vercel: { project: "prj_1" } }, new Date(2026, 10, 1, 9));
    // October was last read on October 31st, before November began.
    closePrevious(ctx, "vercel", "2026-10", new Date(2026, 9, 31, 22));
    const vercel = fakeReader("vercel", 7);
    await billingPass(ctx, { vercel: vercel.reader }, clock.now);
    expect(vercel.calls.map((c) => c.month)).toEqual(["2026-11", "2026-10"]);
    expect(stored(ctx, "vercel", "2026-10")).toMatchObject({ costUsd: 7, readAt: clock.now.toISOString() });
    clock.now = new Date(2026, 10, 2, 9);
    await billingPass(ctx, { vercel: vercel.reader }, clock.now);
    expect(vercel.calls.map((c) => c.month)).toEqual(["2026-11", "2026-10", "2026-11"]);
  });

  it("reads the previous month while it has no record", async () => {
    const { ctx, clock } = billingFactory();
    const vercel = fakeReader("vercel");
    await billingPass(ctx, { vercel: vercel.reader }, clock.now);
    expect(vercel.calls.map((c) => c.month)).toEqual(["2026-11", "2026-10"]);
  });

  it("goes on with the next service when one fails, and logs no token", async () => {
    const { ctx, clock } = billingFactory({ github: {}, vercel: { project: "prj_1" } });
    const broken: BillingReader = {
      service: "github",
      read: async () => {
        throw new Error("Bearer secreto-que-no-se-ve");
      },
    };
    const vercel = fakeReader("vercel");
    await billingPass(ctx, { github: broken, vercel: vercel.reader }, clock.now);
    expect(vercel.calls.length).toBeGreaterThan(0);
    expect(stored(ctx, "vercel", "2026-11")).toBeDefined();
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain("secreto-que-no-se-ve");
  });

  it("stores sin dato when the token is missing, and the report says so", async () => {
    const { ctx, clock } = billingFactory();
    const fetch = vi.fn(async () => new Response("{}"));
    await billingPass(ctx, billingReaders({ fetch: fetch as unknown as typeof globalThis.fetch, secrets: ctx.secrets }), clock.now);
    expect(fetch).not.toHaveBeenCalled();
    expect(stored(ctx, "vercel", "2026-11")).toMatchObject({ status: "sin-dato", reason: "sin-token" });
    expect(stored(ctx, "vercel", "2026-11")?.costUsd).toBeUndefined();
    const report = monthlyReport(ctx, { month: "2026-11" });
    expect(reportMarkdown(report.lines[0]!)).toMatch(/Vercel.*sin dato/);
  });

  it("stores sin dato when the service answers 500 and keeps the token out of the log", async () => {
    const { ctx, clock } = billingFactory();
    ctx.secrets.set("VERCEL_TOKEN", "secreto-que-no-se-ve");
    closePrevious(ctx, "vercel", "2026-10", new Date(2026, 10, 1, 3));
    const fetch = vi.fn(async () => new Response("boom secreto-que-no-se-ve", { status: 500 }));
    await billingPass(ctx, billingReaders({ fetch: fetch as unknown as typeof globalThis.fetch, secrets: ctx.secrets }), clock.now);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stored(ctx, "vercel", "2026-11")).toMatchObject({ status: "sin-dato", reason: "sin-respuesta" });
    expect(ctx.store.getKv(billingKey("tienda", "vercel", "2026-11"))).not.toContain("secreto");
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain("secreto-que-no-se-ve");
  });
});

describe("billing in the daemon", () => {
  it("reads billing in a once run only when a reader is injected", async () => {
    const { ctx } = billingFactory();
    const vercel = fakeReader("vercel");
    await runDaemon(ctx, { once: true, pollMs: 10, billing: { vercel: vercel.reader } });
    expect(vercel.calls.map((c) => c.month)).toContain("2026-11");
    expect(stored(ctx, "vercel", "2026-11")).toMatchObject({ costUsd: 4.75 });
  });

  it("does not read billing in a once run without an injected reader", async () => {
    const { ctx } = billingFactory();
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await runDaemon(ctx, { once: true, pollMs: 10 });
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.store.getKv(billingDayKey("tienda", "vercel"))).toBeUndefined();
  });
});

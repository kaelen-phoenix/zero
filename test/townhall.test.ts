import { afterEach, describe, expect, it } from "vitest";
import { createTownhall, memoryBlock, resilient, type NewPost } from "../src/townhall/index.js";
import { renderBriefing } from "../src/townhall/briefing.js";
import { createLocalStore, shardsSince } from "../src/townhall/store.js";
import { computeMetrics } from "../src/telemetry/metrics.js";
import { Store } from "../src/state/store.js";
import { cleanup, tempDir } from "./helpers.js";

afterEach(cleanup);

const at = (iso: string) => () => new Date(iso);
const note = (over: Partial<NewPost> = {}): NewPost => ({ kind: "lesson", line: "api", job: "j1", source: "test/a.ts:3", topic: "tests", body: "mock the network", ...over }) as NewPost;

describe("townhall", () => {
  it("publishes notes and recalls them by line and kind", async () => {
    const th = createTownhall(createLocalStore(tempDir()), at("2026-10-26T10:00:00Z"));
    await th.publish([note(), note({ line: "web", body: "use playwright" }), note({ kind: "proposal", body: "split tracker" })]);
    expect((await th.recall({ line: "api", kinds: ["lesson"] })).map((p) => p.body)).toEqual(["mock the network"]);
    expect((await th.recall({ line: "web" })).map((p) => p.body)).toEqual(["use playwright"]);
  });

  it("redacts secrets and drops duplicates", async () => {
    const th = createTownhall(createLocalStore(tempDir()), at("2026-10-26T10:00:00Z"));
    await th.publish([note({ body: "set GH_TOKEN to ghp_abcdefghijklmnopqrstuvwxyz0123456789" })]);
    await th.publish([note({ body: "set GH_TOKEN to ghp_abcdefghijklmnopqrstuvwxyz0123456789" }), note({ body: "password: hunter2hunter2" })]);
    const bodies = (await th.recall()).map((p) => p.body);
    expect(bodies).toEqual(["set GH_TOKEN to [REDACTED]", "password: [REDACTED]"]);
  });

  it("never lets a broken store break the line", async () => {
    const broken = resilient({ publish: () => Promise.reject(new Error("disk full")), recall: () => Promise.reject(new Error("offline")) });
    await expect(broken.publish([note()])).resolves.toBeUndefined();
    await expect(broken.recall()).resolves.toEqual([]);
  });

  it("renders memory with its source", () => {
    expect(memoryBlock([{ ...note(), id: "1", at: "" } as never])).toContain("[lesson] tests: mock the network (test/a.ts:3)");
    expect(memoryBlock([])).toBe("");
  });

  it("shards by month across year boundaries", () => {
    expect(shardsSince(new Date("2025-11-15Z"), new Date("2026-01-02Z"))).toEqual(["posts/2025-11.jsonl", "posts/2025-12.jsonl", "posts/2026-01.jsonl"]);
  });
});

describe("briefing", () => {
  it("says when the factory ran on its own", () => {
    const store = new Store(":memory:");
    const b = renderBriefing(computeMetrics(store, new Date(0), new Date("2026-10-26T00:00:00Z")), []);
    expect(b.title).toBe("Informe zero — 2026-10-26");
    expect(b.body).toContain("Nada. La fábrica funcionó sola.");
  });

  it("lists blockers, proposals and what was learned", () => {
    const store = new Store(":memory:");
    const posts = [
      { ...note({ kind: "blocker", topic: "pagos", body: "falta la cuenta de Stripe" }), id: "1", at: "" },
      { ...note({ kind: "proposal", body: "agregar CI" }), id: "2", at: "" },
      { ...note(), id: "3", at: "" },
    ] as never[];
    const b = renderBriefing(computeMetrics(store, new Date(0)), posts);
    expect(b.body).toContain("**Bloqueado** (api · j1): pagos. falta la cuenta de Stripe");
    expect(b.body).toContain("**Propuesta** (api · j1): agregar CI");
    expect(b.body).toContain("[lesson] **tests**: mock the network");
  });
});

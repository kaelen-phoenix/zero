import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryStatus } from "../src/app.js";
import { formatStatus } from "../src/format.js";
import { CACHE_ENTRIES, githubHalt, GithubHalted, githubMeter, HALT_KEY, isRateLimit, QUOTA_KEY, USAGE_KEY, type GithubUsage } from "../src/github-quota.js";
import { githubIssues } from "../src/intake/github.js";
import { githubMerges } from "../src/line/automerge.js";
import { log } from "../src/log.js";
import { cleanup, testFactory } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

const START = new Date("2030-01-15T12:00:00Z");
const MINUTE = 60_000;
const epoch = (ms: number) => String(Math.floor(ms / 1000));
const inMinutes = (minutes: number) => START.getTime() + minutes * MINUTE;

const answer = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const openPr = { state: "open", merged: false, mergeable: true, head: { sha: "abc" } };

interface Sent {
  url: string;
  method: string;
  ifNoneMatch?: string;
}

/** GitHub behind the real Octokit: `reply` answers each request, `sent` records what reached the network. */
function stubGitHub(reply: (sent: Sent, nth: number) => Response) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { method: string; headers: Record<string, string> }) => {
    const request = { url: String(url), method: init.method, ifNoneMatch: init.headers["if-none-match"] };
    sent.push(request);
    // A real fetch fills it in, and pagination reads it.
    return Object.defineProperty(reply(request, sent.length), "url", { value: String(url) });
  });
  return sent;
}

function metered() {
  const clock = { now: START };
  const now = () => clock.now;
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [] }, now);
  const meter = githubMeter(ctx.store, now);
  const merges = (pass: "merges" | "reverts" = "merges") => githubMerges("t", "o/r", meter.client("t", pass));
  const issues = () => githubIssues("t", "o/r", meter.client("t", "issues"));
  const usage = () => JSON.parse(ctx.store.getKv(USAGE_KEY) ?? "{}") as GithubUsage;
  return { ctx, clock, now, meter, merges, issues, usage, store: ctx.store };
}

const limited = (remaining: number, limit = 5000, reset = inMinutes(30)) => ({ "x-ratelimit-limit": String(limit), "x-ratelimit-remaining": String(remaining), "x-ratelimit-reset": epoch(reset) });

describe("requests per pass", () => {
  it("counts 200s and 304s for the pass that sent them, in the current hour", async () => {
    const { merges, usage } = metered();
    stubGitHub((_, nth) => (nth === 1 ? answer(200, openPr, { etag: '"a"' }) : answer(304)));
    await merges().pullRequest(10);
    await merges().pullRequest(10);
    expect(usage()).toEqual({ hour: "2030-01-15T12", passes: { merges: { requests: 1, notModified: 1 } } });
  });

  it("starts the counts again each hour", async () => {
    const { merges, usage, clock } = metered();
    stubGitHub(() => answer(200, openPr));
    await merges().pullRequest(10);
    clock.now = new Date(inMinutes(61));
    await merges("reverts").pullRequest(10);
    expect(usage()).toEqual({ hour: "2030-01-15T13", passes: { reverts: { requests: 1, notModified: 0 } } });
  });

  it("does not count a request held back by a pause", async () => {
    const { merges, usage, store } = metered();
    store.setKv(HALT_KEY, JSON.stringify({ until: new Date(inMinutes(5)).toISOString(), why: "x" }));
    const sent = stubGitHub(() => answer(200, openPr));
    await expect(merges().pullRequest(10)).rejects.toBeInstanceOf(GithubHalted);
    expect(sent).toEqual([]);
    expect(usage()).toEqual({});
  });

  it("logs each run that sent requests, once", async () => {
    const { merges, meter } = metered();
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    stubGitHub((_, nth) => (nth === 1 ? answer(200, openPr, { etag: '"a"' }) : answer(304)));
    meter.endRun("merges");
    expect(info).not.toHaveBeenCalled();
    await merges().pullRequest(10);
    await merges().pullRequest(10);
    meter.endRun("merges");
    meter.endRun("merges");
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.any(String), { pass: "merges", requests: 1, notModified: 1 });
  });
});

describe("conditional requests", () => {
  it("asks with the saved ETag and hands back the same pull request on a 304", async () => {
    const { merges } = metered();
    const sent = stubGitHub((_, nth) => (nth === 1 ? answer(200, openPr, { etag: 'W/"v1"' }) : answer(304)));
    const first = await merges().pullRequest(10);
    const second = await merges().pullRequest(10);
    expect(sent.map((s) => s.ifNoneMatch)).toEqual([undefined, 'W/"v1"']);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ open: true, headSha: "abc", mergeable: true });
  });

  it("serves paginated lists again, whatever pagination did to the first response", async () => {
    const { merges } = metered();
    const seen = new Map<string, number>();
    const sent = stubGitHub(({ url }) => {
      const nth = (seen.get(url) ?? 0) + 1;
      seen.set(url, nth);
      if (nth > 1) return answer(304);
      if (url.includes("/check-runs")) return answer(200, { total_count: 1, check_runs: [{ name: "ci", status: "completed", conclusion: "failure" }] }, { etag: '"runs"' });
      return answer(200, { statuses: [{ context: "sonar", state: "success" }] }, { etag: '"status"' });
    });
    const first = await merges().checks("abc");
    const second = await merges().checks("abc");
    expect(first).toEqual([{ name: "ci", done: true, ok: false }, { name: "sonar", done: true, ok: true }]);
    expect(second).toEqual(first);
    expect(sent.filter((s) => s.ifNoneMatch)).toHaveLength(2);
  });

  it("follows the next pages of a repeated list from what it saved", async () => {
    const { issues } = metered();
    const issue = (number: number) => ({ number, title: "t", body: "", user: { login: "a" }, html_url: "u", labels: [{ name: "zero" }] });
    const pageTwo = "https://api.github.com/repositories/1/issues?page=2";
    const seen = new Set<string>();
    stubGitHub(({ url }) => {
      if (seen.has(url)) return answer(304);
      seen.add(url);
      return url === pageTwo ? answer(200, [issue(2)], { etag: '"p2"' }) : answer(200, [issue(1)], { etag: '"p1"', link: `<${pageTwo}>; rel="next"` });
    });
    const first = await issues().labeled("zero");
    const second = await issues().labeled("zero");
    expect(first.map((i) => i.number)).toEqual([1, 2]);
    expect(second).toEqual(first);
  });

  it("never sends the header on a write", async () => {
    const { issues } = metered();
    const sent = stubGitHub(({ method }) => (method === "GET" ? answer(200, [], { etag: '"list"' }) : answer(201, { id: 1 })));
    await issues().comments(7);
    await issues().comment(7, "hola");
    expect(sent.map((s) => [s.method, s.ifNoneMatch])).toEqual([["GET", undefined], ["POST", undefined]]);
    expect(sent[0]!.url.split("?")[0]).toBe(sent[1]!.url);
  });

  it("keeps at most the newest entries, dropping the oldest first", async () => {
    const { merges } = metered();
    const sent = stubGitHub(({ ifNoneMatch }) => (ifNoneMatch ? answer(304) : answer(200, openPr, { etag: '"e"' })));
    const api = merges();
    for (let n = 1; n <= CACHE_ENTRIES + 1; n++) await api.pullRequest(n);
    sent.length = 0;
    await api.pullRequest(CACHE_ENTRIES + 1);
    await api.pullRequest(2);
    expect(sent.map((s) => s.ifNoneMatch)).toEqual(['"e"', '"e"']);
    sent.length = 0;
    await api.pullRequest(1);
    expect(sent[0]!.ifNoneMatch).toBeUndefined();
  });
});

describe("limit responses", () => {
  it("pauses until x-ratelimit-reset on a 403 with nothing left", async () => {
    const { merges, store, now } = metered();
    const sent = stubGitHub(() => answer(403, { message: "API rate limit exceeded" }, limited(0)));
    await expect(merges().pullRequest(10)).rejects.toMatchObject({ status: 403 });
    expect(githubHalt(store, now())?.until).toBe(new Date(Number(epoch(inMinutes(30))) * 1000).toISOString());
    await expect(merges().pullRequest(10)).rejects.toBeInstanceOf(GithubHalted);
    expect(sent).toHaveLength(1);
  });

  it("pauses for retry-after on a 429", async () => {
    const { merges, store, now } = metered();
    stubGitHub(() => answer(429, { message: "slow down" }, { "retry-after": "120" }));
    await expect(merges().pullRequest(10)).rejects.toMatchObject({ status: 429 });
    expect(githubHalt(store, now())?.until).toBe(new Date(START.getTime() + 120_000).toISOString());
  });

  it("takes the later of x-ratelimit-reset and retry-after, and waits 60 seconds when neither comes", async () => {
    const later = metered();
    stubGitHub(() => answer(403, { message: "secondary" }, { "retry-after": "600", "x-ratelimit-reset": epoch(inMinutes(2)) }));
    await expect(later.merges().pullRequest(10)).rejects.toMatchObject({ status: 403 });
    expect(githubHalt(later.store, later.now())?.until).toBe(new Date(inMinutes(10)).toISOString());

    const neither = metered();
    stubGitHub(() => answer(403, { message: "You have exceeded a secondary rate limit" }));
    await expect(neither.merges().pullRequest(10)).rejects.toMatchObject({ status: 403 });
    expect(githubHalt(neither.store, neither.now())?.until).toBe(new Date(inMinutes(1)).toISOString());
  });

  it("never shortens a longer pause", async () => {
    const { merges, store, now } = metered();
    store.setKv(HALT_KEY, JSON.stringify({ until: new Date(inMinutes(50)).toISOString(), why: "x" }));
    const other = githubMeter(store, () => new Date(inMinutes(60)));
    stubGitHub(() => answer(429, {}, { "retry-after": "1" }));
    await expect(merges().pullRequest(10)).rejects.toBeInstanceOf(GithubHalted);
    await expect(githubMerges("t", "o/r", other.client("t", "merges")).pullRequest(10)).rejects.toMatchObject({ status: 429 });
    expect(Date.parse(githubHalt(store, now())!.until)).toBeGreaterThanOrEqual(inMinutes(50));
  });

  it("does not pause on a 403 for lack of permission", async () => {
    const { merges, store, now } = metered();
    stubGitHub(() => answer(403, { message: "Resource not accessible by integration" }, limited(4000)));
    await expect(merges().pullRequest(10)).rejects.toMatchObject({ status: 403 });
    expect(githubHalt(store, now())).toBeUndefined();
  });

  it("stays paused for a new meter on the same store", async () => {
    const { merges, store, now } = metered();
    const sent = stubGitHub(() => answer(403, { message: "rate limit" }, limited(0)));
    await expect(merges().pullRequest(10)).rejects.toMatchObject({ status: 403 });
    await expect(githubMerges("t", "o/r", githubMeter(store, now).client("t", "merges")).pullRequest(10)).rejects.toBeInstanceOf(GithubHalted);
    expect(sent).toHaveLength(1);
  });

  it("lets requests out again once the end has passed", async () => {
    const { merges, store, now, clock } = metered();
    let limitedYet = false;
    const sent = stubGitHub(() => {
      if (limitedYet) return answer(200, openPr, limited(4999, 5000, inMinutes(90)));
      limitedYet = true;
      return answer(429, {}, { "retry-after": "120" });
    });
    await expect(merges().pullRequest(10)).rejects.toMatchObject({ status: 429 });
    clock.now = new Date(START.getTime() + 121_000);
    expect(githubHalt(store, now())).toBeUndefined();
    await expect(merges().pullRequest(10)).resolves.toMatchObject({ headSha: "abc" });
    expect(sent).toHaveLength(2);
  });

  it("tells a limit from other errors", () => {
    const error = (status: number, message: string, headers: Record<string, string> = {}) => Object.assign(new Error(message), { status, response: { headers } });
    expect(isRateLimit(error(429, "x"))).toBe(true);
    expect(isRateLimit(error(403, "x", { "x-ratelimit-remaining": "0" }))).toBe(true);
    expect(isRateLimit(error(403, "x", { "retry-after": "5" }))).toBe(true);
    expect(isRateLimit(error(403, "API rate limit exceeded"))).toBe(true);
    expect(isRateLimit(error(403, "Resource not accessible", { "x-ratelimit-remaining": "9" }))).toBe(false);
    expect(isRateLimit(error(404, "rate limit"))).toBe(false);
    expect(isRateLimit(new Error("rate limit"))).toBe(false);
  });
});

describe("the reserve", () => {
  const reply = (headers: Record<string, string>, status = 200) => stubGitHub(() => answer(status, status === 304 ? undefined : openPr, headers));

  it("pauses until the renewal right at 20%", async () => {
    const { merges, store, now } = metered();
    const sent = reply(limited(1000));
    await merges().pullRequest(10);
    expect(githubHalt(store, now())?.until).toBe(new Date(Number(epoch(inMinutes(30))) * 1000).toISOString());
    await expect(merges().pullRequest(10)).rejects.toBeInstanceOf(GithubHalted);
    expect(sent).toHaveLength(1);
  });

  it("does not pause above it", async () => {
    const { merges, store, now } = metered();
    reply(limited(1001));
    await merges().pullRequest(10);
    expect(githubHalt(store, now())).toBeUndefined();
  });

  it("is over once the quota renewed", () => {
    const { store, now, clock } = metered();
    store.setKv(QUOTA_KEY, JSON.stringify({ limit: 5000, remaining: 100, resetAt: new Date(inMinutes(5)).toISOString() }));
    expect(githubHalt(store, now())).toBeDefined();
    clock.now = new Date(inMinutes(6));
    expect(githubHalt(store, now())).toBeUndefined();
  });

  it("ignores other resources, and reads a response that names core or nothing", async () => {
    const { merges, store } = metered();
    reply({ ...limited(1), "x-ratelimit-resource": "search" });
    await merges().pullRequest(10);
    expect(store.getKv(QUOTA_KEY)).toBeUndefined();
    vi.unstubAllGlobals();
    reply({ ...limited(3000), "x-ratelimit-resource": "core" });
    await merges().pullRequest(10);
    expect(JSON.parse(store.getKv(QUOTA_KEY)!)).toMatchObject({ limit: 5000, remaining: 3000 });
  });

  it("reads the quota of a 304 too", async () => {
    const { merges, store, now } = metered();
    let nth = 0;
    stubGitHub(() => (++nth === 1 ? answer(200, openPr, { etag: '"a"', ...limited(4000) }) : answer(304, undefined, limited(900))));
    await merges().pullRequest(10);
    await merges().pullRequest(10);
    expect(JSON.parse(store.getKv(QUOTA_KEY)!)).toMatchObject({ limit: 5000, remaining: 900 });
    expect(githubHalt(store, now())).toBeDefined();
  });
});

describe("a limit is not a lack of permission", () => {
  it("rejects when the permission query hits a limit", async () => {
    const { issues } = metered();
    stubGitHub(() => answer(403, { message: "API rate limit exceeded" }, limited(0)));
    await expect(issues().permission("ana")).rejects.toMatchObject({ status: 403 });
    await expect(issues().permission("ana")).rejects.toBeInstanceOf(GithubHalted);
  });

  it("keeps answering none for unknown people and other errors", async () => {
    const { issues } = metered();
    stubGitHub((_, nth) => (nth === 1 ? answer(404, { message: "Not Found" }) : answer(403, { message: "Resource not accessible" }, limited(4000))));
    await expect(issues().permission("ana")).resolves.toBe("none");
    await expect(issues().permission("ana")).resolves.toBe("none");
  });
});

describe("the GitHub line of zero status", () => {
  const status = (quota?: { limit: number; remaining: number; minutes: number }, haltMinutes?: number) => {
    const { ctx, now } = metered();
    if (quota) ctx.store.setKv(QUOTA_KEY, JSON.stringify({ limit: quota.limit, remaining: quota.remaining, resetAt: new Date(inMinutes(quota.minutes)).toISOString() }));
    if (haltMinutes) ctx.store.setKv(HALT_KEY, JSON.stringify({ until: new Date(inMinutes(haltMinutes)).toISOString(), why: "x" }));
    return { ctx, lines: formatStatus(factoryStatus(ctx), now()).split("\n").filter((l) => l.startsWith("GitHub:")) };
  };

  it("shows the quota when it is low", () => {
    const { lines } = status({ limit: 5000, remaining: 1500, minutes: 30 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("1500");
    expect(lines[0]).toContain("5000");
    expect(lines[0]).not.toContain("en pausa");
  });

  it("starts right at 40%", () => {
    expect(status({ limit: 5000, remaining: 2000, minutes: 30 }).lines).toHaveLength(1);
    expect(status({ limit: 5000, remaining: 2001, minutes: 30 }).lines).toEqual([]);
  });

  it("says nothing with quota to spare, without data, or once it renewed", () => {
    expect(status({ limit: 5000, remaining: 4000, minutes: 30 }).lines).toEqual([]);
    expect(status().lines).toEqual([]);
    expect(status({ limit: 5000, remaining: 100, minutes: -1 }).lines).toEqual([]);
  });

  it("says until when the passes stay paused, also without a known quota", () => {
    const { lines } = status(undefined, 20);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/GitHub: las pasadas siguen en pausa hasta \S+/);
  });

  it("names the pass that spent the most this hour", () => {
    const { ctx, now } = metered();
    ctx.store.setKv(QUOTA_KEY, JSON.stringify({ limit: 5000, remaining: 500, resetAt: new Date(inMinutes(30)).toISOString() }));
    ctx.store.setKv(USAGE_KEY, JSON.stringify({ hour: "2030-01-15T12", passes: { issues: { requests: 3, notModified: 9 }, merges: { requests: 40, notModified: 0 } } }));
    expect(formatStatus(factoryStatus(ctx), now())).toMatch(/^GitHub: .*merges \(40\)/m);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, factoryStatus } from "../src/app.js";
import { ConfigError, DEFAULT_SIGNATURE_TEXT, parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { formatStatus } from "../src/format.js";
import { linearIssues, pollLinear, type LinearApi, type LinearIssue } from "../src/intake/linear.js";
import { askOwner, finalizeJob } from "../src/line/finish.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

/** Linear with issues, labelings and members in memory; records every comment and completion. */
function fakeLinear(opts: { members?: readonly string[]; guests?: readonly string[] } = {}) {
  const issues: LinearIssue[] = [];
  const labeledAt = new Map<string, { actor: string; at: string }>();
  const comments: { issue: string; body: string }[] = [];
  const completed: string[] = [];
  const members = new Set(opts.members ?? ["ana"]);
  const guests = new Set(opts.guests ?? []);
  const calls = { member: 0 };
  let completeFails = 0;
  let listFails = false;
  const api: LinearApi = {
    async labeled() {
      if (listFails) throw new Error("Linear caído");
      return [...issues];
    },
    async lastLabeled(id) {
      return labeledAt.get(id);
    },
    async member(user) {
      calls.member++;
      return members.has(user) && !guests.has(user);
    },
    async comment(issue, body) {
      comments.push({ issue, body });
    },
    async complete(issue) {
      if (completeFails > 0) {
        completeFails--;
        throw new Error("Linear no completó");
      }
      completed.push(issue);
    },
  };
  return {
    api,
    comments,
    completed,
    calls,
    /** An empty creator stands for an issue an integration created. */
    add(n: number, creator = "ana", labeler = "ana", at = "2026-11-07T10:00:00Z") {
      const issue = { id: `id-${n}`, identifier: `ENG-${n}`, title: `Pedido ${n}`, description: "Agregar el pie de página.", url: `https://linear.app/acme/issue/ENG-${n}`, creator: creator || undefined };
      issues.push(issue);
      labeledAt.set(issue.id, { actor: labeler, at });
      return issue;
    },
    relabel(id: string, actor: string, at: string) {
      labeledAt.set(id, { actor, at });
    },
    failComplete(times: number) {
      completeFails = times;
    },
    failList(on: boolean) {
      listFails = on;
    },
  };
}

function linearFactory(extra: Record<string, unknown> = {}) {
  return testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [], linear: { team: "ENG" }, ...extra }] });
}

const jobsOf = (ctx: ReturnType<typeof testFactory>) => ctx.store.listJobs({}).filter((j) => j.source?.kind === "linear-issue");

describe("Linear config", () => {
  const base = (linear: string) => `lines:\n  - name: demo\n    repo: /tmp/demo\n    linear: ${linear}\n`;

  it("takes a team and defaults the label to zero", () => {
    expect(parseFactory(base("{ team: ENG }")).lines[0]!.linear).toEqual({ team: "ENG", label: "zero" });
  });

  it("refuses a key in the factory file", () => {
    expect(() => parseFactory(base("{ team: ENG, apiKey: lin_api_x }"))).toThrow(ConfigError);
    expect(() => parseFactory(base("{ team: ENG, token: lin_api_x }"))).toThrow(ConfigError);
  });

  it("needs the team", () => {
    expect(() => parseFactory(base("{ label: zero }"))).toThrow(ConfigError);
  });
});

describe("Linear intake", () => {
  it("without a key calls nothing and names the secret to set", async () => {
    const ctx = linearFactory();
    ctx.store.setKv(ANDON_KEY, "on");
    // No `linear` option: the daemon's real factory, with nothing in the store, so no adapter.
    await runDaemon(ctx, { once: true, pollMs: 10, scout: false, research: false, packages: false, packageUpdates: false });
    expect(jobsOf(ctx)).toEqual([]);
    expect(factoryStatus(ctx).linear[0]!.problem).toContain("zero secret set LINEAR_API_KEY");
  });

  it("turns a member's labeled issue into one job and tells the issue", async () => {
    const ctx = linearFactory();
    const linear = fakeLinear();
    linear.add(7);
    await pollLinear(ctx, () => linear.api);

    const jobs = jobsOf(ctx);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.source).toEqual({ kind: "linear-issue", team: "ENG", id: "id-7", identifier: "ENG-7", url: "https://linear.app/acme/issue/ENG-7" });
    expect(jobs[0]!.request.startsWith("Issue ENG-7 de Linear:")).toBe(true);
    expect(jobs[0]!.request).toContain("Agregar el pie de página.");
    expect(linear.comments).toHaveLength(1);
    expect(linear.comments[0]).toMatchObject({ issue: "id-7" });
    expect(linear.comments[0]!.body).toContain(jobs[0]!.id);
  });

  for (const [name, creator, labeler, opts] of [
    ["a guest wrote it", "invitado", "ana", { members: ["ana", "invitado"], guests: ["invitado"] }],
    ["someone outside the team labeled it", "ana", "ajeno", { members: ["ana"] }],
    ["an integration wrote it", "", "ana", { members: ["ana"] }],
  ] as const) {
    it(`turns it down once when ${name}`, async () => {
      const ctx = linearFactory();
      const linear = fakeLinear(opts);
      linear.add(8, creator, labeler);
      await pollLinear(ctx, () => linear.api);
      await pollLinear(ctx, () => linear.api);
      expect(jobsOf(ctx)).toEqual([]);
      expect(linear.comments).toHaveLength(1);
      expect(linear.comments[0]!.body).toContain("no toma este issue");
    });
  }

  it("takes one job per labeling, and a newer label asks again", async () => {
    const ctx = linearFactory();
    const linear = fakeLinear();
    const issue = linear.add(9);
    await pollLinear(ctx, () => linear.api);
    await pollLinear(ctx, () => linear.api);
    expect(jobsOf(ctx)).toHaveLength(1);

    const first = jobsOf(ctx)[0]!;
    await finalizeJob(ctx, first, "failed", { reason: "no compila" });
    await pollLinear(ctx, () => linear.api);
    expect(jobsOf(ctx)).toHaveLength(1);

    linear.relabel(issue.id, "ana", "2026-11-07T12:00:00Z");
    await pollLinear(ctx, () => linear.api);
    const jobs = jobsOf(ctx);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id)).toContain(first.id);
  });

  it("tells a question once, with the job and how to answer", async () => {
    const ctx = linearFactory();
    const linear = fakeLinear();
    linear.add(10);
    await pollLinear(ctx, () => linear.api);
    const job = jobsOf(ctx)[0]!;
    askOwner(ctx, ctx.store.getJob(job.id)!, { kind: "before-integrate", text: "¿Lo integro?" });
    const before = linear.comments.length;
    await pollLinear(ctx, () => linear.api);
    await pollLinear(ctx, () => linear.api);
    const added = linear.comments.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.body).toContain(job.id);
    expect(added[0]!.body).toContain("zero approve");
    expect(added[0]!.body).not.toContain("comentando acá");
  });

  it("tells a failure with its reason", async () => {
    const ctx = linearFactory();
    const linear = fakeLinear();
    linear.add(11);
    await pollLinear(ctx, () => linear.api);
    await finalizeJob(ctx, jobsOf(ctx)[0]!, "failed", { reason: "los tests no pasan" });
    await pollLinear(ctx, () => linear.api);
    await pollLinear(ctx, () => linear.api);
    expect(linear.comments.filter((c) => c.body.includes("los tests no pasan"))).toHaveLength(1);
    expect(linear.completed).toEqual([]);
  });

  it("tells a stop", async () => {
    const ctx = linearFactory();
    const linear = fakeLinear();
    linear.add(12);
    await pollLinear(ctx, () => linear.api);
    await finalizeJob(ctx, jobsOf(ctx)[0]!, "stopped", { reason: "Lo detuviste vos." });
    await pollLinear(ctx, () => linear.api);
    expect(linear.comments.at(-1)!.body).toContain("se detuvo");
  });

  it("signs every comment with the line's signature", async () => {
    const ctx = linearFactory();
    const linear = fakeLinear({ members: ["ana"] });
    linear.add(13);
    linear.add(14, "ajeno");
    await pollLinear(ctx, () => linear.api);
    expect(linear.comments).toHaveLength(2);
    for (const c of linear.comments) expect(c.body.endsWith(DEFAULT_SIGNATURE_TEXT)).toBe(true);
  });

  it("does not sign with the signature off", async () => {
    const ctx = linearFactory({ signature: "off" });
    const linear = fakeLinear();
    linear.add(15);
    await pollLinear(ctx, () => linear.api);
    expect(linear.comments[0]!.body).not.toContain(DEFAULT_SIGNATURE_TEXT);
  });

  it("comments the delivery and completes the issue", async () => {
    const ctx = linearFactory();
    const linear = fakeLinear();
    linear.add(16);
    await pollLinear(ctx, () => linear.api);
    const job = jobsOf(ctx)[0]!;
    await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/acme/web/pull/3" } });
    await pollLinear(ctx, () => linear.api);
    await pollLinear(ctx, () => linear.api);
    expect(linear.comments.filter((c) => c.body.startsWith("Listo:"))).toHaveLength(1);
    expect(linear.completed).toEqual(["id-16"]);
  });

  it("retries completing without repeating the delivery comment", async () => {
    const ctx = linearFactory();
    const linear = fakeLinear();
    linear.add(17);
    await pollLinear(ctx, () => linear.api);
    const job = jobsOf(ctx)[0]!;
    await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/acme/web/pull/4" } });
    linear.failComplete(1);
    await pollLinear(ctx, () => linear.api);
    expect(linear.completed).toEqual([]);
    expect(factoryStatus(ctx).linear[0]!.problem).toContain("Linear no completó");
    await pollLinear(ctx, () => linear.api);
    expect(linear.completed).toEqual(["id-17"]);
    expect(linear.comments.filter((c) => c.body.startsWith("Listo:"))).toHaveLength(1);
    expect(factoryStatus(ctx).linear[0]!.problem).toBeUndefined();
  });

  it("keeps one line's error to that line", async () => {
    const ctx = testFactory({
      level: "L2",
      isolation: "worktree",
      lines: [
        { name: "uno", repo: gitRepo(), verify: [], linear: { team: "ENG" } },
        { name: "dos", repo: gitRepo(), verify: [], linear: { team: "OPS" } },
      ],
    });
    const broken = fakeLinear();
    broken.failList(true);
    const good = fakeLinear();
    good.add(18);
    await pollLinear(ctx, (line) => (line.name === "uno" ? broken.api : good.api));
    expect(jobsOf(ctx).map((j) => j.line)).toEqual(["dos"]);
    const status = factoryStatus(ctx).linear;
    expect(status.find((l) => l.line === "uno")!.problem).toContain("Linear caído");
    expect(status.find((l) => l.line === "dos")!.problem).toBeUndefined();
  });

  it("shows the lines taking Linear issues in zero status", () => {
    const ctx = linearFactory();
    const text = formatStatus(factoryStatus(ctx));
    const line = text.split("\n").find((l) => l.startsWith("Issues de Linear:"));
    expect(line).toBeDefined();
    for (const part of ["demo", "ENG", "zero"]) expect(line).toContain(part);
  });

  it("is read by a one-shot daemon run with an injected adapter", async () => {
    const ctx = linearFactory();
    // The andon keeps the job from running: only the intake matters here.
    ctx.store.setKv(ANDON_KEY, "on");
    const linear = fakeLinear();
    linear.add(19);
    await runDaemon(ctx, { once: true, pollMs: 10, linear: () => linear.api, scout: false, research: false, packages: false, packageUpdates: false });
    expect(jobsOf(ctx).map((j) => (j.source?.kind === "linear-issue" ? j.source.identifier : ""))).toEqual(["ENG-19"]);
  });
});

describe("Linear adapter", () => {
  /** A fetch answering each GraphQL operation by a word of its query, recording what was sent. */
  function fakeFetch(answers: Record<string, unknown>) {
    const sent: { auth?: string; query: string; variables: Record<string, unknown> }[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      sent.push({ auth: (init.headers as Record<string, string>).Authorization, ...body });
      const key = Object.keys(answers).find((k) => body.query.includes(k));
      return new Response(JSON.stringify(key ? answers[key] : { errors: [{ message: "unknown" }] }), { status: 200 });
    }) as typeof fetch;
    return { fetcher, sent };
  }

  it("sends the key as Authorization and drops malformed issues", async () => {
    const { fetcher, sent } = fakeFetch({
      "issues(": { data: { issues: { nodes: [{ id: "a", identifier: "ENG-1", title: "T", url: "https://linear.app/x", creator: { id: "u" } }, { id: 5 }, "x"], pageInfo: { hasNextPage: false } } } },
    });
    const issues = await linearIssues("lin_api_secret", fetcher).labeled("ENG", "zero");
    expect(issues).toEqual([{ id: "a", identifier: "ENG-1", title: "T", description: "", url: "https://linear.app/x", creator: "u" }]);
    expect(sent[0]!.auth).toBe("lin_api_secret");
    expect(sent[0]!.variables).toMatchObject({ team: "ENG", label: "zero" });
  });

  it("finds the latest labeling in the history", async () => {
    const { fetcher } = fakeFetch({
      "labels {": { data: { issue: { labels: { nodes: [{ id: "L1", name: "zero" }] } } } },
      "history(": {
        data: {
          issue: {
            history: {
              nodes: [
                { createdAt: "2026-11-01T00:00:00Z", addedLabelIds: ["L1"], actor: { id: "ana" } },
                { createdAt: "2026-11-03T00:00:00Z", addedLabelIds: ["L1"], actor: { id: "beto" } },
                { createdAt: "2026-11-04T00:00:00Z", addedLabelIds: ["L2"], actor: { id: "carla" } },
                { createdAt: 3, addedLabelIds: "L1" },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
    });
    expect(await linearIssues("k", fetcher).lastLabeled("a", "zero")).toEqual({ actor: "beto", at: "2026-11-03T00:00:00Z" });
  });

  it("counts only active non-guest team members", async () => {
    const answer = (user: unknown) => fakeFetch({ "user(": { data: { user } } }).fetcher;
    const team = { nodes: [{ key: "ENG" }] };
    expect(await linearIssues("k", answer({ active: true, guest: false, teams: team })).member("u", "ENG")).toBe(true);
    expect(await linearIssues("k", answer({ active: true, guest: true, teams: team })).member("u", "ENG")).toBe(false);
    expect(await linearIssues("k", answer({ active: false, guest: false, teams: team })).member("u", "ENG")).toBe(false);
    expect(await linearIssues("k", answer({ active: true, guest: false, teams: { nodes: [] } })).member("u", "ENG")).toBe(false);
    expect(await linearIssues("k", answer(null)).member("u", "ENG")).toBe(false);
  });

  it("completes through the team's completed state and throws on GraphQL errors", async () => {
    const { fetcher, sent } = fakeFetch({
      workflowStates: { data: { workflowStates: { nodes: [{ id: "S2", position: 2 }, { id: "S1", position: 1 }] } } },
      issueUpdate: { data: { issueUpdate: { success: true } } },
    });
    await linearIssues("k", fetcher).complete("a", "ENG");
    expect(sent.at(-1)!.variables).toEqual({ id: "a", stateId: "S1" });
    await expect(linearIssues("k", fakeFetch({}).fetcher).comment("a", "hola")).rejects.toThrow(/unknown/);
  });
});


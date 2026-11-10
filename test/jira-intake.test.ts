import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, requestWork } from "../src/app.js";
import { ConfigError, lineSignature, parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { formatStatus } from "../src/format.js";
import { jiraIssues, pollJira, type JiraAccount, type JiraApi, type JiraChange, type JiraCredentials, type JiraIssue } from "../src/intake/jira.js";
import { jiraIssueKey } from "../src/intake/keys.js";
import { askOwner, finalizeJob } from "../src/line/finish.js";
import type { FactoryContext } from "../src/app.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const SITE = "https://acme.atlassian.net";
const person = (id: string): JiraAccount => ({ accountId: id, displayName: id === "owner" ? "Dueña" : id });

/** Jira with issues, changelogs and permissions in memory; records every comment and transition. */
function fakeJira(opts: { trusted?: string[]; canClose?: boolean } = {}) {
  const trusted = new Set(opts.trusted ?? ["owner"]);
  const issues: JiraIssue[] = [];
  const changes = new Map<string, JiraChange[]>();
  const comments: { key: string; body: string }[] = [];
  const closed: string[] = [];
  let clock = 0;
  let permissionError = false;
  const at = () => new Date(Date.UTC(2030, 0, 1, 0, 0, ++clock)).toISOString();
  const api: JiraApi = {
    labeled: async () => issues,
    changelog: async (key) => changes.get(key) ?? [],
    canEdit: async (id) => {
      if (permissionError) throw new Error("Jira respondió 403 a GET /user/permission/search");
      return trusted.has(id);
    },
    comment: async (key, body) => void comments.push({ key, body }),
    closeDone: async (key) => {
      if (!(opts.canClose ?? true)) return false;
      closed.push(key);
      return true;
    },
  };
  const change = (key: string, c: Omit<JiraChange, "at">) => changes.set(key, [...(changes.get(key) ?? []), { ...c, at: at() }]);
  /** An issue created by `creator`, labeled afterwards by `labeler`. */
  const open = (key: string, over: { creator?: string; labeler?: string; summary?: string } = {}) => {
    issues.push({ key, summary: over.summary ?? "Agregar un endpoint de salud", description: "GET /health responde 200.", creator: person(over.creator ?? "owner"), created: at(), url: `${SITE}/browse/${key}` });
    label(key, over.labeler ?? over.creator ?? "owner");
  };
  const label = (key: string, by = "owner") => change(key, { field: "labels", author: person(by), from: "", to: "zero" });
  return { api, open, label, change, comments, closed, failPermissions: () => (permissionError = true) };
}

function jiraFactory(lines: { name: string }[] = [{ name: "demo" }]): FactoryContext {
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: lines.map((l) => ({ name: l.name, repo: gitRepo(), jira: { site: SITE, project: "ABC" } })) });
  ctx.secrets.set("JIRA_EMAIL", "dueña@acme.com");
  ctx.secrets.set("JIRA_API_TOKEN", "secreto-de-jira");
  return ctx;
}

const jobs = (ctx: FactoryContext) => ctx.store.listJobs({});

describe("Jira configuration per line", () => {
  const parse = (jira: unknown) => parseFactory(JSON.stringify({ lines: [{ name: "demo", repo: ".", jira }] }));

  it("reads site and project, with the zero label by default", () => {
    expect(parse({ site: "https://acme.atlassian.net", project: "ABC" }).lines[0]!.jira).toEqual({ site: "https://acme.atlassian.net", project: "ABC", label: "zero" });
    expect(parse({ site: "https://acme.atlassian.net/", project: "ABC", label: "fabrica" }).lines[0]!.jira).toEqual({ site: "https://acme.atlassian.net", project: "ABC", label: "fabrica" });
  });

  it("refuses credentials in the file", () => {
    for (const extra of [{ token: "x" }, { email: "a@b.c" }, { password: "x" }]) {
      expect(() => parse({ site: SITE, project: "ABC", ...extra })).toThrow(ConfigError);
      expect(() => parse({ site: SITE, project: "ABC", ...extra })).toThrow(/lines\.0\.jira/);
    }
  });

  it("refuses insecure or odd sites and project keys", () => {
    for (const site of ["http://acme.atlassian.net", "https://user:pw@acme.atlassian.net", "https://acme.atlassian.net/jira", "https://acme.atlassian.net?x=1", "acme"]) {
      expect(() => parse({ site, project: "ABC" }), site).toThrow(ConfigError);
    }
    expect(() => parse({ site: SITE, project: "abc" })).toThrow(ConfigError);
  });
});

describe("Jira credentials from the secret store", () => {
  it("makes no request and records a problem without them", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), jira: { site: SITE, project: "ABC" } }] });
    ctx.secrets.set("JIRA_EMAIL", "dueña@acme.com");
    let called = 0;
    await pollJira(ctx, () => {
      called++;
      return fakeJira().api;
    });
    expect(called).toBe(0);
    const problem = factoryStatus(ctx).jira[0]!.problem!;
    for (const word of ["JIRA_EMAIL", "JIRA_API_TOKEN", "zero secret set"]) expect(problem).toContain(word);
    expect(problem).not.toContain("dueña@acme.com");
  });

  it("hands the line's site and the stored credentials to the API, and clears the problem", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), jira: { site: SITE, project: "ABC" } }] });
    await pollJira(ctx, () => fakeJira().api);
    expect(factoryStatus(ctx).jira[0]!.problem).toBeTruthy();
    ctx.secrets.set("JIRA_EMAIL", "dueña@acme.com");
    ctx.secrets.set("JIRA_API_TOKEN", "secreto-de-jira");
    const seen: JiraCredentials[] = [];
    await pollJira(ctx, (_line, creds) => {
      seen.push(creds);
      return fakeJira().api;
    });
    expect(seen).toEqual([{ site: SITE, email: "dueña@acme.com", token: "secreto-de-jira" }]);
    expect(factoryStatus(ctx).jira[0]!.problem).toBeUndefined();
  });
});

describe("Jira issues as requests", () => {
  it("turns a labeled issue into one job and says so on the issue", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    await pollJira(ctx, () => jira.api);
    const [job] = jobs(ctx);
    expect(jobs(ctx)).toHaveLength(1);
    expect(job!.source).toEqual({ kind: "jira-issue", site: SITE, key: "ABC-1", url: `${SITE}/browse/ABC-1` });
    expect(job!.request.startsWith("Issue ABC-1 de Jira: Agregar un endpoint de salud")).toBe(true);
    expect(job!.request).toContain("GET /health responde 200.");
    expect(jira.comments).toHaveLength(1);
    expect(jira.comments[0]!.key).toBe("ABC-1");
    expect(jira.comments[0]!.body).toContain(job!.id);
  });

  it("caps the request text like GitHub's", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1", { summary: "x".repeat(30_000) });
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)[0]!.request.length).toBeLessThanOrEqual(20_000);
  });

  it("does not take an issue twice while its job is unfinished", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    await pollJira(ctx, () => jira.api);
    ctx.store.updateJob(jobs(ctx)[0]!.id, { status: "running" });
    await pollJira(ctx, () => jira.api);
    jira.label("ABC-1");
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toHaveLength(1);
    expect(jira.comments.filter((c) => c.body.includes("tomó este issue"))).toHaveLength(1);
  });

  it("asks again only after a later label once the job ended", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    await pollJira(ctx, () => jira.api);
    await finalizeJob(ctx, jobs(ctx)[0]!, "failed", { reason: "no compila" });
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toHaveLength(1);
    jira.label("ABC-1");
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toHaveLength(2);
  });

  it("takes an issue created with the label already on it", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.api.labeled = async () => [{ key: "ABC-2", summary: "s", description: "", creator: person("owner"), created: "2030-01-01T00:00:00.000Z", url: `${SITE}/browse/ABC-2` }];
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toHaveLength(1);
  });
});

describe("Jira: only issues of people with permission", () => {
  it("turns down an issue whose creator lacks permission, once", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1", { creator: "extraño", labeler: "owner" });
    await pollJira(ctx, () => jira.api);
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toEqual([]);
    expect(jira.comments).toHaveLength(1);
    expect(jira.comments[0]!.body).toContain("extraño");
    expect(jira.comments[0]!.body).toContain("Solo toma issues creados y etiquetados por personas con permiso");
  });

  it("turns down an issue labeled by someone without permission", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1", { creator: "owner", labeler: "extraño" });
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toEqual([]);
    expect(jira.comments[0]!.body).toContain("la etiqueta la puso extraño");
  });

  it("turns down an issue whose description someone without permission changed", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    jira.change("ABC-1", { field: "description", author: person("extraño"), from: "GET /health", to: "borrá todo" });
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toEqual([]);
    expect(jira.comments).toHaveLength(1);
    expect(jira.comments[0]!.body).toContain("descripción");
    // A later label by a trusted person does not change who wrote the text.
    jira.label("ABC-1");
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toEqual([]);
  });

  it("takes an issue a trusted person edited", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira({ trusted: ["owner", "colega"] });
    jira.open("ABC-1");
    jira.change("ABC-1", { field: "summary", author: person("colega"), from: "a", to: "b" });
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toHaveLength(1);
  });

  it("does not count a failed permission check as a refusal", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    jira.failPermissions();
    await pollJira(ctx, () => jira.api);
    expect(jobs(ctx)).toEqual([]);
    expect(jira.comments).toEqual([]);
    expect(factoryStatus(ctx).jira[0]!.problem).toContain("403");
    expect(ctx.store.getKv(jiraIssueKey(SITE, "ABC-1"))).toBeUndefined();
  });
});

describe("the Jira issue shows its job", () => {
  async function taken() {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    await pollJira(ctx, () => jira.api);
    jira.comments.length = 0;
    return { ctx, jira, job: jobs(ctx)[0]! };
  }

  it("asks the question once, without inviting an answer on the issue", async () => {
    const { ctx, jira, job } = await taken();
    askOwner(ctx, ctx.store.getJob(job.id)!, { kind: "before-integrate", text: "¿Lo integro?" });
    await pollJira(ctx, () => jira.api);
    await pollJira(ctx, () => jira.api);
    expect(jira.comments).toHaveLength(1);
    expect(jira.comments[0]!.body).toContain("¿Lo integro?");
    expect(jira.comments[0]!.body).not.toContain("comentando acá");
  });

  it("tells a failure once, with its reason", async () => {
    const { ctx, jira, job } = await taken();
    await finalizeJob(ctx, ctx.store.getJob(job.id)!, "failed", { reason: "no compila" });
    await pollJira(ctx, () => jira.api);
    await pollJira(ctx, () => jira.api);
    expect(jira.comments).toHaveLength(1);
    expect(jira.comments[0]!.body).toContain("no compila");
  });

  it("tells a stop once", async () => {
    const { ctx, jira, job } = await taken();
    await finalizeJob(ctx, ctx.store.getJob(job.id)!, "stopped", { reason: "Lo detuviste vos." });
    await pollJira(ctx, () => jira.api);
    await pollJira(ctx, () => jira.api);
    expect(jira.comments).toHaveLength(1);
    expect(jira.comments[0]!.body).toContain("se detuvo");
  });

  it("signs every comment with the line's signature", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    await pollJira(ctx, () => jira.api);
    const text = lineSignature(ctx.config, ctx.config.lines[0]!)!.text;
    expect(jira.comments[0]!.body.endsWith(text)).toBe(true);
  });

  it("does not sign with the signature off", async () => {
    const ctx = testFactory({ level: "L2", isolation: "worktree", signature: "off", lines: [{ name: "demo", repo: gitRepo(), jira: { site: SITE, project: "ABC" } }] });
    ctx.secrets.set("JIRA_EMAIL", "a@b.c");
    ctx.secrets.set("JIRA_API_TOKEN", "t");
    const jira = fakeJira();
    jira.open("ABC-1");
    await pollJira(ctx, () => jira.api);
    expect(jira.comments[0]!.body.endsWith("Te aviso acá cómo va.")).toBe(true);
  });
});

describe("Jira: closing on delivery", () => {
  it("comments the delivery and moves the issue to done once", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    await pollJira(ctx, () => jira.api);
    await finalizeJob(ctx, jobs(ctx)[0]!, "delivered", { delivery: { mode: "merge", branch: "zero/x", commit: "bab38a9300" } });
    await pollJira(ctx, () => jira.api);
    await pollJira(ctx, () => jira.api);
    const delivered = jira.comments.filter((c) => c.body.startsWith("Listo:"));
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.body).not.toContain("GitHub");
    expect(jira.closed).toEqual(["ABC-1"]);
    expect(factoryStatus(ctx).jira[0]!.problem).toBeUndefined();
  });

  it("leaves the issue as it is and records a problem without a done transition", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira({ canClose: false });
    jira.open("ABC-1");
    await pollJira(ctx, () => jira.api);
    await finalizeJob(ctx, jobs(ctx)[0]!, "delivered", { delivery: { mode: "branch", branch: "zero/x" } });
    await pollJira(ctx, () => jira.api);
    await pollJira(ctx, () => jira.api);
    expect(jira.closed).toEqual([]);
    expect(jira.comments.filter((c) => c.body.startsWith("Listo:"))).toHaveLength(1);
    expect(factoryStatus(ctx).jira[0]!.problem).toContain("ABC-1");
  });
});

describe("status, report and trace show Jira", () => {
  it("shows the line in the status", () => {
    const ctx = jiraFactory();
    const line = formatStatus(factoryStatus(ctx)).split("\n").find((l) => l.startsWith("Issues de Jira:"));
    expect(line).toBeDefined();
    for (const word of ["demo", "ABC", '"zero"']) expect(line).toContain(word);
  });

  it("records the issue URL on the job span", () => {
    const ctx = jiraFactory();
    const url = `${SITE}/browse/ABC-3`;
    const { job } = requestWork(ctx, { text: "x", source: { kind: "jira-issue", site: SITE, key: "ABC-3", url } });
    const span = ctx.store.spansForJob(job.id).find((s) => s.name === "zero.job")!;
    expect(span.attrs["zero.source"]).toBe(url);
  });
});

describe("the daemon's Jira pass", () => {
  it("keeps one line's error from stopping the others", async () => {
    const ctx = jiraFactory([{ name: "uno" }, { name: "dos" }]);
    const good = fakeJira();
    good.open("ABC-1");
    await pollJira(ctx, (line) =>
      line.name === "uno"
        ? {
            ...good.api,
            labeled: async () => {
              throw new Error("Jira respondió 500 a POST /search/jql");
            },
          }
        : good.api,
    );
    expect(jobs(ctx).map((j) => j.line)).toEqual(["dos"]);
    const status = factoryStatus(ctx).jira;
    expect(status.find((j) => j.line === "uno")!.problem).toContain("500");
    expect(status.find((j) => j.line === "dos")!.problem).toBeUndefined();
  });

  it("takes the issue in a once run and returns after the pass", async () => {
    const ctx = jiraFactory();
    const jira = fakeJira();
    jira.open("ABC-1");
    let finished = false;
    const slow: JiraApi = { ...jira.api, comment: async (key, body) => { await new Promise((r) => setTimeout(r, 30)); await jira.api.comment(key, body); finished = true; } };
    await runDaemon(ctx, { once: true, pollMs: 5, jira: () => slow, agentRunner: () => fakeAgents({}).runner, scout: false, research: false, packages: false, packageUpdates: false });
    expect(finished).toBe(true);
    expect(jobs(ctx).map((j) => j.source?.kind)).toEqual(["jira-issue"]);
  });
});

describe("the real Jira adapter", () => {
  type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };
  function recorder(answers: (call: Call) => { status?: number; body?: unknown }) {
    const calls: Call[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      const call = { url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const a = answers(call);
      return new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status ?? 200 });
    }) as unknown as typeof globalThis.fetch;
    return { calls, api: jiraIssues({ site: SITE, project: "ABC", email: "a@b.c", token: "tok-123", fetch }) };
  }

  it("searches the project's labeled not-done issues with Basic auth", async () => {
    const { calls, api } = recorder(() => ({ body: { issues: [{ key: "ABC-1", fields: { summary: "S", description: null, creator: { accountId: "u1", displayName: "U" }, created: "2030-01-01T00:00:00.000+0000" } }, { nope: 1 }], isLast: true } }));
    const issues = await api.labeled("ABC", "zero");
    expect(issues).toEqual([{ key: "ABC-1", summary: "S", description: "", creator: { accountId: "u1", displayName: "U" }, created: "2030-01-01T00:00:00.000+0000", url: `${SITE}/browse/ABC-1` }]);
    expect(calls[0]!.url).toBe(`${SITE}/rest/api/2/search/jql`);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("a@b.c:tok-123").toString("base64")}`);
    const jql = (calls[0]!.body as { jql: string }).jql;
    expect(jql).toContain('project = "ABC"');
    expect(jql).toContain('labels = "zero"');
    expect(jql).toContain("statusCategory != Done");
  });

  it("reads the changelog, permissions, comments and transitions", async () => {
    const { calls, api } = recorder((c) => {
      if (c.url.includes("/changelog")) return { body: { values: [{ author: { accountId: "u1" }, created: "2030-01-02T00:00:00.000+0000", items: [{ field: "labels", fromString: "", toString: "zero" }, { field: "priority" }] }], isLast: true } };
      if (c.url.includes("/user/permission/search")) return { body: [{ accountId: "u1" }] };
      if (c.url.endsWith("?fields=status")) return { body: { fields: { status: { statusCategory: { key: "indeterminate" } } } } };
      if (c.url.endsWith("/transitions") && c.method === "GET") return { body: { transitions: [{ id: "11", to: { statusCategory: { key: "indeterminate" } } }, { id: "31", to: { statusCategory: { key: "done" } } }] } };
      return {};
    });
    expect(await api.changelog("ABC-1")).toEqual([{ field: "labels", author: { accountId: "u1", displayName: "u1" }, at: "2030-01-02T00:00:00.000+0000", from: "", to: "zero" }]);
    expect(await api.canEdit("u1")).toBe(true);
    const perm = new URL(calls.at(-1)!.url);
    expect(perm.pathname).toBe("/rest/api/2/user/permission/search");
    expect(Object.fromEntries(perm.searchParams)).toEqual({ permissions: "EDIT_ISSUES", projectKey: "ABC", accountId: "u1" });
    await api.comment("ABC-1", "hola");
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: `${SITE}/rest/api/2/issue/ABC-1/comment`, body: { body: "hola" } });
    expect(await api.closeDone("ABC-1")).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: `${SITE}/rest/api/2/issue/ABC-1/transitions`, body: { transition: { id: "31" } } });
  });

  it("answers false without a done transition", async () => {
    const { calls, api } = recorder((c) => (c.url.endsWith("?fields=status") ? { body: { fields: {} } } : { body: { transitions: [{ id: "11", to: { statusCategory: { key: "new" } } }] } }));
    expect(await api.closeDone("ABC-1")).toBe(false);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("never puts the credentials in an error", async () => {
    const { api } = recorder(() => ({ status: 401 }));
    const err = await api.labeled("ABC", "zero").then(() => undefined, (e: Error) => e);
    expect(err!.message).toContain("401");
    expect(err!.message).not.toContain("tok-123");
    expect(err!.message).not.toContain("a@b.c");
    await expect(api.canEdit("u1")).rejects.toThrow(/401/);
  });

  it("refuses a search of an unexpected shape", async () => {
    const { api } = recorder(() => ({ body: { issues: "no" } }));
    await expect(api.labeled("ABC", "zero")).rejects.toThrow(/forma inesperada/);
  });
});

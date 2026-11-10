import { requestWork, type FactoryContext } from "../app.js";
import { lineSignature, type LineConfig } from "../config.js";
import { signText } from "../signature.js";
import { FINAL_STATUSES } from "../state/store.js";
import { MAX_REQUEST, report } from "./github.js";
import { jiraIssueKey, jiraProblemKey } from "./keys.js";

/**
 * Jira issues as requests: for lines with `jira`, the project's not-done issues
 * carrying the label become jobs, the issue hears back how its job is going,
 * and it moves to a done status on delivery. Polled, like the GitHub intake.
 */

export interface JiraAccount {
  accountId: string;
  displayName: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  /** Plain text (REST API v2). */
  description: string;
  creator?: JiraAccount;
  created: string;
  url: string;
}

/** One changed field of the issue's changelog: labels, summary or description. */
export interface JiraChange {
  field: "labels" | "summary" | "description";
  author?: JiraAccount;
  at: string;
  from: string;
  to: string;
}

/** The slice of Jira the intake needs; tests use a fake. */
export interface JiraApi {
  /** The project's issues carrying the label whose status is not in the done category. */
  labeled(project: string, label: string): Promise<JiraIssue[]>;
  /** Label, summary and description changes, oldest first. */
  changelog(key: string): Promise<JiraChange[]>;
  /** Whether the account has EDIT_ISSUES in the project; throws when Jira cannot tell. */
  canEdit(accountId: string): Promise<boolean>;
  comment(key: string, body: string): Promise<void>;
  /** Moves the issue to a done-category status (true when it is there already); false when no transition leads there. */
  closeDone(key: string): Promise<boolean>;
}

export interface JiraCredentials {
  site: string;
  email: string;
  token: string;
}

export const JIRA_SECRETS = ["JIRA_EMAIL", "JIRA_API_TOKEN"] as const;

export interface JiraIssueState {
  job?: string;
  /** Last job status the issue was told about (`waiting:<askedAt>` for each question). */
  reported?: string;
  /** When the label the factory acted on was applied, by Jira's clock: only a later label asks again. */
  labeledAt: string;
  /** Delivered but not moved to done yet: tried again on every pass. */
  closing?: boolean;
}

type Fetch = typeof fetch;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const account = (v: unknown): JiraAccount | undefined => (isObject(v) && typeof v.accountId === "string" ? { accountId: v.accountId, displayName: str(v.displayName) || v.accountId } : undefined);
/** A JQL string literal. */
const jql = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Jira Cloud's REST API v2 with Basic auth (email and API token). Errors name the request, never the credentials. */
export function jiraIssues(opts: { site: string; project: string; email: string; token: string; fetch?: Fetch }): JiraApi {
  const site = new URL(opts.site).origin;
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.email}:${opts.token}`).toString("base64")}`;
  const call = async (method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> => {
    const res = await doFetch(`${site}/rest/api/2${path}`, {
      method,
      headers: { Authorization: auth, Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Jira respondió ${res.status} a ${method} ${path.split("?")[0]}`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  };
  const issuePath = (key: string) => `/issue/${encodeURIComponent(key)}`;
  return {
    async labeled(project, label) {
      const out: JiraIssue[] = [];
      let nextPageToken: string | undefined;
      for (let page = 0; page < 50; page++) {
        const data = await call("POST", "/search/jql", {
          jql: `project = ${jql(project)} AND labels = ${jql(label)} AND statusCategory != Done ORDER BY created ASC`,
          fields: ["summary", "description", "creator", "created"],
          maxResults: 100,
          ...(nextPageToken && { nextPageToken }),
        });
        if (!isObject(data) || !Array.isArray(data.issues)) throw new Error("Jira respondió una búsqueda con una forma inesperada");
        for (const i of data.issues) {
          if (!isObject(i) || typeof i.key !== "string" || !isObject(i.fields)) continue;
          const f = i.fields;
          out.push({ key: i.key, summary: str(f.summary), description: str(f.description), creator: account(f.creator), created: str(f.created), url: `${site}/browse/${i.key}` });
        }
        nextPageToken = typeof data.nextPageToken === "string" && data.isLast !== true ? data.nextPageToken : undefined;
        if (!nextPageToken) break;
      }
      return out;
    },
    async changelog(key) {
      const out: JiraChange[] = [];
      for (let startAt = 0, page = 0; page < 50; page++) {
        const data = await call("GET", `${issuePath(key)}/changelog?startAt=${startAt}&maxResults=100`);
        if (!isObject(data) || !Array.isArray(data.values)) throw new Error("Jira respondió un historial con una forma inesperada");
        for (const h of data.values) {
          if (!isObject(h) || !Array.isArray(h.items)) continue;
          for (const item of h.items) {
            if (!isObject(item)) continue;
            const field = str(item.field).toLowerCase();
            if (field === "labels" || field === "summary" || field === "description") out.push({ field, author: account(h.author), at: str(h.created), from: str(item.fromString), to: str(item.toString) });
          }
        }
        startAt += data.values.length;
        if (data.isLast === true || !data.values.length || (typeof data.total === "number" && startAt >= data.total)) break;
      }
      return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    },
    async canEdit(accountId) {
      const query = new URLSearchParams({ permissions: "EDIT_ISSUES", projectKey: opts.project, accountId });
      const data = await call("GET", `/user/permission/search?${query}`);
      if (!Array.isArray(data)) throw new Error("Jira respondió los permisos con una forma inesperada");
      return data.some((u) => isObject(u) && u.accountId === accountId);
    },
    async comment(key, body) {
      await call("POST", `${issuePath(key)}/comment`, { body });
    },
    async closeDone(key) {
      const issue = await call("GET", `${issuePath(key)}?fields=status`);
      const category = (s: unknown) => (isObject(s) && isObject(s.statusCategory) ? s.statusCategory.key : undefined);
      if (isObject(issue) && isObject(issue.fields) && category(issue.fields.status) === "done") return true;
      const data = await call("GET", `${issuePath(key)}/transitions`);
      if (!isObject(data) || !Array.isArray(data.transitions)) throw new Error("Jira respondió las transiciones con una forma inesperada");
      const done = data.transitions.find((t) => isObject(t) && typeof t.id === "string" && category(t.to) === "done") as { id: string } | undefined;
      if (!done) return false;
      await call("POST", `${issuePath(key)}/transitions`, { transition: { id: done.id } });
      return true;
    },
  };
}

const tokens = (labels: string) => labels.split(/\s+/).filter(Boolean);

/** Who applied the label last, and when; an issue created with it has no changelog entry, so its creator did. */
function lastLabeled(issue: JiraIssue, changes: JiraChange[], label: string): { by?: JiraAccount; at: string } {
  const added = changes.filter((c) => c.field === "labels" && tokens(c.to).includes(label) && !tokens(c.from).includes(label)).at(-1);
  return added ? { by: added.author, at: added.at } : { by: issue.creator, at: issue.created };
}

const name = (a?: JiraAccount) => a?.displayName || "una cuenta anónima";

async function takeIssues(ctx: FactoryContext, line: LineConfig & { jira: NonNullable<LineConfig["jira"]> }, jira: JiraApi, say: (key: string, body: string) => Promise<void>) {
  const { site, project, label } = line.jira;
  const trust = new Map<string, Promise<boolean>>();
  const trusted = (a?: JiraAccount) => {
    if (!a) return Promise.resolve(false);
    if (!trust.has(a.accountId)) trust.set(a.accountId, jira.canEdit(a.accountId));
    return trust.get(a.accountId)!;
  };
  for (const issue of await jira.labeled(project, label)) {
    const key = jiraIssueKey(site, issue.key);
    const raw = ctx.store.getKv(key);
    const state: JiraIssueState | undefined = raw ? JSON.parse(raw) : undefined;
    const job = state?.job ? ctx.store.getJob(state.job) : undefined;
    // One job per issue at a time; after it ends (or the issue was turned down), only a new label asks again.
    if (job && !FINAL_STATUSES.includes(job.status)) continue;
    const changes = await jira.changelog(issue.key);
    const labeled = lastLabeled(issue, changes, label);
    if (state && labeled.at <= state.labeledAt) continue;

    // Whoever wrote the text the agents will read must be trusted too, since Jira lets more people edit than create.
    const editors = changes.filter((c) => c.field !== "labels").map((c) => c.author);
    const checks = await Promise.all([issue.creator, labeled.by, ...editors].map(async (a) => ({ a, ok: await trusted(a) })));
    const [creator, labeler, ...edits] = checks;
    const badEdit = edits.find((e) => !e.ok);
    if (!creator!.ok || !labeler!.ok || badEdit) {
      ctx.store.setKv(key, JSON.stringify({ labeledAt: labeled.at } satisfies JiraIssueState));
      const who = !creator!.ok
        ? `lo creó ${name(creator!.a)}, que no tiene permiso para editar issues en el proyecto`
        : !labeler!.ok
          ? `la etiqueta la puso ${name(labeler!.a)}, que no tiene permiso para editar issues en el proyecto`
          : `su título o su descripción los cambió ${name(badEdit!.a)}, que no tiene permiso para editar issues en el proyecto`;
      await say(
        issue.key,
        `La fábrica zero no toma este issue: ${who}. Solo toma issues creados y etiquetados por personas con permiso, y que nadie sin permiso haya cambiado, porque su texto se convierte en instrucciones para los agentes. Si querés que lo haga, copialo en un issue tuyo.`,
      );
      continue;
    }

    const text = `Issue ${issue.key} de Jira: ${issue.summary}\n\n${issue.description}`.slice(0, MAX_REQUEST);
    const r = requestWork(ctx, { text, line: line.name, source: { kind: "jira-issue", site, key: issue.key, url: issue.url } });
    ctx.store.setKv(key, JSON.stringify({ job: r.job.id, reported: "queued", labeledAt: labeled.at } satisfies JiraIssueState));
    await say(issue.key, `La fábrica tomó este issue como trabajo ${r.job.id} (nivel ${r.level.level}). ${r.next} Te aviso acá cómo va.`);
  }
}

/** Tells each issue of the project how its job is going and moves delivered ones to done; returns the issues that could not be moved. */
async function reportIssues(ctx: FactoryContext, site: string, project: string, jira: JiraApi, say: (key: string, body: string) => Promise<void>): Promise<string[]> {
  const unclosed: string[] = [];
  const prefix = jiraIssueKey(site, `${project}-`);
  for (const [key, raw] of ctx.store.kvWithPrefix(prefix)) {
    let state = JSON.parse(raw) as JiraIssueState;
    const issueKey = key.slice(key.lastIndexOf("/") + 1);
    const job = state.job ? ctx.store.getJob(state.job) : undefined;
    const update = job && report(job, { replyHere: false });
    if (update && update.key !== state.reported) {
      await say(issueKey, update.body);
      state = { ...state, reported: update.key, ...(update.key === "delivered" && { closing: true }) };
      ctx.store.setKv(key, JSON.stringify(state));
    }
    if (!state.closing) continue;
    if (await jira.closeDone(issueKey)) ctx.store.setKv(key, JSON.stringify({ ...state, closing: undefined }));
    else unclosed.push(issueKey);
  }
  return unclosed;
}

/**
 * One pass over every line that takes Jira issues. A line's problem (missing
 * credentials, no access, an issue that cannot be closed) is kept for
 * `zero status` and never stops the others.
 */
export async function pollJira(ctx: FactoryContext, api: (line: LineConfig, credentials: JiraCredentials) => JiraApi | undefined): Promise<void> {
  for (const line of ctx.config.lines) {
    if (!line.jira) continue;
    const problem = jiraProblemKey(line.name);
    try {
      const [email, token] = JIRA_SECRETS.map((s) => ctx.secrets.get(s));
      if (!email || !token) {
        ctx.store.setKv(problem, "faltan las credenciales de Jira: guardalas con `zero secret set JIRA_EMAIL` y `zero secret set JIRA_API_TOKEN`");
        continue;
      }
      const jira = api(line, { site: line.jira.site, email, token });
      if (!jira) {
        ctx.store.setKv(problem, "sin acceso a Jira");
        continue;
      }
      const signature = lineSignature(ctx.config, line);
      const say = (key: string, body: string) => jira.comment(key, signText(body, signature));
      await takeIssues(ctx, { ...line, jira: line.jira }, jira, say);
      const unclosed = await reportIssues(ctx, line.jira.site, line.jira.project, jira, say);
      if (unclosed.length) ctx.store.setKv(problem, `no se pudo pasar a un estado terminado ${unclosed.join(", ")}: su flujo no tiene una transición a un estado de la categoría terminado`);
      else ctx.store.deleteKv(problem);
    } catch (err) {
      ctx.store.setKv(problem, `no se pudo leer Jira: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }
}

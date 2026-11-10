import { requestWork, type FactoryContext } from "../app.js";
import { lineSignature, type LineConfig } from "../config.js";
import { signText } from "../signature.js";
import { FINAL_STATUSES } from "../state/store.js";
import { MAX_REQUEST, report } from "./github.js";
import { linearIssueKey, linearProblemKey } from "./keys.js";

/**
 * Linear issues as requests: for lines with `linear`, open issues of the team
 * carrying the label become jobs, and the issue hears back how its job is going,
 * the same way GitHub issues do. Polled with the key in the secret LINEAR_API_KEY.
 */

export const LINEAR_SECRET = "LINEAR_API_KEY";
const ENDPOINT = "https://api.linear.app/graphql";

export interface LinearIssue {
  /** Linear's id, stable; `identifier` (ENG-7) is what people read. */
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  /** The user who created it; absent when an integration did. */
  creator?: string;
}

/** The slice of Linear the intake needs; tests use a fake. */
export interface LinearApi {
  /** Open (neither completed nor canceled) issues of the team carrying the label. */
  labeled(team: string, label: string): Promise<LinearIssue[]>;
  /** Who applied the label last, and when, from the issue's history. */
  lastLabeled(issueId: string, label: string): Promise<{ actor: string; at: string } | undefined>;
  /** True only for an active, non-guest member of the team. */
  member(userId: string, team: string): Promise<boolean>;
  comment(issueId: string, body: string): Promise<void>;
  /** Moves the issue to the team's first workflow state of type `completed`. */
  complete(issueId: string, team: string): Promise<void>;
}

export interface LinearIssueState {
  job?: string;
  /** Last job status the issue was told about (`waiting:<askedAt>` for each question). */
  reported?: string;
  /** When the label the factory acted on was applied, by Linear's clock: only a later label asks again. */
  labeledAt: string;
  /** The delivered issue was moved to a completed state. */
  completed?: boolean;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nodes = (connection: unknown): Json[] => list(obj(connection)?.nodes).flatMap((n) => (obj(n) ? [obj(n)!] : []));

/** The real adapter over Linear's GraphQL API. Every answer is read as untrusted in shape. */
export function linearIssues(key: string, fetcher: typeof fetch = fetch): LinearApi {
  async function gql(query: string, variables: Json): Promise<Json> {
    const res = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = obj(await res.json().catch(() => undefined));
    const errors = list(body?.errors).map((e) => str(obj(e)?.message)).filter(Boolean);
    if (!res.ok || errors.length || !obj(body?.data)) throw new Error(`Linear respondió ${res.status}${errors.length ? `: ${errors.join("; ")}` : ""}`.slice(0, 300));
    return obj(body!.data)!;
  }
  const pages = async (query: string, variables: Json, field: string): Promise<Json[]> => {
    const out: Json[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const data = obj((await gql(query, { ...variables, after }))[field]);
      out.push(...nodes(data));
      const info = obj(data?.pageInfo);
      after = str(info?.endCursor);
      if (info?.hasNextPage !== true || !after) break;
    }
    return out;
  };
  return {
    async labeled(team, label) {
      const found = await pages(
        `query($team: String!, $label: String!, $after: String) { issues(first: 50, after: $after, filter: { team: { key: { eq: $team } }, labels: { name: { eq: $label } }, state: { type: { nin: ["completed", "canceled"] } } }) { nodes { id identifier title description url creator { id } } pageInfo { hasNextPage endCursor } } }`,
        { team, label },
        "issues",
      );
      return found.flatMap((n) => {
        const id = str(n.id), identifier = str(n.identifier), url = str(n.url);
        if (!id || !identifier || !url) return [];
        return [{ id, identifier, title: str(n.title) ?? "", description: str(n.description) ?? "", url, creator: str(obj(n.creator)?.id) }];
      });
    },
    async lastLabeled(issueId, label) {
      const data = obj((await gql(`query($id: String!) { issue(id: $id) { labels { nodes { id name } } } }`, { id: issueId })).issue);
      const labelId = str(nodes(data?.labels).find((l) => l.name === label)?.id);
      if (!labelId) return undefined;
      // The history hangs from the issue, not from the query's root: paged by hand.
      let last: { actor: string; at: string } | undefined;
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const h = obj(obj((await gql(`query($id: String!, $after: String) { issue(id: $id) { history(first: 100, after: $after) { nodes { createdAt addedLabelIds actor { id } } pageInfo { hasNextPage endCursor } } } }`, { id: issueId, after })).issue)?.history);
        for (const entry of nodes(h)) {
          const at = str(entry.createdAt);
          const actor = str(obj(entry.actor)?.id);
          if (!at || !list(entry.addedLabelIds).includes(labelId)) continue;
          // An integration's labeling has no actor: kept, so the refusal names it, as nobody with permission.
          if (!last || at > last.at) last = { actor: actor ?? "", at };
        }
        const info = obj(h?.pageInfo);
        after = str(info?.endCursor);
        if (info?.hasNextPage !== true || !after) break;
      }
      return last;
    },
    async member(userId, team) {
      if (!userId) return false;
      const user = obj((await gql(`query($id: String!, $team: String!) { user(id: $id) { active guest teams(filter: { key: { eq: $team } }) { nodes { key } } } }`, { id: userId, team })).user);
      return user?.active === true && user.guest === false && nodes(user.teams).some((t) => t.key === team);
    },
    async comment(issueId, body) {
      const r = obj((await gql(`mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`, { issueId, body })).commentCreate);
      if (r?.success !== true) throw new Error("Linear no aceptó el comentario");
    },
    async complete(issueId, team) {
      const states = nodes(obj((await gql(`query($team: String!) { workflowStates(filter: { team: { key: { eq: $team } }, type: { eq: "completed" } }) { nodes { id position } } }`, { team })).workflowStates));
      const state = states.filter((s) => str(s.id)).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))[0];
      if (!state) throw new Error(`el equipo ${team} de Linear no tiene un estado de completado`);
      const r = obj((await gql(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, { id: issueId, stateId: state.id })).issueUpdate);
      if (r?.success !== true) throw new Error("Linear no aceptó completar el issue");
    },
  };
}

type LinearLine = LineConfig & { linear: { team: string; label: string } };

async function takeLinearIssues(ctx: FactoryContext, line: LinearLine, api: LinearApi, comment: (issueId: string, body: string) => Promise<void>) {
  const { team, label } = line.linear;
  const trust = new Map<string, Promise<boolean>>();
  const trusted = (user?: string) => {
    if (!user) return Promise.resolve(false);
    if (!trust.has(user)) trust.set(user, api.member(user, team));
    return trust.get(user)!;
  };
  for (const issue of await api.labeled(team, label)) {
    const key = linearIssueKey(team, issue.id);
    const raw = ctx.store.getKv(key);
    const state: LinearIssueState | undefined = raw ? JSON.parse(raw) : undefined;
    const job = state?.job ? ctx.store.getJob(state.job) : undefined;
    // One job per issue at a time; after it ends (or the issue was turned down), only a new label asks again.
    if (job && !FINAL_STATUSES.includes(job.status)) continue;
    const labeled = await api.lastLabeled(issue.id, label);
    if (!labeled || (state && labeled.at <= state.labeledAt)) continue;

    const [creatorOk, labelerOk] = await Promise.all([trusted(issue.creator), trusted(labeled.actor)]);
    if (!creatorOk || !labelerOk) {
      ctx.store.setKv(key, JSON.stringify({ labeledAt: labeled.at } satisfies LinearIssueState));
      const who = !creatorOk ? "lo creó alguien que no es miembro activo del equipo" : "la etiqueta la puso alguien que no es miembro activo del equipo";
      await comment(
        issue.id,
        `La fábrica zero no toma este issue: ${who} ${team} (o es invitado). Solo toma issues creados y etiquetados por miembros activos del equipo que no sean invitados, porque su texto se convierte en instrucciones para los agentes. Si querés que lo haga, copialo en un issue tuyo.`,
      );
      continue;
    }

    const text = `Issue ${issue.identifier} de Linear: ${issue.title}\n\n${issue.description}`.slice(0, MAX_REQUEST);
    const r = requestWork(ctx, { text, line: line.name, source: { kind: "linear-issue", team, id: issue.id, identifier: issue.identifier, url: issue.url } });
    ctx.store.setKv(key, JSON.stringify({ job: r.job.id, reported: "queued", labeledAt: labeled.at } satisfies LinearIssueState));
    await comment(issue.id, `La fábrica tomó este issue como trabajo \`${r.job.id}\` (nivel ${r.level.level}). ${r.next} Te aviso acá cómo va.`);
  }
}

async function reportLinearIssues(ctx: FactoryContext, team: string, api: LinearApi, comment: (issueId: string, body: string) => Promise<void>) {
  const prefix = linearIssueKey(team, "");
  for (const [key, raw] of ctx.store.kvWithPrefix(prefix)) {
    let state = JSON.parse(raw) as LinearIssueState;
    const job = state.job ? ctx.store.getJob(state.job) : undefined;
    if (!job) continue;
    const issueId = key.slice(prefix.length);
    const update = report(job, { replyHere: false });
    if (update && update.key !== state.reported) {
      await comment(issueId, update.body);
      state = { ...state, reported: update.key };
      ctx.store.setKv(key, JSON.stringify(state));
    }
    // Recorded apart from the comment, so a failed move is retried without telling the delivery twice.
    if (job.status === "delivered" && state.reported === "delivered" && !state.completed) {
      await api.complete(issueId, team);
      ctx.store.setKv(key, JSON.stringify({ ...state, completed: true } satisfies LinearIssueState));
    }
  }
}

/**
 * One pass over every line that takes Linear issues. Every comment carries the
 * line's signature. A line's problem (no key, Linear failing) is kept for
 * `zero status`, cleared by its next good pass, and never stops the others.
 */
export async function pollLinear(ctx: FactoryContext, api: (line: LineConfig) => LinearApi | undefined): Promise<void> {
  for (const line of ctx.config.lines) {
    if (!line.linear) continue;
    const problem = linearProblemKey(line.name);
    const linear = api(line);
    if (!linear) {
      ctx.store.setKv(problem, `sin clave de Linear: guardala con \`zero secret set ${LINEAR_SECRET}\``);
      continue;
    }
    const signature = lineSignature(ctx.config, line);
    const comment = (issueId: string, body: string) => linear.comment(issueId, signText(body, signature));
    try {
      await takeLinearIssues(ctx, { ...line, linear: line.linear }, linear, comment);
      await reportLinearIssues(ctx, line.linear.team, linear, comment);
      ctx.store.deleteKv(problem);
    } catch (err) {
      ctx.store.setKv(problem, `no se pudo leer Linear: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }
}

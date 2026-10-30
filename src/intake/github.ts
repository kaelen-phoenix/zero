import { Octokit } from "@octokit/rest";
import { requestWork, type FactoryContext } from "../app.js";
import type { LineConfig } from "../config.js";
import { describeDelivery } from "../line/finish.js";
import { githubRepository } from "../line/integrate.js";
import { tryGit } from "../shell.js";
import { FINAL_STATUSES, type Job } from "../state/store.js";
import type { AgentRunner } from "../agent.js";
import { answerComments } from "./comments.js";
import { FACTORY_MARK, intakeProblemKey, issueKey, PROPOSAL_LABEL } from "./keys.js";

/**
 * GitHub issues as requests: for lines with `issues`, open issues carrying the
 * label become jobs, and the issue hears back how its job is going. Polled, so
 * the owner's machine needs no public address.
 */

export interface Issue {
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  isPullRequest: boolean;
  labels: string[];
}

export interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

/** The slice of GitHub the intake needs; tests use a fake. */
export interface IssueApi {
  labeled(label: string): Promise<Issue[]>;
  /** Open issues without any label, pull requests left out, newest first. */
  unlabeled(): Promise<Issue[]>;
  /** The issue's state and labels now, and who closed it when it is closed. */
  issue(number: number): Promise<{ state: "open" | "closed"; labels: string[]; closedBy?: string }>;
  /** Who applied the label last, and when. */
  lastLabeled(number: number, label: string): Promise<{ actor: string; at: string } | undefined>;
  /** `admin`, `write`, `read` or `none`. */
  permission(login: string): Promise<string>;
  comment(number: number, body: string): Promise<void>;
  /** Every comment on the issue, oldest first. */
  comments(number: number): Promise<IssueComment[]>;
  /** Creates the label if the repository does not have it; true when it had to. */
  ensureLabel(label: string, description?: string): Promise<boolean>;
  createIssue(title: string, body: string, labels: string[]): Promise<{ number: number; url: string }>;
  addLabels(number: number, labels: string[]): Promise<void>;
  /** Closes the issue, as not planned unless said otherwise. */
  close(number: number, reason?: "completed" | "not_planned"): Promise<void>;
}

/** GitHub lists labels as names or as objects. */
const labelNames = (labels: (string | { name?: string })[]) => labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean);

type RestIssue = { number: number; title: string; body?: string | null; user: { login: string } | null; html_url: string; pull_request?: unknown; labels: (string | { name?: string })[] };
const toIssue = (i: RestIssue): Issue => ({ number: i.number, title: i.title, body: i.body ?? "", author: i.user?.login ?? "", url: i.html_url, isPullRequest: Boolean(i.pull_request), labels: labelNames(i.labels) });

export function githubIssues(token: string, repository: string): IssueApi {
  const [owner, repo] = repository.split("/") as [string, string];
  // Missing labels and permissions are expected answers, not errors to print.
  const gh = new Octokit({ auth: token, log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
  return {
    async labeled(label) {
      const issues = await gh.paginate(gh.issues.listForRepo, { owner, repo, state: "open", labels: label, per_page: 100 });
      return issues.map(toIssue);
    },
    async unlabeled() {
      const issues = await gh.paginate(gh.issues.listForRepo, { owner, repo, state: "open", sort: "created", direction: "desc", per_page: 100 });
      return issues.map(toIssue).filter((i) => !i.isPullRequest && !i.labels.length);
    },
    async issue(number) {
      const { data } = await gh.issues.get({ owner, repo, issue_number: number });
      return { state: data.state === "closed" ? "closed" : "open", labels: labelNames(data.labels), closedBy: data.closed_by?.login };
    },
    async lastLabeled(number, label) {
      const events = await gh.paginate(gh.issues.listEvents, { owner, repo, issue_number: number, per_page: 100 });
      const last = events.filter((e) => e.event === "labeled" && (e as { label?: { name?: string } }).label?.name === label).at(-1);
      return last?.actor ? { actor: last.actor.login, at: last.created_at } : undefined;
    },
    async permission(login) {
      try {
        return (await gh.repos.getCollaboratorPermissionLevel({ owner, repo, username: login })).data.permission;
      } catch {
        return "none";
      }
    },
    async comment(number, body) {
      await gh.issues.createComment({ owner, repo, issue_number: number, body: `${body}\n\n${FACTORY_MARK}` });
    },
    async comments(number) {
      const all = await gh.paginate(gh.issues.listComments, { owner, repo, issue_number: number, per_page: 100 });
      return all.map((c) => ({ author: c.user?.login ?? "", body: c.body ?? "", createdAt: c.created_at }));
    },
    async ensureLabel(label, description = "Trabajo para la fábrica zero") {
      try {
        await gh.issues.getLabel({ owner, repo, name: label });
        return false;
      } catch {
        await gh.issues.createLabel({ owner, repo, name: label, color: "5319e7", description });
        return true;
      }
    },
    async createIssue(title, body, labels) {
      const { data } = await gh.issues.create({ owner, repo, title, body, labels });
      return { number: data.number, url: data.html_url };
    },
    async addLabels(number, labels) {
      await gh.issues.addLabels({ owner, repo, issue_number: number, labels });
    },
    async close(number, reason = "not_planned") {
      await gh.issues.update({ owner, repo, issue_number: number, state: "closed", state_reason: reason });
    },
  };
}

/** Write access (admin covers maintain; write covers it too in GitHub's legacy permission field). */
export const TRUSTED = new Set(["admin", "write"]);
const MAX_REQUEST = 20_000;

export interface IssueState {
  job?: string;
  /** GitHub time of the last comment the factory handled; later ones are new. */
  commentsSeen?: string;
  /** Last job status the issue was told about (`waiting:<askedAt>` for each question). */
  reported?: string;
  /** When the label the factory acted on was applied, by GitHub's clock: only a later label asks again. */
  labeledAt: string;
}

/** owner/repo of the line's remote, when it is GitHub. */
export function lineRepository(line: LineConfig): string | undefined {
  const url = tryGit(["remote", "get-url", line.remote], line.repo);
  return url ? githubRepository(url) : undefined;
}

const quote = (text: string) => text.split("\n").map((l) => `> ${l}`).join("\n");

/** What the issue is told when its job reaches a status worth telling, once per status (and per question). */
function report(job: Job): { key: string; body: string } | undefined {
  const id = `\`${job.id}\``;
  if (job.status === "waiting" && job.question) {
    const timeout = job.question.onTimeout === "approve" ? "se aprueba" : "se rechaza";
    return {
      key: `waiting:${job.question.askedAt}`,
      body: `La fábrica necesita tu respuesta en el trabajo ${id}:\n\n${quote(job.question.text)}\n\nRespondé comentando acá ("aprobado" o "rechazado"), desde el panel o el chat (\`zero approve ${job.id}\`, o con \`--reject\`). Si nadie responde antes de ${job.question.expiresAt.slice(0, 16).replace("T", " ")} UTC, ${timeout}.`,
    };
  }
  if (job.status === "delivered" && job.delivery) {
    const local =
      job.delivery.mode === "merge"
        ? " Quedó en la rama base de tu PC, no en GitHub: para publicarlo, subila (`git push`)."
        : job.delivery.mode === "branch"
          ? " La rama quedó en tu PC, sin subir."
          : "";
    return { key: "delivered", body: `Listo: ${describeDelivery(job.delivery)}.${local}` };
  }
  if (job.status === "failed") return { key: "failed", body: `El trabajo ${id} no se pudo completar:\n\n${quote(job.reason ?? "(sin detalle)")}\n\nPara volver a pedirlo, sacale y volvele a poner la etiqueta.` };
  if (job.status === "stopped") return { key: "stopped", body: `El trabajo ${id} se detuvo: ${job.reason ?? "por el dueño"}.` };
  return undefined;
}

async function takeIssues(ctx: FactoryContext, line: LineConfig & { issues: { label: string } }, repository: string, gh: IssueApi) {
  const trust = new Map<string, Promise<boolean>>();
  const trusted = (login: string) => {
    if (!trust.has(login)) trust.set(login, gh.permission(login).then((p) => TRUSTED.has(p)));
    return trust.get(login)!;
  };
  for (const issue of await gh.labeled(line.issues.label)) {
    // Proposal issues are decided by the proposal sync, never taken as plain requests.
    if (issue.isPullRequest || issue.labels.includes(PROPOSAL_LABEL)) continue;
    const key = issueKey(repository, issue.number);
    const raw = ctx.store.getKv(key);
    const state: IssueState | undefined = raw ? JSON.parse(raw) : undefined;
    const job = state?.job ? ctx.store.getJob(state.job) : undefined;
    // One job per issue at a time; after it ends (or the issue was turned down), only a new label asks again.
    if (job && !FINAL_STATUSES.includes(job.status)) continue;
    const labeled = await gh.lastLabeled(issue.number, line.issues.label);
    if (!labeled || (state && labeled.at <= state.labeledAt)) continue;

    const [authorOk, labelerOk] = await Promise.all([trusted(issue.author), trusted(labeled.actor)]);
    if (!authorOk || !labelerOk) {
      ctx.store.setKv(key, JSON.stringify({ labeledAt: labeled.at } satisfies IssueState));
      const who = !authorOk ? `lo escribió @${issue.author}, que no tiene permiso de escritura en el repositorio` : `la etiqueta la puso @${labeled.actor}, que no tiene permiso de escritura`;
      await gh.comment(
        issue.number,
        `La fábrica zero no toma este issue: ${who}. Solo toma issues escritos y etiquetados por personas con permiso de escritura, porque su texto se convierte en instrucciones para los agentes. Si querés que lo haga, copialo en un issue tuyo.`,
      );
      continue;
    }

    const text = `Issue #${issue.number} de GitHub: ${issue.title}\n\n${issue.body}`.slice(0, MAX_REQUEST);
    const r = requestWork(ctx, { text, line: line.name, source: { kind: "github-issue", repository, number: issue.number, url: issue.url } });
    ctx.store.setKv(key, JSON.stringify({ job: r.job.id, reported: "queued", labeledAt: labeled.at } satisfies IssueState));
    await gh.comment(issue.number, `La fábrica tomó este issue como trabajo \`${r.job.id}\` (nivel ${r.level.level}). ${r.next} Te aviso acá cómo va.`);
  }
}

async function reportIssues(ctx: FactoryContext, repository: string, gh: IssueApi) {
  for (const [key, raw] of ctx.store.kvWithPrefix(`issue:${repository}#`)) {
    const state = JSON.parse(raw) as IssueState;
    const job = state.job ? ctx.store.getJob(state.job) : undefined;
    const update = job && report(job);
    if (!update || update.key === state.reported) continue;
    await gh.comment(Number(key.slice(key.lastIndexOf("#") + 1)), update.body);
    ctx.store.setKv(key, JSON.stringify({ ...state, reported: update.key } satisfies IssueState));
  }
}

/**
 * One pass over every line that takes issues. A line's problem (no GitHub
 * remote, no access) is kept for `zero status` and never stops the others.
 */
export async function pollIssues(ctx: FactoryContext, api: (repository: string, line: LineConfig) => IssueApi | undefined, opts: { runAgent?: AgentRunner } = {}): Promise<void> {
  for (const line of ctx.config.lines) {
    if (!line.issues) continue;
    const problem = intakeProblemKey(line.name);
    const repository = lineRepository(line);
    const gh = repository && api(repository, line);
    if (!repository || !gh) {
      ctx.store.setKv(problem, repository ? "sin acceso a GitHub: iniciá sesión con `gh auth login` o definí GH_TOKEN" : `el remoto "${line.remote}" no es un repositorio de GitHub`);
      continue;
    }
    try {
      await takeIssues(ctx, { ...line, issues: line.issues }, repository, gh);
      await reportIssues(ctx, repository, gh);
      if (opts.runAgent) await answerComments(ctx, line, repository, gh, opts.runAgent);
      ctx.store.deleteKv(problem);
    } catch (err) {
      ctx.store.setKv(problem, `no se pudo leer GitHub: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }
}

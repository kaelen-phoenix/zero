import { Octokit } from "@octokit/rest";
import { requestWork, type FactoryContext } from "../app.js";
import type { LineConfig } from "../config.js";
import { SEVERITY_TEXT } from "../format.js";
import { GithubHalted, isRateLimit } from "../github-quota.js";
import { FINAL_STATUSES, type AlertSeverity, type Job } from "../state/store.js";
import { lineRepository, MAX_REQUEST } from "./github.js";
import { securityAlertKey, securityAlertsKey, securityAlertsProblemKey } from "./keys.js";

/**
 * GitHub's Dependabot alerts as urgent patches: for every line on GitHub whose
 * `securityAlerts.mode` is not `off`, the open alerts are read through the
 * factory's GitHub quota and kept as the line's snapshot for `zero status` and
 * the briefing. In `jobs` mode, new alerts at or above `minSeverity` with a
 * published fix become one job per package, and each alert is taken only once.
 */

export interface DependabotAlert {
  number: number;
  ecosystem: string;
  package: string;
  /** Manifest the vulnerable dependency was found in. */
  manifest: string;
  severity: AlertSeverity;
  ghsa: string;
  summary: string;
  url: string;
  /** First version that fixes it, when one is published. */
  fixed?: string;
}

/** The slice of GitHub the pass needs; tests use a fake. */
export interface AlertApi {
  /** Open Dependabot alerts of the repository. */
  openAlerts(): Promise<DependabotAlert[]>;
}

/** One open alert as `zero status` and the briefing show it. */
export interface AlertEntry {
  number: number;
  package: string;
  ecosystem: string;
  severity: AlertSeverity;
  url: string;
  fixed?: string;
  /** The job that handles it. */
  job?: string;
}

/** What the pass remembers of an alert it took. */
export interface TakenAlert {
  job: string;
  at: string;
}

const SEVERITIES: AlertSeverity[] = ["low", "medium", "high", "critical"];
const rank = (s: AlertSeverity) => SEVERITIES.indexOf(s);
const severityOf = (s: string | undefined): AlertSeverity => (SEVERITIES.includes(s as AlertSeverity) ? (s as AlertSeverity) : "medium");

type RestAlert = {
  number: number;
  html_url: string;
  dependency?: { package?: { ecosystem?: string; name?: string }; manifest_path?: string };
  security_advisory?: { ghsa_id?: string; summary?: string; severity?: string };
  security_vulnerability?: { severity?: string; first_patched_version?: { identifier?: string } | null };
};

/** Third-party text kept to one short line, so no field of an alert can lay out the request, the status or the briefing it ends up in. */
const oneLine = (text: unknown, max = 200) => {
  const flat = (typeof text === "string" ? text : "").replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const toAlert = (a: RestAlert): DependabotAlert => {
  const fixed = oneLine(a.security_vulnerability?.first_patched_version?.identifier, 80);
  return {
    number: a.number,
    ecosystem: oneLine(a.dependency?.package?.ecosystem, 40),
    package: oneLine(a.dependency?.package?.name),
    manifest: oneLine(a.dependency?.manifest_path, 300),
    severity: severityOf(a.security_vulnerability?.severity ?? a.security_advisory?.severity),
    ghsa: oneLine(a.security_advisory?.ghsa_id, 40),
    summary: oneLine(a.security_advisory?.summary),
    url: oneLine(a.html_url, 300),
    ...(fixed && { fixed }),
  };
};

export function githubAlerts(token: string, repository: string, client?: Octokit): AlertApi {
  const [owner, repo] = repository.split("/") as [string, string];
  const gh = client ?? new Octokit({ auth: token, log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
  return {
    async openAlerts() {
      const alerts = await gh.paginate(gh.dependabot.listAlertsForRepo, { owner, repo, state: "open", per_page: 100 });
      return (alerts as RestAlert[]).map(toAlert);
    },
  };
}

/** Compares versions segment by segment, numbers as numbers: enough to pick the highest fix of a package. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/i, "").split(/[.\-+_]/);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const [x, y] = [pa[i], pb[i]];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const [nx, ny] = [Number(x), Number(y)];
    const diff = Number.isInteger(nx) && Number.isInteger(ny) ? nx - ny : x.localeCompare(y);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/** The request of a package's job: what to update, to which version, and the alerts behind it. */
export function alertRequest(repository: string, alerts: DependabotAlert[], target: string): string {
  const { package: name, ecosystem } = alerts[0]!;
  const manifests = [...new Set(alerts.map((a) => a.manifest).filter(Boolean))];
  return [
    `Actualizar ${name} (${ecosystem}) a ${target} por alertas de seguridad de Dependabot`,
    `GitHub informa alertas de Dependabot abiertas en ${repository} para la dependencia ${name} del ecosistema ${ecosystem}:`,
    alerts.map((a) => `- Alerta #${a.number} (${SEVERITY_TEXT[a.severity]}) ${a.ghsa || "sin GHSA"}: ${oneLine(a.summary) || "(sin resumen)"} · corregida en ${a.fixed} · ${a.url}`).join("\n"),
    `Manifiestos: ${manifests.length ? manifests.join(", ") : "(GitHub no los informa)"}.`,
    `Actualizá la dependencia ${name} a la versión ${target} (la más alta entre las versiones corregidas de estas alertas) en esos manifiestos y su lockfile, sin otros cambios, y dejá los tests pasando. Si esa versión no existe, usá la mínima que corrija todas estas alertas.`,
  ]
    .join("\n\n")
    .slice(0, MAX_REQUEST);
}

const packageKey = (a: { ecosystem: string; package: string }) => `${a.ecosystem}\u0000${a.package}`;

/** The line's security job for this package that has not finished yet, if any. */
function unfinishedJob(ctx: FactoryContext, line: string, repository: string, alert: DependabotAlert): Job | undefined {
  return ctx.store
    .listJobs({ line, limit: -1 })
    .find((j) => !FINAL_STATUSES.includes(j.status) && j.source?.kind === "security-alert" && j.source.repository === repository && packageKey(j.source) === packageKey(alert));
}

const status = (err: unknown) => (err as { status?: number } | undefined)?.status;

function readProblem(err: unknown): string {
  if (status(err) === 403) return "GitHub no deja leer las alertas de Dependabot: el token necesita permiso de lectura de alertas de Dependabot (o de seguridad) en el repositorio";
  if (status(err) === 404) return "GitHub no encuentra las alertas de Dependabot: revisá que estén activadas en el repositorio y que el token lo vea";
  return `no se pudieron leer las alertas de Dependabot: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
}

function takeAlerts(ctx: FactoryContext, line: LineConfig, repository: string, alerts: DependabotAlert[]) {
  const now = (ctx.now ?? (() => new Date()))().toISOString();
  const min = rank(line.securityAlerts.minSeverity);
  const groups = new Map<string, DependabotAlert[]>();
  for (const alert of alerts) {
    if (rank(alert.severity) < min || !alert.fixed || !alert.package) continue;
    if (ctx.store.getKv(securityAlertKey(repository, alert.number))) continue;
    groups.set(packageKey(alert), [...(groups.get(packageKey(alert)) ?? []), alert]);
  }
  for (const group of groups.values()) {
    const first = group[0]!;
    let job = unfinishedJob(ctx, line.name, repository, first);
    if (!job) {
      const target = group.map((a) => a.fixed!).reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
      const severity = group.map((a) => a.severity).reduce((a, b) => (rank(a) >= rank(b) ? a : b));
      const source = { kind: "security-alert" as const, repository, ecosystem: first.ecosystem, package: first.package, alerts: group.map((a) => a.number), severity };
      job = requestWork(ctx, { text: alertRequest(repository, group, target), line: line.name, source }).job;
    }
    for (const alert of group) ctx.store.setKv(securityAlertKey(repository, alert.number), JSON.stringify({ job: job.id, at: now } satisfies TakenAlert));
  }
}

/** The line's open alerts as shown, each with the job that took it. */
function snapshot(ctx: FactoryContext, repository: string, alerts: DependabotAlert[]): AlertEntry[] {
  return alerts.map((a) => {
    const raw = ctx.store.getKv(securityAlertKey(repository, a.number));
    const taken: TakenAlert | undefined = raw ? JSON.parse(raw) : undefined;
    return { number: a.number, package: a.package, ecosystem: a.ecosystem, severity: a.severity, url: a.url, ...(a.fixed && { fixed: a.fixed }), ...(taken && { job: taken.job }) };
  });
}

/**
 * One pass over every line. A line that cannot be read keeps its problem for
 * `zero status` and never stops the others; a GitHub limit ends the pass with
 * nothing recorded, so the next pass asks again.
 */
export async function pollSecurityAlerts(ctx: FactoryContext, api: (repository: string, line: LineConfig) => AlertApi | undefined): Promise<void> {
  for (const line of ctx.config.lines) {
    if (line.securityAlerts.mode === "off") continue;
    const repository = lineRepository(line);
    if (!repository) continue;
    const problem = securityAlertsProblemKey(line.name);
    const gh = api(repository, line);
    if (!gh) {
      ctx.store.setKv(problem, "sin acceso a GitHub: iniciá sesión con `gh auth login` o definí GH_TOKEN");
      continue;
    }
    let alerts: DependabotAlert[];
    try {
      alerts = await gh.openAlerts();
    } catch (err) {
      if (err instanceof GithubHalted || isRateLimit(err)) throw err;
      ctx.store.setKv(problem, readProblem(err));
      continue;
    }
    if (line.securityAlerts.mode === "jobs") takeAlerts(ctx, line, repository, alerts);
    ctx.store.setKv(securityAlertsKey(line.name), JSON.stringify(snapshot(ctx, repository, alerts)));
    ctx.store.deleteKv(problem);
  }
}

import type { LineConfig } from "../config.js";
import { lineRepository } from "../intake/github.js";
import type { SecretStore } from "../keychain.js";
import { log } from "../log.js";
import { BILLING_SERVICES, missingRecord, type BillingFigure, type BillingReader, type BillingRecord, type BillingService, type MissingReason, type ReadInput } from "./records.js";

/** Per request to a billing API. */
export const BILLING_TIMEOUT_MS = 10_000;

export const GITHUB_API = "https://api.github.com";
export const VERCEL_API = "https://api.vercel.com";
export const SUPABASE_API = "https://api.supabase.com";

export interface ReaderDeps {
  fetch: typeof fetch;
  secrets: Pick<SecretStore, "get">;
  /** The factory's GitHub token, when GITHUB_BILLING_TOKEN is not stored. */
  githubToken?: () => string | undefined;
  /** owner/repo of the line's remote; by default read from git. */
  repository?: (line: LineConfig) => string | undefined;
  /** Per request; BILLING_TIMEOUT_MS by default. */
  timeoutMs?: number;
}

/** A failed read, with a reason chosen by code: what it says never comes from the answer. */
class Missing extends Error {
  constructor(readonly reason: MissingReason) {
    super(reason);
  }
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined);
const round = (n: number) => Math.round(n * 100) / 100;

/** The month's bounds as ISO times, local, the end never past now. */
function monthRange(month: string, now: Date): { from: string; to: string; year: number; month: number } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(y, m - 1, 1);
  const next = new Date(y, m, 1);
  const end = next.getTime() < now.getTime() ? next : now;
  return { from: start.toISOString(), to: end.toISOString(), year: y, month: m };
}

/** A GET that answers JSON or text, and throws only `Missing`: no token or body ever leaves it. */
async function get(deps: ReaderDeps, url: string, token: string, as: "json" | "text" = "json", headers: Record<string, string> = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await deps.fetch(url, { headers: { authorization: `Bearer ${token}`, ...headers }, signal: AbortSignal.timeout(deps.timeoutMs ?? BILLING_TIMEOUT_MS) });
  } catch {
    throw new Missing("sin-respuesta");
  }
  if (!res.ok) throw new Missing("sin-respuesta");
  try {
    return as === "text" ? await res.text() : await res.json();
  } catch {
    throw new Missing("respuesta-invalida");
  }
}

const secret = (deps: ReaderDeps, name: string) => deps.secrets.get(name) || undefined;

/** Turns a reader's body into one that never throws, logging only line, service and reason. */
function reader(service: BillingService, read: (input: ReadInput) => Promise<{ costUsd?: number; figures: BillingFigure[] }>): BillingReader {
  return {
    service,
    async read(input): Promise<BillingRecord> {
      try {
        const { costUsd, figures } = await read(input);
        return {
          service,
          month: input.month,
          source: BILLING_SERVICES[service].source,
          readAt: input.now.toISOString(),
          status: "ok",
          ...(costUsd === undefined ? {} : { costUsd: round(costUsd) }),
          figures,
        };
      } catch (err) {
        const reason: MissingReason = err instanceof Missing ? err.reason : "respuesta-invalida";
        log.warn("billing read without data", { line: input.line.name, service, reason });
        return missingRecord(service, input.month, input.now, reason);
      }
    },
  };
}

interface GithubUsageItem {
  product?: unknown;
  quantity?: unknown;
  unitType?: unknown;
  grossAmount?: unknown;
  discountAmount?: unknown;
  netAmount?: unknown;
  repositoryName?: unknown;
}

const sameRepository = (name: unknown, repository: string) => {
  if (typeof name !== "string" || !name) return false;
  const want = repository.toLowerCase();
  const got = name.toLowerCase();
  return got.includes("/") ? got === want : got === want.slice(want.indexOf("/") + 1);
};

/** GitHub Actions of the line's repository, from the account's billing usage API. */
export function githubReader(deps: ReaderDeps): BillingReader {
  return reader("github", async ({ line, month, now }) => {
    const config = line.services?.github;
    const token = secret(deps, "GITHUB_BILLING_TOKEN") ?? deps.githubToken?.();
    if (!token) throw new Missing("sin-token");
    const repository = config?.repository ?? (deps.repository ?? lineRepository)(line);
    if (!repository) throw new Missing("sin-repositorio");
    const account = config?.account ?? repository.slice(0, repository.indexOf("/"));
    const range = monthRange(month, now);
    const path = config?.type === "organization" ? "organizations" : "users";
    const url = `${GITHUB_API}/${path}/${encodeURIComponent(account)}/settings/billing/usage?year=${range.year}&month=${range.month}`;
    const body = (await get(deps, url, token, "json", { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" })) as { usageItems?: unknown } | undefined;
    if (!Array.isArray(body?.usageItems)) throw new Missing("respuesta-invalida");
    let minutes = 0;
    let gross = 0;
    let discount = 0;
    let net = 0;
    for (const raw of body.usageItems as GithubUsageItem[]) {
      if (!raw || typeof raw !== "object" || String(raw.product).toLowerCase() !== "actions" || !sameRepository(raw.repositoryName, repository)) continue;
      if (String(raw.unitType).toLowerCase() === "minutes") minutes += num(raw.quantity) ?? 0;
      gross += num(raw.grossAmount) ?? 0;
      discount += num(raw.discountAmount) ?? 0;
      net += num(raw.netAmount) ?? 0;
    }
    return {
      costUsd: net,
      figures: [
        { label: "Minutos brutos", value: String(Math.round(minutes)) },
        { label: "Bruto", value: usd(gross) },
        { label: "Cubierto por el plan", value: usd(discount) },
        { label: "Facturado", value: usd(net) },
      ],
    };
  });
}

interface VercelCharge {
  BilledCost?: unknown;
  Tags?: Record<string, unknown>;
  ProjectId?: unknown;
  ProjectName?: unknown;
}

/** Vercel's charges come as JSON lines (FOCUS records); a plain array or `{charges}` reads too. */
function vercelCharges(text: unknown): VercelCharge[] {
  if (typeof text !== "string") throw new Missing("respuesta-invalida");
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const whole: unknown = JSON.parse(trimmed);
    if (Array.isArray(whole)) return whole as VercelCharge[];
    if (whole && typeof whole === "object" && Array.isArray((whole as { charges?: unknown }).charges)) return (whole as { charges: VercelCharge[] }).charges;
    if (whole && typeof whole === "object") return [whole as VercelCharge];
  } catch {
    // JSON lines.
  }
  try {
    return trimmed.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as VercelCharge);
  } catch {
    throw new Missing("respuesta-invalida");
  }
}

const chargeProjects = (c: VercelCharge): string[] =>
  [c.Tags?.ProjectId, c.Tags?.ProjectName, c.Tags?.projectId, c.Tags?.projectName, c.ProjectId, c.ProjectName].filter((v): v is string => typeof v === "string" && v !== "");

/** The billed cost of the records Vercel attributes to the line's project. */
export function vercelReader(deps: ReaderDeps): BillingReader {
  return reader("vercel", async ({ line, month, now }) => {
    const config = line.services?.vercel;
    if (!config) throw new Missing("respuesta-invalida");
    const token = secret(deps, "VERCEL_TOKEN");
    if (!token) throw new Missing("sin-token");
    const range = monthRange(month, now);
    const query = new URLSearchParams({ from: range.from, to: range.to, ...(config.team ? { teamId: config.team } : {}) });
    const charges = vercelCharges(await get(deps, `${VERCEL_API}/v1/billing/charges?${query}`, token, "text"));
    const attributed = charges.filter((c) => c && typeof c === "object" && chargeProjects(c).length);
    if (!attributed.length) throw new Missing("sin-costo");
    const mine = attributed.filter((c) => chargeProjects(c).includes(config.project));
    const billed = mine.reduce((sum, c) => sum + (num(c.BilledCost) ?? 0), 0);
    return { costUsd: billed, figures: [{ label: "Facturado", value: usd(billed) }, { label: "Registros", value: String(mine.length) }] };
  });
}

/** The project and its organization's plan; the Management API gives no cost, so there is none. */
export function supabaseReader(deps: ReaderDeps): BillingReader {
  return reader("supabase", async ({ line }) => {
    const config = line.services?.supabase;
    if (!config) throw new Missing("respuesta-invalida");
    const token = secret(deps, "SUPABASE_ACCESS_TOKEN");
    if (!token) throw new Missing("sin-token");
    const project = (await get(deps, `${SUPABASE_API}/v1/projects/${encodeURIComponent(config.project)}`, token)) as Record<string, unknown> | undefined;
    if (!project || typeof project !== "object") throw new Missing("respuesta-invalida");
    const slug = config.organization ?? [project.organization_slug, project.organization_id].find((v): v is string => typeof v === "string" && v !== "");
    if (!slug) throw new Missing("respuesta-invalida");
    const org = (await get(deps, `${SUPABASE_API}/v1/organizations/${encodeURIComponent(slug)}`, token)) as Record<string, unknown> | undefined;
    if (!org || typeof org !== "object" || typeof org.plan !== "string" || !org.plan) throw new Missing("respuesta-invalida");
    const figures: BillingFigure[] = [{ label: "Plan", value: org.plan }];
    if (typeof project.name === "string" && project.name) figures.push({ label: "Proyecto", value: project.name });
    if (typeof project.status === "string" && project.status) figures.push({ label: "Estado", value: project.status });
    return { figures };
  });
}

/** Every service's reader, one per entry of `BILLING_SERVICES`. */
export function billingReaders(deps: ReaderDeps): Record<BillingService, BillingReader> {
  return { github: githubReader(deps), vercel: vercelReader(deps), supabase: supabaseReader(deps) };
}

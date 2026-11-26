import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentRunner } from "../agent.js";
import { ANDON_KEY, type FactoryContext } from "../app.js";
import { budgetState, pickAgentEngine } from "../budget.js";
import { PERFORMANCE_SKILL, ZERO_AGENTS_DIR, type LineConfig } from "../config.js";
import { log } from "../log.js";
import type { Store } from "../state/store.js";
import { scrubLocal } from "./research.js";
import { normalizeTitle } from "./scout.js";
import { ALWAYS_PROTECTED, protectedTouched } from "./verify.js";

/** Proposals an audit stores, whatever the agent returns. */
export const PROPOSALS_PER_AUDIT = 5;
/** The name the audit's agent is recorded under, and its instructions in zero's own `agents/` folder. */
export const AUDIT_AGENT = "performance-audit";

const IMPACTS = ["high", "medium", "low"] as const;
type Impact = (typeof IMPACTS)[number];
/** How the impact reads in a proposal, for the person in charge. */
const IMPACT_TEXT: Record<Impact, string> = { high: "alto", medium: "medio", low: "bajo" };

export const AuditOutput = z.object({
  proposals: z.array(
    z.object({
      title: z.string().min(1),
      /** The id of the skill's control it fixes, like PERF-03. */
      control: z.string(),
      impact: z.enum(IMPACTS),
      why: z.string().min(1),
      change: z.string().min(1),
      estimatedUsd: z.number().nonnegative(),
      /** Files or globs the change would touch. */
      paths: z.array(z.string()),
    }),
  ),
});
export type AuditOutput = z.infer<typeof AuditOutput>;
type Idea = AuditOutput["proposals"][number];

/** An audit the person in charge asked for and that has not started yet; at most one in the factory. */
export interface PerformanceAuditRequest {
  /** When it was asked, ISO 8601. */
  requestedAt: string;
  line: string;
}

/** The last audit; times in ISO 8601. */
export interface PerformanceAuditRecord {
  /** The `requestedAt` of the request it answers. */
  asked: string;
  line: string;
  /** Absent for an audit that could not start. */
  startedAt?: string;
  endedAt?: string;
  /** `not-run` when its line went away before it started. */
  outcome?: "ok" | "failed" | "stopped" | "not-run";
  reason?: string;
  /** Proposals it stored. */
  proposals: number;
}

/** The pending audit, as a `PerformanceAuditRequest`. */
export const PERFORMANCE_AUDIT_REQUEST_KEY = "performance-audit-demand";
/** The last audit, as a `PerformanceAuditRecord`. */
export const PERFORMANCE_AUDIT_RUN_KEY = "performance-audit-last";

function readJson<T>(store: Store, key: string): T | undefined {
  const raw = store.getKv(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** The audit that has not started yet, if there is one and it can be read. */
export function readPerformanceAuditRequest(store: Store): PerformanceAuditRequest | undefined {
  const r = readJson<Partial<PerformanceAuditRequest>>(store, PERFORMANCE_AUDIT_REQUEST_KEY);
  return typeof r?.requestedAt === "string" && typeof r.line === "string" ? (r as PerformanceAuditRequest) : undefined;
}

/** The last audit, if one was recorded and can be read. */
export function readPerformanceAuditRun(store: Store): PerformanceAuditRecord | undefined {
  const r = readJson<Partial<PerformanceAuditRecord>>(store, PERFORMANCE_AUDIT_RUN_KEY);
  return typeof r?.asked === "string" && typeof r.line === "string" && typeof r.proposals === "number" ? (r as PerformanceAuditRecord) : undefined;
}

/** Why a line cannot be audited, whatever the moment. */
export function auditProblem(ctx: FactoryContext, name: string): string | undefined {
  const lines = ctx.config.lines.filter((l) => !l.package);
  if (lines.some((l) => l.name === name)) return undefined;
  if (ctx.config.lines.some((l) => l.name === name)) return `la línea "${name}" es de un paquete: ahí no se audita`;
  return `no existe la línea "${name}". Líneas: ${lines.map((l) => l.name).join(", ") || "ninguna"}`;
}

/** Whether an audit is pending and may start now: with the andon on, the budget reached or no engine, it stays pending. */
export function performanceAuditReady(ctx: FactoryContext, now: Date): boolean {
  if (!readPerformanceAuditRequest(ctx.store) || ctx.store.getKv(ANDON_KEY) === "on" || budgetState(ctx.store, ctx.config, now).reached) return false;
  return pickAgentEngine(ctx.store, ctx.config, {}, now).available;
}

/** Every protected path, zero's own and the owner's. */
const protectedPaths = (ctx: FactoryContext) => [...new Set([...ALWAYS_PROTECTED, ...ctx.config.limits.protectedPaths])];

/** What the audit is asked for one line. */
export function performanceAuditPrompt(ctx: FactoryContext, line: LineConfig, taken: string[]): string {
  return [
    `Line: ${line.name} (repository at the working directory, base branch ${line.baseBranch}, read-only).`,
    `Audit the code as it is now with the \`${PERFORMANCE_SKILL}\` checklist and propose the fixes with the most impact first.`,
    `## Existing proposals (never repeat these titles)\n${taken.length ? taken.map((t) => `- ${t}`).join("\n") : "(none)"}`,
    `## Constraints\nProtected paths (never propose touching them): ${protectedPaths(ctx).join(", ")}.\nPropose at most ${PROPOSALS_PER_AUDIT} pieces of work.`,
  ].join("\n\n");
}

/**
 * The proposals zero keeps of an audit: from high to low impact (the agent's order within each), no repeated titles,
 * no protected paths and at most `PROPOSALS_PER_AUDIT`, scrubbed of local paths and secrets.
 */
export function acceptAudit(ideas: Idea[], taken: string[], protectedList: string[], line: Pick<LineConfig, "repo">): Idea[] {
  const seen = new Set(taken.map(normalizeTitle));
  const out: Idea[] = [];
  const sorted = [...ideas].sort((a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact));
  for (const idea of sorted) {
    if (out.length >= PROPOSALS_PER_AUDIT) break;
    const title = scrubLocal(idea.title, line).trim();
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;
    const paths = idea.paths.map((p) => p.trim().replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean);
    if (protectedTouched(paths.map((path) => ({ path })) as Parameters<typeof protectedTouched>[0], protectedList).length) continue;
    seen.add(key);
    out.push({ ...idea, title, control: scrubLocal(idea.control, line).trim(), why: scrubLocal(idea.why, line).trim(), change: scrubLocal(idea.change, line).trim(), paths });
  }
  return out;
}

/** The `why` of a stored proposal: its impact, the control and the files first, then the agent's reasons. */
const auditWhy = (idea: Idea) =>
  [`Impacto ${IMPACT_TEXT[idea.impact]}${idea.control ? ` · ${idea.control}` : ""}${idea.paths.length ? ` · ${idea.paths.join(", ")}` : ""}.`, idea.why].join("\n\n");

type AuditEnd = Pick<PerformanceAuditRecord, "outcome" | "reason" | "proposals">;

/** The audit's single read-only call on the line's repository, and the proposals it stores. */
async function audit(ctx: FactoryContext, line: LineConfig, runAgent: AgentRunner, now: Date, signal?: AbortSignal): Promise<AuditEnd> {
  const cut = (): AuditEnd | undefined => {
    if (ctx.store.getKv(ANDON_KEY) === "on") return { outcome: "stopped", reason: "la fábrica se detuvo (andon)", proposals: 0 };
    return signal?.aborted ? { outcome: "stopped", reason: "la fábrica se apagó", proposals: 0 } : undefined;
  };
  try {
    const taken = ctx.store.listProposals({ line: line.name, status: ["pending", "rejected", "approved", "reverted"] }).map((p) => p.title);
    const choice = pickAgentEngine(ctx.store, ctx.config, {}, now);
    const { limitUsd, spentUsd } = budgetState(ctx.store, ctx.config, now);
    const instructions = await readFile(join(ZERO_AGENTS_DIR, `${AUDIT_AGENT}.md`), "utf8");
    const run = await runAgent({
      station: "review",
      prompt: performanceAuditPrompt(ctx, line, taken),
      cwd: line.repo,
      line: line.name,
      schema: AuditOutput,
      engine: { name: choice.engine, model: choice.model, replaces: choice.replaces, reason: choice.reason },
      ...(choice.billing !== "subscription" && { maxBudgetUsd: Math.round(Math.max(0, limitUsd - spentUsd) * 1e6) / 1e6 }),
      signal,
      trace: { tracer: ctx.tracer },
      custom: { name: AUDIT_AGENT, instructions, access: "read", maxTurns: 60, timeoutMinutes: 30, skills: [PERFORMANCE_SKILL] },
    });
    const stopped = cut();
    if (stopped) return stopped;
    if (!run.ok || !run.output) {
      log.warn("performance audit produced no proposals", { line: line.name, engine: run.engine, error: run.text.slice(0, 300) });
      return { outcome: "failed", reason: "el motor no devolvió una respuesta válida", proposals: 0 };
    }
    const accepted = acceptAudit(run.output.proposals, taken, ctx.config.limits.protectedPaths, line);
    // In order, so the line's proposals list them from high to low impact. They never build on their own (proposalAutonomy).
    for (const idea of accepted) {
      ctx.store.createProposal({ line: line.name, title: idea.title, why: auditWhy(idea), change: idea.change, estimatedUsd: idea.estimatedUsd, paths: idea.paths, origin: "performance" });
    }
    log.info("performance audit stored proposals", { line: line.name, stored: accepted.length, dropped: run.output.proposals.length - accepted.length });
    return { outcome: "ok", ...(!accepted.length && { reason: "no encontró problemas nuevos de la lista" }), proposals: accepted.length };
  } catch (err) {
    log.warn("performance audit failed", { line: line.name, error: String(err) });
    return cut() ?? { outcome: "failed", reason: "la auditoría falló antes de terminar", proposals: 0 };
  }
}

/**
 * The performance audit the person in charge asked for, whatever the factory is doing: one read-only call on the
 * line's repository with the `zero:performance` skill, whose findings wait as proposals for their approval. The
 * request goes right before the run so it never runs twice, and its record is written with it and again at the end.
 */
export async function performanceAuditPass(ctx: FactoryContext, runAgent: AgentRunner, now: Date, opts: { signal?: AbortSignal } = {}): Promise<void> {
  const request = readPerformanceAuditRequest(ctx.store);
  if (!request || opts.signal?.aborted || !performanceAuditReady(ctx, now)) return;
  const clock = () => (ctx.now ?? (() => new Date()))().toISOString();
  const write = (record: PerformanceAuditRecord) => ctx.store.setKv(PERFORMANCE_AUDIT_RUN_KEY, JSON.stringify(record));
  const base: PerformanceAuditRecord = { asked: request.requestedAt, line: request.line, proposals: 0 };
  ctx.store.deleteKv(PERFORMANCE_AUDIT_REQUEST_KEY);
  const problem = auditProblem(ctx, request.line);
  const line = ctx.config.lines.find((l) => l.name === request.line);
  if (problem || !line) {
    write({ ...base, endedAt: clock(), outcome: "not-run", reason: problem });
    return;
  }
  const started = { ...base, startedAt: clock() };
  write(started);
  log.info("performance audit runs on demand", { line: line.name, asked: request.requestedAt });
  const end = await audit(ctx, line, runAgent, now, opts.signal);
  write({ ...started, endedAt: clock(), ...end });
}

/** An audit a crashed daemon left without an end, closed when the next one starts. */
export function closeInterruptedAudit(ctx: FactoryContext, now: Date): void {
  const record = readPerformanceAuditRun(ctx.store);
  if (!record?.startedAt || record.endedAt) return;
  ctx.store.setKv(PERFORMANCE_AUDIT_RUN_KEY, JSON.stringify({ ...record, endedAt: now.toISOString(), outcome: "stopped", reason: "la fábrica se cerró antes de que terminara" } satisfies PerformanceAuditRecord));
}

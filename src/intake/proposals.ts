import { homedir } from "node:os";
import { approveProposal, rejectProposal, type FactoryContext } from "../app.js";
import type { Autonomy, FactoryConfig, LineConfig } from "../config.js";
import { proposalAutonomy } from "../line/scout.js";
import { log } from "../log.js";
import { redact } from "../secrets.js";
import type { Proposal } from "../state/store.js";
import { lineRepository, TRUSTED, type IssueApi, type IssueState } from "./github.js";
import { issueKey, PROPOSAL_LABEL } from "./keys.js";

/**
 * Night-shift proposals as GitHub issues: every proposal of a line whose
 * remote is on GitHub gets an issue labeled `zero:propuesta` (never the line's
 * work label, so it does not become a job on its own), and the owner's
 * decision in the factory is mirrored on it once. On proposals held at
 * `propose`, a writer of the repository decides from the issue: the work label
 * approves it, closing it without the label rejects it. Elsewhere the issue is
 * a record, closed with the delivery.
 */

export { PROPOSAL_LABEL };
/** Marks a proposal approved from its issue, so the comment says so even when it is retried. */
const fromGitHubKey = (id: string) => `proposal.github.${id}`;
const PROPOSAL_LABEL_DESCRIPTION = "Propuesta del turno nocturno de zero";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every spelling of an absolute path: as given, and with either slash. */
function spellings(path: string): string[] {
  const trimmed = path.replace(/[\\/]+$/, "");
  return [...new Set([trimmed, trimmed.replace(/\\/g, "/"), trimmed.replace(/\//g, "\\")])].filter((p) => p.length > 1);
}

/** Text fit for a public issue: recognisable secrets redacted, the line's repository and the owner's home folder removed. */
export function scrub(text: string, line: Pick<LineConfig, "repo">): string {
  let out = redact(text);
  for (const repo of spellings(line.repo)) out = out.replace(new RegExp(`${escape(repo)}[\\\\/]?`, "gi"), "");
  for (const home of spellings(homedir())) out = out.replace(new RegExp(escape(home), "gi"), "~");
  return out;
}

/** Breaks @mentions with a zero-width space, so a public post notifies nobody. */
export function breakMentions(text: string): string {
  return text.replace(/@(?=[\w-])/g, "@\u200b");
}

/** How the issue is decided: from GitHub on `propose`, a record otherwise. */
function howToDecide(proposal: Proposal, label: string, autonomy: Autonomy): string {
  if (autonomy !== "propose") {
    return `Este issue es un registro: en esta línea el turno nocturno avanza solo (autonomía \`${autonomy}\`), así que ni la etiqueta ni cerrarlo deciden nada. Se cierra con la entrega. El dueño puede rechazarla desde la fábrica: \`zero proposals reject ${proposal.id}\`.`;
  }
  return `Para decidirla desde GitHub (solo personas con permiso de escritura): ponele la etiqueta \`${label}\` para aprobarla, o cerrá el issue sin esa etiqueta para rechazarla. También desde la fábrica: \`zero proposals approve ${proposal.id}\` o \`zero proposals reject ${proposal.id} --note "<motivo>"\`, o desde el panel o el chat.`;
}

export function proposalIssueBody(proposal: Proposal, line: Pick<LineConfig, "repo" | "issues" | "nightShift">, config: Pick<FactoryConfig, "nightShift" | "research">): string {
  const files = proposal.paths.length ? proposal.paths.map((p) => `- \`${p}\``).join("\n") : "(sin detalle)";
  const body = [
    `Propuesta del turno nocturno de zero para la línea ${proposal.line}.`,
    `## Por qué\n${proposal.why}`,
    `## Qué cambiaría\n${proposal.change}`,
    `## Archivos que tocaría\n${files}`,
    ...(proposal.sourceIssue !== undefined && proposal.sourceIssueUrl ? [`Nació del issue #${proposal.sourceIssue}: ${proposal.sourceIssueUrl}`] : []),
    `Costo estimado: $${proposal.estimatedUsd.toFixed(2)} · propuesta \`${proposal.id}\``,
    howToDecide(proposal, line.issues?.label ?? "zero", proposalAutonomy(config, line, proposal)),
  ].join("\n\n");
  return breakMentions(scrub(body, line));
}

async function publish(ctx: FactoryContext, line: LineConfig, proposal: Proposal, gh: IssueApi): Promise<Proposal> {
  const issue = await gh.createIssue(breakMentions(scrub(proposal.title, line)), proposalIssueBody(proposal, line, ctx.config), [PROPOSAL_LABEL]);
  ctx.store.setProposalIssue(proposal.id, issue);
  log.info("proposal published as an issue", { proposal: proposal.id, issue: issue.number });
  return { ...proposal, issueNumber: issue.number, issueUrl: issue.url };
}

/** Who approved: the owner, or the night shift on its own under the line's autonomy, never presented as the owner. */
function approvalText(ctx: FactoryContext, proposal: Proposal): string {
  const job = `\`${proposal.jobId ?? "?"}\``;
  if (ctx.store.getKv(fromGitHubKey(proposal.id))) return `Propuesta aprobada desde GitHub con la etiqueta de trabajo: la fábrica la tomó como trabajo ${job}.`;
  if (proposal.decidedBy !== "night-shift") return `El dueño aprobó esta propuesta: la fábrica la tomó como trabajo ${job}.`;
  const source = proposal.jobId ? ctx.store.getJob(proposal.jobId)?.source : undefined;
  const autonomy = source?.kind === "night-shift" ? source.autonomy : undefined;
  const after = autonomy === "auto" ? "se integra sola si pasa todas las estaciones" : "no se integra hasta que el dueño la apruebe";
  return `El turno nocturno tomó esta propuesta por su cuenta como trabajo ${job} (autonomía de la línea: \`${autonomy ?? "?"}\`): ${after}.`;
}

/** Labels the issue with the line's work label, recording the job first so the intake never opens a second one for it. */
async function tellApproved(ctx: FactoryContext, line: LineConfig, repository: string, proposal: Proposal & { issueNumber: number }, gh: IssueApi) {
  const key = issueKey(repository, proposal.issueNumber);
  const label = line.issues?.label ?? "zero";
  ctx.store.setKv(key, JSON.stringify({ job: proposal.jobId, reported: "queued", labeledAt: "" } satisfies IssueState));
  // Idempotent first: a failed comment is retried without labeling twice.
  await gh.addLabels(proposal.issueNumber, [label]);
  await gh.comment(proposal.issueNumber, scrub(approvalText(ctx, proposal), line));
  ctx.store.markProposalIssueTold(proposal.id, "approved");
}

async function tellRejected(ctx: FactoryContext, line: LineConfig, proposal: Proposal & { issueNumber: number }, gh: IssueApi) {
  const reason = proposal.note ? `con este motivo:\n\n${proposal.note.split("\n").map((l) => `> ${l}`).join("\n")}` : "sin dar motivo.";
  await gh.close(proposal.issueNumber);
  await gh.comment(proposal.issueNumber, breakMentions(scrub(`El dueño rechazó esta propuesta ${reason}`, line)));
  ctx.store.markProposalIssueTold(proposal.id, "rejected");
}

/** Whether the proposal is held at `propose`, where its issue decides it. */
const decidedOnGitHub = (ctx: FactoryContext, line: LineConfig, p: Proposal) => proposalAutonomy(ctx.config, line, p) === "propose";

/**
 * Reads a pending proposal's issue: the work label applied by a writer
 * approves it; closing it without the label, by a writer, rejects it. Anyone
 * else's label or close leaves it pending. Returns the proposal as it stands.
 */
async function decideFromIssue(ctx: FactoryContext, line: LineConfig, proposal: Proposal & { issueNumber: number }, gh: IssueApi): Promise<Proposal> {
  const label = line.issues?.label ?? "zero";
  const issue = await gh.issue(proposal.issueNumber);
  if (issue.labels.includes(label)) {
    const labeled = await gh.lastLabeled(proposal.issueNumber, label);
    if (!labeled || !TRUSTED.has(await gh.permission(labeled.actor))) return proposal;
    ctx.store.setKv(fromGitHubKey(proposal.id), labeled.actor);
    approveProposal(ctx, proposal.id);
    log.info("proposal approved from its issue", { proposal: proposal.id, issue: proposal.issueNumber });
    return ctx.store.getProposal(proposal.id)!;
  }
  if (issue.state !== "closed" || !issue.closedBy || !TRUSTED.has(await gh.permission(issue.closedBy))) return proposal;
  await rejectProposal(ctx, proposal.id, `Cerrado en GitHub sin la etiqueta ${label}.`);
  // Closing the issue was the decision: there is nothing to tell it, and it stays closed.
  ctx.store.markProposalIssueTold(proposal.id, "rejected");
  log.info("proposal rejected from its issue", { proposal: proposal.id, issue: proposal.issueNumber });
  return ctx.store.getProposal(proposal.id)!;
}

/** The job of an approved proposal was delivered without a pull request, whose "Closes #n" would close the issue. */
function deliveredLocally(ctx: FactoryContext, p: Proposal): boolean {
  if (p.status !== "approved" || p.issueClosed || p.issueNumber === undefined || !p.jobId) return false;
  const job = ctx.store.getJob(p.jobId);
  return job?.status === "delivered" && !!job.delivery && job.delivery.mode !== "pull-request";
}

/** Once the work label is on, when GitHub says it was applied: the intake only takes the issue again after a later label. */
async function recordLabel(ctx: FactoryContext, line: LineConfig, repository: string, issue: number, gh: IssueApi) {
  const key = issueKey(repository, issue);
  const raw = ctx.store.getKv(key);
  const state: IssueState | undefined = raw ? JSON.parse(raw) : undefined;
  if (!state || state.labeledAt) return;
  const labeled = await gh.lastLabeled(issue, line.issues?.label ?? "zero");
  if (labeled) ctx.store.setKv(key, JSON.stringify({ ...state, labeledAt: labeled.at } satisfies IssueState));
}

async function syncLine(ctx: FactoryContext, line: LineConfig, proposals: Proposal[], repository: string, gh: IssueApi) {
  if (proposals.some((p) => p.issueNumber === undefined && !closedOut(p))) await gh.ensureLabel(PROPOSAL_LABEL, PROPOSAL_LABEL_DESCRIPTION);
  for (let proposal of proposals) {
    try {
      const fresh = proposal.issueNumber === undefined;
      if (fresh) {
        // Rejected (or reverted) before it was ever published: nothing to record.
        if (closedOut(proposal)) continue;
        proposal = await publish(ctx, line, proposal, gh);
      }
      // An issue published in this pass has nobody's decision on it yet.
      if (!fresh && proposal.status === "pending" && decidedOnGitHub(ctx, line, proposal)) proposal = await decideFromIssue(ctx, line, proposal as Proposal & { issueNumber: number }, gh);
      const published = proposal as Proposal & { issueNumber: number };
      if (proposal.status === "approved" && proposal.issueTold !== "approved") await tellApproved(ctx, line, repository, published, gh);
      if (proposal.status === "rejected" && proposal.issueTold !== "rejected") await tellRejected(ctx, line, published, gh);
      if (proposal.status === "approved") await recordLabel(ctx, line, repository, published.issueNumber, gh);
      if (deliveredLocally(ctx, proposal)) {
        await gh.close(published.issueNumber, "completed");
        ctx.store.markProposalIssueClosed(proposal.id);
      }
    } catch (err) {
      log.warn("cannot sync a proposal with its issue", { line: line.name, proposal: proposal.id, error: String(err) });
    }
  }
}

/** Rejected, or reverted after the night shift integrated it: its issue has nothing new to hear. */
const closedOut = (p: Proposal) => p.status === "rejected" || p.status === "reverted";

/** Whether a proposal still has something to do on GitHub. */
function needsSync(ctx: FactoryContext, line: LineConfig, repository: string | undefined, p: Proposal): boolean {
  if (p.issueNumber === undefined) return !closedOut(p);
  if (p.status === "reverted") return false;
  if (p.status === "pending") return decidedOnGitHub(ctx, line, p);
  if (p.issueTold !== p.status || deliveredLocally(ctx, p)) return true;
  if (p.status !== "approved" || !repository) return false;
  const raw = ctx.store.getKv(issueKey(repository, p.issueNumber));
  return !raw || !(JSON.parse(raw) as IssueState).labeledAt;
}

/**
 * One pass over every line: publishes proposals without an issue and tells the
 * issues about decisions taken in the factory. A failure stays in the log and
 * is retried on the next pass; it never stops the other lines.
 */
export async function syncProposalIssues(ctx: FactoryContext, api: (repository: string, line: LineConfig) => IssueApi | undefined): Promise<void> {
  for (const line of ctx.config.lines) {
    try {
      const proposals = ctx.store.listProposals({ line: line.name });
      if (!proposals.some((p) => needsSync(ctx, line, undefined, p) || (p.status === "approved" && p.issueNumber !== undefined))) continue;
      const repository = lineRepository(line);
      const gh = repository && api(repository, line);
      if (!repository || !gh) continue;
      const todo = proposals.filter((p) => needsSync(ctx, line, repository, p));
      if (todo.length) await syncLine(ctx, line, todo, repository, gh);
    } catch (err) {
      log.warn("cannot sync proposals with GitHub", { line: line.name, error: String(err) });
    }
  }
}

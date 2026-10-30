import { homedir } from "node:os";
import type { FactoryContext } from "../app.js";
import type { LineConfig } from "../config.js";
import { log } from "../log.js";
import { redact } from "../secrets.js";
import type { Proposal } from "../state/store.js";
import { lineRepository, type IssueApi, type IssueState } from "./github.js";
import { issueKey } from "./keys.js";

/**
 * Night-shift proposals as GitHub issues: every proposal of a line whose
 * remote is on GitHub gets an issue labeled `zero:propuesta` (never the line's
 * work label, so it does not become a job on its own), and the owner's
 * decision in the factory is mirrored on it once.
 */

export const PROPOSAL_LABEL = "zero:propuesta";
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

export function proposalIssueBody(proposal: Proposal, line: Pick<LineConfig, "repo">): string {
  const files = proposal.paths.length ? proposal.paths.map((p) => `- \`${p}\``).join("\n") : "(sin detalle)";
  const body = [
    `Propuesta del turno nocturno de zero para la línea ${proposal.line}.`,
    `## Por qué\n${proposal.why}`,
    `## Qué cambiaría\n${proposal.change}`,
    `## Archivos que tocaría\n${files}`,
    `Costo estimado: $${proposal.estimatedUsd.toFixed(2)} · propuesta \`${proposal.id}\``,
    `Para decidirla: \`zero proposals approve ${proposal.id}\` o \`zero proposals reject ${proposal.id} --note "<motivo>"\`, o desde el panel o el chat.`,
  ].join("\n\n");
  return scrub(body, line);
}

async function publish(ctx: FactoryContext, line: LineConfig, proposal: Proposal, gh: IssueApi): Promise<Proposal> {
  const issue = await gh.createIssue(scrub(proposal.title, line), proposalIssueBody(proposal, line), [PROPOSAL_LABEL]);
  ctx.store.setProposalIssue(proposal.id, issue);
  log.info("proposal published as an issue", { proposal: proposal.id, issue: issue.number });
  return { ...proposal, issueNumber: issue.number, issueUrl: issue.url };
}

/** Labels the issue with the line's work label, recording the job first so the intake never opens a second one for it. */
async function tellApproved(ctx: FactoryContext, line: LineConfig, repository: string, proposal: Proposal & { issueNumber: number }, gh: IssueApi) {
  const key = issueKey(repository, proposal.issueNumber);
  const label = line.issues?.label ?? "zero";
  ctx.store.setKv(key, JSON.stringify({ job: proposal.jobId, reported: "queued", labeledAt: "" } satisfies IssueState));
  await gh.comment(proposal.issueNumber, scrub(`El dueño aprobó esta propuesta: la fábrica la tomó como trabajo \`${proposal.jobId ?? "?"}\`.`, line));
  await gh.addLabels(proposal.issueNumber, [label]);
  ctx.store.markProposalIssueTold(proposal.id, "approved");
}

async function tellRejected(ctx: FactoryContext, line: LineConfig, proposal: Proposal & { issueNumber: number }, gh: IssueApi) {
  const reason = proposal.note ? `con este motivo:\n\n${proposal.note.split("\n").map((l) => `> ${l}`).join("\n")}` : "sin dar motivo.";
  await gh.comment(proposal.issueNumber, scrub(`El dueño rechazó esta propuesta ${reason}`, line));
  await gh.close(proposal.issueNumber);
  ctx.store.markProposalIssueTold(proposal.id, "rejected");
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
  if (proposals.some((p) => p.issueNumber === undefined && p.status !== "rejected")) await gh.ensureLabel(PROPOSAL_LABEL, PROPOSAL_LABEL_DESCRIPTION);
  for (let proposal of proposals) {
    try {
      if (proposal.issueNumber === undefined) {
        // Rejected before it was ever published: nothing to record.
        if (proposal.status === "rejected") continue;
        proposal = await publish(ctx, line, proposal, gh);
      }
      const published = proposal as Proposal & { issueNumber: number };
      if (proposal.status === "approved" && proposal.issueTold !== "approved") await tellApproved(ctx, line, repository, published, gh);
      if (proposal.status === "rejected" && proposal.issueTold !== "rejected") await tellRejected(ctx, line, published, gh);
      if (proposal.status === "approved") await recordLabel(ctx, line, repository, published.issueNumber, gh);
    } catch (err) {
      log.warn("cannot sync a proposal with its issue", { line: line.name, proposal: proposal.id, error: String(err) });
    }
  }
}

/** Whether a proposal still has something to do on GitHub. */
function needsSync(ctx: FactoryContext, repository: string | undefined, p: Proposal): boolean {
  if (p.issueNumber === undefined) return p.status !== "rejected";
  if (p.status !== "pending" && p.issueTold !== p.status) return true;
  if (p.status !== "approved" || !repository) return false;
  const raw = ctx.store.getKv(issueKey(repository, p.issueNumber));
  return !raw || !(JSON.parse(raw) as IssueState).labeledAt;
}

/**
 * One pass over every line: publishes proposals without an issue and tells the
 * issues about decisions taken in the factory. A failure stays in the log and
 * is retried on the next pass; it never stops the other lines.
 */
export async function syncProposalIssues(ctx: FactoryContext, api: (repository: string) => IssueApi | undefined): Promise<void> {
  for (const line of ctx.config.lines) {
    try {
      const proposals = ctx.store.listProposals({ line: line.name });
      if (!proposals.some((p) => needsSync(ctx, undefined, p) || (p.status === "approved" && p.issueNumber !== undefined))) continue;
      const repository = lineRepository(line);
      const gh = repository && api(repository);
      if (!repository || !gh) continue;
      const todo = proposals.filter((p) => needsSync(ctx, repository, p));
      if (todo.length) await syncLine(ctx, line, todo, repository, gh);
    } catch (err) {
      log.warn("cannot sync proposals with GitHub", { line: line.name, error: String(err) });
    }
  }
}

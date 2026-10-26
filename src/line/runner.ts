import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRunner } from "../agent.js";
import type { BoxExecutor } from "../box/executor.js";
import { effectiveLevel, findLine, type BoxAvailability, type Level, type LineConfig } from "../config.js";
import type { FactoryHome } from "../home.js";
import { log } from "../log.js";
import { git, sh, type ShellResult } from "../shell.js";
import type { Job, Store } from "../state/store.js";
import type { Tracer } from "../telemetry/tracer.js";
import { memoryBlock, type Learning, type NewPost, type Townhall } from "../townhall/index.js";
import { openCloneCopy, openWorkCopy, untrackedPaths, type WorkCopy } from "../workspace.js";
import { askOwner, describeDelivery, finalizeJob, type LedgerDeps } from "./finish.js";
import { integrate } from "./integrate.js";
import { decide } from "./policy.js";
import { blockingFindings, checkCitations, findingsFeedback, ReviewSchema } from "./review.js";
import {
  capabilityExists,
  changeName,
  plainSpec,
  renderOpenSpecChange,
  renderSpecDelta,
  SpecSchema,
  specProblems,
  writeFiles,
  type Spec,
} from "./spec.js";
import { verifyChange } from "./verify.js";

export interface RunnerDeps extends LedgerDeps {
  home: FactoryHome;
  /** Agents on this machine, for jobs that do not run in the box. */
  runAgent: AgentRunner;
  /** The isolation box, when it is ready. */
  box?: BoxExecutor;
  /** What the effective level sees; defaults to "ready" exactly when a box is given. */
  boxAvailability?: BoxAvailability;
}

/** Runs a shell command in the job's work copy, wherever the job runs. */
type Shell = (command: string, cwd: string, opts: { timeoutMs: number; signal?: AbortSignal; parentId: string; station: "setup" | "verify" }) => Promise<ShellResult>;

/** Why a running job was interrupted. `stop` ends it; `andon` and `shutdown` put it back in the queue. */
export type StopReason = "stop" | "andon" | "shutdown";

class Interrupted extends Error {
  constructor(readonly why: StopReason) {
    super(`interrupted: ${why}`);
  }
}

const reasonOf = (signal: AbortSignal): StopReason => (signal.reason === "stop" || signal.reason === "andon" ? signal.reason : "shutdown");

function requestBlock(job: Job): string {
  const kind = job.kind === "spec" ? "a written specification from the owner (convert it faithfully)" : "a request in plain language";
  return `# Job ${job.id}\nThe owner sent ${kind}:\n\n${job.request}`;
}

/**
 * Runs one job from its checkpoint until it is delivered, fails, is stopped
 * or has to wait for the owner. Safe to call again on the same job: it
 * resumes where it left off.
 */
export async function runJob(jobId: string, deps: RunnerDeps, signal: AbortSignal = new AbortController().signal): Promise<Job> {
  const { store, tracer, config } = deps;
  let job = store.getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const line = findLine(config, job.line);
  const level = effectiveLevel(config, deps.boxAvailability ?? { ready: Boolean(deps.box), problems: deps.box ? [] : ["la caja no está lista"] }).level;
  const jobSpan = tracer.jobSpanId(job.id);

  // Fixed on the first run: a job that started in the box finishes in the box.
  const isolation = job.isolation ?? (config.isolation === "container" && deps.box ? "container" : "worktree");
  if (!job.isolation) job = store.updateJob(jobId, { isolation });
  if (isolation === "container" && !deps.box) {
    return finalizeJob(deps, job, "failed", { reason: "Este trabajo empezó en la caja de aislamiento, que ahora no está lista. Revisala con `zero box status` y volvé a pedir el trabajo." });
  }
  const box = isolation === "container" ? deps.box : undefined;
  const lineDeps: RunnerDeps = { ...deps, runAgent: box ? box.agentRunner(config) : deps.runAgent };
  const shell: Shell = box
    ? (command, cwd, o) => box.shell(command, { cwd, mount: "rw", jobId, station: o.station, timeoutMs: o.timeoutMs, signal: o.signal, trace: { tracer, jobId, parentId: o.parentId } })
    : (command, cwd, o) => sh(command, cwd, o);

  const reload = () => (job = store.getJob(jobId)!);
  const check = () => {
    if (signal.aborted) throw new Interrupted(reasonOf(signal));
  };
  const addCost = (usd: number) => (job = store.updateJob(jobId, { costUsd: job!.costUsd + usd }));
  const fail = (reason: string) => finalizeJob(deps, reload(), "failed", { reason });
  const learn = (learnings: Learning[], extra: NewPost[] = []) =>
    deps.townhall.publish([...learnings.map((l) => ({ ...l, line: line.name, job: jobId })), ...extra]);

  job = store.updateJob(jobId, { status: "running" });
  try {
    const copy = await prepareWorkCopy(deps, job, line, isolation, shell);
    job = reload();

    if (job.checkpoint === "none") {
      const outcome = await specStation(lineDeps, job, line, copy, signal, addCost, learn);
      check();
      if (typeof outcome === "string") return await fail(outcome);
      job = reload();
    }
    const flaggedAfterSpec = await egressStop(deps, jobId, level);
    if (flaggedAfterSpec) return flaggedAfterSpec;
    const spec = job.spec as Spec;
    if (job.checkpoint === "spec" && !job.approvals.spec && decide(level, "spec-ready") === "ask") {
      return askOwner(deps, job, { kind: "spec-ready", text: `Antes de empezar, ¿te parece bien?\n\n${plainSpec(spec)}` });
    }

    if (job.checkpoint === "spec") {
      const outcome = await buildLoop(lineDeps, jobId, line, level, copy, spec, signal, addCost, learn, shell);
      if (outcome) return outcome;
      job = reload();
    }

    const flaggedBeforeIntegrate = await egressStop(deps, jobId, level);
    if (flaggedBeforeIntegrate) return flaggedBeforeIntegrate;
    if (!job.approvals.integrate && decide(level, "before-integrate") === "ask") {
      return askOwner(deps, job, { kind: "before-integrate", text: `El trabajo "${spec.title}" pasó la verificación y la revisión. ¿Lo integro?` });
    }
    check();
    job = store.updateJob(jobId, { station: "integrate" });
    const result = await tracer.within("zero.station.integrate", { jobId, parentId: jobSpan, attrs: { "zero.station": "integrate", "zero.integrate.mode": line.integrate, "zero.isolation": isolation } }, async () => {
      copy.publish();
      return integrate(line, copy, {
        jobId,
        title: spec.title,
        body: deliveryBody(spec, job!),
        scratchDir: join(deps.home.worktrees, line.name),
      });
    });
    if (!result.ok) {
      return askOwner(deps, reload(), { kind: "integration-blocked", text: `${result.reason}\n\nCuando esté resuelto, aprobá para reintentar la integración, o rechazá para dejar la rama como está.` });
    }
    log.info("job delivered", { job: jobId, delivery: describeDelivery(result.delivery) });
    return await finalizeJob(deps, reload(), "delivered", { delivery: result.delivery });
  } catch (err) {
    if (err instanceof Interrupted || signal.aborted) {
      const why = err instanceof Interrupted ? err.why : reasonOf(signal);
      if (why === "stop") return finalizeJob(deps, reload(), "stopped", { reason: "Detenido por el dueño." });
      return store.updateJob(jobId, { status: "queued" });
    }
    log.error("job crashed", { job: jobId, error: err instanceof Error ? err.stack : String(err) });
    return fail(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Opens the job's work copy, running the line's setup the first time. What
 * setup produces is not part of the change: edits to tracked files (lockfile
 * rewrites) are reverted and new paths (node_modules) are excluded from commits.
 */
async function prepareWorkCopy(deps: RunnerDeps, job: Job, line: LineConfig, isolation: "worktree" | "container", shell: Shell): Promise<WorkCopy> {
  const path = job.worktree ?? join(deps.home.worktrees, line.name, job.id);
  const branch = job.branch ?? `zero/${job.id}`;
  // Fixed when the copy is made, so a resumed job measures its changes from the same point.
  const base = job.base ?? (existsSync(path) ? line.baseBranch : startingBase(line, job.id));
  const excludeFile = join(deps.home.jobs, job.id, "setup-untracked.json");
  // The box gets an independent clone; a worktree would expose the owner's repository.
  const open = (exclude: string[]) => (isolation === "container" ? openCloneCopy : openWorkCopy)(line.repo, base, branch, path, exclude);
  if (existsSync(path)) {
    const exclude = existsSync(excludeFile) ? (JSON.parse(readFileSync(excludeFile, "utf8")) as string[]) : [];
    return open(exclude);
  }
  const bare = await open([]);
  deps.store.updateJob(job.id, { worktree: path, branch, base });
  if (line.setup.length) {
    await deps.tracer.within("zero.setup", { jobId: job.id, parentId: deps.tracer.jobSpanId(job.id), attrs: { "zero.isolation": isolation } }, async (span) => {
      for (const command of line.setup) {
        const r = await shell(command, bare.cwd, { timeoutMs: 20 * 60_000, parentId: span.id, station: "setup" });
        span.set({ "process.command_line": command, "process.exit.code": r.code });
        if (r.code !== 0) throw new Error(`setup \`${command}\` terminó con código ${r.code}: ${r.output.slice(-2000)}`);
      }
    });
  }
  git(["checkout", "-q", "--", "."], bare.cwd);
  const exclude = untrackedPaths(bare.cwd);
  await mkdir(join(deps.home.jobs, job.id), { recursive: true });
  await writeFile(excludeFile, JSON.stringify(exclude));
  return open(exclude);
}

/**
 * A job whose box runs tried something suspicious is not delivered without the
 * owner: L3 fails it, lower levels ask. Only the gate's `suspicious` refusals
 * count (the owner's own lists are policy, not a warning sign), and only those
 * after what the owner already accepted.
 */
async function egressStop(deps: RunnerDeps, jobId: string, level: Level): Promise<Job | undefined> {
  const job = deps.store.getJob(jobId)!;
  const flagged = deps.store.listEgress({ job: jobId, afterSeq: job.approvals.egressSeq ?? 0 }).filter((e) => !e.allowed && e.rule === "suspicious");
  if (!flagged.length) return undefined;
  const sites = new Map(flagged.map((e) => [`${e.host}:${e.port}`, e]));
  const list = [...sites].map(([site, e]) => `- ${site}${e.station ? ` (${e.station})` : ""}: ${e.reason}`).join("\n");
  if (decide(level, "egress-suspicious") === "fail") {
    return finalizeJob(deps, job, "failed", {
      reason: `La puerta de salida bloqueó conexiones sospechosas de este trabajo:\n${list}\nPor seguridad no se integró. Si un sitio es legítimo, permitilo con \`zero egress allow <sitio>\` y volvé a pedir el trabajo.`,
    });
  }
  return askOwner(deps, job, {
    kind: "egress-suspicious",
    text: `La puerta de salida bloqueó conexiones sospechosas del trabajo "${job.title ?? job.request.slice(0, 80)}":\n${list}\nPuede ser una dependencia rara o un agente manipulado. ¿Sigo igual?`,
    data: { seq: Math.max(...flagged.map((e) => e.seq)) },
  });
}

const remaining = (job: Job) => Math.max(job.budgetUsd + (job.approvals.extraBudgetUsd ?? 0) - job.costUsd, 0.01);

/** What the pull request says: the plain spec, the issue it closes, and what the job cost. */
export function deliveryBody(spec: Spec, job: Job): string {
  const closes = job.source?.kind === "github-issue" ? `\n\nCloses #${job.source.number}` : "";
  return `${plainSpec(spec)}${closes}\n\n---\nGenerado por zero · trabajo ${job.id} · costo estimado $${job.costUsd.toFixed(2)}`;
}

/**
 * Where a new job's branch starts. A pull request is judged against the
 * remote's base, which may be ahead of the owner's local branch (pull requests
 * accepted on GitHub), so it is fetched first; the local branch is never moved.
 */
function startingBase(line: LineConfig, jobId: string): string {
  if (line.integrate !== "pull-request") return line.baseBranch;
  const fetched = spawnSync("git", ["fetch", "-q", line.remote, line.baseBranch], { cwd: line.repo, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  if (fetched.status === 0) return `${line.remote}/${line.baseBranch}`;
  log.warn("cannot fetch the base branch; starting from the local one", { job: jobId, remote: line.remote, error: (fetched.stderr || String(fetched.error ?? "")).trim().slice(0, 300) });
  return line.baseBranch;
}

/** Returns a failure reason, or undefined once the spec is stored at checkpoint `spec`. */
async function specStation(
  deps: RunnerDeps,
  job: Job,
  line: LineConfig,
  copy: WorkCopy,
  signal: AbortSignal,
  addCost: (usd: number) => Job,
  learn: (l: Learning[], extra?: NewPost[]) => Promise<void>,
): Promise<string | undefined> {
  const { store, tracer } = deps;
  store.updateJob(job.id, { station: "spec" });
  return tracer.within("zero.station.spec", { jobId: job.id, parentId: tracer.jobSpanId(job.id), attrs: { "zero.station": "spec" } }, async (span) => {
    const memory = memoryBlock(await deps.townhall.recall({ line: line.name, kinds: ["lesson", "finding", "blocker"], limit: deps.config.townhall.recallLimit }));
    let spec: Spec | undefined;
    let error = "";
    for (let tryNo = 1; tryNo <= 2 && !spec; tryNo++) {
      const run = await deps.runAgent({
        station: "spec",
        cwd: copy.cwd,
        schema: SpecSchema,
        signal,
        maxBudgetUsd: remaining(store.getJob(job.id)!),
        trace: { tracer, jobId: job.id, parentId: span.id },
        prompt: [
          requestBlock(job),
          memory,
          error && `Your previous answer was rejected: ${error}. Fix it.`,
          "Study the repository and produce the specification.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      addCost(run.costUsd);
      // Spec is read-only: whatever the engine wrote is discarded.
      if (copy.hasChanges()) {
        log.warn("spec modified the work copy; discarding", { job: job.id });
        copy.discardChanges();
      }
      if (signal.aborted) return undefined;
      if (!run.ok || !run.output) {
        error = run.text;
        continue;
      }
      const problems = specProblems(run.output);
      if (problems.length) error = problems.join("; ");
      else spec = run.output;
    }
    if (!spec) return `La estación spec no produjo una especificación válida: ${error}`;

    await learn(spec.learnings, spec.followUps.map((f) => ({ kind: "proposal" as const, line: line.name, job: job.id, source: "spec", topic: f.slice(0, 80), body: f })));
    if (!spec.feasible) return `El pedido no se puede hacer sin ayuda: ${spec.reason}`;

    const files = renderOpenSpecChange(spec, { jobId: job.id, request: job.request, newCapability: !capabilityExists(copy.cwd, spec.capability) });
    await writeFiles(join(deps.home.jobs, job.id, "openspec"), files);
    if (existsSync(join(copy.cwd, "openspec"))) {
      await writeFiles(join(copy.cwd, "openspec", "changes", changeName(job.id)), files);
      copy.commitAll(`zero(${job.id}): especificación`);
    }
    span.set({ "zero.requirements": spec.requirements.length });
    store.updateJob(job.id, { spec, title: spec.title, checkpoint: "spec" });
    return undefined;
  });
}

/** The build → verify → review loop. Returns the job when it stops here (failed, parked), or undefined to integrate. */
async function buildLoop(
  deps: RunnerDeps,
  jobId: string,
  line: LineConfig,
  level: Level,
  copy: WorkCopy,
  spec: Spec,
  signal: AbortSignal,
  addCost: (usd: number) => Job,
  learn: (l: Learning[], extra?: NewPost[]) => Promise<void>,
  shell: Shell,
): Promise<Job | undefined> {
  const { store, tracer, config } = deps;
  const contract = renderSpecDelta(spec, false);
  const memory = memoryBlock(await deps.townhall.recall({ line: line.name, kinds: ["lesson", "finding", "blocker"], limit: config.townhall.recallLimit }));
  const specFiles = `openspec/changes/${changeName(jobId)}/`;

  for (;;) {
    if (signal.aborted) throw new Interrupted(reasonOf(signal));
    let job = store.getJob(jobId)!;
    // A job interrupted after building resumes at the station it was in, without rebuilding.
    const resuming = job.attempt > 0 && (job.station === "verify" || job.station === "review");
    const attempt = resuming ? job.attempt : job.attempt + 1;
    const flagged = await egressStop(deps, jobId, level);
    if (flagged) return flagged;
    if (attempt > line.maxAttempts) {
      return finalizeJob(deps, job, "failed", { reason: `Se agotaron los ${line.maxAttempts} intentos. Último problema:\n${job.feedback ?? "(sin detalle)"}` });
    }
    if (job.costUsd >= job.budgetUsd + (job.approvals.extraBudgetUsd ?? 0)) {
      if (decide(level, "budget-exceeded") === "fail") {
        return finalizeJob(deps, job, "failed", { reason: `Se agotó el presupuesto del trabajo ($${job.costUsd.toFixed(2)}).` });
      }
      return askOwner(deps, job, {
        kind: "budget-exceeded",
        text: `El trabajo "${spec.title}" ya gastó $${job.costUsd.toFixed(2)} y no terminó. ¿Le doy $${config.limits.usdPerJob.toFixed(2)} más?`,
        data: { extraUsd: config.limits.usdPerJob },
      });
    }

    const attemptSpan = tracer.start("zero.attempt", { jobId, parentId: tracer.jobSpanId(jobId), attrs: { "zero.attempt": attempt } });
    const failAttempt = (feedback: string) => {
      store.updateJob(jobId, { feedback, station: "build" });
      attemptSpan.end("error", { "error.message": feedback.slice(0, 300) });
    };

    if (!resuming) {
      job = store.updateJob(jobId, { attempt, station: "build" });
      const run = await tracer.within("zero.station.build", { jobId, parentId: attemptSpan.id, attrs: { "zero.station": "build" } }, async (span) =>
        deps.runAgent({
          station: "build",
          cwd: copy.cwd,
          signal,
          maxBudgetUsd: remaining(job),
          trace: { tracer, jobId, parentId: span.id },
          prompt: [
            requestBlock(job),
            `## Specification (the contract)\n${contract}`,
            memory,
            job.feedback && `## Feedback from the previous attempt (fix all of it)\n${job.feedback}`,
            `Implement the specification. Verification commands that must pass: ${line.verify.join(", ") || "none configured"}.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        }),
      );
      addCost(run.costUsd);
      if (signal.aborted) {
        attemptSpan.end("error", { "error.message": "interrupted" });
        throw new Interrupted(reasonOf(signal));
      }
      if (!run.ok) {
        failAttempt(`La ejecución de build terminó de forma anormal (${run.text.slice(0, 500)}). Hacé cambios más chicos y enfocados.`);
        continue;
      }
      copy.commitAll(`zero(${jobId}): intento ${attempt}`);
      if (!copy.changedFiles().some((f) => !f.path.startsWith(specFiles))) {
        failAttempt("No se hizo ningún cambio en el código. Implementá la especificación.");
        continue;
      }
    }

    store.updateJob(jobId, { station: "verify" });
    job = store.getJob(jobId)!;
    const verified = await tracer.within("zero.station.verify", { jobId, parentId: attemptSpan.id, attrs: { "zero.station": "verify" } }, async (span) =>
      verifyChange(copy, {
        commands: line.verify,
        protectedPaths: config.limits.protectedPaths,
        allowedProtected: job.approvals.protectedPaths,
        tracer,
        jobId,
        parentId: span.id,
        signal,
        run: (command, o) => shell(command, copy.cwd, { ...o, station: "verify" }),
      }),
    );
    // Whatever verification left behind (coverage, build output) must never end up in a later commit.
    copy.discardChanges();
    if (signal.aborted) throw new Interrupted(reasonOf(signal));
    if (!verified.ok && verified.kind === "protected") {
      if (decide(level, "protected-path") === "fail") {
        failAttempt(`El cambio modificó rutas protegidas (${verified.paths.join(", ")}). Revertí esos cambios y no las toques.`);
        continue;
      }
      attemptSpan.end("ok", { "zero.waiting": "protected-path" });
      return askOwner(deps, job, {
        kind: "protected-path",
        text: `El trabajo "${spec.title}" quiere modificar archivos protegidos:\n${verified.paths.map((p) => `- ${p}`).join("\n")}\n¿Lo permito?`,
        data: { paths: verified.paths },
      });
    }
    if (!verified.ok) {
      failAttempt(verified.feedback);
      continue;
    }

    store.updateJob(jobId, { station: "review" });
    const reviewed = await tracer.within("zero.station.review", { jobId, parentId: attemptSpan.id, attrs: { "zero.station": "review" } }, async (span) => {
      for (let tryNo = 1; tryNo <= 2; tryNo++) {
        const run = await deps.runAgent({
          station: "review",
          cwd: copy.cwd,
          schema: ReviewSchema,
          signal,
          maxBudgetUsd: remaining(store.getJob(jobId)!),
          trace: { tracer, jobId, parentId: span.id },
          prompt: `${requestBlock(job)}\n\n## Specification\n${contract}\n\nReview the change with \`git diff ${copy.base}...HEAD\`.`,
        });
        addCost(run.costUsd);
        // Review is read-only: whatever the engine wrote is discarded.
        if (copy.hasChanges()) {
          log.warn("review modified the work copy; discarding", { job: jobId });
          copy.discardChanges();
        }
        if (signal.aborted || (run.ok && run.output)) {
          if (!run.output) return undefined;
          const { valid, invalid } = checkCitations(copy.cwd, run.output.findings);
          span.set({ "zero.findings": valid.length, "zero.citations.invalid": invalid.length });
          return { review: run.output, blocking: blockingFindings(valid) };
        }
      }
      return undefined;
    });
    if (signal.aborted) throw new Interrupted(reasonOf(signal));
    if (!reviewed) {
      failAttempt("La revisión no pudo completarse; reintentando el ciclo.");
      continue;
    }
    await learn(reviewed.review.learnings);
    if (reviewed.blocking.length) {
      failAttempt(findingsFeedback(reviewed.blocking));
      continue;
    }

    attemptSpan.end("ok");
    store.updateJob(jobId, { checkpoint: "review", feedback: null });
    return undefined;
  }
}

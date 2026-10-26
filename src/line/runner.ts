import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRunner } from "../agent.js";
import { effectiveLevel, findLine, type Level, type LineConfig } from "../config.js";
import type { FactoryHome } from "../home.js";
import { log } from "../log.js";
import { git, sh } from "../shell.js";
import type { Job, Store } from "../state/store.js";
import type { Tracer } from "../telemetry/tracer.js";
import { memoryBlock, type Learning, type NewPost, type Townhall } from "../townhall/index.js";
import { openWorkCopy, untrackedPaths, type WorkCopy } from "../workspace.js";
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
  runAgent: AgentRunner;
  /** Whether the isolation box is available; defaults to detecting it. */
  isolationBox?: boolean;
}

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
  const level = effectiveLevel(config, deps.isolationBox).level;
  const jobSpan = tracer.jobSpanId(job.id);

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
    const copy = await prepareWorkCopy(deps, job, line);
    job = reload();

    if (job.checkpoint === "none") {
      const outcome = await specStation(deps, job, line, copy, signal, addCost, learn);
      check();
      if (typeof outcome === "string") return await fail(outcome);
      job = reload();
    }
    const spec = job.spec as Spec;
    if (job.checkpoint === "spec" && !job.approvals.spec && decide(level, "spec-ready") === "ask") {
      return askOwner(deps, job, { kind: "spec-ready", text: `Antes de empezar, ¿te parece bien?\n\n${plainSpec(spec)}` });
    }

    if (job.checkpoint === "spec") {
      const outcome = await buildLoop(deps, jobId, line, level, copy, spec, signal, addCost, learn);
      if (outcome) return outcome;
      job = reload();
    }

    if (!job.approvals.integrate && decide(level, "before-integrate") === "ask") {
      return askOwner(deps, job, { kind: "before-integrate", text: `El trabajo "${spec.title}" pasó la verificación y la revisión. ¿Lo integro?` });
    }
    check();
    job = store.updateJob(jobId, { station: "integrate" });
    const result = await tracer.within("zero.station.integrate", { jobId, parentId: jobSpan, attrs: { "zero.station": "integrate", "zero.integrate.mode": line.integrate } }, async () =>
      integrate(line, copy, {
        jobId,
        title: spec.title,
        body: `${plainSpec(spec)}\n\n---\nGenerado por zero · trabajo ${jobId} · costo estimado $${job!.costUsd.toFixed(2)}`,
        scratchDir: join(deps.home.worktrees, line.name),
      }),
    );
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
async function prepareWorkCopy(deps: RunnerDeps, job: Job, line: LineConfig): Promise<WorkCopy> {
  const path = job.worktree ?? join(deps.home.worktrees, line.name, job.id);
  const branch = job.branch ?? `zero/${job.id}`;
  const excludeFile = join(deps.home.jobs, job.id, "setup-untracked.json");
  if (existsSync(path)) {
    const exclude = existsSync(excludeFile) ? (JSON.parse(readFileSync(excludeFile, "utf8")) as string[]) : [];
    return openWorkCopy(line.repo, line.baseBranch, branch, path, exclude);
  }
  const bare = await openWorkCopy(line.repo, line.baseBranch, branch, path);
  deps.store.updateJob(job.id, { worktree: path, branch });
  if (line.setup.length) {
    await deps.tracer.within("zero.setup", { jobId: job.id, parentId: deps.tracer.jobSpanId(job.id) }, async (span) => {
      for (const command of line.setup) {
        const r = await sh(command, bare.cwd, { timeoutMs: 20 * 60_000 });
        span.set({ "process.command_line": command, "process.exit.code": r.code });
        if (r.code !== 0) throw new Error(`setup \`${command}\` terminó con código ${r.code}: ${r.output.slice(-2000)}`);
      }
    });
  }
  git(["checkout", "-q", "--", "."], bare.cwd);
  const exclude = untrackedPaths(bare.cwd);
  await mkdir(join(deps.home.jobs, job.id), { recursive: true });
  await writeFile(excludeFile, JSON.stringify(exclude));
  return openWorkCopy(line.repo, line.baseBranch, branch, path, exclude);
}

const remaining = (job: Job) => Math.max(job.budgetUsd + (job.approvals.extraBudgetUsd ?? 0) - job.costUsd, 0.01);

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
      }),
    );
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
          prompt: `${requestBlock(job)}\n\n## Specification\n${contract}\n\nReview the change with \`git diff ${line.baseBranch}...HEAD\`.`,
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

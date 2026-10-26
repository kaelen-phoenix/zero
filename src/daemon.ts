import { createAgentRunner, type AgentRunner } from "./agent.js";
import { ANDON_KEY, daemonInfo, DAEMON_KEY, SHUTDOWN_KEY, type FactoryContext } from "./app.js";
import { loadFactory, type FactoryConfig } from "./config.js";
import { answerJob } from "./line/answer.js";
import { finalizeJob } from "./line/finish.js";
import { runJob, type StopReason } from "./line/runner.js";
import { log } from "./log.js";
import { dailyBudgetReached, spentToday } from "./telemetry/metrics.js";

export interface DaemonOptions {
  /** How often the loop wakes up to beat, apply andon and start work. */
  pollMs?: number;
  /** Stop once nothing is running and nothing can start (tests, one-shot runs). */
  once?: boolean;
  /** Agent runner per config; tests inject fakes. */
  agentRunner?: (config: FactoryConfig) => AgentRunner;
}

interface Running {
  line: string;
  controller: AbortController;
  done: Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The factory working on its own: one job per line at a time, up to the
 * configured concurrency, resuming anything a previous run left unfinished.
 */
export async function runDaemon(ctx: FactoryContext, opts: DaemonOptions = {}): Promise<void> {
  const { store } = ctx;
  const pollMs = opts.pollMs ?? 2_000;
  const agentRunner = opts.agentRunner ?? createAgentRunner;
  const now = () => (ctx.now ?? (() => new Date()))();

  const other = daemonInfo(store, now());
  if (other.alive && other.pid !== process.pid) throw new Error(`La fábrica ya está en marcha (proceso ${other.pid}).`);
  const beat = () => store.setKv(DAEMON_KEY, JSON.stringify({ pid: process.pid, beatAt: now().toISOString() }));
  beat();
  store.deleteKv(SHUTDOWN_KEY);

  for (const job of store.listJobs({ status: ["running"] })) {
    log.info("resuming interrupted job", { job: job.id, checkpoint: job.checkpoint, station: job.station });
    store.updateJob(job.id, { status: "queued" });
  }

  const running = new Map<string, Running>();
  let stopping = false;
  const shutdown = () => {
    stopping = true;
    for (const r of running.values()) r.controller.abort("shutdown" satisfies StopReason);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  log.info("factory started", { pid: process.pid, home: ctx.home.root });

  try {
    while (!stopping) {
      beat();
      if (store.getKv(SHUTDOWN_KEY)) {
        shutdown();
        break;
      }
      try {
        ctx.config = await loadFactory(ctx.home.config);
      } catch (err) {
        log.error("cannot load factory definition; not starting new jobs", { error: String(err) });
        await sleep(pollMs);
        continue;
      }

      await expireQuestions(ctx);

      const andon = store.getKv(ANDON_KEY) === "on";
      for (const [id, r] of running) {
        if (andon) r.controller.abort("andon" satisfies StopReason);
        else if (store.getJob(id)?.stopRequested) r.controller.abort("stop" satisfies StopReason);
      }

      let startable = false;
      if (!andon && !dailyBudgetReached(spentToday(store, now()), ctx.config.limits.usdPerDay)) {
        for (const job of store.listJobs({ status: ["queued"] })) {
          if (job.stopRequested) {
            await finalizeJob(ctx, job, "stopped", { reason: "Detenido por el dueño." });
            continue;
          }
          const busy = [...running.values()].some((r) => r.line === job.line);
          if (busy) continue;
          if (!ctx.config.lines.some((l) => l.name === job.line)) {
            await finalizeJob(ctx, job, "failed", { reason: `La línea "${job.line}" ya no existe en la fábrica.` });
            continue;
          }
          if (running.size >= ctx.config.concurrency) {
            startable = true;
            break;
          }
          startable = true;
          const controller = new AbortController();
          const deps = { ...ctx, config: ctx.config, runAgent: agentRunner(ctx.config) };
          const done = runJob(job.id, deps, controller.signal)
            .catch((err) => log.error("job runner crashed", { job: job.id, error: String(err) }))
            .finally(() => running.delete(job.id));
          running.set(job.id, { line: job.line, controller, done });
        }
      }

      if (opts.once && !running.size && !startable) break;
      await Promise.race([sleep(pollMs), ...[...running.values()].map((r) => r.done)]);
    }
  } finally {
    await Promise.allSettled([...running.values()].map((r) => r.done));
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    const mine = daemonInfo(store, now());
    if (mine.pid === process.pid) store.deleteKv(DAEMON_KEY);
    log.info("factory stopped", { pid: process.pid });
  }
}

/** Questions nobody answered in time get their default answer. */
async function expireQuestions(ctx: FactoryContext) {
  const now = (ctx.now ?? (() => new Date()))().getTime();
  for (const job of ctx.store.listJobs({ status: ["waiting"] })) {
    const q = job.question;
    if (!q || Date.parse(q.expiresAt) > now) continue;
    log.info("question expired", { job: job.id, kind: q.kind, default: q.onTimeout });
    await answerJob(ctx, job, q.onTimeout, "venció sin respuesta");
  }
}

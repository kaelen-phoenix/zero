import { createAgentRunner, type AgentRunner } from "./agent.js";
import { ANDON_KEY, currentBox, daemonInfo, DAEMON_KEY, readGate, SHUTDOWN_KEY, type FactoryContext } from "./app.js";
import { egressPolicy } from "./box/egress.js";
import { budgetState } from "./budget.js";
import { createBoxExecutor, type BoxExecutor } from "./box/executor.js";
import { githubIssues, pollIssues, type IssueApi } from "./intake/github.js";
import { githubMerges, pollMerges, type MergeApi } from "./line/automerge.js";
import { githubToken } from "./line/integrate.js";
import { createGateHost, type GateHost } from "./box/network.js";
import { inspectBox, saveBoxStatus, type BoxStatus } from "./box/status.js";
import { loadFactory, type FactoryConfig } from "./config.js";
import { answerJob } from "./line/answer.js";
import { finalizeJob } from "./line/finish.js";
import { runJob, type StopReason } from "./line/runner.js";
import { log } from "./log.js";
import { panelKey } from "./panel/key.js";
import { createPanelServer } from "./panel/server.js";
import { tunnelKeeper } from "./panel/tunnel.js";

export interface DaemonOptions {
  /** How often the loop wakes up to beat, apply andon and start work. */
  pollMs?: number;
  /** Stop once nothing is running and nothing can start (tests, one-shot runs). */
  once?: boolean;
  /** Agent runner per config; tests inject fakes. */
  agentRunner?: (config: FactoryConfig) => AgentRunner;
  /** Probes the isolation box; tests inject a result instead of running container commands. */
  inspectBox?: (config: FactoryConfig) => BoxStatus;
  /** Builds the executor for a ready box; tests inject a simulated one. */
  boxExecutor?: (config: FactoryConfig, status: BoxStatus) => BoxExecutor;
  /** GitHub for the issue intake; tests inject a fake. */
  issues?: (repository: string) => IssueApi | undefined;
  /** GitHub for automatic merging; tests inject a fake. */
  merges?: (repository: string) => MergeApi | undefined;
  /** Serve the control panel (and its tunnel when the owner turned it on). Defaults to on, except in `once` runs. */
  panel?: boolean;
}

const BOX_RECHECK_MS = 10 * 60_000;
const INTAKE_MS = 60_000;

const realIssues = (repository: string) => {
  const token = githubToken();
  return token ? githubIssues(token, repository) : undefined;
};

const realMerges = (repository: string) => {
  const token = githubToken();
  return token ? githubMerges(token, repository) : undefined;
};

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
  // One gate host per runtime and image, shared by every job so only one of them starts the gate.
  const gates = new Map<string, GateHost>();
  const gateFor = (st: BoxStatus) => {
    const key = `${st.runtime}:${st.image}`;
    let gate = gates.get(key);
    if (!gate) {
      gate = createGateHost({ runtime: st.runtime!, image: st.image, dir: ctx.home.gate, store, policy: () => egressPolicy(ctx.config) });
      gates.set(key, gate);
    }
    return gate;
  };
  let stopping = false;
  let boxCheckedAt = 0;
  const refreshBox = () => {
    if (ctx.config.isolation !== "container") return;
    try {
      saveBoxStatus(store, (opts.inspectBox ?? inspectBox)(ctx.config));
    } catch (err) {
      log.warn("box inspection failed", { error: String(err) });
    }
    boxCheckedAt = Date.now();
  };
  const shutdown = () => {
    stopping = true;
    for (const r of running.values()) r.controller.abort("shutdown" satisfies StopReason);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  log.info("factory started", { pid: process.pid, home: ctx.home.root });

  // The panel is fixed to the port the factory started with; changing it needs a restart.
  const port = (opts.panel ?? !opts.once) ? ctx.config.panel.port : 0;
  const panel = port > 0 ? createPanelServer(ctx, { key: () => panelKey(ctx.secrets) }) : undefined;
  panel?.on("error", (err) => log.warn("control panel unavailable", { port, error: String(err) }));
  panel?.listen(port, "127.0.0.1", () => log.info("control panel listening", { url: `http://127.0.0.1:${port}` }));
  const tunnel = tunnelKeeper({ home: ctx.home, store, port: panel ? port : 0 });
  // GitHub issues are read in the background: a slow GitHub never holds up the loop, and passes never overlap.
  let intakeAt = 0;
  let intake: Promise<void> | undefined;
  const takeIssues = () => {
    if (intake || !ctx.config.lines.some((l) => l.issues) || Date.now() - intakeAt < (opts.once ? 0 : INTAKE_MS)) return;
    intakeAt = Date.now();
    intake = pollIssues(ctx, opts.issues ?? realIssues, { runAgent: agentRunner(ctx.config) })
      .catch((err) => log.warn("issue intake failed", { error: String(err) }))
      .finally(() => (intake = undefined));
  };
  // Pull requests to merge, polled the same way.
  let mergesAt = 0;
  let merging: Promise<void> | undefined;
  const mergeReady = () => {
    if (merging || !ctx.config.lines.some((l) => l.autoMerge) || Date.now() - mergesAt < (opts.once ? 0 : INTAKE_MS)) return;
    mergesAt = Date.now();
    merging = pollMerges(ctx, opts.merges ?? realMerges)
      .catch((err) => log.warn("automatic merge failed", { error: String(err) }))
      .finally(() => (merging = undefined));
  };

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

      if (Date.now() - boxCheckedAt > BOX_RECHECK_MS) refreshBox();
      readGate(ctx);
      tunnel.tick();
      takeIssues();
      mergeReady();
      await expireQuestions(ctx);

      const andon = store.getKv(ANDON_KEY) === "on";
      for (const [id, r] of running) {
        if (andon) r.controller.abort("andon" satisfies StopReason);
        else if (store.getJob(id)?.stopRequested) r.controller.abort("stop" satisfies StopReason);
      }

      let startable = false;
      if (!andon && !budgetState(store, ctx.config, now()).reached) {
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
          const { status, availability } = currentBox(ctx);
          const box = ctx.config.isolation === "container" && availability.ready && status ? (opts.boxExecutor ?? ((c, st) => createBoxExecutor(c, st, ctx.secrets, gateFor(st))))(ctx.config, status) : undefined;
          const deps = { ...ctx, config: ctx.config, runAgent: agentRunner(ctx.config), box, boxAvailability: availability };
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
    await intake;
    await merging;
    tunnel.stop();
    panel?.close();
    panel?.closeAllConnections();
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

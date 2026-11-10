import { resolve } from "node:path";
import { createAgentRunner, runHere, type AgentRunner, type EngineExecute } from "./agent.js";
import { ANDON_KEY, currentBox, daemonInfo, DAEMON_KEY, readGate, SHUTDOWN_KEY, waitsForBox, type FactoryContext } from "./app.js";
import { egressPolicy } from "./box/egress.js";
import { budgetState } from "./budget.js";
import { createBoxExecutor, type BoxExecutor } from "./box/executor.js";
import { acquireDaemonLock } from "./daemon-lock.js";
import { githubHalt, githubMeter, type GithubMeter, type GithubPass } from "./github-quota.js";
import { githubIssues, pollIssues, type IssueApi } from "./intake/github.js";
import { LINEAR_SECRET, linearIssues, pollLinear, type LinearApi } from "./intake/linear.js";
import { syncProposalIssues } from "./intake/proposals.js";
import { syncResearchIssues } from "./intake/research.js";
import { githubAlerts, pollSecurityAlerts, type AlertApi } from "./intake/security-alerts.js";
import { githubMerges, pollMerges, type MergeApi } from "./line/automerge.js";
import { githubToken } from "./line/integrate.js";
import { createGateHost, type GateHost } from "./box/network.js";
import { inspectBox, saveBoxStatus, type BoxStatus } from "./box/status.js";
import { lineSignature, type FactoryConfig, type LineConfig } from "./config.js";
import { factoryConfig } from "./packages.js";
import { beingGuarded } from "./readonly-guard.js";
import { answerJob } from "./line/answer.js";
import { finalizeJob, STOPPED_BY_YOU } from "./line/finish.js";
import { runJob, type StopReason } from "./line/runner.js";
import { packageUpdatesPass } from "./line/package-updates.js";
import { onDemandPending, packagesPass, scheduledPass } from "./line/packages.js";
import { researchPass } from "./line/research.js";
import { detectReverts } from "./line/reverts.js";
import { scoutPass } from "./line/scout.js";
import { signedIssues, signedMerges } from "./signature.js";
import { log } from "./log.js";
import { exportPass } from "./telemetry/otlp.js";
import type { Job } from "./state/store.js";
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
  issues?: (repository: string, line?: LineConfig) => IssueApi | undefined;
  /** Linear for the Linear intake, per line (undefined without a key); tests inject a fake. */
  linear?: (line: LineConfig) => LinearApi | undefined;
  /** GitHub's Dependabot alerts, per line; tests inject a fake. Without it, `once` runs do not read alerts. */
  alerts?: (repository: string, line?: LineConfig) => AlertApi | undefined;
  /** GitHub for automatic merging; tests inject a fake. */
  merges?: (repository: string, line?: LineConfig) => MergeApi | undefined;
  /** Serve the control panel (and its tunnel when the owner turned it on). Defaults to on, except in `once` runs. */
  panel?: boolean;
  /** Run the night shift (scout) while the factory is idle. Defaults to on, except in `once` runs. */
  scout?: boolean;
  /** Run the research station while the factory is idle. Defaults to on, except in `once` runs. */
  research?: boolean;
  /** Run the stations of the installed packages while the factory is idle, and at the times of their `schedule`. Defaults to on, except in `once` runs. */
  packages?: boolean;
  /** Look once a day at what the remotes of the git and npm packages have. Defaults to on, except in `once` runs. */
  packageUpdates?: boolean;
}

const BOX_RECHECK_MS = 10 * 60_000;
const INTAKE_MS = 60_000;
const EXPORT_MS = 30_000;

/** The real GitHub adapters, signed with the signature of the line they act for (the global one without a line), and counting their requests for the pass that uses them. */
const realIssues = (ctx: FactoryContext, meter: GithubMeter, pass: GithubPass) => (repository: string, line?: LineConfig) => {
  const token = githubToken();
  return token ? signedIssues(githubIssues(token, repository, meter.client(token, pass)), lineSignature(ctx.config, line ?? {})) : undefined;
};

const realMerges = (ctx: FactoryContext, meter: GithubMeter, pass: GithubPass) => (repository: string, line?: LineConfig) => {
  const token = githubToken();
  return token ? signedMerges(githubMerges(token, repository, meter.client(token, pass)), lineSignature(ctx.config, line ?? {})) : undefined;
};

const realAlerts = (meter: GithubMeter) => (repository: string) => {
  const token = githubToken();
  return token ? githubAlerts(token, repository, meter.client(token, "alerts")) : undefined;
};

/** The real Linear adapter, with the key from the secret store; pollLinear signs its comments. */
const realLinear = (ctx: FactoryContext) => () => {
  const key = ctx.secrets.get(LINEAR_SECRET);
  return key ? linearIssues(key) : undefined;
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
  // First of all: a daemon that does not hold the lock must not change anything, not even the shutdown request meant for the one that does.
  const lock = acquireDaemonLock(ctx.home);
  if (!lock) {
    const { pid } = daemonInfo(ctx.store);
    throw new Error(`La fábrica ya está en marcha${pid ? ` (proceso ${pid})` : ""}.`);
  }
  try {
    await factoryLoop(ctx, opts);
  } finally {
    lock.release();
  }
}

async function factoryLoop(ctx: FactoryContext, opts: DaemonOptions): Promise<void> {
  const { store } = ctx;
  const pollMs = opts.pollMs ?? 2_000;
  const agentRunner = opts.agentRunner ?? ((config: FactoryConfig) => createAgentRunner(config, { secrets: ctx.secrets }));
  const now = () => (ctx.now ?? (() => new Date()))();

  // A daemon of an earlier version holds no lock: only its heartbeat tells it is there.
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
  const readyBox = (config: FactoryConfig): BoxExecutor | undefined => {
    const { status, availability } = currentBox(ctx);
    return config.isolation === "container" && availability.ready && status ? (opts.boxExecutor ?? ((c, st) => createBoxExecutor(c, st, ctx.secrets, gateFor(st))))(config, status) : undefined;
  };
  const jobsIn = (folder: string) => [...running.values()].filter((r) => ctx.config.lines.some((l) => l.name === r.line && resolve(l.repo) === resolve(folder))).map((r) => r.done);
  const passRunner = opts.agentRunner ?? ((config: FactoryConfig) => createAgentRunner(config, { secrets: ctx.secrets, execute: passExecute(() => readyBox(config), jobsIn) }));
  let stopping = false;
  let boxCheckedAt = 0;
  let boxWaitLogged = false;
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
  const host = ctx.config.panel.host;
  panel?.listen(port, host, () => log.info("control panel listening", { url: `http://${host}:${port}` }));
  const tunnel = tunnelKeeper({ home: ctx.home, store, port: panel ? port : 0 });
  // Every pass that talks to GitHub does it through this meter; while it holds a pause, none of them starts.
  const meter = githubMeter(store, now);
  let githubPauseLogged = false;
  const githubPaused = () => {
    const halt = githubHalt(store, now());
    if (halt && !githubPauseLogged) log.warn("github passes paused", { until: halt.until, why: halt.why });
    githubPauseLogged = Boolean(halt);
    return githubPauseLogged;
  };
  // GitHub issues are read in the background: a slow GitHub never holds up the loop, and passes never overlap.
  let intakeAt = 0;
  let intake: Promise<void> | undefined;
  const takeIssues = () => {
    if (intake || !ctx.config.lines.some((l) => l.issues) || Date.now() - intakeAt < (opts.once ? 0 : INTAKE_MS)) return;
    intakeAt = Date.now();
    intake = pollIssues(ctx, opts.issues ?? realIssues(ctx, meter, "issues"), { runAgent: passRunner(ctx.config) })
      .catch((err) => log.warn("issue intake failed", { error: String(err) }))
      .finally(() => {
        meter.endRun("issues");
        intake = undefined;
      });
  };
  // Linear issues are read the same way, outside the GitHub meter and its pauses.
  let linearAt = 0;
  let linearIntake: Promise<void> | undefined;
  const takeLinear = () => {
    if (linearIntake || !ctx.config.lines.some((l) => l.linear) || Date.now() - linearAt < (opts.once ? 0 : INTAKE_MS)) return;
    linearAt = Date.now();
    linearIntake = pollLinear(ctx, opts.linear ?? realLinear(ctx))
      .catch((err) => log.warn("linear intake failed", { error: String(err) }))
      .finally(() => (linearIntake = undefined));
  };
  // Night-shift proposals mirrored as GitHub issues, then research notes published, on every line with a GitHub remote, polled the same way.
  let proposalsAt = 0;
  let publishing: Promise<void> | undefined;
  const syncProposals = () => {
    if (publishing || !ctx.config.lines.length || Date.now() - proposalsAt < (opts.once ? 0 : INTAKE_MS)) return;
    proposalsAt = Date.now();
    publishing = syncProposalIssues(ctx, opts.issues ?? realIssues(ctx, meter, "proposals"))
      .catch((err) => log.warn("proposal issues failed", { error: String(err) }))
      .then(() => meter.endRun("proposals"))
      .then(() => syncResearchIssues(ctx, opts.issues ?? realIssues(ctx, meter, "research")))
      .catch((err) => log.warn("research issues failed", { error: String(err) }))
      .finally(() => {
        meter.endRun("research");
        publishing = undefined;
      });
  };
  // Pull requests to merge, polled the same way.
  let mergesAt = 0;
  let merging: Promise<void> | undefined;
  const mergeReady = () => {
    if (merging || !ctx.config.lines.some((l) => l.autoMerge) || Date.now() - mergesAt < (opts.once ? 0 : INTAKE_MS)) return;
    mergesAt = Date.now();
    merging = pollMerges(ctx, opts.merges ?? realMerges(ctx, meter, "merges"))
      .catch((err) => log.warn("automatic merge failed", { error: String(err) }))
      .finally(() => {
        meter.endRun("merges");
        merging = undefined;
      });
  };
  // Dependabot alerts of the lines on GitHub, read the same way; they become urgent security jobs.
  let alertsAt = 0;
  let readingAlerts: Promise<void> | undefined;
  const readAlerts = () => {
    if (readingAlerts || (opts.once && !opts.alerts) || !ctx.config.lines.some((l) => l.securityAlerts.mode !== "off") || Date.now() - alertsAt < (opts.once ? 0 : INTAKE_MS)) return;
    alertsAt = Date.now();
    readingAlerts = pollSecurityAlerts(ctx, opts.alerts ?? realAlerts(meter))
      .catch((err) => log.warn("security alerts failed", { error: String(err) }))
      .finally(() => {
        meter.endRun("alerts");
        readingAlerts = undefined;
      });
  };
  // Night-shift integrations the owner reverted on the base branch, read the same way.
  let revertsAt = 0;
  let checkingReverts: Promise<unknown> | undefined;
  const findReverts = () => {
    if (checkingReverts || !ctx.config.lines.length || Date.now() - revertsAt < (opts.once ? 0 : INTAKE_MS)) return;
    revertsAt = Date.now();
    checkingReverts = detectReverts(ctx, opts.merges ?? realMerges(ctx, meter, "reverts"))
      .catch((err) => log.warn("revert detection failed", { error: String(err) }))
      .finally(() => {
        meter.endRun("reverts");
        checkingReverts = undefined;
      });
  };

  // Finished jobs' traces sent to the owner's OpenTelemetry collector, when one is configured; a down collector never holds up the loop.
  let exportAt = 0;
  let exporting: Promise<void> | undefined;
  const exportTraces = () => {
    if (exporting || !ctx.config.telemetry?.otlp || Date.now() - exportAt < (opts.once ? 0 : EXPORT_MS)) return;
    exportAt = Date.now();
    exporting = exportPass(ctx).finally(() => (exporting = undefined));
  };

  // What the packages' remotes have now, for `zero package list`; the pass itself keeps it to once a day, and a slow remote never holds up the loop.
  let lookedAt = 0;
  let looking: Promise<void> | undefined;
  const lookForPackageUpdates = () => {
    if (looking || !(opts.packageUpdates ?? !opts.once) || Date.now() - lookedAt < (opts.once ? 0 : INTAKE_MS)) return;
    lookedAt = Date.now();
    looking = packageUpdatesPass(ctx, now())
      .catch((err) => log.warn("package update check failed", { error: String(err) }))
      .finally(() => (looking = undefined));
  };

  // The night shift: while the factory is idle, scout proposes work, research reads the web (once a day per line) and the
  // packages' stations do their own work, one idle run at a time and never holding up the owner's jobs. They run one after the other because they share
  // limits.usdPerNight: each computes what is left only after the others' spans are recorded. The packages' stations go last. Shutdown cuts them all but scout short.
  let idle: Promise<void> | undefined;
  let packagesAt = 0;
  const researchStop = new AbortController();
  const idlePasses = () => {
    if (idle || running.size) return;
    const scouts = (opts.scout ?? !opts.once) && ctx.config.nightShift !== "off";
    const researches = (opts.research ?? !opts.once) && ctx.config.research !== "off";
    // Each station decides on its own whether its period is over, so this only keeps the loop from asking on every wake-up.
    // A run the person in charge asked for does not wait for the throttle.
    const stations = (opts.packages ?? !opts.once) && Boolean(ctx.config.loadedPackages?.stations.length) && (Date.now() - packagesAt >= (opts.once ? 0 : INTAKE_MS) || onDemandPending(ctx));
    if (!scouts && !researches && !stations) return;
    if (stations) packagesAt = Date.now();
    idle = (async () => {
      if (scouts) {
        await scoutPass(ctx, passRunner(ctx.config), now(), opts.issues ?? realIssues(ctx, meter, "scout")).catch((err) => log.warn("night shift failed", { error: String(err) }));
        meter.endRun("scout");
      }
      if (researches && !researchStop.signal.aborted)
        await researchPass(ctx, passRunner(ctx.config), now(), researchStop.signal).catch((err) => log.warn("research failed", { error: String(err) }));
      if (stations && !researchStop.signal.aborted)
        await packagesPass(ctx, passRunner(ctx.config), now(), { signal: researchStop.signal }).catch((err) => log.warn("package stations failed", { error: String(err) }));
    })().finally(() => (idle = undefined));
  };

  // The stations' scheduled passes call no model, so they run in the background whatever the line is doing; scheduledPass itself respects the andon.
  let schedulesAt = 0;
  let scheduling: Promise<void> | undefined;
  const runSchedules = () => {
    if (scheduling || !(opts.packages ?? !opts.once) || !ctx.config.loadedPackages?.stations.some((s) => s.schedule.length) || Date.now() - schedulesAt < (opts.once ? 0 : INTAKE_MS)) return;
    schedulesAt = Date.now();
    scheduling = scheduledPass(ctx, now(), { signal: researchStop.signal })
      .catch((err) => log.warn("scheduled stations failed", { error: String(err) }))
      .finally(() => (scheduling = undefined));
  };

  try {
    while (!stopping) {
      beat();
      if (store.getKv(SHUTDOWN_KEY)) {
        shutdown();
        break;
      }
      try {
        ctx.config = await factoryConfig(ctx.home);
      } catch (err) {
        log.error("cannot load factory definition; not starting new jobs", { error: String(err) });
        await sleep(pollMs);
        continue;
      }

      if (Date.now() - boxCheckedAt > BOX_RECHECK_MS) refreshBox();
      readGate(ctx);
      tunnel.tick();
      if (!githubPaused()) {
        takeIssues();
        syncProposals();
        mergeReady();
        findReverts();
        readAlerts();
      }
      takeLinear();
      exportTraces();
      runSchedules();
      lookForPackageUpdates();
      await expireQuestions(ctx);

      const andon = store.getKv(ANDON_KEY) === "on";
      for (const [id, r] of running) {
        if (andon) r.controller.abort("andon" satisfies StopReason);
        else if (store.getJob(id)?.stopRequested) r.controller.abort("stop" satisfies StopReason);
      }

      // In a container nobody can have meant local copies by accident: without the box, work waits and `zero status` says why.
      const boxWait = waitsForBox(ctx);
      if (boxWait && !boxWaitLogged) log.warn("waiting for the box: not starting jobs", { problems: currentBox(ctx).availability.problems.join("; ") });
      boxWaitLogged = boxWait;

      let startable = false;
      if (!andon && !budgetState(store, ctx.config, now()).reached) {
        for (const job of ownerFirst(store.listJobs({ status: ["queued"] }))) {
          if (job.stopRequested) {
            await finalizeJob(ctx, job, "stopped", { reason: STOPPED_BY_YOU });
            continue;
          }
          // The night shift's own jobs and the packages' never go ahead of other work: one at a time, and only while no other job is queued or running.
          if (lowPriority(job) && (running.size > 0 || store.listJobs({ status: ["queued", "running"] }).some((j) => j.status === "running" || !lowPriority(j)))) continue;
          const busy = [...running.values()].some((r) => r.line === job.line);
          if (busy) continue;
          const line = ctx.config.lines.find((l) => l.name === job.line);
          if (!line) {
            await finalizeJob(ctx, job, "failed", { reason: `La línea "${job.line}" ya no existe en la fábrica.` });
            continue;
          }
          if (boxWait) continue;
          // The read-only check there would take the job's branch and integration for the call's doing.
          if (beingGuarded(line.repo)) {
            startable = true;
            continue;
          }
          if (running.size >= ctx.config.concurrency) {
            startable = true;
            break;
          }
          startable = true;
          const controller = new AbortController();
          const { availability } = currentBox(ctx);
          const box = readyBox(ctx.config);
          const deps = { ...ctx, config: ctx.config, runAgent: agentRunner(ctx.config), box, boxAvailability: availability };
          const done = runJob(job.id, deps, controller.signal)
            .catch((err) => log.error("job runner crashed", { job: job.id, error: String(err) }))
            .finally(() => running.delete(job.id));
          running.set(job.id, { line: job.line, controller, done });
        }
      }

      if (!andon && !startable && !boxWait) {
        idlePasses();
      }

      if (opts.once && !running.size && !startable) break;
      await Promise.race([sleep(pollMs), ...[...running.values()].map((r) => r.done)]);
    }
  } finally {
    // A shutdown cuts research and the packages' stations short, scheduled passes included; a `once` run lets them finish.
    if (stopping) researchStop.abort();
    await Promise.allSettled([...running.values()].map((r) => r.done));
    await intake;
    await linearIntake;
    await publishing;
    await merging;
    await checkingReverts;
    await readingAlerts;
    await exporting;
    await scheduling;
    await looking;
    await idle;
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

/**
 * Where a background pass runs an engine: on this machine, except one with no sandbox of its own
 * whenever the box is ready at the time of the call. Checked on this machine, it waits for the jobs
 * running in its folder, since the check would take what they do to the repository for the call's doing.
 */
export const passExecute = (box: () => BoxExecutor | undefined, jobsIn: (folder: string) => Promise<unknown>[]): EngineExecute => async (engine, req, trace, station) => {
  if (!engine.unsandboxed) return runHere(engine, req, trace, station);
  const boxed = box()?.execute;
  if (boxed) return boxed(engine, req, trace, station);
  for (let busy = jobsIn(req.cwd); busy.length; busy = jobsIn(req.cwd)) await Promise.all(busy);
  return runHere(engine, req, trace, station);
};

/** A job nobody is waiting for: the night shift opened it on its own, under the line's `build` or `auto` autonomy, or a package's station asked for it. */
const lowPriority = (job: Job) => (job.source?.kind === "night-shift" && Boolean(job.source.autonomy)) || job.source?.kind === "package";

/** A Dependabot alert of high or critical severity: it goes ahead of everything else. */
const urgent = (job: Job) => job.source?.kind === "security-alert" && (job.source.severity === "high" || job.source.severity === "critical");

/** Queued jobs in the order the daemon considers them: urgent security patches first, then the owner's, the night shift's own and the packages' after. */
export function ownerFirst(jobs: Job[]): Job[] {
  return [...jobs.filter(urgent), ...jobs.filter((j) => !urgent(j) && !lowPriority(j)), ...jobs.filter(lowPriority)];
}

/** Questions nobody answered in time get their default answer. */
async function expireQuestions(ctx: FactoryContext) {
  const now = (ctx.now ?? (() => new Date()))().getTime();
  for (const job of ctx.store.listJobs({ status: ["waiting"] })) {
    const q = job.question;
    if (!q || Date.parse(q.expiresAt) > now) continue;
    log.info("question expired", { job: job.id, kind: q.kind, default: q.onTimeout });
    await answerJob(ctx, job, q.onTimeout, "venció sin respuesta", { expired: true });
  }
}

import { createAgentRunner, type AgentRunner } from "../agent.js";
import type { FactoryConfig } from "../config.js";
import type { SecretStore } from "../keychain.js";
import type { ShellResult } from "../shell.js";
import type { Tracer } from "../telemetry/tracer.js";
import { engineCredentials } from "./credentials.js";
import type { GateDoor, GateHost } from "./network.js";
import { decodeResult, type BoxAgentRequest } from "./protocol.js";
import { BOX_SKILLS, containerName, runInBox, type BoxRunResult, type BoxRunSpec, type Mount } from "./run.js";
import type { BoxStatus } from "./status.js";

export interface BoxTrace {
  tracer: Tracer;
  jobId: string;
  parentId: string;
}

/** Runs a job's commands and agents inside the isolation box. */
export interface BoxExecutor {
  runtime: string;
  image: string;
  /** A shell command (setup, verify) in the box, with the job's copy at /work and no credentials. */
  shell(command: string, opts: { cwd: string; mount: Mount; jobId: string; station: string; timeoutMs?: number; signal?: AbortSignal; trace?: BoxTrace }): Promise<ShellResult>;
  /** An agent runner whose engines run in the box, read-only for read-only stations. */
  agentRunner(config: FactoryConfig): AgentRunner;
}

const AGENT_ENTRY = ["node", "/opt/zero/dist/box/agent.js"];
const tail = (s: string) => s.trim().slice(-1500);

/**
 * Every box run leaves through the egress gate with a pass of its own: the
 * pass is revoked when the run ends and the gate's records are read at once,
 * so the runner sees what the run tried before deciding what comes next.
 */
async function throughGate(gate: GateHost, run: { jobId: string; station: string }, fn: (door: GateDoor) => Promise<BoxRunResult>): Promise<BoxRunResult | { gateError: string }> {
  let door: GateDoor;
  try {
    door = await gate.open(run);
  } catch (err) {
    return { gateError: `No se pudo abrir la puerta de salida de la caja: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    return await fn(door);
  } finally {
    door.close();
    gate.ingest();
  }
}

export function createBoxExecutor(config: FactoryConfig, status: BoxStatus, secrets: SecretStore, gate: GateHost): BoxExecutor {
  if (!status.ready || !status.runtime) throw new Error("la caja no está lista");
  const runtime = status.runtime;
  const base = { runtime, image: status.image, limits: config.box };
  const egress = (door: GateDoor): BoxRunSpec["egress"] => ({ network: door.network, proxy: door.proxy });

  return {
    runtime,
    image: status.image,
    async shell(command, opts) {
      const span = opts.trace?.tracer.start("zero.box.run", {
        jobId: opts.trace.jobId,
        parentId: opts.trace.parentId,
        attrs: { "zero.box.runtime": runtime, "zero.box.image": status.image, "zero.box.mount": opts.mount, "process.command_line": command },
      });
      const r = await throughGate(gate, { jobId: opts.jobId, station: opts.station }, (door) =>
        runInBox(
          { ...base, copy: opts.cwd, mount: opts.mount, secretNames: [], command: ["sh", "-c", command], name: containerName(opts.jobId), egress: egress(door) },
          { timeoutMs: opts.timeoutMs ?? 20 * 60_000, signal: opts.signal },
        ),
      );
      if ("gateError" in r) {
        span?.end("error", { "error.message": r.gateError });
        return { code: 1, output: r.gateError, timedOut: false };
      }
      span?.end(r.code === 0 ? "ok" : "error", { "process.exit.code": r.code });
      return { code: r.code, output: `${r.stdout}${r.stderr}`, timedOut: r.timedOut };
    },
    agentRunner(cfg) {
      return createAgentRunner(cfg, {
        async execute(engine, req, trace, station) {
          const creds = engineCredentials(engine.name, cfg, secrets);
          if (creds.problem) return { ok: false, text: `No se puede usar ${engine.name} en la caja: ${creds.problem}` };
          const mount: Mount = req.access === "write" ? "rw" : "ro";
          const span = trace?.tracer.start("zero.box.run", {
            jobId: trace.jobId,
            parentId: trace.parentId,
            attrs: { "zero.box.runtime": runtime, "zero.box.image": status.image, "zero.box.mount": mount },
          });
          const { signal, cwd, skills, ...rest } = req;
          // The box sees the skills at their in-box path, read-only.
          const request = skills ? { ...rest, skills: { ...skills, dir: BOX_SKILLS } } : rest;
          const payload: BoxAgentRequest = { engine: engine.name, engines: cfg.engines, request };
          const env = Object.fromEntries(creds.names.map((n) => [n, secrets.get(n)!]));
          const jobId = trace?.jobId ?? "agent";
          const r = await throughGate(gate, { jobId, station }, (door) =>
            runInBox(
              { ...base, copy: cwd, mount, skills: skills?.dir, secretNames: creds.names, command: AGENT_ENTRY, name: containerName(jobId), egress: egress(door) },
              // The engine enforces its own timeout inside; the extra minute covers container start-up.
              { input: JSON.stringify(payload), env, timeoutMs: req.timeoutMs + 60_000, signal },
            ),
          );
          if ("gateError" in r) {
            span?.end("error", { "error.message": r.gateError });
            return { ok: false, text: r.gateError };
          }
          span?.end(r.code === 0 ? "ok" : "error", { "process.exit.code": r.code, "zero.timed_out": r.timedOut });
          if (r.cancelled) return { ok: false, text: "cancelled" };
          if (r.timedOut) return { ok: false, text: `la caja superó el tiempo límite (${Math.round(req.timeoutMs / 60_000)} min)` };
          return decodeResult(r.stdout) ?? { ok: false, text: `la caja terminó con código ${r.code} sin resultado: ${tail(r.stderr || r.stdout)}` };
        },
      });
    },
  };
}

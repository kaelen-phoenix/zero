import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { answer, approveProposal, briefing, listProposals, rejectProposal, egressReport, ensureDaemon, factoryStatus, getJob, linesWithSkills, openFactory, requestWork, resume, setEgressRule, stop, trace, type FactoryContext } from "../app.js";
import { onSubscription } from "../budget.js";
import { formatEgress, formatJob, formatProposals, formatRequest, formatStatus } from "../format.js";
import type { FactoryHome } from "../home.js";

const INSTRUCTIONS = `zero is the owner's own software factory, running in the background on this machine.
Use it when the owner wants something built or changed in one of their projects ("lines"): send the request with zero_request in the owner's words and let the factory do the work. Do not implement it yourself in this chat.
The factory answers immediately; work continues in the background even if the chat closes. Check progress with zero_status. When a job is waiting, show the owner its question and pass their decision with zero_answer. zero_stop is the emergency stop.
Relay results in the owner's language and in plain terms; the owner may not be a programmer.`;

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Text => ({ content: [{ type: "text", text: t }] });

/** Opens the factory fresh for every call, so edits to zero.factory.yaml apply without restarting the client. */
async function withFactory(home: FactoryHome, fn: (ctx: FactoryContext) => Promise<string> | string): Promise<Text> {
  let ctx: FactoryContext | undefined;
  try {
    ctx = await openFactory(home);
    return text(await fn(ctx));
  } catch (err) {
    return { ...text(err instanceof Error ? err.message : String(err)), isError: true };
  } finally {
    ctx?.store.close();
  }
}

/**
 * The chat is the front door and the control room: every tool returns at
 * once and only reads or writes the factory's state; the daemon does the work.
 */
export function createZeroMcpServer(home: FactoryHome, opts: { autoStart?: boolean } = {}): McpServer {
  const server = new McpServer({ name: "zero", version: "0.2.0" }, { instructions: INSTRUCTIONS });
  const autoStart = opts.autoStart ?? true;

  server.registerTool(
    "zero_request",
    {
      title: "Pedir un trabajo a la fábrica",
      description: "Queue work for the factory: a feature, a fix or a change in one of the owner's projects, in the owner's own words. Returns at once with the job id.",
      inputSchema: {
        text: z.string().describe("What the owner wants, in their words."),
        line: z.string().optional().describe("Project (line) name; optional when the factory has a single line."),
        kind: z.enum(["request", "spec"]).optional().describe("'spec' when the owner pasted a written specification."),
      },
    },
    ({ text: request, line, kind }) =>
      withFactory(home, async (ctx) => {
        const result = requestWork(ctx, { text: request, line, kind });
        const started = autoStart && (await ensureDaemon(ctx));
        return formatRequest(result) + (started ? "\nLa fábrica estaba apagada: la encendí." : "");
      }),
  );

  server.registerTool(
    "zero_status",
    {
      title: "Estado de la fábrica o de un trabajo",
      description: "Overview of the factory (level, budget, jobs running, queued and waiting for the owner) or details of one job, including any question pending for the owner.",
      inputSchema: { job: z.string().optional().describe("Job id for details; omit for the factory overview.") },
      annotations: { readOnlyHint: true },
    },
    ({ job }) => withFactory(home, (ctx) => (job ? formatJob(getJob(ctx, job), { subscription: onSubscription(ctx.store, ctx.config.engine) }) : formatStatus(factoryStatus(ctx)))),
  );

  server.registerTool(
    "zero_answer",
    {
      title: "Responder una consulta de la fábrica",
      description: "Pass the owner's decision on a job that is waiting for them. Only use the owner's actual answer.",
      inputSchema: {
        job: z.string(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().optional().describe("The owner's reason or instructions, if they gave any."),
      },
    },
    ({ job, decision, note }) => withFactory(home, async (ctx) => formatJob(await answer(ctx, job, decision, note), { subscription: onSubscription(ctx.store, ctx.config.engine) })),
  );

  server.registerTool(
    "zero_proposals",
    {
      title: "Propuestas del turno nocturno",
      description: "Work the factory's scout station proposed on its own while idle, still waiting for the owner: id, line, title, why, what would change and estimated cost.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => withFactory(home, (ctx) => formatProposals(listProposals(ctx), true)),
  );

  server.registerTool(
    "zero_proposal_decide",
    {
      title: "Aprobar o rechazar una propuesta",
      description: "Pass the owner's decision on a scout proposal. 'approve' turns it into a normal job of its line; 'reject' archives it. Only use the owner's actual answer.",
      inputSchema: {
        id: z.string(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().optional().describe("The owner's reason, if they gave one."),
      },
    },
    ({ id, decision, note }) =>
      withFactory(home, async (ctx) => {
        if (decision === "reject") return `Propuesta ${(await rejectProposal(ctx, id, note)).id} rechazada y archivada.`;
        const r = approveProposal(ctx, id);
        const started = await ensureDaemon(ctx);
        return `Propuesta ${id} aprobada.\n${formatRequest(r)}${started ? "\nLa fábrica estaba apagada: la encendí." : ""}`;
      }),
  );

  server.registerTool(
    "zero_stop",
    {
      title: "Detener (andon)",
      description: "Emergency stop. With a job id, stops that job; without one, stops the whole factory until zero_resume.",
      inputSchema: { job: z.string().optional() },
      annotations: { destructiveHint: true },
    },
    ({ job }) =>
      withFactory(home, async (ctx) => {
        const r = await stop(ctx, job);
        if (r.factory) return "Fábrica detenida. Los trabajos en curso se pausan y vuelven a la cola; nada nuevo empieza hasta que la reanudes.";
        return r.job!.stopRequested && r.job!.status === "running" ? `Deteniendo el trabajo ${r.job!.id}…` : formatJob(r.job!, { subscription: onSubscription(ctx.store, ctx.config.engine) });
      }),
  );

  server.registerTool(
    "zero_resume",
    { title: "Reanudar la fábrica", description: "Lift a factory-wide stop so pending jobs continue.", inputSchema: {} },
    () =>
      withFactory(home, async (ctx) => {
        resume(ctx);
        const started = autoStart && (await ensureDaemon(ctx));
        return `Fábrica reanudada.${started ? " La encendí." : ""}`;
      }),
  );

  server.registerTool(
    "zero_briefing",
    {
      title: "Informe de la fábrica",
      description: "Report for the owner: what was produced, what it cost, what the network learned and what needs them.",
      inputSchema: { days: z.number().positive().optional().describe("Period in days (default 1).") },
      annotations: { readOnlyHint: true },
    },
    ({ days }) =>
      withFactory(home, async (ctx) => {
        const b = await briefing(ctx, days ?? 1);
        return `# ${b.title}\n\n${b.body}`;
      }),
  );

  server.registerTool(
    "zero_trace",
    {
      title: "Traza de un trabajo",
      description: "Step-by-step trace of a job: stations, attempts, agents, commands, durations and cost.",
      inputSchema: { job: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ job }) => withFactory(home, (ctx) => trace(ctx, job)),
  );

  server.registerTool(
    "zero_egress",
    {
      title: "Salidas a internet de la caja",
      description: "Every site the isolation box connected to through zero's egress gate: connections, bytes, and what was blocked and why. For the last days or for one job.",
      inputSchema: {
        job: z.string().optional().describe("Job id; omit for the whole factory."),
        days: z.number().positive().optional().describe("Period in days when no job is given (default 1)."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ job, days }) => withFactory(home, (ctx) => formatEgress(egressReport(ctx, { job, days }))),
  );

  // Only blocking is offered here: a chat can be manipulated by what it reads, and blocking too much is safe.
  // Allowing a site or changing the mode is for the owner, on the terminal or in zero.factory.yaml.
  server.registerTool(
    "zero_egress_block",
    {
      title: "Bloquear un sitio para la caja",
      description: "Block a site (and its subdomains) for the isolation box, when the owner asks for it. Takes effect on the next run in the box. To allow a site the owner runs `zero egress allow <site>` themselves.",
      inputSchema: { site: z.string().describe("Site name, e.g. example.com or example.com:8443.") },
    },
    ({ site }) => withFactory(home, (ctx) => setEgressRule(ctx, site, "block")),
  );

  server.registerTool(
    "zero_lines",
    { title: "Proyectos de la fábrica", description: "The projects (lines) this factory works on, and what each agent is given in general and per line.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () => withFactory(home, (ctx) => JSON.stringify(linesWithSkills(ctx.config), null, 2)),
  );

  return server;
}

export async function serveStdio(home: FactoryHome) {
  await createZeroMcpServer(home).connect(new StdioServerTransport());
}

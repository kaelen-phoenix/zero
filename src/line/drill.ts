import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { z } from "zod";
import type { AgentRunner } from "../agent.js";
import { pickEngine } from "../budget.js";
import type { FactoryConfig, LineConfig } from "../config.js";
import type { FactoryHome } from "../home.js";
import { git, sh, type ShellResult } from "../shell.js";
import type { Store } from "../state/store.js";
import type { Tracer } from "../telemetry/tracer.js";
import { log } from "../log.js";
import { FACTORY_IDENTITY } from "../workspace.js";
import { isTestFile } from "./verify.js";

/** Each setup and verify command of a drill gets at most this long, like a job's. */
export const DRILL_COMMAND_MS = 20 * 60_000;
const OUTPUT_TAIL = 2_000;

export const DrillOutput = z.object({
  /** What the specification did not say and had to be guessed. */
  missing: z.array(z.string()),
});

export type DrillOutcome = "alcanzan" | "no alcanzan" | "inválido";

export interface DrillCommand {
  command: string;
  code: number;
  timedOut: boolean;
  /** The end of its output. */
  output: string;
}

export interface DrillResult {
  id: string;
  line: string;
  capability: string;
  baseBranch: string;
  baseCommit: string;
  removed: string[];
  rebuilt: string[];
  notRebuilt: string[];
  /** Tests or specifications the agent changed or deleted. */
  tampered: string[];
  outcome: DrillOutcome;
  agent: { ok: boolean; engine: string; costUsd: number; budgetLimited: boolean; text: string };
  setup: DrillCommand[];
  verify: DrillCommand[];
  missing: string[];
  /** Where `informe.md` was written. */
  report: string;
  /** Whether the working copy stays in `<ZERO_HOME>/drills/<id>/copy` (`--conservar`); otherwise it is deleted at the end. */
  copyKept: boolean;
}

export interface DrillDeps {
  home: FactoryHome;
  config: FactoryConfig;
  store: Store;
  tracer: Tracer;
  runAgent: AgentRunner;
  sh?: (command: string, cwd: string, opts: { timeoutMs: number }) => Promise<ShellResult>;
  now?: () => Date;
  /** Deletes the working copy at the end; a failure is only logged. */
  removeCopy?: (path: string) => Promise<void>;
}

export interface DrillInput {
  line: LineConfig;
  capability: string;
  /** The files to remove, already chosen by `drillFiles`. */
  files: string[];
  usd: number;
  /** Keep the working copy instead of deleting it at the end. */
  keep?: boolean;
}

/** Tests and specifications stay in the copy: they are what the regenerated code is measured against. */
const kept = (path: string) => isTestFile(path) || path === "openspec" || path.startsWith("openspec/");

export const specPath = (capability: string) => `openspec/specs/${capability}/spec.md`;

/** The files of the base branch a drill removes: those matching some pattern, minus tests and everything under openspec/. */
export function drillFiles(line: LineConfig, patterns: string[]): string[] {
  const tracked = git(["-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", line.baseBranch], line.repo).split("\n").filter(Boolean);
  return tracked.filter((p) => !kept(p) && patterns.some((g) => posix.matchesGlob(p, g)));
}

const tail = (r: ShellResult, command: string): DrillCommand => ({ command, code: r.code, timedOut: r.timedOut, output: r.output.slice(-OUTPUT_TAIL) });

/**
 * Rebuilds the given files of a line from its specification alone, in a copy
 * of its own under `<ZERO_HOME>/drills/<id>`, and runs the line's tests against
 * what came out. The line's repository is only read (a clone without links).
 */
export async function runDrill(deps: DrillDeps, input: DrillInput): Promise<DrillResult> {
  const id = randomBytes(4).toString("hex");
  const dir = join(deps.home.drills, id);
  const copy = join(dir, "copy");
  await mkdir(dir, { recursive: true });
  try {
    return await drillIn(deps, input, id, dir, copy);
  } finally {
    // The report holds everything worth keeping; the copy (maybe with node_modules) would only fill the disk.
    if (!input.keep) {
      try {
        await (deps.removeCopy ?? ((path) => rm(path, { recursive: true, force: true, maxRetries: 3 })))(copy);
      } catch (e) {
        log.warn(`no pude borrar la copia del simulacro ${copy}: ${e instanceof Error ? e.message : String(e)}`, { drill: id, copy });
      }
    }
  }
}

async function drillIn(deps: DrillDeps, input: DrillInput, id: string, dir: string, copy: string): Promise<DrillResult> {
  const run = deps.sh ?? ((command, cwd, opts) => sh(command, cwd, opts));
  const { line, capability, files } = input;
  const baseCommit = git(["rev-parse", `${line.baseBranch}^{commit}`], line.repo);
  git(["clone", "-q", "--no-hardlinks", "--no-local", "--branch", line.baseBranch, line.repo, copy], dir);
  for (const file of files) await rm(join(copy, file), { force: true });
  // A fresh repository with one commit: nothing in the copy's history holds what was removed.
  await rm(join(copy, ".git"), { recursive: true, force: true });
  git(["init", "-q", "-b", "drill"], copy);
  git(["config", "core.autocrlf", "false"], copy);
  git(["add", "-A"], copy);
  git([...FACTORY_IDENTITY, "commit", "-q", "--allow-empty", "-m", `drill ${id} of ${line.name} at ${baseCommit}`], copy);
  const start = git(["rev-parse", "HEAD"], copy);

  const setup: DrillCommand[] = [];
  for (const command of line.setup) {
    const r = tail(await run(command, copy, { timeoutMs: DRILL_COMMAND_MS }), command);
    setup.push(r);
    if (r.code !== 0) break;
  }
  const setupOk = setup.every((c) => c.code === 0);

  let agent: DrillResult["agent"] = { ok: false, engine: "", costUsd: 0, budgetLimited: false, text: "no se llamó al agente: falló el setup" };
  let missing: string[] = [];
  if (setupOk) {
    const choice = pickEngine(deps.store, deps.config, "build", deps.now?.());
    const prompt = [
      `This is a regeneration drill: it measures whether the specifications of this project are enough to rebuild its code.`,
      `These files were removed from the working directory:\n${files.map((f) => `- ${f}`).join("\n")}`,
      `Rebuild them from the specification at ${specPath(capability)} (other specifications under openspec/specs may help), and from the rest of the code and the tests that are still here. Write each file back at the same path.`,
      `Never modify or delete tests or anything under openspec/: they are what the rebuilt code is measured against. Do not look for the removed files' original content anywhere else.`,
      `Verification commands that will run afterwards: ${line.verify.join(", ")}.`,
      `In \`missing\`, list each thing the specification did not say and you had to guess, one short sentence each, in Spanish. An empty list means nothing was missing.`,
    ].join("\n\n");
    const r = await deps.runAgent({
      station: "build",
      prompt,
      cwd: copy,
      line: line.name,
      schema: DrillOutput,
      engine: { name: choice.engine, model: choice.model, replaces: choice.replaces, reason: choice.reason },
      maxBudgetUsd: input.usd,
      trace: { tracer: deps.tracer },
    });
    agent = { ok: r.ok, engine: r.engine, costUsd: r.costUsd, budgetLimited: !!r.budgetLimited, text: r.text.slice(0, OUTPUT_TAIL) };
    missing = r.output?.missing ?? [];
  }

  const tampered = git(["-c", "core.quotepath=false", "diff", "--name-only", "--no-renames", start], copy)
    .split("\n")
    .filter((p) => p && kept(p));
  const verify: DrillCommand[] = [];
  if (setupOk) for (const command of line.verify) verify.push(tail(await run(command, copy, { timeoutMs: DRILL_COMMAND_MS }), command));
  const rebuilt = files.filter((f) => existsSync(join(copy, f)));
  const notRebuilt = files.filter((f) => !rebuilt.includes(f));
  const outcome: DrillOutcome = tampered.length
    ? "inválido"
    : setupOk && agent.ok && !agent.budgetLimited && !notRebuilt.length && verify.length > 0 && verify.every((c) => c.code === 0)
      ? "alcanzan"
      : "no alcanzan";

  const report = join(dir, "informe.md");
  const result: DrillResult = { id, line: line.name, capability, baseBranch: line.baseBranch, baseCommit, removed: files, rebuilt, notRebuilt, tampered, outcome, agent, setup, verify, missing, report, copyKept: !!input.keep };
  await writeFile(report, drillMarkdown(result));
  await writeFile(join(dir, "resultado.json"), JSON.stringify(result, null, 2));
  return result;
}

const list = (items: string[], empty = "(ninguno)") => (items.length ? items.map((i) => `- ${i}`).join("\n") : empty);
const fence = (text: string) => "```\n" + text.replace(/```/g, "'''").trimEnd() + "\n```";
const commandBlock = (c: DrillCommand) => `### \`${c.command}\`\n\nCódigo de salida: ${c.code}${c.timedOut ? " (cortado a los 20 minutos)" : ""}\n\n${fence(c.output || "(sin salida)")}`;

const OUTCOME_TEXT: Record<DrillOutcome, string> = {
  alcanzan: "las especificaciones alcanzan: se reconstruyó todo y los tests de la línea pasan",
  "no alcanzan": "las especificaciones no alcanzan",
  inválido: "inválido: se tocaron tests o especificaciones, así que el resultado no mide nada",
};

/** The drill's report, in Spanish, for the person in charge. */
export function drillMarkdown(r: DrillResult): string {
  return [
    `# Simulacro de regeneración ${r.id}`,
    [
      `- Línea: ${r.line}`,
      `- Capacidad: ${r.capability} (${specPath(r.capability)})`,
      `- Commit base: ${r.baseCommit} (${r.baseBranch})`,
      `- Resultado: **${r.outcome}**, ${OUTCOME_TEXT[r.outcome]}`,
      `- Costo de la llamada: US$ ${r.agent.costUsd.toFixed(2)}${r.agent.engine ? ` (${r.agent.engine})` : ""}`,
      `- Copia de trabajo: ${r.copyKept ? `conservada en ${join(dirname(r.report), "copy")}` : "se borra al terminar el simulacro"}`,
      `- Agente: ${r.agent.ok ? "terminó bien" : "no terminó bien"}${r.agent.budgetLimited ? ", cortado por el tope de gasto" : ""}`,
    ].join("\n"),
    `## Archivos quitados\n\n${list(r.removed)}`,
    `## Reconstruidos\n\n${list(r.rebuilt)}`,
    `## No reconstruidos\n\n${list(r.notRebuilt)}`,
    ...(r.tampered.length ? [`## Tests o especificaciones tocados\n\n${list(r.tampered)}`] : []),
    `## Qué faltaba en las especificaciones\n\n${list(r.missing, "(el agente no informó nada)")}`,
    ...(r.agent.ok ? [] : [`## Lo que dijo el agente\n\n${fence(r.agent.text || "(nada)")}`]),
    ...(r.setup.length ? [`## Setup\n\n${r.setup.map(commandBlock).join("\n\n")}`] : []),
    `## Verify\n\n${r.verify.length ? r.verify.map(commandBlock).join("\n\n") : "(no corrió)"}`,
  ].join("\n\n") + "\n";
}

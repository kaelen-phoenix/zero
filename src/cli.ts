#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { inspectBox, saveBoxStatus, setupBox } from "./box/index.js";
import { installedRuntimes, responds } from "./box/runtime.js";
import { SecretStore } from "./keychain.js";
import { addAgent, packageAdd, packageList, packageRemove, packageUpdate, addSkill, agentList, answer, approveProposal, briefing, daemonInfo, daemonProcesses, listProposals, listResearchNotes, mergePullRequest, monthlyReport, regenerationDrill, requestFromResearchNote, rejectProposal, removeAgent, requestStationRun, waitStationStart, removeSkill, skillList, egressReport, ensureDaemon, factoryStatus, getJob, openFactory, panelLinks, requestWork, resume, setEgressMode, setEgressRule, setIssueIntake, setPriority, setRemotePanel, shutdownFactory, saveReport, stop, trace, type FactoryContext, type PanelLinks } from "./app.js";
import { onSubscription } from "./budget.js";
import { findLine } from "./config.js";
import { githubIssues, lineRepository } from "./intake/github.js";
import { gitCredential, githubToken } from "./line/integrate.js";
import { runDaemon } from "./daemon.js";
import { formatEgress, formatJob, formatMerge,formatProposals, formatRequest, formatResearchNotes, formatAgents, formatPackages, formatSkills, formatStatus, shutdownOutcome } from "./format.js";
import { factoryHome } from "./home.js";
import { addLine, initFactory } from "./init.js";
import { install } from "./install.js";
import { log } from "./log.js";
import { serveStdio } from "./mcp/server.js";
import { downloadCloudflared, downloadPlan, findCloudflared } from "./panel/tunnel.js";
import { monthlyMarkdown } from "./report.js";
import { factoryConfig } from "./packages.js";
import { versionText } from "./self-update.js";
import { runSetup } from "./setup.js";
import { onPath } from "./shell.js";

const USAGE = `zero: tu fábrica de software, en tu máquina

Primeros pasos:
  zero init                      Crea la fábrica (y agrega el repo actual como línea)
  zero install                   Registra zero en tus clientes de chat (Claude Code, …)
  zero setup                     Asistente: con qué motores trabajar (suscripción, API key o ambas), límites, caja, panel y GitHub.
                                 Se puede volver a correr; con Docker: docker compose run --rm zero setup
  zero --version                 Versión instalada (y su commit)

Uso diario (también desde el chat):
  zero request "<pedido>"        Pide un trabajo   [--line <nombre>] [--spec] [--prioridad baja|media|alta|urgente]
  zero priority <trabajo> <nivel>    Cambia la prioridad de un trabajo que no terminó (baja, media, alta, urgente)
  zero status [trabajo]          Estado de la fábrica o de un trabajo
  zero approve <trabajo>         Aprueba una consulta   [--reject] [--note "<motivo>"]
  zero stop [trabajo]            Andon: detiene un trabajo, o toda la fábrica
  zero resume                    Reanuda la fábrica
  zero fusionar <trabajo | url>  Funde un pull request que entregó la fábrica, aunque la línea no tenga autoMerge,
                                 solo si GitHub dice que está listo (checks verdes, sin conflictos); si no, dice por qué
  zero briefing [--days N]       Informe: producción, costo, aprendizajes, pendientes
  zero informe [línea] [--mes AAAA-MM] [--html]
                                 Informe mensual por línea, para compartir (por defecto el mes anterior, todas las líneas); --html lo guarda en ZERO_HOME/reports y muestra la ruta
  zero simulacro <línea> <capacidad> --archivos <patrón>... [--usd N] [--conservar]
                                 Simulacro de regeneración: en una copia aparte en ZERO_HOME/drills quita esos archivos,
                                 los reconstruye solo desde openspec/specs/<capacidad>/spec.md (tope: --usd o limits.usdPerJob),
                                 corre el verify de la línea y deja un informe con lo que faltaba en las especificaciones;
                                 al terminar borra la copia y deja solo el informe, salvo con --conservar
  zero trace <trabajo>           Traza paso a paso de un trabajo
  zero proposals                 Propuestas del turno nocturno que esperan tu decisión
  zero proposals approve|reject <id>   Aprueba (crea el trabajo, o integra el que el turno ya construyó) o rechaza una propuesta   [--note "<motivo>"]
  zero research                  Notas de investigación de la web   [--line <nombre>] [--days N]
  zero research request <id>     Pide un trabajo en la línea de la nota, a partir de lo que encontró

Caja de aislamiento y credenciales:
  zero box status                Revisa la caja (contenedores) donde trabajan los agentes
  zero box setup [--yes]         Prepara la caja: pide permiso antes de instalar nada
  zero secret set <NOMBRE>       Guarda una credencial en el llavero del sistema o, en Docker, cifrada en el volumen (se escribe sin mostrarse)
  zero secret list | remove <NOMBRE>

Salidas a internet de la caja (todas pasan por la puerta de zero):
  zero egress [trabajo] [--days N]   Qué sitios, cuánto se envió y qué se bloqueó
  zero egress allow|block <sitio>    Permite o bloquea un sitio (incluye sus subdominios)
  zero egress remove <sitio>         Saca un sitio de tus listas
  zero egress mode blocklist|allowlist
                                 blocklist: sale todo salvo lo sospechoso y lo bloqueado; allowlist: solo lo permitido

Panel en el navegador:
  zero panel                     Muestra el link del panel (con tu clave) y enciende la fábrica si hace falta
  zero panel remote on|off       Abre o cierra el acceso desde afuera (celular) con un túnel temporal   [--yes]
  zero panel rotate              Cambia la clave: los links anteriores dejan de funcionar

Fábrica:
  zero line add [ruta]           Agrega un repositorio como línea   [--name <nombre>]
  zero agent list [--line <nombre>]   Agentes a medida de cada línea, en el orden en que corren
  zero agent add <nombre> --line <línea> [--informativo] [--tipo review|build] [--archivos <patrón>]...
                                 Suma un agente a la línea (crea .zero/agents/<nombre>.md con una plantilla): revisor de
                                 solo lectura, o con --tipo build uno que escribe entre build y verify, si querés solo
                                 cuando el cambio toca --archivos
  zero agent remove <nombre> --line <línea>   Lo quita de la configuración (el archivo queda)
  zero package list              Paquetes de agentes instalados: fuente, versión, qué traen, si hay novedades y qué problema tienen
  zero package add <carpeta|paquete-npm|git> [--permitir-codigo] [--yes]
                                 Instala un paquete; sus estaciones solo corren con --permitir-codigo (con los permisos de tu usuario).
                                 git: github:cuenta/repo[#tag-o-rama] o una URL https o ssh; muestra qué trae y pide confirmación
  zero package update [nombre] [--yes]
                                 Actualiza uno o todos: muestra el cambio, apaga la fábrica, aplica (si falla vuelve atrás) y la vuelve a encender
  zero package remove <nombre>   Lo quita de la fábrica (sus archivos quedan)
  zero package run <paquete>/<estación> [--pedido "<texto>"]
                                 Pide correr una vez la estación en la próxima pasada, sin esperar su período ni la cola
                                 (solo si su manifiesto declara onDemand: true), con un pedido en texto si querés;
                                 responde cuando la corrida empezó (o, pasados 2 minutos, que sigue pendiente)
  zero skill list                Skills asignadas a cada agente y las disponibles en tu Claude Code
  zero skill add|remove <skill> --station <agente> [--line <nombre>]
                                 Asigna o quita una skill (agentes: spec, build, review, security, reply, scout, research)
  zero issues on|off             Toma como pedidos los issues de GitHub con una etiqueta   [--line <nombre>] [--label zero]
  zero start [--detach]          Enciende la fábrica (en primer plano, o en segundo plano)
  zero shutdown                  Apaga la fábrica cuando termine lo que está haciendo y espera a que se apague (hasta 60 s)
  zero mcp                       Servidor MCP por stdio (lo lanzan los clientes de chat)

Directorio de la fábrica: ZERO_HOME (por defecto ~/.zero)`;

/** How long `zero package run` waits for the daemon to start the run before saying it is still pending. */
const STATION_WAIT_MS = 120_000;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      line: { type: "string" },
      name: { type: "string" },
      spec: { type: "boolean" },
      prioridad: { type: "string" },
      reject: { type: "boolean" },
      informativo: { type: "boolean" },
      tipo: { type: "string" },
      archivos: { type: "string", multiple: true },
      "permitir-codigo": { type: "boolean" },
      note: { type: "string" },
      days: { type: "string" },
      mes: { type: "string" },
      html: { type: "boolean" },
      usd: { type: "string" },
      conservar: { type: "boolean" },
      label: { type: "string" },
      station: { type: "string" },
      pedido: { type: "string" },
      detach: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.version) {
    console.log(versionText());
    return 0;
  }
  const home = factoryHome();

  if (!command || values.help || command === "help") {
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case "init": {
      const r = await initFactory(home, process.cwd());
      if (!r.created) {
        console.log(`La fábrica ya existe en ${r.path}; no la modifiqué.`);
        return 0;
      }
      console.log(`Fábrica creada en ${r.path}`);
      console.log(`Motor: ${r.engine}${r.clients.length ? ` (detectados: ${r.clients.join(", ")})` : " (no detecté clientes de agentes; instalá Claude Code, Codex o agy)"}`);
      console.log(r.line ? `Línea: ${r.line} (este repositorio)` : "Sin líneas todavía: agregá un repo con `zero line add <ruta>`.");
      console.log("Siguiente paso: `zero install` para usar zero desde tu chat.");
      return 0;
    }
    case "install": {
      for (const r of install(home)) console.log(`\n[${r.client}] ${r.status}\n${r.detail}`);
      return 0;
    }
    case "secret": {
      const secrets = new SecretStore(home);
      const [action, name, extra] = rest;
      if (action === "list") {
        const names = secrets.list();
        console.log(names.length ? names.join("\n") : "No hay credenciales guardadas.");
        return 0;
      }
      if (action === "remove" && name) {
        console.log(secrets.remove(name) ? `Credencial ${name} borrada.` : `No había una credencial ${name}.`);
        return 0;
      }
      if (action === "set" && name) {
        if (extra !== undefined) throw new Error("No pases el valor como argumento (quedaría en el historial). Corré `zero secret set NOMBRE` y escribilo cuando lo pida, o pasalo por la entrada estándar.");
        secrets.set(name, await readSecretValue(name));
        console.log(`Credencial ${name} guardada en ${secrets.place}.`);
        return 0;
      }
      break;
    }
    case "setup": {
      await runSetup(home, {
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        ask: askLine,
        askSecret: readSecretValue,
        confirm: async (q) => YES.test((await askLine(`${q} [s/N] `)).trim()),
        say: (t) => console.log(t),
        runInteractive: (bin, args) => new Promise((resolve) => {
          const child = spawn(bin, args, { stdio: "inherit" });
          child.on("error", () => resolve(127));
          child.on("close", (code) => resolve(code ?? 1));
        }),
        isAvailable: onPath,
        boxResponds: () => installedRuntimes("auto").some((rt) => responds(rt)),
        secrets: new SecretStore(home),
        cwd: process.cwd(),
      });
      return 0;
    }
    case "git-credential": {
      // git also says `store` and `erase`; there is nothing to keep.
      if (rest[0] !== "get") return 0;
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      process.stdout.write(gitCredential(input, () => githubToken()));
      return 0;
    }
    case "mcp":
      await serveStdio(home);
      return -1; // keep running until the client closes stdin
    case "self-update": {
      // Hidden: a prepared version proves it can read the factory file before the factory switches to it.
      if (rest[0] !== "check") break;
      await factoryConfig(home);
      return 0;
    }
    case "line": {
      if (rest[0] !== "add") break;
      const line = await addLine(home, rest[1] ?? process.cwd(), values.name);
      console.log(`Línea "${line.name}" agregada: ${line.repo} (rama ${line.baseBranch}, verificación: ${line.verify.join(", ") || "ninguna"})`);
      return 0;
    }
  }

  const ctx = await openFactory(home);
  try {
    switch (command) {
      case "start": {
        if (values.detach) {
          if (await ensureDaemon(ctx)) {
            console.log("Fábrica encendida en segundo plano.");
            return 0;
          }
          const daemon = daemonInfo(ctx.store);
          if (daemon.alive) {
            console.log("La fábrica ya estaba en marcha.");
            return 0;
          }
          console.log(`La fábrica sigue tomada por ${daemon.pid ? `el proceso ${daemon.pid}` : "otro proceso"}, que no responde, así que no encendí otra. Si no vuelve, terminá ese proceso a mano.`);
          return 1;
        }
        await runDaemon(ctx);
        return 0;
      }
      case "box": {
        if (rest[0] === "setup") {
          const ask = interactiveConfirm();
          const outcome = await setupBox(ctx.config, { confirm: ask.confirm, say: (t) => console.log(t) }, Boolean(values.yes));
          ask.close();
          console.log(outcome === "ready" ? "Caja lista." : outcome === "reboot" ? "" : "La caja todavía no está lista.");
        } else if (rest[0] !== "status") break;
        const status = inspectBox(ctx.config);
        saveBoxStatus(ctx.store, status);
        console.log(formatStatus(factoryStatus(ctx)).split("\n").filter((l) => l.startsWith("Caja") || l.startsWith("Fábrica") || l.startsWith("  ")).join("\n"));
        return 0;
      }
      case "shutdown": {
        const { text, code } = shutdownOutcome(await shutdownFactory(ctx));
        console.log(text);
        return code;
      }
      case "request": {
        const text = rest.join(" ");
        const r = requestWork(ctx, { text, line: values.line, kind: values.spec ? "spec" : "request", priority: values.prioridad });
        const started = await ensureDaemon(ctx);
        console.log(formatRequest(r) + (started ? "\nLa fábrica estaba apagada: la encendí." : ""));
        return 0;
      }
      case "priority": {
        if (!rest[0] || !rest[1]) throw new Error("Indicá el trabajo y la prioridad: zero priority <trabajo> <baja|media|alta|urgente>");
        console.log(formatJob(setPriority(ctx, rest[0], rest[1]), { subscription: onSubscription(ctx.store, ctx.config.engine) }));
        return 0;
      }
      case "status":
        console.log(rest[0] ? formatJob(getJob(ctx, rest[0]), { subscription: onSubscription(ctx.store, ctx.config.engine) }) : formatStatus({ ...factoryStatus(ctx), daemonProcesses: daemonProcesses() }));
        return 0;
      case "approve": {
        if (!rest[0]) throw new Error("Indicá el trabajo: zero approve <trabajo>");
        console.log(formatJob(await answer(ctx, rest[0], values.reject ? "reject" : "approve", values.note), { subscription: onSubscription(ctx.store, ctx.config.engine) }));
        return 0;
      }
      case "stop": {
        const r = await stop(ctx, rest[0]);
        console.log(r.factory ? "Fábrica detenida (andon). `zero resume` para continuar." : formatJob(r.job!, { subscription: onSubscription(ctx.store, ctx.config.engine) }));
        return 0;
      }
      case "fusionar": {
        if (!rest[0]) throw new Error("Indicá el trabajo o el pull request: zero fusionar <trabajo | url>");
        const r = await mergePullRequest(ctx, rest[0], { via: "cli" });
        console.log(formatMerge(r));
        return r.merged ? 0 : 1;
      }
      case "resume":
        resume(ctx);
        console.log("Fábrica reanudada.");
        return 0;
      case "briefing": {
        const b = await briefing(ctx, values.days ? Number(values.days) : 1);
        console.log(`# ${b.title}\n\n${b.body}`);
        return 0;
      }
      case "informe": {
        const line = rest[0];
        if (values.html && !line) throw new Error("Para exportar en HTML indicá la línea: zero informe <línea> --html");
        const report = monthlyReport(ctx, { line, month: values.mes });
        if (!line) console.error("Aviso: este resultado junta todas las líneas. Para compartirlo, pedí una sola: zero informe <línea>");
        console.log(values.html ? saveReport(ctx, report.lines[0]!, "html") : monthlyMarkdown(report));
        return 0;
      }
      case "simulacro": {
        const [line, capability] = rest;
        if (!line || !capability) throw new Error("Uso: zero simulacro <línea> <capacidad> --archivos <patrón>... [--usd N] [--conservar]");
        const r = await regenerationDrill(ctx, { line, capability, patterns: values.archivos ?? [], usd: values.usd === undefined ? undefined : Number(values.usd), keep: Boolean(values.conservar) });
        console.log(`Resultado: ${r.outcome}
Informe: ${r.report}`);
        return 0;
      }
      case "proposals": {
        if (!rest[0]) {
          console.log(formatProposals(listProposals(ctx)));
          return 0;
        }
        if ((rest[0] !== "approve" && rest[0] !== "reject") || !rest[1]) break;
        if (rest[0] === "reject") {
          console.log(`Propuesta ${(await rejectProposal(ctx, rest[1], values.note)).id} rechazada y archivada.`);
          return 0;
        }
        const r = approveProposal(ctx, rest[1]);
        const started = await ensureDaemon(ctx);
        console.log(`Propuesta ${rest[1]} aprobada.\n${formatRequest(r)}${started ? "\nLa fábrica estaba apagada: la encendí." : ""}`);
        return 0;
      }
      case "research": {
        if (!rest[0]) {
          console.log(formatResearchNotes(listResearchNotes(ctx, { line: values.line, days: values.days ? Number(values.days) : undefined })));
          return 0;
        }
        if (rest[0] !== "request" || !rest[1]) break;
        const r = requestFromResearchNote(ctx, rest[1]);
        const started = await ensureDaemon(ctx);
        console.log(`${formatRequest(r)}${started ? "\nLa fábrica estaba apagada: la encendí." : ""}`);
        return 0;
      }
      case "issues": {
        if (rest[0] !== "on" && rest[0] !== "off") break;
        const r = await setIssueIntake(ctx, { line: values.line, on: rest[0] === "on", label: values.label });
        if (!r.label) {
          console.log(`La línea ${r.line} ya no toma issues de GitHub.`);
          return 0;
        }
        const repository = lineRepository(findLine(ctx.config, r.line));
        const token = githubToken();
        if (!repository) console.log(`Ojo: el remoto de la línea ${r.line} no es un repositorio de GitHub, así que no va a encontrar issues.`);
        else if (!token) console.log("Ojo: no hay acceso a GitHub. Iniciá sesión con `gh auth login` (o definí GH_TOKEN).");
        else if (await githubIssues(token, repository).ensureLabel(r.label)) console.log(`Creé la etiqueta "${r.label}" en ${repository}.`);
        console.log(
          `La línea ${r.line} toma los issues${repository ? ` de ${repository}` : ""} con la etiqueta "${r.label}". La fábrica los revisa cada minuto mientras está en marcha.\nSolo toma issues escritos y etiquetados por personas con permiso de escritura, comenta en cada uno cómo va su trabajo, y el pull request lo cierra al aceptarlo.`,
        );
        return 0;
      }
      case "panel": {
        const [action, arg] = rest;
        if (action === "remote" && arg === "off") {
          setRemotePanel(ctx, false);
          console.log("Acceso remoto cerrado: el link de afuera deja de funcionar en unos segundos.");
          return 0;
        }
        if (action === "remote" && arg === "on") {
          if (!(await ensureCloudflared(ctx, Boolean(values.yes)))) return 1;
          setRemotePanel(ctx, true);
          await ensureDaemon(ctx);
          console.log("Abriendo el túnel…");
          const links = await waitFor(() => panelLinks(ctx).remote, 90_000);
          if (!links) console.log("El túnel todavía no respondió; probá `zero panel` en un minuto (mirá daemon.log si no aparece).");
          printPanel(panelLinks(ctx));
          return 0;
        }
        if (action && action !== "rotate") break;
        const started = await ensureDaemon(ctx);
        printPanel(panelLinks(ctx, { rotate: action === "rotate" }), action === "rotate");
        if (started) console.log("\nLa fábrica estaba apagada: la encendí (el panel tarda unos segundos en responder).");
        return 0;
      }
      case "package": {
        const [action, name] = rest;
        if (action === "list" || !action) {
          console.log(formatPackages(packageList(ctx)));
          return 0;
        }
        if (action === "add" || action === "update") {
          if (action === "add" && !name) throw new Error("Indicá la carpeta, el paquete o el repositorio: zero package add <carpeta|paquete-npm|git>");
          const ask = interactiveConfirm();
          const confirm = values.yes ? async () => true : ask.confirm;
          try {
            if (action === "add") {
              console.log(await packageAdd(ctx, { source: name!, allowCode: values["permitir-codigo"], confirm, say: (text) => console.log(text) }));
              return 0;
            }
            return (await packageUpdate(ctx, { name, confirm, say: (text) => console.log(text) })).failed ? 1 : 0;
          } finally {
            ask.close();
          }
        }
        if (action === "run") {
          if (!name) throw new Error("Indicá la estación: zero package run <paquete>/<estación>");
          const r = requestStationRun(ctx, name, new Date(), values.pedido);
          if (!r.ok) {
            console.log(r.reason);
            return 1;
          }
          console.log(r.text);
          if (await ensureDaemon(ctx)) console.log("La fábrica estaba apagada: la encendí.");
          console.log((await waitStationStart(ctx, name, r.requestedAt, { timeoutMs: STATION_WAIT_MS })).text);
          return 0;
        }
        if (action !== "remove") break;
        if (!name) throw new Error("Indicá el paquete: zero package remove <nombre>");
        console.log(await packageRemove(ctx, { name }));
        return 0;
      }
      case "agent": {
        const [action, name] = rest;
        if (action === "list" || !action) {
          console.log(formatAgents(agentList(ctx, values.line)));
          return 0;
        }
        if (action !== "add" && action !== "remove") break;
        if (!name || !values.line) throw new Error(`Indicá el agente y la línea: zero agent ${action} <nombre> --line <línea>`);
        console.log(action === "add" ? await addAgent(ctx, { name, line: values.line, blocking: !values.informativo, type: values.tipo, files: values.archivos }) : await removeAgent(ctx, { name, line: values.line }));
        return 0;
      }
      case "skill": {
        const [action, skill] = rest;
        if (action === "list" || !action) {
          console.log(formatSkills(skillList(ctx)));
          return 0;
        }
        if (action !== "add" && action !== "remove") break;
        if (!skill || !values.station) throw new Error(`Indicá la skill y el agente: zero skill ${action} <skill> --station <agente> [--line <nombre>]`);
        const input = { skill, station: values.station, line: values.line };
        console.log(action === "add" ? await addSkill(ctx, input) : await removeSkill(ctx, input));
        return 0;
      }
      case "egress": {
        const [action, arg] = rest;
        if (action === "allow" || action === "block" || action === "remove") {
          if (!arg) throw new Error(`Indicá el sitio: zero egress ${action} <sitio>`);
          console.log(await setEgressRule(ctx, arg, action));
          return 0;
        }
        if (action === "mode") {
          if (!arg) throw new Error("Indicá el modo: zero egress mode blocklist|allowlist");
          console.log(await setEgressMode(ctx, arg));
          return 0;
        }
        console.log(formatEgress(egressReport(ctx, { job: action, days: values.days ? Number(values.days) : 1 })));
        return 0;
      }
      case "trace":
        if (!rest[0]) throw new Error("Indicá el trabajo: zero trace <trabajo>");
        console.log(trace(ctx, rest[0]));
        return 0;
    }
  } finally {
    ctx.store.close();
  }
  console.log(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err) => {
    if (process.env.ZERO_DEBUG) log.error("fatal", { error: err instanceof Error ? err.stack : String(err) });
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);

/** Reads a secret without echoing it on a terminal, or from stdin when piped. */
async function readSecretValue(name: string): Promise<string> {
  if (!process.stdin.isTTY) {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    return input.trim();
  }
  process.stdout.write(`Valor de ${name} (no se muestra): `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") process.exit(130);
        value = ch === "\u007f" || ch === "\b" ? value.slice(0, -1) : value + ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

const YES = /^(s|si|sí|y|yes)$/i;

/** One question at a time and closed after it: a secret's raw read or a CLI's login may use the terminal next. */
async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** Yes/no questions on a terminal; without one, nobody can consent, so the answer is no. */
function interactiveConfirm() {
  if (!process.stdin.isTTY) return { confirm: async () => false, close: () => {} };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    confirm: async (q: string) => YES.test((await rl.question(`${q} [s/N] `)).trim()),
    close: () => rl.close(),
  };
}

function printPanel(links: PanelLinks, rotated = false) {
  if (rotated) console.log("Clave nueva: los links y sesiones anteriores ya no sirven.\n");
  console.log(links.local ? `En esta PC:   ${links.local}` : "El panel está desactivado (panel.port: 0).");
  if (links.remote) console.log(`Desde afuera: ${links.remote}`);
  else if (links.remoteOn) console.log("Desde afuera: el túnel se está abriendo; volvé a correr `zero panel` en unos segundos.");
  if (links.local || links.remote) console.log("\nCada link lleva tu clave: no lo compartas. Si se filtró: `zero panel rotate`.");
  if (links.remote) console.log("Para cerrar el acceso desde afuera: `zero panel remote off`.");
}

/** cloudflared is downloaded only with the owner's consent (or `--yes`). */
async function ensureCloudflared(ctx: FactoryContext, yes: boolean): Promise<boolean> {
  if (findCloudflared(ctx.home)) return true;
  const plan = downloadPlan();
  if ("manual" in plan) {
    console.log(plan.manual);
    return false;
  }
  console.log(`Para abrir el panel desde afuera hace falta cloudflared (de Cloudflare, open source, Apache-2.0).\nLo descargo de sus releases oficiales en GitHub a ${ctx.home.bin}. No necesita administrador ni instala nada en el sistema.`);
  const ask = interactiveConfirm();
  const ok = yes || (await ask.confirm("¿Lo descargo?"));
  ask.close();
  if (!ok) {
    console.log("No descargué nada.");
    return false;
  }
  const d = await downloadCloudflared(ctx.home);
  console.log(`cloudflared descargado${process.platform === "win32" ? " y con la firma de Cloudflare verificada" : ""} (sha256 ${d.sha256.slice(0, 16)}…).`);
  return true;
}

async function waitFor<T>(fn: () => T | undefined, ms: number): Promise<T | undefined> {
  for (const start = Date.now(); Date.now() - start < ms; await new Promise((r) => setTimeout(r, 1000))) {
    const v = fn();
    if (v !== undefined) return v;
  }
  return undefined;
}

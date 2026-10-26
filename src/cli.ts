#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { inspectBox, saveBoxStatus, setupBox } from "./box/index.js";
import { SecretStore } from "./keychain.js";
import { answer, briefing, ensureDaemon, factoryStatus, getJob, openFactory, requestWork, resume, SHUTDOWN_KEY, stop, trace } from "./app.js";
import { runDaemon } from "./daemon.js";
import { formatJob, formatRequest, formatStatus } from "./format.js";
import { factoryHome } from "./home.js";
import { addLine, initFactory } from "./init.js";
import { install } from "./install.js";
import { log } from "./log.js";
import { serveStdio } from "./mcp/server.js";

const USAGE = `zero: tu fábrica de software, en tu máquina

Primeros pasos:
  zero init                      Crea la fábrica (y agrega el repo actual como línea)
  zero install                   Registra zero en tus clientes de chat (Claude Code, …)

Uso diario (también desde el chat):
  zero request "<pedido>"        Pide un trabajo   [--line <nombre>] [--spec]
  zero status [trabajo]          Estado de la fábrica o de un trabajo
  zero approve <trabajo>         Aprueba una consulta   [--reject] [--note "<motivo>"]
  zero stop [trabajo]            Andon: detiene un trabajo, o toda la fábrica
  zero resume                    Reanuda la fábrica
  zero briefing [--days N]       Informe: producción, costo, aprendizajes, pendientes
  zero trace <trabajo>           Traza paso a paso de un trabajo

Caja de aislamiento y credenciales:
  zero box status                Revisa la caja (contenedores) donde trabajan los agentes
  zero box setup [--yes]         Prepara la caja: pide permiso antes de instalar nada
  zero secret set <NOMBRE>       Guarda una credencial en el llavero del sistema (se escribe sin mostrarse)
  zero secret list | remove <NOMBRE>

Fábrica:
  zero line add [ruta]           Agrega un repositorio como línea   [--name <nombre>]
  zero start [--detach]          Enciende la fábrica (en primer plano, o en segundo plano)
  zero shutdown                  Apaga la fábrica cuando termine lo que está haciendo
  zero mcp                       Servidor MCP por stdio (lo lanzan los clientes de chat)

Directorio de la fábrica: ZERO_HOME (por defecto ~/.zero)`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      line: { type: "string" },
      name: { type: "string" },
      spec: { type: "boolean" },
      reject: { type: "boolean" },
      note: { type: "string" },
      days: { type: "string" },
      detach: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
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
        console.log(`Credencial ${name} guardada en el llavero del sistema.`);
        return 0;
      }
      break;
    }
    case "mcp":
      await serveStdio(home);
      return -1; // keep running until the client closes stdin
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
          console.log((await ensureDaemon(ctx)) ? "Fábrica encendida en segundo plano." : "La fábrica ya estaba en marcha.");
          return 0;
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
      case "shutdown":
        ctx.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
        console.log("La fábrica se apagará en unos segundos; los trabajos en curso vuelven a la cola.");
        return 0;
      case "request": {
        const text = rest.join(" ");
        const r = requestWork(ctx, { text, line: values.line, kind: values.spec ? "spec" : "request" });
        const started = await ensureDaemon(ctx);
        console.log(formatRequest(r) + (started ? "\nLa fábrica estaba apagada: la encendí." : ""));
        return 0;
      }
      case "status":
        console.log(rest[0] ? formatJob(getJob(ctx, rest[0])) : formatStatus(factoryStatus(ctx)));
        return 0;
      case "approve": {
        if (!rest[0]) throw new Error("Indicá el trabajo: zero approve <trabajo>");
        console.log(formatJob(await answer(ctx, rest[0], values.reject ? "reject" : "approve", values.note)));
        return 0;
      }
      case "stop": {
        const r = await stop(ctx, rest[0]);
        console.log(r.factory ? "Fábrica detenida (andon). `zero resume` para continuar." : formatJob(r.job!));
        return 0;
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

/** Yes/no questions on a terminal; without one, nobody can consent, so the answer is no. */
function interactiveConfirm() {
  if (!process.stdin.isTTY) return { confirm: async () => false, close: () => {} };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    confirm: async (q: string) => /^(s|si|sí|y|yes)$/i.test((await rl.question(`${q} [s/N] `)).trim()),
    close: () => rl.close(),
  };
}

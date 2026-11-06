import { existsSync } from "node:fs";
import { stringify } from "yaml";
import { editFactory, loadFactory, parseFactory, type FactoryConfig } from "./config.js";
import { inContainer, type FactoryHome } from "./home.js";
import { initFactory } from "./init.js";
import type { SecretStore } from "./keychain.js";

/** The terminal and the machine, injectable so the wizard runs in tests with no Docker, CLI or model. */
export interface SetupDeps {
  /** Whether there is a person on a terminal; without one the wizard changes nothing. */
  interactive: boolean;
  ask(question: string): Promise<string>;
  /** Reads a value without showing it; `label` says which one. */
  askSecret(label: string): Promise<string>;
  /** Answers no unless the person says yes. */
  confirm(question: string): Promise<boolean>;
  say(text: string): void;
  /** Runs a CLI on this terminal, so its own login can talk to the person. */
  runInteractive(bin: string, args: string[]): Promise<number>;
  isAvailable(bin: string): boolean;
  /** Whether a container runtime answers from here. */
  boxResponds(): boolean;
  secrets: SecretStore;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface SetupResult {
  path: string;
  engine: string;
  fallback: string[];
  isolation: FactoryConfig["isolation"];
}

type Method = "subscription" | "api";

interface EngineSetup {
  label: string;
  bin: string;
  /** Credentials of per-use billing; the first is the one the wizard asks for. */
  apiKeys: string[];
  /** The CLI's own login. These flags depend on the CLI's version: this table is the one place to correct them. */
  login: { args: string[]; token?: string };
  /** Whether the login gives something usable inside the box, which only receives credentials by name. */
  loginInBox: boolean;
}

const ENGINES: Record<string, EngineSetup> = {
  claude: { label: "Claude Code", bin: "claude", apiKeys: ["ANTHROPIC_API_KEY"], login: { args: ["setup-token"], token: "CLAUDE_CODE_OAUTH_TOKEN" }, loginInBox: true },
  codex: { label: "Codex", bin: "codex", apiKeys: ["OPENAI_API_KEY", "CODEX_API_KEY"], login: { args: ["login", "--device-auth"] }, loginInBox: false },
};
const ENGINE_NAMES = Object.keys(ENGINES).join(", ");

const NO_BOX_WARNING =
  "Aviso: sin caja, los agentes corren en el mismo contenedor que la llave y los secretos. Pueden leerlos, igual que las sesiones de los CLI, y lo que hagan en internet no pasa por la puerta de salida.";

const SOURCE_TEXT = { env: "una variable de entorno", file: "un Docker secret" } as const;

const commandOf = (e: EngineSetup) => [e.bin, ...e.login.args].join(" ");

/** Asks until `parse` accepts the answer; it returns undefined after explaining what is wrong. */
async function askUntil<T>(deps: SetupDeps, question: string, parse: (answer: string) => T | undefined): Promise<T> {
  for (;;) {
    const parsed = parse((await deps.ask(question)).trim());
    if (parsed !== undefined) return parsed;
  }
}

async function confirmNoBox(deps: SetupDeps): Promise<boolean> {
  deps.say(NO_BOX_WARNING);
  return deps.confirm("¿Trabajar sin caja igual?");
}

async function chooseIsolation(deps: SetupDeps): Promise<FactoryConfig["isolation"]> {
  if (!deps.boxResponds()) {
    deps.say("Desde este contenedor no respondió Docker ni Podman, así que la caja no está disponible ahora. Para usarla, sumá docker/compose.box.yaml, que conecta el socket de Docker de tu máquina.");
    if (await confirmNoBox(deps)) return "worktree";
    deps.say("Queda la caja (isolation: container). Hasta que esté lista, los trabajos esperan en la cola.");
    return "container";
  }
  deps.say("Docker responde desde este contenedor. Aviso: el socket da control sobre la máquina anfitriona a todo lo que corra acá con zero. Los agentes dentro de la caja no lo ven.");
  for (;;) {
    const answer = (await deps.ask("¿Dónde trabajan los agentes? [caja/sin caja] (caja): ")).trim().toLowerCase();
    if (!answer || answer === "caja") {
      deps.say("Queda la caja (isolation: container). Corré `zero box setup` para construir su imagen.");
      return "container";
    }
    if (/^sin[ -]?caja$/.test(answer)) {
      if (await confirmNoBox(deps)) return "worktree";
      continue;
    }
    deps.say("Respondé caja o sin caja.");
  }
}

/** What keeps an engine from being chosen for this method, in the person's words. */
function engineProblem(deps: SetupDeps, name: string, method: Method, isolation: FactoryConfig["isolation"]): string | undefined {
  const engine = ENGINES[name];
  if (!engine) return `No conozco el motor "${name}". Por ahora: ${ENGINE_NAMES}.`;
  if (!deps.isAvailable(engine.bin)) return `El CLI de ${engine.label} (${engine.bin}) no está en esta imagen y no instalo nada por mi cuenta. Reconstruí la imagen sumándolo a ZERO_CLIS (por ejemplo \`ZERO_CLIS=claude,codex docker compose build\`).`;
  if (method === "subscription" && isolation === "container" && !engine.loginInBox) {
    return `${engine.label} por suscripción no sirve dentro de la caja: su sesión queda en el HOME, y la caja solo recibe credenciales por nombre. Dentro de la caja necesita una API key; para usar la suscripción, elegí trabajar sin caja.`;
  }
  return undefined;
}

async function pickEngines(deps: SetupDeps, question: string, method: Method, isolation: FactoryConfig["isolation"], opts: { single?: boolean; notSameAs?: string } = {}): Promise<string[]> {
  return askUntil(deps, question, (answer) => {
    const names = [...new Set(answer.toLowerCase().split(/[\s,]+/).filter(Boolean))];
    if (!names.length) return void deps.say(`Elegí al menos uno: ${ENGINE_NAMES}.`);
    if (opts.single && names.length > 1) return void deps.say("Acá va un solo motor.");
    if (opts.notSameAs && names.includes(opts.notSameAs)) return void deps.say(`Tienen que ser motores distintos: ${opts.notSameAs} ya trabaja por suscripción, y el reemplazo tiene que ser otro.`);
    const problem = names.map((n) => engineProblem(deps, n, method, isolation)).find(Boolean);
    if (problem) return void deps.say(problem);
    return names;
  });
}

interface EngineChoice {
  name: string;
  method: Method;
}

/** Engines in the order the factory should try them: `engine`, then `fallback`. */
async function chooseEngines(deps: SetupDeps, isolation: FactoryConfig["isolation"]): Promise<EngineChoice[]> {
  const mode = await askUntil(deps, "¿Cómo vas a trabajar? [suscripción/API key/ambas]: ", (answer) => {
    const text = answer.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (text === "suscripcion") return "subscription" as const;
    if (text === "api key" || text === "api") return "api" as const;
    if (text === "ambas") return "both" as const;
    return void deps.say("Respondé suscripción, API key o ambas.");
  });
  const asked = `(${ENGINE_NAMES})`;
  if (mode === "both") {
    const [subscription] = await pickEngines(deps, `¿Qué motor por suscripción? ${asked}: `, "subscription", isolation, { single: true });
    const [api] = await pickEngines(deps, `¿Qué motor por API key, como reemplazo? ${asked}: `, "api", isolation, { single: true, notSameAs: subscription });
    return [{ name: subscription!, method: "subscription" }, { name: api!, method: "api" }];
  }
  const names = await pickEngines(deps, `¿Qué motores, en orden de preferencia? ${asked}, separados por coma: `, mode, isolation);
  return names.map((name) => ({ name, method: mode }));
}

/** A number within `[min, max]`; `integer` for ports. Empty keeps the value shown. */
async function askNumber(deps: SetupDeps, question: string, current: number, min: number, max: number, integer = false): Promise<number> {
  return askUntil(deps, `${question} [${current}]: `, (answer) => {
    if (!answer) return current;
    const n = /^\d+(\.\d+)?$/.test(answer) ? Number(answer) : NaN;
    if (Number.isNaN(n) || n < min || n > max || (integer && !Number.isInteger(n))) return void deps.say(`Tiene que ser un número ${integer ? "entero " : ""}entre ${min} y ${max}.`);
    return n;
  });
}

type Limits = Partial<Pick<FactoryConfig["limits"], "usdPerDay" | "usdPerJob" | "reservePercent">>;

/** Only the limits of what was chosen: per-use billing has dollars, plans have a reserve. */
async function chooseLimits(deps: SetupDeps, engines: EngineChoice[], current: FactoryConfig["limits"]): Promise<Limits> {
  const limits: Limits = {};
  if (engines.some((e) => e.method === "api")) {
    limits.usdPerDay = await askNumber(deps, "Tope de gasto por día, en dólares (limits.usdPerDay)", current.usdPerDay, 0, Number.MAX_SAFE_INTEGER);
    limits.usdPerJob = await askNumber(deps, "Tope de gasto por trabajo, en dólares (limits.usdPerJob)", current.usdPerJob, 0.01, Number.MAX_SAFE_INTEGER);
  }
  if (engines.some((e) => e.method === "subscription")) {
    limits.reservePercent = await askNumber(deps, "Parte de tu plan que la fábrica te deja libre, en % (limits.reservePercent)", current.reservePercent, 0, 99);
  }
  return limits;
}

async function choosePanel(deps: SetupDeps, env: NodeJS.ProcessEnv, current: FactoryConfig["panel"], exists: boolean): Promise<FactoryConfig["panel"]> {
  const published = Number(env.ZERO_PANEL_PORT);
  const shown = !exists && Number.isInteger(published) && published > 0 && published <= 65535 ? published : current.port;
  const port = await askNumber(deps, "Puerto del panel (0 lo apaga)", shown, 0, 65535, true);
  if (!inContainer(env)) return { ...current, port };
  deps.say("Dentro del contenedor el panel escucha en todas sus interfaces (panel.host: 0.0.0.0), para que compose pueda publicarlo, y sigue pidiendo la clave. En tu máquina queda atado a 127.0.0.1 salvo que cambies ZERO_PANEL_BIND.");
  if (port && String(port) !== (env.ZERO_PANEL_PORT ?? "4848")) deps.say(`Definí ZERO_PANEL_PORT=${port} en el archivo .env, junto a compose.yaml, para que compose publique ese puerto.`);
  return { port, host: "0.0.0.0" };
}

/** A key the person types, unless one that cannot be replaced from here is already in use. */
async function storeSecret(deps: SetupDeps, name: string): Promise<void> {
  const source = deps.secrets.source(name);
  if (source === "env" || source === "file") return deps.say(`${name} ya viene de ${SOURCE_TEXT[source]}: uso esa y no guardo otra.`);
  for (;;) {
    const value = (await deps.askSecret(source ? `${name} (Enter conserva la guardada)` : name)).trim();
    if (value) {
      deps.secrets.set(name, value);
      return deps.say(`${name} guardada en ${deps.secrets.place}.`);
    }
    if (source) return deps.say(`${name}: conservo la guardada.`);
    deps.say(`${name} no puede quedar vacía.`);
  }
}

/** A credential of the method not chosen would keep being used: gone from the store, and a warning for what zero cannot delete. */
function dropOtherMethod(deps: SetupDeps, names: string[]): void {
  for (const name of names) {
    if (deps.secrets.stored(name)) {
      deps.secrets.remove(name);
      deps.say(`Borré ${name} del almacén, porque ya no corresponde a lo que elegiste.`);
    }
    const source = deps.secrets.source(name);
    if (source === "env" || source === "file") deps.say(`Aviso: ${name} viene de ${SOURCE_TEXT[source]}. No puedo borrarla y se va a seguir usando; sacala de ahí si no querés que se use.`);
  }
}

async function loginTo(deps: SetupDeps, engine: EngineSetup): Promise<void> {
  const { token } = engine.login;
  const later = `\`${commandOf(engine)}\`${token ? ` y después \`zero secret set ${token}\`` : ""}`;
  const source = token && deps.secrets.source(token);
  if (source === "env" || source === "file") return deps.say(`${token} ya viene de ${SOURCE_TEXT[source]}: uso esa.`);
  if (!(await deps.confirm(`¿Lanzo \`${commandOf(engine)}\` en esta terminal para iniciar sesión en ${engine.label}?`))) return deps.say(`No lancé nada. Cuando quieras, hacelo con ${later}.`);
  const code = await deps.runInteractive(engine.bin, engine.login.args);
  if (code !== 0) return deps.say(`\`${commandOf(engine)}\` terminó con código ${code}. Podés reintentar con ${later}.`);
  if (!token) return deps.say(`Sesión de ${engine.label} iniciada; queda en el HOME del volumen, sin cifrar.`);
  const value = (await deps.askSecret(`${token} (el token que te mostró \`${commandOf(engine)}\`)`)).trim();
  if (!value) return deps.say(`No guardé ningún token. Cuando lo tengas: \`zero secret set ${token}\`.`);
  deps.secrets.set(token, value);
  deps.say(`${token} guardado en ${deps.secrets.place}.`);
}

async function setUpGitHub(deps: SetupDeps): Promise<void> {
  const choice = await askUntil(deps, "Acceso a GitHub [login/token/ninguno]: ", (answer) => {
    const text = answer.toLowerCase();
    if (text === "login" && !deps.isAvailable("gh")) return void deps.say("`gh` no está en esta imagen: elegí token o ninguno.");
    if (text === "login" || text === "token" || text === "ninguno") return text;
    return void deps.say("Respondé login, token o ninguno.");
  });
  if (choice === "token") return storeSecret(deps, "GH_TOKEN");
  if (choice === "ninguno") {
    if (deps.secrets.has("GH_TOKEN")) deps.say("GH_TOKEN sigue disponible; si querés sacarlo: `zero secret remove GH_TOKEN`.");
    return;
  }
  if (!(await deps.confirm("¿Lanzo `gh auth login` en esta terminal?"))) return deps.say("No lancé nada. Cuando quieras, hacelo con `gh auth login`.");
  const code = await deps.runInteractive("gh", ["auth", "login"]);
  if (code !== 0) return deps.say(`\`gh auth login\` terminó con código ${code}. Podés reintentar cuando quieras.`);
  // A stored token would win over the session just started.
  if (deps.secrets.stored("GH_TOKEN")) deps.secrets.remove("GH_TOKEN");
  deps.say("Sesión de GitHub iniciada; queda en el HOME del volumen, sin cifrar.");
}

/**
 * `zero setup`: what the factory works with. Can be run again: it changes only
 * what it manages, keeps lines and comments, and nothing is installed here.
 */
export async function runSetup(home: FactoryHome, deps: SetupDeps): Promise<SetupResult> {
  if (!deps.interactive) throw new Error("`zero setup` necesita una terminal para preguntarte; no cambié nada. Con Docker: `docker compose run --rm zero setup`, con terminal (sin -T).");
  const env = deps.env ?? process.env;
  const exists = existsSync(home.config);
  // Before asking anything: a broken file or a store that cannot be opened would only fail at the end.
  const current = exists ? await loadFactory(home.config) : parseFactory(stringify({ lines: [] }));
  deps.secrets.check();

  const isolation = inContainer(env) ? await chooseIsolation(deps) : current.isolation;
  const engines = await chooseEngines(deps, isolation);
  const limits = await chooseLimits(deps, engines, current.limits);
  const panel = await choosePanel(deps, env, current.panel, exists);

  for (const { name, method } of engines) {
    const engine = ENGINES[name]!;
    if (method === "subscription") {
      dropOtherMethod(deps, engine.apiKeys);
      await loginTo(deps, engine);
    } else {
      dropOtherMethod(deps, engine.login.token ? [engine.login.token] : []);
      await storeSecret(deps, engine.apiKeys[0]!);
    }
  }
  await setUpGitHub(deps);

  const [first, ...rest] = engines.map((e) => e.name);
  if (!exists) await initFactory(home, deps.cwd, deps.isAvailable);
  await editFactory(home.config, (doc) => {
    doc.set("engine", first);
    doc.set("fallback", doc.createNode(rest));
    if (inContainer(env)) doc.set("isolation", isolation);
    for (const [key, value] of Object.entries(limits)) doc.setIn(["limits", key], value);
    doc.setIn(["panel", "port"], panel.port);
    doc.setIn(["panel", "host"], panel.host);
  });
  deps.say(`Listo: motor ${first}${rest.length ? `, reemplazo ${rest.join(", ")}` : ""}, en ${home.config}. Podés volver a correr \`zero setup\` para cambiarlo.`);
  if (inContainer(env)) deps.say("Si la fábrica ya está en marcha, reiniciala con `docker compose restart zero` para que tome el puerto del panel. Los repositorios van en /repos; sumalos con `zero line add /repos/<nombre>`.");
  return { path: home.config, engine: first!, fallback: rest, isolation };
}

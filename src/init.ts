import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseDocument, stringify } from "yaml";
import { parseFactory, type LineConfig } from "./config.js";
import type { FactoryHome } from "./home.js";
import { onPath, tryGit } from "./shell.js";

/** Agent clients zero can drive, in order of preference for the default engine. */
const CLIENTS = [
  { engine: "claude", bin: "claude" },
  { engine: "codex", bin: "codex" },
  { engine: "antigravity", bin: "agy" },
] as const;

export function detectClients(isAvailable: (bin: string) => boolean = onPath): string[] {
  return CLIENTS.filter((c) => isAvailable(c.bin)).map((c) => c.engine);
}

/** Setup and verify commands guessed from the files a repository has. */
export function detectCommands(repo: string): Pick<LineConfig, "setup" | "verify"> {
  const has = (file: string) => existsSync(join(repo, file));
  if (has("package.json")) {
    const scripts: Record<string, string> = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts ?? {};
    const setup = has("pnpm-lock.yaml")
      ? ["pnpm install --frozen-lockfile"]
      : has("yarn.lock")
        ? ["yarn install --frozen-lockfile"]
        : has("package-lock.json")
          ? ["npm ci"]
          : ["npm install"];
    const verify = ["typecheck", "lint", "test"].filter((s) => scripts[s]).map((s) => (s === "test" ? "npm test" : `npm run ${s}`));
    return { setup, verify };
  }
  if (has("Cargo.toml")) return { setup: [], verify: ["cargo test"] };
  if (has("go.mod")) return { setup: [], verify: ["go test ./..."] };
  if (has("pyproject.toml") || has("pytest.ini")) return { setup: [], verify: ["pytest"] };
  return { setup: [], verify: [] };
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "line"
  );
}

/** The line for a local git repository, or undefined when `path` is not inside one. */
export function lineFromRepo(path: string): Omit<LineConfig, "integrate" | "remote" | "maxAttempts"> | undefined {
  const repo = tryGit(["rev-parse", "--show-toplevel"], path);
  if (!repo) return undefined;
  const baseBranch = tryGit(["symbolic-ref", "--short", "HEAD"], repo) || "main";
  return { name: slug(basename(repo)), repo, baseBranch, ...detectCommands(repo) };
}

export interface InitResult {
  created: boolean;
  path: string;
  engine: string;
  clients: string[];
  line?: string;
}

const HEADER = `# Fábrica zero. Editable a mano o desde el panel; los secretos NO van aquí.
# Niveles: L0 aprobás todo · L1 aprobás la especificación · L2 solo consulta por política · L3 a oscuras.
`;

export async function initFactory(home: FactoryHome, cwd: string, isAvailable?: (bin: string) => boolean): Promise<InitResult> {
  const clients = detectClients(isAvailable);
  const engine = clients[0] ?? "claude";
  if (existsSync(home.config)) return { created: false, path: home.config, engine, clients };

  const line = lineFromRepo(cwd);
  const doc = {
    version: 1,
    level: "L3",
    isolation: "container",
    engine,
    limits: { usdPerDay: 10, usdPerJob: 3 },
    lines: line ? [line] : [],
  };
  parseFactory(stringify(doc)); // never write a file the factory would refuse to load
  await mkdir(dirname(home.config), { recursive: true });
  await writeFile(home.config, HEADER + stringify(doc));
  return { created: true, path: home.config, engine, clients, line: line?.name };
}

/** Adds a repository as a line, keeping the comments and formatting of the existing file. */
export async function addLine(home: FactoryHome, path: string, name?: string): Promise<LineConfig> {
  const line = lineFromRepo(path);
  if (!line) throw new Error(`${path} no es un repositorio git.`);
  const doc = parseDocument(await readFile(home.config, "utf8"));
  const cfg = parseFactory(doc.toString());
  const entry = { ...line, name: name ?? line.name };
  if (cfg.lines.some((l) => l.name === entry.name)) throw new Error(`Ya existe la línea "${entry.name}".`);
  if (!doc.has("lines")) doc.set("lines", doc.createNode([]));
  doc.addIn(["lines"], doc.createNode(entry));
  const next = doc.toString();
  const added = parseFactory(next).lines.find((l) => l.name === entry.name)!;
  await writeFile(home.config, next);
  return added;
}

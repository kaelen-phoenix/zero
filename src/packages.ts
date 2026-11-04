import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { CustomAgentSchema, FIXED_STATIONS, instructionsProblem, loadFactory, type FactoryConfig, type LoadedPackages, type PackageAgent, type PackageEntry, type PackageStation } from "./config.js";
import type { FactoryHome } from "./home.js";
import { SECRET_NAME } from "./keychain.js";
import { log } from "./log.js";
import { skillDescription, type Skill } from "./skills.js";

/** The only version of the package format this zero understands. */
export const PACKAGE_INTERFACE = 1;
export const MANIFEST = "zero-package.yaml";

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const NAME_RULE = "usá minúsculas, dígitos y guiones";

/** No `engine` or `model` here: which engine runs a third party's agent is up to the package's entry, so they are refused as unknown keys. */
const ManifestAgentSchema = z
  .object({
    name: z.string().regex(NAME, NAME_RULE),
    instructions: z.string().min(1),
    type: z.enum(["review", "build"]).default("review"),
    blocking: z.boolean().optional(),
    files: z.array(z.string().min(1)).optional(),
    maxTurns: z.number().int().positive().optional(),
    timeoutMinutes: z.number().positive().optional(),
    skills: z.array(z.string().min(1)).default([]),
  })
  .strict();

const ManifestStationSchema = z
  .object({
    name: z.string().regex(NAME, NAME_RULE),
    /** The code, an ES module exporting `pass`. */
    module: z.string().min(1),
    /** Its agent's instructions; a station that calls no agent needs none. */
    instructions: z.string().min(1).optional(),
    skills: z.array(z.string().min(1)).default([]),
    secrets: z.array(z.string().regex(SECRET_NAME, "va el nombre de un secreto, en mayúsculas, dígitos y _")).default([]),
    everyMinutes: z.number().positive().default(1440),
    timeoutMinutes: z.number().positive().default(10),
    maxTurns: z.number().int().positive().default(40),
  })
  .strict();

export const ManifestSchema = z
  .object({
    interface: z.literal(PACKAGE_INTERFACE),
    name: z.string().regex(NAME, NAME_RULE),
    version: z.string().min(1),
    agents: z.array(ManifestAgentSchema).default([]),
    /** Folders with a `SKILL.md`; each one's name is the skill's short name. */
    skills: z.array(z.string().min(1)).default([]),
    stations: z.array(ManifestStationSchema).default([]),
  })
  .strict();
export type PackageManifest = z.output<typeof ManifestSchema>;

/** Why a path of the manifest is refused before looking at the disk. */
function pathProblem(path: string): string | undefined {
  if (isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path)) return `la ruta "${path}" tiene que ser relativa a la carpeta del paquete`;
  if (path.split(/[\\/]/).includes("..")) return `la ruta "${path}" no puede salir de la carpeta del paquete con ".."`;
  return undefined;
}

const sameCase = (path: string) => (process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path);

/** Whether `path` is `root` or below it; both already real paths. */
function isInside(path: string, root: string): boolean {
  const rel = relative(sameCase(root), sameCase(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** The real path of something inside the package, or why not: it must exist and stay inside, links included. */
function insidePackage(root: string, path: string): { real: string } | { problem: string } {
  const problem = pathProblem(path);
  if (problem) return { problem };
  let real: string;
  try {
    real = realpathSync(join(root, path));
  } catch {
    return { problem: `la ruta "${path}" no existe en el paquete` };
  }
  return isInside(real, root) ? { real } : { problem: `la ruta "${path}" sale de la carpeta del paquete` };
}

/** The first link inside a skill's folder. None is allowed, wherever it points: a link to elsewhere in the package could chain to a link leaving it, and staging must never bring in files from outside. */
function firstLink(root: string, dir: string): string | undefined {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isSymbolicLink()) return relative(root, path);
    if (e.isDirectory()) {
      const found = firstLink(root, path);
      if (found) return found;
    }
  }
  return undefined;
}

class Refused extends Error {}

/** The manifest of a folder, valid in every way that does not depend on other packages; throws `Refused` otherwise. */
export function readManifest(dir: string): PackageManifest {
  const file = join(dir, MANIFEST);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Refused(`no existe la carpeta ${dir}`);
  if (!existsSync(file)) throw new Refused(`no tiene ${MANIFEST} en su raíz`);
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Refused(`${MANIFEST} no se puede leer: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
  const version = raw && typeof raw === "object" ? (raw as Record<string, unknown>).interface : undefined;
  if (version !== PACKAGE_INTERFACE) throw new Refused(`pide la interfaz ${JSON.stringify(version) ?? "(ninguna)"} y este zero soporta la interfaz ${PACKAGE_INTERFACE}`);
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) throw new Refused(`${MANIFEST} no es válido: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

const need = (found: { real: string } | { problem: string }): string => {
  if ("problem" in found) throw new Refused(found.problem);
  return found.real;
};

/** The skills of a package, from its manifest's folders. */
function packageSkills(manifest: PackageManifest, root: string): Skill[] {
  const out: Skill[] = [];
  for (const path of manifest.skills) {
    const dir = need(insidePackage(root, path));
    if (!statSync(dir).isDirectory() || !existsSync(join(dir, "SKILL.md"))) throw new Refused(`la carpeta de skill "${path}" no tiene SKILL.md`);
    const link = firstLink(root, dir);
    if (link) throw new Refused(`la skill "${path}" tiene un enlace, y en una skill no se aceptan: ${link}`);
    const name = basename(dir);
    if (out.some((s) => s.name === name)) throw new Refused(`la skill "${name}" está repetida`);
    const description = skillDescription(readFileSync(join(dir, "SKILL.md"), "utf8"));
    out.push({ name, fullName: `${manifest.name}:${name}`, source: "package", plugin: manifest.name, dir, ...(description && { description }) });
  }
  return out;
}

/** A short name of the package's own skills as its full name; a package's agents and stations use nothing else. */
function ownSkills(refs: string[], skills: Skill[], who: string): string[] {
  return refs.map((ref) => {
    const skill = skills.find((s) => s.name === ref || s.fullName === ref);
    if (!skill) throw new Refused(`${who} pide la skill "${ref}", que el paquete no trae`);
    return skill.fullName;
  });
}

function packageAgents(manifest: PackageManifest, root: string, entry: PackageEntry, skills: Skill[], taken: Set<string>): PackageAgent[] {
  const seen = new Set<string>();
  return manifest.agents.map((a) => {
    const who = `el agente "${a.name}"`;
    const wrong = instructionsProblem(a.instructions);
    if (wrong) throw new Refused(`${who}: ${wrong}`);
    need(insidePackage(root, a.instructions));
    if ((FIXED_STATIONS as readonly string[]).includes(a.name)) throw new Refused(`${who} usa el nombre de una estación fija de zero`);
    if (taken.has(a.name) || seen.has(a.name)) throw new Refused(`${who} usa un nombre que ya tiene otro agente`);
    seen.add(a.name);
    const parsed = CustomAgentSchema.safeParse({ ...a, skills: ownSkills(a.skills, skills, who), ...(entry.engine && { engine: entry.engine }), ...(entry.model && { model: entry.model }) });
    if (!parsed.success) throw new Refused(`${who}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    return { ...parsed.data, package: manifest.name, packageDir: root };
  });
}

function packageStations(manifest: PackageManifest, root: string, entry: PackageEntry, skills: Skill[]): PackageStation[] {
  const seen = new Set<string>();
  return manifest.stations.map((s) => {
    const who = `la estación "${s.name}"`;
    if (seen.has(s.name)) throw new Refused(`${who} está repetida`);
    seen.add(s.name);
    const module = need(insidePackage(root, s.module));
    if (!/\.(?:mjs|js)$/i.test(s.module)) throw new Refused(`${who}: el módulo tiene que ser .mjs o .js ("${s.module}")`);
    if (s.instructions) {
      const wrong = instructionsProblem(s.instructions);
      if (wrong) throw new Refused(`${who}: ${wrong}`);
    }
    return {
      package: manifest.name,
      name: s.name,
      module,
      ...(s.instructions && { instructions: need(insidePackage(root, s.instructions)) }),
      skills: ownSkills(s.skills, skills, who),
      secrets: s.secrets,
      everyMinutes: s.everyMinutes,
      timeoutMinutes: s.timeoutMinutes,
      maxTurns: s.maxTurns,
      entry,
    };
  });
}

/** Where an entry's package lives. */
export function packageFolder(entry: PackageEntry, home: Pick<FactoryHome, "config" | "packages">): string {
  return entry.npm ? join(home.packages, "node_modules", entry.npm) : resolve(dirname(home.config), entry.path!);
}

/** How a package is called before its manifest could be read. */
const entryLabel = (entry: PackageEntry) => entry.npm ?? entry.path!;

/** Why code from this real folder must not be imported: the jobs' agents can write there. */
function codeRefusal(config: Pick<FactoryConfig, "lines">, home: Pick<FactoryHome, "worktrees" | "jobs">, dir: string): string | undefined {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  for (const line of config.lines) if (isInside(dir, real(line.repo))) return `su carpeta está dentro del repositorio de la línea "${line.name}", donde escriben los agentes`;
  for (const work of [home.worktrees, home.jobs]) if (isInside(dir, real(work))) return `su carpeta está dentro de ${work}, donde escriben los agentes`;
  return undefined;
}

const logged = new Set<string>();

/** Once per distinct message: the daemon loads the packages on every turn of its loop. */
export function warnOnce(message: string, fields?: Record<string, unknown>): void {
  if (logged.has(message)) return;
  logged.add(message);
  log.warn(message, fields);
}

/**
 * What the file's `packages` bring. It never throws: a package that cannot be
 * loaded stays out whole, its problem says why, and the others go on. Its names
 * are only taken once it is in.
 */
export function loadPackages(config: Pick<FactoryConfig, "packages" | "agents" | "lines">, home: Pick<FactoryHome, "config" | "packages" | "worktrees" | "jobs">): LoadedPackages {
  const out: LoadedPackages = { packages: [], agents: [], skills: [], stations: [], problems: [] };
  const taken = new Set([...config.agents, ...config.lines.flatMap((l) => l.agents)].map((a) => a.name));
  for (const [index, entry] of (config.packages ?? []).entries()) {
    let label = entryLabel(entry);
    try {
      const dir = packageFolder(entry, home);
      const manifest = readManifest(dir);
      label = manifest.name;
      if (out.packages.some((p) => p.name === manifest.name)) throw new Refused(`hay otro paquete con el nombre "${manifest.name}"`);
      const root = realpathSync(dir);
      const skills = packageSkills(manifest, root);
      const agents = packageAgents(manifest, root, entry, skills, taken);
      const stations = packageStations(manifest, root, entry, skills);
      for (const a of agents) taken.add(a.name);
      out.packages.push({ name: manifest.name, version: manifest.version, dir: root, index, entry, agents: agents.map((a) => a.name), skills: skills.map((s) => s.fullName), stations: stations.map((s) => s.name) });
      out.agents.push(...agents);
      out.skills.push(...skills);
      if (!stations.length) continue;
      const names = stations.map((s) => s.name).join(", ");
      const refusal = entry.allowCode ? codeRefusal(config, home, root) : `falta allowCode: true en su entrada para correr código`;
      if (refusal) out.problems.push({ package: manifest.name, reason: `sus estaciones (${names}) no corren: ${refusal}` });
      else out.stations.push(...stations);
    } catch (err) {
      out.problems.push({ package: label, reason: err instanceof Refused ? err.message : `no se pudo cargar: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  for (const p of out.problems) warnOnce(`paquete ${p.package}: ${p.reason}`);
  return out;
}

/** A definition with what its packages bring. */
export function withPackages(config: FactoryConfig, home: FactoryHome): FactoryConfig {
  return { ...config, loadedPackages: loadPackages(config, home) };
}

/** The factory as everything works with it: the file, plus its packages. */
export async function factoryConfig(home: FactoryHome): Promise<FactoryConfig> {
  return withPackages(await loadFactory(home.config), home);
}


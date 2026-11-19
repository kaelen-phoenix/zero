import { FIXED_STATIONS } from "./config.js";

/**
 * The agent catalog's checks, pure: what a third party's agent must pass
 * before zero stores it. Its text is untrusted data, so it is only read here,
 * never run, and anything that reads like orders, asks for credentials or
 * reaches the network stays out.
 */

export type CatalogType = "review" | "build";
export type CatalogStatus = "listed" | "proposed" | "added" | "rejected";
export const CATALOG_STATUSES: readonly CatalogStatus[] = ["proposed", "listed", "added", "rejected"];
export type CatalogLicense = "MIT" | "Apache-2.0" | "BSD-2-Clause" | "BSD-3-Clause";

/** What a finding becomes once stored, in `agent_catalog`. */
export interface CatalogEntry {
  id: string;
  name: string;
  /** What it does, in a sentence or two. */
  description: string;
  type: CatalogType;
  /** The https URL of its repository, normalized by `catalogKey`. */
  source: string;
  license: CatalogLicense;
  /** Engines it works on, as the finding said. */
  engines: string[];
  /** The instructions that adding it would write, as found. */
  instructions: string;
  /** When zero screened it. */
  reviewedAt: string;
  status: CatalogStatus;
  /** With `proposed` or `added`: the line it is for. */
  line?: string;
  /** With `proposed`: the gap of the line it fills. */
  gap?: string;
  /** Why the owner rejected it, when they said. */
  note?: string;
  createdAt: string;
  decidedAt?: string;
}

/** An agent found outside the factory, before any check. */
export interface CatalogFinding {
  name: string;
  description: string;
  type: string;
  source: string;
  license: string;
  engines: string[];
  instructions?: string;
  line?: string;
  gap?: string;
}

export type NewCatalogEntry = Omit<CatalogEntry, "id" | "createdAt" | "decidedAt" | "note">;

const MAX_NAME = 60;
const MAX_DESCRIPTION = 1000;
const MAX_GAP = 500;
const MAX_INSTRUCTIONS = 20_000;
const MAX_ENGINES = 10;

/** The license as SPDX when it is one zero can take (MIT, Apache 2.0, BSD 2 or 3 clause); anything else, unknown included, is undefined. */
export function normalizeLicense(text: string | undefined): CatalogLicense | undefined {
  const s = (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\b(the|licen[sc]e|version|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s === "mit") return "MIT";
  if (/^apache (2|2\.0)$/.test(s)) return "Apache-2.0";
  if (/^(bsd (2|2 clause)|simplified bsd|freebsd)$/.test(s)) return "BSD-2-Clause";
  if (/^(bsd (3|3 clause)|(new|modified|revised) bsd)$/.test(s)) return "BSD-3-Clause";
  return undefined;
}

const SCREEN: { pattern: RegExp; problem: string }[] = [
  { pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,30}\b(previous|prior|above|earlier|all|your|any)\b[^.\n]{0,20}\b(instructions?|rules|prompts?|directions)\b/i, problem: "intenta dar órdenes (inyección de prompt)" },
  { pattern: /\bsystem[ _-]?prompt\b|\bjailbreak\b|\bdeveloper mode\b/i, problem: "intenta dar órdenes (inyección de prompt)" },
  { pattern: /\b[A-Z][A-Z0-9]*_(TOKEN|KEY|SECRET|PASSWORD|PAT)\b/, problem: "pide credenciales o secretos" },
  { pattern: /\b(api[ _-]?keys?|passwords?|passphrases?|credentials?|secrets?|private[ _-]?keys?)\b/i, problem: "pide credenciales o secretos" },
  { pattern: /\b(access|auth|bearer|github|gh|npm|personal[ _-]access|oauth|session)[ _-]?tokens?\b/i, problem: "pide credenciales o secretos" },
  { pattern: /(^|[\s/"'`(])\.env\b|\bssh[ _-]?keys?\b|\bid_(rsa|ed25519|ecdsa)\b|\.ssh\//i, problem: "pide credenciales o secretos" },
  { pattern: /\b(curl|wget)\b|\binvoke-(webrequest|restmethod)\b|\biwr\b|\birm\b/i, problem: "usa la red o descarga algo" },
  { pattern: /\bfetch\b[^\n]{0,40}https?:\/\//i, problem: "usa la red o descarga algo" },
  { pattern: /\b(npm|pnpm|yarn|bun)\s+(install|i|add)\b|\bpip3?\s+install\b|\bnpx\s/i, problem: "instala software" },
];

/** What makes a third party's text unsafe to propose, once each; empty when nothing was found. It only reads the text. */
export function screenAgentText(text: string): string[] {
  const problems: string[] = [];
  for (const { pattern, problem } of SCREEN) if (pattern.test(text) && !problems.includes(problem)) problems.push(problem);
  return problems;
}

/** A source URL as the catalog compares it: https only, lowercase host, no credentials, query, fragment, trailing slash or `.git`. */
export function catalogKey(source: string): string | undefined {
  let url: URL;
  try {
    url = new URL(source.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return undefined;
  const path = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return `https://${url.host.toLowerCase()}${path}`;
}

/** A found name as an agent name: lowercase, digits and hyphens. */
export function catalogName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME)
    .replace(/-+$/, "");
}

export interface CatalogContext {
  /** Every entry already in the catalog, whatever its status. */
  existing: Pick<CatalogEntry, "name" | "source">[];
  /** The lines a finding may name (no package lines), with their custom agents' names. */
  lines: { name: string; agents: string[] }[];
  /** At most this many are accepted. */
  max: number;
  /** The review date of what is accepted. */
  reviewedAt: string;
}

export interface CatalogDrop {
  name: string;
  reason: string;
}

/**
 * The findings the catalog takes, in order, and why the rest stay out:
 * a compatible license, a clean screen and nothing seen before, by source or
 * by name, in any status or among the line's agents. One that names a known
 * line and a gap is `proposed` for it; the rest are `listed` with no line.
 */
export function acceptFindings(findings: CatalogFinding[], ctx: CatalogContext): { entries: NewCatalogEntry[]; dropped: CatalogDrop[] } {
  const entries: NewCatalogEntry[] = [];
  const dropped: CatalogDrop[] = [];
  const names = new Set(ctx.existing.map((e) => catalogName(e.name)));
  const sources = new Set(ctx.existing.map((e) => catalogKey(e.source) ?? e.source));
  for (const f of findings) {
    const name = catalogName(String(f.name ?? ""));
    const drop = (reason: string) => dropped.push({ name: name || String(f.name ?? ""), reason });
    if (entries.length >= ctx.max) {
      drop("ya se tomaron los de esta pasada");
      continue;
    }
    const source = catalogKey(String(f.source ?? ""));
    const license = normalizeLicense(f.license);
    const description = String(f.description ?? "").trim();
    const instructions = String(f.instructions ?? "").trim();
    const type = f.type === "review" || f.type === "build" ? f.type : undefined;
    if (!name || (FIXED_STATIONS as readonly string[]).includes(name)) drop("el nombre no sirve para un agente");
    else if (!source) drop("la fuente no es una dirección https");
    else if (!license) drop("la licencia no es MIT, Apache 2.0 ni BSD");
    else if (!type) drop("el tipo no es review ni build");
    else if (!description) drop("no dice qué hace");
    else if (instructions.length > MAX_INSTRUCTIONS) drop("las instrucciones son demasiado largas");
    else {
      const problems = screenAgentText([f.name, description, instructions, f.gap ?? ""].join("\n"));
      const line = ctx.lines.find((l) => l.name === f.line);
      if (problems.length) drop(problems.join("; "));
      else if (sources.has(source)) drop("su fuente ya está en el catálogo");
      else if (names.has(name)) drop("su nombre ya está en el catálogo");
      else if (line?.agents.includes(name)) drop(`la línea ${line.name} ya tiene un agente con ese nombre`);
      else {
        const gap = String(f.gap ?? "").trim().slice(0, MAX_GAP);
        const engines = [...new Set((f.engines ?? []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[a-z0-9][a-z0-9._-]*$/.test(e)))].slice(0, MAX_ENGINES);
        const proposed = line !== undefined && gap !== "";
        entries.push({
          name,
          description: description.slice(0, MAX_DESCRIPTION),
          type,
          source,
          license,
          engines,
          instructions,
          reviewedAt: ctx.reviewedAt,
          status: proposed ? "proposed" : "listed",
          ...(proposed && { line: line.name, gap }),
        });
        names.add(name);
        sources.add(source);
      }
    }
  }
  return { entries, dropped };
}

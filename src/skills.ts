import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import type { FactoryConfig } from "./config.js";

/** Stations staffed by an agent, which are the only ones that can get skills. */
export const SKILL_STATIONS = ["spec", "build", "review", "security", "reply", "scout"] as const;
export type SkillStation = (typeof SKILL_STATIONS)[number];

/** A skill installed in the owner's Claude Code. */
export interface Skill {
  /** Short name: the skill's directory. */
  name: string;
  /** `name` for personal skills, `plugin:name` for plugin skills. */
  fullName: string;
  source: "personal" | "plugin";
  plugin?: string;
  dir: string;
  /** Short description from the SKILL.md frontmatter, when it has one. */
  description?: string;
}

/** A skill copied for one agent run; `id` is its directory under `<dir>/skills`. */
export interface StagedSkill {
  name: string;
  id: string;
  /** SKILL.md as staged, without `allowed-tools`. */
  text: string;
}

/** What an engine gets: a plugin directory zero staged, and the skills in it. */
export interface StagedSkills {
  dir: string;
  skills: StagedSkill[];
}

/** How an assigned skill is shown: what it resolves to, or why it does not. */
export interface SkillView {
  /** As assigned. */
  name: string;
  fullName?: string;
  description?: string;
  missing?: string;
}

export interface SkillProblem {
  skill: string;
  station: SkillStation;
  line?: string;
  reason: string;
}

export const defaultClaudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

function skillDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "SKILL.md")))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const DESCRIPTION_MAX = 200;

/** One line of at most 200 characters, cut with an ellipsis. */
export function shortDescription(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : line;
}

/** The frontmatter `description`; anything missing or unparseable means no description. */
export function skillDescription(text: string): string | undefined {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return undefined;
  try {
    const data = parse(m[1]!) as unknown;
    const d = data && typeof data === "object" ? (data as Record<string, unknown>).description : undefined;
    return typeof d === "string" && d.trim() ? shortDescription(d) : undefined;
  } catch {
    return undefined;
  }
}

function withDescription(skill: Skill): Skill {
  let text: string;
  try {
    text = readFileSync(join(skill.dir, "SKILL.md"), "utf8");
  } catch {
    return skill;
  }
  const description = skillDescription(text);
  return description ? { ...skill, description } : skill;
}

/** Personal skills and those of installed plugins; anything missing or unreadable is simply left out. */
export function discoverSkills(claudeHome = defaultClaudeHome()): Skill[] {
  const personalRoot = join(claudeHome, "skills");
  const out: Skill[] = skillDirs(personalRoot).map((name) => ({ name, fullName: name, source: "personal", dir: join(personalRoot, name) }));
  let plugins: Record<string, { installPath?: string }[]> = {};
  try {
    const raw = JSON.parse(readFileSync(join(claudeHome, "plugins", "installed_plugins.json"), "utf8")) as { plugins?: typeof plugins };
    plugins = raw.plugins ?? {};
  } catch {
    // no plugins
  }
  const seen = new Set<string>();
  for (const [key, installs] of Object.entries(plugins)) {
    const plugin = key.split("@")[0]!;
    for (const install of Array.isArray(installs) ? installs : []) {
      if (typeof install?.installPath !== "string") continue;
      const root = join(install.installPath, "skills");
      for (const name of skillDirs(root)) {
        const fullName = `${plugin}:${name}`;
        if (seen.has(fullName)) continue;
        seen.add(fullName);
        out.push({ name, fullName, source: "plugin", plugin, dir: join(root, name) });
      }
    }
  }
  return out.map(withDescription);
}

/** `plugin:skill` resolves by full name; a short name only when exactly one skill has it. */
export function resolveSkill(ref: string, available: Skill[]): { skill?: Skill; problem?: string } {
  if (ref.includes(":")) {
    const exact = available.find((s) => s.fullName === ref);
    return exact ? { skill: exact } : { problem: "no está instalada en Claude Code" };
  }
  const matches = available.filter((s) => s.name === ref);
  if (matches.length === 1) return { skill: matches[0] };
  if (matches.length > 1) return { problem: `hay varias skills con ese nombre; usá el nombre completo: ${matches.map((s) => s.fullName).join(", ")}` };
  return { problem: "no está instalada en Claude Code" };
}

export function skillView(ref: string, available: Skill[]): SkillView {
  const { skill, problem } = resolveSkill(ref, available);
  if (!skill) return { name: ref, missing: problem };
  return { name: ref, fullName: skill.fullName, ...(skill.description && { description: skill.description }) };
}

/** The global list for the agent plus the line's own, without duplicates. */
export function assignedSkills(config: FactoryConfig, station: SkillStation, lineName?: string): string[] {
  const line = lineName ? config.lines.find((l) => l.name === lineName) : undefined;
  return [...new Set([...config.stations[station].skills, ...(line?.stations?.[station]?.skills ?? [])])];
}

/** One problem per assignment that does not resolve. */
export function skillProblems(config: FactoryConfig, available: Skill[]): SkillProblem[] {
  const out: SkillProblem[] = [];
  for (const station of SKILL_STATIONS) {
    for (const skill of config.stations[station].skills) {
      const { problem } = resolveSkill(skill, available);
      if (problem) out.push({ skill, station, reason: problem });
    }
  }
  for (const line of config.lines) {
    for (const station of SKILL_STATIONS) {
      for (const skill of line.stations?.[station]?.skills ?? []) {
        const { problem } = resolveSkill(skill, available);
        if (problem) out.push({ skill, station, line: line.name, reason: problem });
      }
    }
  }
  return out;
}

/** Removes `allowed-tools` from the frontmatter, so a skill can never grant tools; the rest is unchanged. */
export function stripAllowedTools(text: string): string {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!m) return text;
  const lines = m[2]!.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^allowed-tools\s*:/.test(line)) skipping = true;
    else if (skipping && /^\s+\S|^\s*-\s/.test(line)) continue;
    else skipping = false;
    if (!skipping) kept.push(line);
  }
  return m[1] + kept.join("\n") + m[3] + text.slice(m[0].length);
}

/** Copies the skills into a fresh plugin directory; the caller removes it with `unstageSkills`. */
export async function stageSkills(skills: Skill[], parent = tmpdir()): Promise<StagedSkills> {
  const dir = await mkdtemp(join(parent, "zero-skills-"));
  await mkdir(join(dir, ".claude-plugin"), { recursive: true });
  await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "zero-skills", description: "Skills assigned by zero" }));
  const staged: StagedSkill[] = [];
  for (const skill of skills) {
    const id = skill.fullName.replace(/[^A-Za-z0-9_-]/g, "-");
    const target = join(dir, "skills", id);
    await cp(skill.dir, target, { recursive: true, dereference: true });
    const text = stripAllowedTools(await readFile(join(target, "SKILL.md"), "utf8"));
    await writeFile(join(target, "SKILL.md"), text);
    staged.push({ name: skill.fullName, id, text });
  }
  return { dir, skills: staged };
}

export async function unstageSkills(staged: StagedSkills | undefined): Promise<void> {
  if (staged) await rm(staged.dir, { recursive: true, force: true });
}

/** How engines without native skills get them: each SKILL.md after the station's instructions. */
export function withSkillText(instructions: string, skills: StagedSkill[]): string {
  if (!skills.length) return instructions;
  return [instructions, ...skills.map((s) => `---\n\n# Skill: ${s.name}\n\n${s.text.trim()}`)].join("\n\n");
}

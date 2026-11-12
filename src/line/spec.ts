import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { slug } from "../init.js";
import { LearningSchema } from "../townhall/types.js";

const ScenarioSchema = z.object({
  name: z.string(),
  when: z.string(),
  then: z.string(),
});

const RequirementSchema = z.object({
  name: z.string(),
  text: z.string().describe("One observable behaviour. MUST contain the keyword SHALL or MUST."),
  scenarios: z.array(ScenarioSchema).describe("At least one; each must be checkable by an automated test."),
});

const StageSchema = z.object({
  title: z.string(),
  tasks: z.array(z.string()).describe("This stage's tasks. Each stage builds on the previous ones and leaves the tests passing."),
});

/** What the spec station returns. Kept free of constraints some engines' structured output cannot express; checked by `specProblems`. */
export const SpecSchema = z.object({
  feasible: z.boolean().describe("False when any implementation would be a guess, needs access the factory lacks, or is destructive."),
  reason: z.string(),
  title: z.string(),
  summary: z.string().describe("What the owner will get, in plain language and in the owner's language."),
  capability: z.string().describe("kebab-case name of the system behaviour this touches."),
  requirements: z.array(RequirementSchema),
  tasks: z.array(z.string()),
  risks: z.array(z.string()),
  learnings: z.array(LearningSchema).describe("Durable facts about this codebase for future runs. Empty if nothing new."),
  followUps: z.array(z.string()).describe("Out-of-scope work worth doing. Empty if none."),
  stages: z
    .array(StageSchema)
    .optional()
    .describe("Only for a large request (many tasks or many areas of the code): between 2 and 8 stages, in build order, each small enough for one build call. Leave it out for small requests."),
});

export type Spec = z.infer<typeof SpecSchema>;
export type Stage = z.infer<typeof StageSchema>;

/** The most stages one job may have: each one is a build and a full verify, with its own attempts, so the count bounds how long a job can run. */
export const MAX_STAGES = 8;

/** The spec's stages, in order; empty when it is built in one go. */
export function specStages(spec: Pick<Spec, "stages">): Stage[] {
  return spec.stages ?? [];
}

/** The stage a job is on (the first not yet verified, never past the last), or undefined for a job without stages. */
export function jobStage(job: { spec?: unknown; stagesDone?: number }): { n: number; total: number; title: string } | undefined {
  const stages = (job.spec as Partial<Spec> | undefined)?.stages;
  if (!Array.isArray(stages) || !stages.length) return undefined;
  const n = Math.min((job.stagesDone ?? 0) + 1, stages.length);
  return { n, total: stages.length, title: String(stages[n - 1]?.title ?? "") };
}

/** Rules OpenSpec enforces that the schema alone cannot. Empty when the spec is usable. */
export function specProblems(spec: Spec): string[] {
  if (!spec.feasible) return spec.reason.trim() ? [] : ["an infeasible spec needs a reason"];
  const problems: string[] = [];
  if (!spec.title.trim()) problems.push("title is empty");
  if (!spec.requirements.length) problems.push("a feasible spec needs at least one requirement");
  for (const r of spec.requirements) {
    if (!/\b(SHALL|MUST)\b/.test(r.text)) problems.push(`requirement "${r.name}" must contain the keyword SHALL or MUST`);
    if (!r.scenarios.length) problems.push(`requirement "${r.name}" needs at least one scenario`);
  }
  if (spec.stages) {
    if (spec.stages.length < 2) problems.push("stages, when present, must have at least 2 stages");
    if (spec.stages.length > MAX_STAGES) problems.push(`stages must be at most ${MAX_STAGES}; specify the first coherent part and put the rest in followUps`);
    spec.stages.forEach((s, i) => {
      if (!s.title.trim()) problems.push(`stage ${i + 1} has an empty title`);
      if (!s.tasks.length) problems.push(`stage ${i + 1} "${s.title}" has no tasks`);
    });
  }
  return problems;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function changeName(jobId: string) {
  return `zero-${jobId}`;
}

/** The requirements as an OpenSpec spec delta. Also used as the build station's contract. */
export function renderSpecDelta(spec: Spec, newCapability: boolean): string {
  const parts = ["# Spec Delta", ""];
  if (newCapability) parts.push("## Purpose", "", oneLine(spec.summary), "");
  parts.push("## ADDED Requirements", "");
  for (const r of spec.requirements) {
    parts.push(`### Requirement: ${oneLine(r.name)}`, oneLine(r.text), "");
    for (const s of r.scenarios) parts.push(`#### Scenario: ${oneLine(s.name)}`, `- **WHEN** ${oneLine(s.when)}`, `- **THEN** ${oneLine(s.then)}`, "");
  }
  return parts.join("\n");
}

/** The spec as an OpenSpec change: path (relative to the change directory) → content. */
export function renderOpenSpecChange(spec: Spec, opts: { jobId: string; newCapability: boolean }): Record<string, string> {
  const capability = slug(spec.capability) || "change";
  const proposal = [
    "# Proposal",
    "",
    "## Why",
    "",
    oneLine(spec.summary),
    "",
    "## What Changes",
    "",
    `- ${oneLine(spec.title)}`,
    ...spec.risks.map((r) => `- Supuesto: ${oneLine(r)}`),
    "",
    "## Capabilities",
    "",
    "### New Capabilities",
    ...(opts.newCapability ? [`- \`${capability}\`: ${oneLine(spec.title)}`] : []),
    "",
    "### Modified Capabilities",
    ...(opts.newCapability ? [] : [`- \`${capability}\`: ${oneLine(spec.title)}`]),
    "",
    "## Impact",
    "",
    `Generado por zero para el trabajo ${opts.jobId}.`,
    "",
  ].join("\n");
  const steps = spec.tasks.length ? spec.tasks : [`Implementar ${spec.title}`];
  const sections = specStages(spec).length ? specStages(spec).map((s, i) => ({ title: `Etapa ${i + 1}: ${oneLine(s.title)}`, steps: s.tasks })) : [{ title: "Implementación", steps }];
  const tasks = [
    "# Tasks",
    "",
    ...sections.flatMap((s, n) => [`## ${n + 1}. ${s.title}`, "", ...s.steps.map((t, i) => `- [ ] ${n + 1}.${i + 1} ${oneLine(t)}`), ""]),
  ].join("\n");
  return {
    "proposal.md": proposal,
    [`specs/${capability}/spec.md`]: renderSpecDelta(spec, opts.newCapability),
    "tasks.md": tasks,
  };
}

export async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

/** Whether the repository already has a main spec for this capability. */
export function capabilityExists(repo: string, capability: string): boolean {
  return existsSync(join(repo, "openspec", "specs", slug(capability), "spec.md"));
}

/** How openspec tells requirement names apart (`foldRequirementName`), copied since openspec is only a dev dependency. */
export function foldRequirementName(name: string): string {
  return name.replace(/[ \t]+#+[ \t]*$/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function folderEntries(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * The requirement names a capability already has, in its main spec and in the
 * unarchived deltas of other changes. Whatever cannot be read is left out: this
 * must never fail a job.
 */
export function existingRequirementNames(repo: string, capability: string, ownChange: string): string[] {
  const cap = slug(capability) || "change";
  const openspec = join(repo, "openspec");
  const changes = folderEntries(join(openspec, "changes")).filter((c) => c !== "archive" && c !== ownChange);
  const sources = [join(openspec, "specs", cap, "spec.md"), ...changes.map((c) => join(openspec, "changes", c, "specs", cap, "spec.md"))];
  const names: string[] = [];
  for (const source of sources) {
    for (const line of readOrEmpty(source).split(/\r?\n/)) {
      const name = /^###\s*Requirement:\s*(.+)\s*$/i.exec(line)?.[1];
      if (name) names.push(name);
    }
  }
  return names;
}

/** The spec with every requirement name distinct, from `existing` and from each other. Repeats get the job's id as a suffix. */
export function uniqueRequirementNames(spec: Spec, jobId: string, existing: string[]): Spec {
  const taken = new Set(existing.map(foldRequirementName));
  const requirements = spec.requirements.map((r) => {
    let name = r.name;
    if (taken.has(foldRequirementName(oneLine(name)))) {
      // The closing `#`s go too, or the suffix would turn them into part of the name.
      const base = oneLine(name).replace(/[ \t]+#+[ \t]*$/, "");
      name = `${base} (${jobId})`;
      for (let n = 2; taken.has(foldRequirementName(name)); n++) name = `${base} (${jobId}-${n})`;
    }
    taken.add(foldRequirementName(oneLine(name)));
    return { ...r, name };
  });
  return { ...spec, requirements };
}

/** The owner-facing version of the spec, for approvals and the chat. */
export function plainSpec(spec: Spec): string {
  const lines = [`**${spec.title}**`, "", spec.summary, "", "Qué va a funcionar:"];
  for (const r of spec.requirements) lines.push(`- ${r.name}`);
  if (spec.risks.length) lines.push("", "Supuestos:", ...spec.risks.map((r) => `- ${r}`));
  return lines.join("\n");
}

import { existsSync } from "node:fs";
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
});

export type Spec = z.infer<typeof SpecSchema>;

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
export function renderOpenSpecChange(spec: Spec, opts: { jobId: string; request: string; newCapability: boolean }): Record<string, string> {
  const capability = slug(spec.capability) || "change";
  const proposal = [
    "# Proposal",
    "",
    "## Why",
    "",
    oneLine(spec.summary),
    "",
    `Pedido original: "${oneLine(opts.request)}"`,
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
  const tasks = ["# Tasks", "", "## 1. Implementación", "", ...steps.map((t, i) => `- [ ] 1.${i + 1} ${oneLine(t)}`), ""].join("\n");
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

/** The owner-facing version of the spec, for approvals and the chat. */
export function plainSpec(spec: Spec): string {
  const lines = [`**${spec.title}**`, "", spec.summary, "", "Qué va a funcionar:"];
  for (const r of spec.requirements) lines.push(`- ${r.name}`);
  if (spec.risks.length) lines.push("", "Supuestos:", ...spec.risks.map((r) => `- ${r}`));
  return lines.join("\n");
}

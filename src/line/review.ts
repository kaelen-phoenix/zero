import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { LearningSchema } from "../townhall/types.js";

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const BLOCKING = new Set(["high", "critical"]);
/** Below this confidence a finding is recorded but never rejects a change. */
export const MIN_CONFIDENCE = 8;

const FindingSchema = z.object({
  severity: z.enum(SEVERITIES),
  file: z.string().describe("Path relative to the repository root."),
  line: z.number().int().describe("1-based line number in that file."),
  problem: z.string(),
  fix: z.string(),
  confidence: z.number().int().min(1).max(10).describe(`How sure you are that this is a real defect, from 1 (a guess) to 10 (certain). Only findings with confidence ${MIN_CONFIDENCE} or more can block.`),
});

export const ReviewSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema).describe("Concrete defects. Empty when there are none."),
  learnings: z.array(LearningSchema).describe("Lessons future builds should apply. Empty if nothing new."),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Review = z.infer<typeof ReviewSchema>;

/** A citation is valid when it names an existing file inside the work copy and a line that exists in it. */
export function citationValid(cwd: string, file: string, line: number): boolean {
  const target = resolve(cwd, file.replace(/\\/g, "/"));
  const rel = relative(cwd, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
  if (!existsSync(target) || !statSync(target).isFile()) return false;
  const lines = readFileSync(target, "utf8").split("\n").length;
  return Number.isInteger(line) && line >= 1 && line <= lines;
}

export function checkCitations(cwd: string, findings: Finding[]): { valid: Finding[]; invalid: Finding[] } {
  const valid: Finding[] = [];
  const invalid: Finding[] = [];
  for (const f of findings) (citationValid(cwd, f.file, f.line) ? valid : invalid).push(f);
  return { valid, invalid };
}

/** The factory decides, not the reviewer: only verified high or critical findings the reviewer is sure of reject a change. */
export function blockingFindings(valid: Finding[]): Finding[] {
  return valid.filter((f) => BLOCKING.has(f.severity) && f.confidence >= MIN_CONFIDENCE);
}

/** Verified high or critical findings that do not block because their confidence is below the threshold. */
export function lowConfidence(valid: Finding[]): Finding[] {
  return valid.filter((f) => BLOCKING.has(f.severity) && f.confidence < MIN_CONFIDENCE);
}

/** What build hears about the findings of a reviewer: review, security or a custom agent, by name. */
export function findingsFeedback(findings: Finding[], station: string = "review"): string {
  const who = station === "security" ? "La revisión de seguridad encontró problemas" : station === "review" ? "La revisión encontró defectos" : `El agente ${station} encontró problemas`;
  return `${who} que hay que corregir:\n${findings.map((f) => `- [${f.severity}, confianza ${f.confidence}] ${f.file}:${f.line}: ${f.problem} → ${f.fix}`).join("\n")}`;
}

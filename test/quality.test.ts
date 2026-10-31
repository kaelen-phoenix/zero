import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const path = (p: string) => new URL(`../${p}`, import.meta.url);
const read = (p: string) => readFileSync(path(p), "utf8").replace(/\r\n/g, "\n");

/** From a heading to the next `## ` heading. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === heading);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return rest.slice(0, end === -1 ? undefined : end).join("\n");
}

type Step = { uses?: string; with?: Record<string, unknown>; "continue-on-error"?: unknown };
type Job = { permissions?: Record<string, string> | string; steps?: Step[]; "continue-on-error"?: unknown };

describe("CodeQL workflow", () => {
  const workflow = parse(read(".github/workflows/codeql.yml")) as {
    on: { pull_request?: Record<string, unknown> | null; push?: { branches?: string[] } };
    permissions?: Record<string, string> | string;
    jobs: Record<string, Job>;
  };
  const jobs = Object.values(workflow.jobs);
  const analyze = jobs.find((j) => j.steps?.some((s) => s.uses?.startsWith("github/codeql-action/analyze@")));

  it("runs on every pull request and on pushes to main", () => {
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on.push?.branches).toContain("main");
  });

  it("checks out, initializes CodeQL for JavaScript/TypeScript and analyzes, in that order", () => {
    expect(analyze).toBeDefined();
    const uses = analyze!.steps!.map((s) => s.uses ?? "");
    const at = ["actions/checkout@", "github/codeql-action/init@", "github/codeql-action/analyze@"].map((p) => uses.findIndex((u) => u.startsWith(p)));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const init = analyze!.steps!.find((s) => s.uses!.startsWith("github/codeql-action/init@"))!;
    expect(init.with?.languages).toBe("javascript-typescript");
    for (const step of analyze!.steps!.filter((s) => s.uses?.startsWith("github/codeql-action/"))) {
      expect(Number(/@v(\d+)/.exec(step.uses!)?.[1])).toBeGreaterThanOrEqual(3);
    }
  });

  it("grants write only to security events", () => {
    const declared = { ...(typeof workflow.permissions === "object" ? workflow.permissions : {}), ...(typeof analyze!.permissions === "object" ? analyze!.permissions : {}) };
    expect(workflow.permissions).not.toBe("write-all");
    expect(analyze!.permissions).not.toBe("write-all");
    expect(declared["security-events"]).toBe("write");
    expect(declared.contents).toBe("read");
    for (const [name, value] of Object.entries(declared)) if (name !== "security-events") expect(value, name).not.toBe("write");
    expect(read(".github/workflows/codeql.yml")).not.toContain("write-all");
  });

  it("is an ordinary check: no path filters and no continue-on-error", () => {
    const pr = workflow.on.pull_request ?? {};
    expect(pr).not.toHaveProperty("paths");
    expect(pr).not.toHaveProperty("paths-ignore");
    for (const job of jobs) {
      expect(job["continue-on-error"]).not.toBe(true);
      for (const step of job.steps ?? []) expect(step["continue-on-error"]).not.toBe(true);
    }
  });
});

describe("Dependabot", () => {
  const config = parse(read(".github/dependabot.yml")) as {
    version: number;
    updates: { "package-ecosystem": string; directory: string; schedule: { interval: string } }[];
  };

  it("checks npm and GitHub Actions weekly", () => {
    expect(config.version).toBe(2);
    expect(config.updates).toHaveLength(2);
    expect(new Set(config.updates.map((u) => u["package-ecosystem"]))).toEqual(new Set(["npm", "github-actions"]));
    for (const update of config.updates) {
      expect(update.directory).toBe("/");
      expect(update.schedule.interval).toBe("weekly");
    }
  });
});

describe("no SonarCloud yet", () => {
  it("has no sonar workflow nor sonar-project.properties", () => {
    for (const file of readdirSync(path(".github/workflows/"))) expect(read(`.github/workflows/${file}`), file).not.toMatch(/sonar/i);
    expect(existsSync(path("sonar-project.properties"))).toBe(false);
  });
});

describe("README documents this repository's quality tools", () => {
  it("in English", () => {
    const text = section(read("README.md"), "## zero, your CI and your quality tools");
    for (const fact of ["CodeQL", "Dependabot", "npm", "GitHub Actions", "weekly", "every pull request", "SonarCloud", "account"]) expect(text, fact).toContain(fact);
  });

  it("in Spanish", () => {
    const text = section(read("README.es.md"), "## zero, tu CI y tus herramientas de calidad");
    for (const fact of ["CodeQL", "Dependabot", "npm", "GitHub Actions", "semanal", "cada pull request", "SonarCloud", "cuenta"]) expect(text, fact).toContain(fact);
  });
});

import type { Autonomy, FactoryConfig, Level } from "../config.js";

export type PolicyEvent = "spec-ready" | "before-integrate" | "protected-path" | "budget-exceeded" | "egress-suspicious";
export type PolicyDecision = "continue" | "ask" | "fail";

/**
 * The only place that decides when the owner is consulted. Lower levels ask
 * more; L3 never asks and turns every policy into a hard limit.
 */
const TABLE: Record<Level, Record<PolicyEvent, PolicyDecision>> = {
  L0: { "spec-ready": "ask", "before-integrate": "ask", "protected-path": "ask", "budget-exceeded": "ask", "egress-suspicious": "ask" },
  L1: { "spec-ready": "ask", "before-integrate": "continue", "protected-path": "ask", "budget-exceeded": "ask", "egress-suspicious": "ask" },
  L2: { "spec-ready": "continue", "before-integrate": "continue", "protected-path": "ask", "budget-exceeded": "ask", "egress-suspicious": "ask" },
  L3: { "spec-ready": "continue", "before-integrate": "continue", "protected-path": "fail", "budget-exceeded": "fail", "egress-suspicious": "fail" },
};

export function decide(level: Level, event: PolicyEvent): PolicyDecision {
  return TABLE[level][event];
}

const RANK: Record<Autonomy, number> = { propose: 0, build: 1, auto: 2 };

/** The more restrictive of two autonomies. */
export function stricter(a: Autonomy, b: Autonomy): Autonomy {
  return RANK[a] <= RANK[b] ? a : b;
}

/** How far research-born third-party work may go on its own: `research.autonomy`, or `propose` when research is off. */
export function researchAutonomy(config: Pick<FactoryConfig, "research">): Autonomy {
  return config.research === "off" ? "propose" : config.research.autonomy;
}

/**
 * Dependency and MCP manifests zero recognizes on its own, whatever the agent
 * says: touching one means adding third-party code, a dependency or a server.
 */
const DEPENDENCY_MANIFESTS = [
  /(^|\/)package\.json$/,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  /(^|\/)requirements[^/]*\.txt$/,
  /(^|\/)(pyproject\.toml|Pipfile|Pipfile\.lock|poetry\.lock|uv\.lock|setup\.py|setup\.cfg)$/,
  /(^|\/)(go\.mod|go\.sum)$/,
  /(^|\/)(Cargo\.toml|Cargo\.lock)$/,
  /(^|\/)(Gemfile|Gemfile\.lock)$/,
  /(^|\/)(composer\.json|composer\.lock|pom\.xml|build\.gradle(\.kts)?)$/,
  /(^|\/)\.mcp\.json$/,
  /(^|\/)\.gitmodules$/,
];

/** Whether any of the paths (files or globs, as written) is a dependency or MCP manifest. */
export function touchesManifest(paths: string[]): boolean {
  return paths.some((p) => {
    const path = p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    return DEPENDENCY_MANIFESTS.some((re) => re.test(path));
  });
}

/**
 * Whether a night-shift job may integrate without the owner: `build` always
 * asks; `auto` continues to the normal level policy.
 */
export function decideNightShift(autonomy: Autonomy): PolicyDecision {
  return autonomy === "auto" ? "continue" : "ask";
}

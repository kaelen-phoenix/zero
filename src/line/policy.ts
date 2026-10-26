import type { Level } from "../config.js";

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

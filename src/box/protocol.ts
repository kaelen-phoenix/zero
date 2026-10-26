import type { CustomEngine } from "../config.js";
import type { EngineRequest, EngineResult } from "../engines/types.js";

/** What the host sends to the box agent on stdin. */
export interface BoxAgentRequest {
  engine: string;
  /** Custom engines from the factory definition, so the box resolves names exactly like the host. */
  engines: Record<string, CustomEngine>;
  request: Omit<EngineRequest, "signal" | "cwd">;
}

export const RESULT_MARKER = "ZERO-RESULT ";

export function encodeResult(result: EngineResult): string {
  return `\n${RESULT_MARKER}${JSON.stringify(result)}\n`;
}

/** The engine result printed by the box agent; anything else on stdout is the engine's own noise. */
export function decodeResult(stdout: string): EngineResult | undefined {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(RESULT_MARKER));
  if (!line) return undefined;
  try {
    return JSON.parse(line.slice(RESULT_MARKER.length)) as EngineResult;
  } catch {
    return undefined;
  }
}

import type { Config } from "../config.js";
import { claudeEngine } from "./claude.js";
import { antigravityEngine, codexEngine, customEngine } from "./cli.js";
import type { Engine } from "./types.js";

export type { Access, Engine, EngineRequest, EngineResult } from "./types.js";

const BUILT_IN: Record<string, Engine> = {
  claude: claudeEngine,
  codex: codexEngine,
  antigravity: antigravityEngine,
};

export const BUILT_IN_ENGINES = Object.keys(BUILT_IN);

/** Engines declared in `zero.config.json` take precedence, so a built-in can be overridden. */
export function resolveEngine(name: string, config: Config): Engine {
  const custom = config.engines[name];
  if (custom) return customEngine(name, custom);
  const engine = BUILT_IN[name];
  if (!engine) {
    const known = [...BUILT_IN_ENGINES, ...Object.keys(config.engines)].join(", ");
    throw new Error(`Unknown engine "${name}". Known engines: ${known}`);
  }
  return engine;
}

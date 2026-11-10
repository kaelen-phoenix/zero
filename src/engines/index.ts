import type { FactoryConfig } from "../config.js";
import { claudeEngine } from "./claude.js";
import { antigravityEngine, codexEngine, customEngine, opencodeEngine, unsandboxedCodexEngine } from "./cli.js";
import type { Engine } from "./types.js";

export type { Access, Engine, EngineRequest, EngineResult, QuotaReport, QuotaWindow } from "./types.js";

const BUILT_IN: Record<string, Engine> = {
  claude: claudeEngine,
  codex: codexEngine,
  antigravity: antigravityEngine,
  opencode: opencodeEngine,
};

export const BUILT_IN_ENGINES = Object.keys(BUILT_IN);

/** Engines declared in `zero.factory.yaml` take precedence, so a built-in can be overridden. */
export function resolveEngine(name: string, config: Pick<FactoryConfig, "engines"> & Partial<Pick<FactoryConfig, "codex">>): Engine {
  const custom = config.engines[name];
  if (custom) return customEngine(name, custom);
  if (name === "codex" && config.codex?.sandbox === "off") return unsandboxedCodexEngine;
  const engine = BUILT_IN[name];
  if (!engine) {
    const known = [...BUILT_IN_ENGINES, ...Object.keys(config.engines)].join(", ");
    throw new Error(`Unknown engine "${name}". Known engines: ${known}`);
  }
  return engine;
}

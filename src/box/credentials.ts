import type { FactoryConfig } from "../config.js";
import type { SecretStore } from "../keychain.js";

interface Requirement {
  /** Any one of these is enough. */
  anyOf: string[];
  /** What the owner should do when none is available. */
  hint: string;
}

/** Credentials each built-in engine can use inside the box. `null`: the engine cannot run in the box. */
const BUILT_IN: Record<string, Requirement | null> = {
  claude: {
    anyOf: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
    hint: "Claude necesita un token dentro de la caja: corré `claude setup-token` y guardalo con `zero secret set CLAUDE_CODE_OAUTH_TOKEN`",
  },
  codex: {
    anyOf: ["CODEX_API_KEY", "OPENAI_API_KEY"],
    hint: "Codex necesita una clave dentro de la caja: guardala con `zero secret set OPENAI_API_KEY`",
  },
  antigravity: null,
};

/** The engines the factory's stations use. */
export function stationEngines(config: FactoryConfig): string[] {
  return [...new Set((["spec", "build", "review"] as const).map((s) => config.stations[s].engine ?? config.engine))];
}

export interface EngineCredentials {
  /** Names to pass into the box (values are read from the SecretStore at run time). */
  names: string[];
  problem?: string;
}

export function engineCredentials(engine: string, config: Pick<FactoryConfig, "engines">, secrets: SecretStore): EngineCredentials {
  const custom = config.engines[engine];
  if (custom) {
    const missing = custom.secrets.filter((n) => !secrets.has(n));
    return missing.length
      ? { names: [], problem: `al motor ${engine} le faltan ${missing.join(", ")}: guardalos con \`zero secret set <NOMBRE>\`` }
      : { names: custom.secrets };
  }
  const req = BUILT_IN[engine];
  if (req === null) return { names: [], problem: `el motor ${engine} todavía no puede trabajar dentro de la caja` };
  if (!req) return { names: [] };
  const available = req.anyOf.filter((n) => secrets.has(n));
  return available.length ? { names: available.slice(0, 1) } : { names: [], problem: req.hint };
}

/** Problems that keep the configured engines from working inside the box. */
export function credentialProblems(config: FactoryConfig, secrets: SecretStore): string[] {
  return stationEngines(config).flatMap((e) => engineCredentials(e, config, secrets).problem ?? []);
}

import type { BoxAvailability, FactoryConfig } from "../config.js";
import type { SecretStore } from "../keychain.js";
import type { Store } from "../state/store.js";
import { credentialProblems } from "./credentials.js";
import { imageTag } from "./image.js";
import { exec as realExec, imageExists, installedRuntimes, responds, type Exec, type Runtime } from "./runtime.js";

export interface BoxStatus {
  ready: boolean;
  runtime?: Runtime;
  image: string;
  /** What is missing, in the owner's words. Empty when ready. */
  problems: string[];
  checkedAt: string;
}

const KEY = "box";

export interface InspectDeps {
  exec?: Exec;
  tag?: string;
  now?: Date;
}

/** Probes the machine: is there a runtime, does it respond, is this version's image built? */
export function inspectBox(config: Pick<FactoryConfig, "box">, deps: InspectDeps = {}): BoxStatus {
  const run = deps.exec ?? realExec;
  const image = deps.tag ?? imageTag();
  const checkedAt = (deps.now ?? new Date()).toISOString();
  const runtimes = installedRuntimes(config.box.runtime, run);
  if (!runtimes.length) return { ready: false, image, checkedAt, problems: ["no hay Podman ni Docker instalados: corré `zero box setup`"] };
  const runtime = runtimes.find((rt) => responds(rt, run));
  if (!runtime) return { ready: false, runtime: runtimes[0], image, checkedAt, problems: [`${runtimes[0]} está instalado pero no responde (¿su máquina está apagada?): corré \`zero box setup\``] };
  if (!imageExists(runtime, image, run)) return { ready: false, runtime, image, checkedAt, problems: [`falta construir la imagen de la caja (${image}): corré \`zero box setup\``] };
  return { ready: true, runtime, image, checkedAt, problems: [] };
}

export function saveBoxStatus(store: Store, status: BoxStatus) {
  store.setKv(KEY, JSON.stringify(status));
}

export function readBoxStatus(store: Store): BoxStatus | undefined {
  const raw = store.getKv(KEY);
  return raw ? (JSON.parse(raw) as BoxStatus) : undefined;
}

/** The box as the effective level sees it: the last inspection plus the credentials available now. */
export function boxAvailability(config: FactoryConfig, status: BoxStatus | undefined, secrets: SecretStore): BoxAvailability {
  if (!status) return { ready: false, problems: ["la caja todavía no se revisó: corré `zero box status`"] };
  const problems = [...status.problems, ...(status.ready ? credentialProblems(config, secrets) : [])];
  return { ready: status.ready && !problems.length, problems };
}

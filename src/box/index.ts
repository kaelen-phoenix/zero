import { spawnSync } from "node:child_process";
import type { FactoryConfig } from "../config.js";
import { inContainer } from "../home.js";
import { buildImage, imageTag } from "./image.js";
import { exec, imageExists, installedRuntimes, responds } from "./runtime.js";
import { probe, runBoxSetup, type SetupIO, type SetupOutcome } from "./setup.js";

export { inspectBox, readBoxStatus, saveBoxStatus, boxAvailability, type BoxStatus } from "./status.js";

/**
 * Installers record the new PATH in the registry; without reading it back this
 * process would not find a freshly installed `podman` until a new terminal.
 */
function refreshWindowsPath(): void {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (r.status !== 0 || !r.stdout.trim()) return;
  const entries = new Map<string, string>();
  for (const entry of [...(process.env.PATH ?? "").split(";"), ...r.stdout.trim().split(";")]) {
    if (entry && !entries.has(entry.toLowerCase())) entries.set(entry.toLowerCase(), entry);
  }
  process.env.PATH = [...entries.values()].join(";");
}

/** The real machine: runtimes, VMs and image builds, with the owner answering on the terminal. */
export function machineSetupIO(config: Pick<FactoryConfig, "box">, confirm: SetupIO["confirm"], say: SetupIO["say"]): SetupIO {
  const tag = imageTag();
  return {
    confirm,
    say,
    run: (bin, args) => {
      const status = spawnSync(bin, args, { stdio: "inherit", windowsHide: false }).status ?? 1;
      if (process.platform === "win32") refreshWindowsPath();
      return status;
    },
    buildImage: (runtime, onOutput) => buildImage(runtime, tag, onOutput),
    probe: () => {
      const runtimes = installedRuntimes(config.box.runtime, exec);
      const responding = runtimes.find((rt) => responds(rt, exec));
      return probe(process.platform, exec, runtimes, responding, responding ? imageExists(responding, tag, exec) : false);
    },
  };
}

export async function setupBox(config: Pick<FactoryConfig, "box">, io: Pick<SetupIO, "confirm" | "say">, yes: boolean): Promise<SetupOutcome> {
  // Inside the official image the runtime is the host's: installing one here would not help.
  if (inContainer() && !installedRuntimes(config.box.runtime, exec).some((rt) => responds(rt, exec))) {
    io.say("Este contenedor no llega a Docker. Para usar la caja, levantalo con docker/compose.box.yaml, que conecta el socket de tu máquina; o corré `zero setup` y elegí trabajar sin caja.");
    return "manual";
  }
  return runBoxSetup(machineSetupIO(config, io.confirm, io.say), { yes });
}

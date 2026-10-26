import { spawnSync } from "node:child_process";
import type { FactoryConfig } from "../config.js";
import { buildImage, imageTag } from "./image.js";
import { exec, imageExists, installedRuntimes, responds } from "./runtime.js";
import { probe, runBoxSetup, type SetupIO, type SetupOutcome } from "./setup.js";

export { inspectBox, readBoxStatus, saveBoxStatus, boxAvailability, type BoxStatus } from "./status.js";

/** The real machine: runtimes, VMs and image builds, with the owner answering on the terminal. */
export function machineSetupIO(config: Pick<FactoryConfig, "box">, confirm: SetupIO["confirm"], say: SetupIO["say"]): SetupIO {
  const tag = imageTag();
  return {
    confirm,
    say,
    run: (bin, args) => spawnSync(bin, args, { stdio: "inherit", windowsHide: false }).status ?? 1,
    buildImage: (runtime, onOutput) => buildImage(runtime, tag, onOutput),
    probe: () => {
      const runtimes = installedRuntimes(config.box.runtime, exec);
      const responding = runtimes.find((rt) => responds(rt, exec));
      return probe(process.platform, exec, runtimes, responding, responding ? imageExists(responding, tag, exec) : false);
    },
  };
}

export async function setupBox(config: Pick<FactoryConfig, "box">, io: Pick<SetupIO, "confirm" | "say">, yes: boolean): Promise<SetupOutcome> {
  return runBoxSetup(machineSetupIO(config, io.confirm, io.say), { yes });
}

import type { Exec, Runtime } from "./runtime.js";

export interface SetupStep {
  id: "wsl" | "install-podman" | "machine-init" | "machine-start" | "image" | "manual";
  title: string;
  /** Command to run; absent for steps the owner must do by hand. */
  command?: { bin: string; args: string[] };
  /** Installs software or changes the system: always needs the owner's consent. */
  installs: boolean;
  admin: boolean;
  /** The machine must restart before continuing; the plan stops after this step. */
  reboot: boolean;
}

export interface Probes {
  platform: NodeJS.Platform;
  runtimes: Runtime[];
  /** Runtime that answers `info`, if any. */
  responding?: Runtime;
  wsl?: boolean;
  /** Windows booted with its hypervisor running, which WSL2 needs. */
  hypervisor?: boolean;
  brew?: boolean;
  /** Podman machines known (Windows/macOS). */
  podmanMachines?: number;
  imageBuilt: boolean;
}

export function probe(platform: NodeJS.Platform, run: Exec, runtimes: Runtime[], responding: Runtime | undefined, imageBuilt: boolean): Probes {
  const ok = (bin: string, args: string[]) => run(bin, args, { timeoutMs: 30_000 }).status === 0;
  const machines = runtimes.includes("podman") ? run("podman", ["machine", "list", "--format", "json"], { timeoutMs: 30_000 }) : undefined;
  let podmanMachines: number | undefined;
  try {
    podmanMachines = machines?.status === 0 ? (JSON.parse(machines.stdout || "[]") as unknown[]).length : undefined;
  } catch {
    podmanMachines = undefined;
  }
  return {
    platform,
    runtimes,
    responding,
    // Without a distribution `--status` may fail even when WSL is installed; `--version` only exists once it is.
    wsl: platform === "win32" ? ok("wsl", ["--status"]) || ok("wsl", ["--version"]) : undefined,
    hypervisor: platform === "win32"
      ? run("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).HypervisorPresent"], { timeoutMs: 30_000 }).stdout.trim() === "True"
      : undefined,
    brew: platform === "darwin" ? ok("brew", ["--version"]) : undefined,
    podmanMachines,
    imageBuilt,
  };
}

const step = (s: Omit<SetupStep, "installs" | "admin" | "reboot"> & Partial<SetupStep>): SetupStep => ({ installs: false, admin: false, reboot: false, ...s });

/** What is left to make the box ready on this machine, in order. Empty when the box is ready. */
export function planBoxSetup(p: Probes): SetupStep[] {
  const steps: SetupStep[] = [];
  const needsVm = p.platform === "win32" || p.platform === "darwin";

  // Old machines may not boot with the hypervisor on; installing more would not help.
  if (p.platform === "win32" && p.wsl && p.hypervisor === false && !p.responding) {
    steps.push(step({
      id: "manual",
      title: "WSL está instalado, pero Windows arrancó sin su hipervisor, y sin él no hay contenedores. Si todavía no reiniciaste, reiniciá y volvé a correr `zero box setup`. Si ya reiniciaste, esta PC no puede usar la caja: la fábrica sigue en L2, con copias locales.",
    }));
    return steps;
  }

  if (!p.runtimes.length) {
    if (p.platform === "win32") {
      if (!p.wsl) {
        steps.push(step({
          id: "wsl",
          title: "Habilitar WSL2 (el subsistema de Linux de Windows), necesario para los contenedores. Después hay que reiniciar el equipo",
          command: { bin: "powershell", args: ["-NoProfile", "-Command", "Start-Process wsl -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait"] },
          installs: true, admin: true, reboot: true,
        }));
        return steps;
      }
      // The Windows installer is machine-wide, so Windows asks for administrator permission.
      steps.push(step({ id: "install-podman", title: "Instalar Podman (contenedores, libre y gratuito) con winget.", command: { bin: "winget", args: ["install", "-e", "--id", "RedHat.Podman", "--accept-source-agreements", "--accept-package-agreements"] }, installs: true, admin: true }));
    } else if (p.platform === "darwin") {
      if (!p.brew) {
        steps.push(step({ id: "manual", title: "Instalá Podman desde https://podman.io (o Homebrew desde https://brew.sh) y volvé a correr `zero box setup`.", installs: true }));
        return steps;
      }
      steps.push(step({ id: "install-podman", title: "Instalar Podman con Homebrew.", command: { bin: "brew", args: ["install", "podman"] }, installs: true }));
    } else {
      steps.push(step({ id: "manual", title: "Instalá Podman con el gestor de paquetes de tu distribución (por ejemplo `sudo apt install podman` o `sudo dnf install podman`) y volvé a correr `zero box setup`.", installs: true, admin: true }));
      return steps;
    }
  }

  const podman = p.runtimes.includes("podman") || !p.runtimes.length;
  if (!p.responding && needsVm && podman) {
    if (!p.podmanMachines) steps.push(step({ id: "machine-init", title: "Crear la máquina virtual de Podman.", command: { bin: "podman", args: ["machine", "init"] }, installs: true }));
    steps.push(step({ id: "machine-start", title: "Encender la máquina virtual de Podman.", command: { bin: "podman", args: ["machine", "start"] } }));
  } else if (!p.responding && p.runtimes.length) {
    steps.push(step({ id: "manual", title: `${p.runtimes[0]} está instalado pero no responde. Inicialo (por ejemplo abriendo Docker Desktop o con \`sudo systemctl start docker\`) y volvé a correr \`zero box setup\`.` }));
    return steps;
  }

  if (!p.imageBuilt) steps.push(step({ id: "image", title: "Construir la imagen de la caja (la primera vez tarda varios minutos)." }));
  return steps;
}

export interface SetupIO {
  /** Asks the owner; resolves false when there is no one to ask. */
  confirm(question: string): Promise<boolean>;
  say(text: string): void;
  /** Runs a step's command with its output visible to the owner. */
  run(bin: string, args: string[]): number;
  buildImage(runtime: Runtime, onOutput: (chunk: string) => void): Promise<void>;
  probe(): Probes;
}

export type SetupOutcome = "ready" | "needs-consent" | "reboot" | "manual" | "failed";

/**
 * Walks the plan one step at a time, re-probing after each, and stops at
 * anything that needs the owner: consent, a reboot or a manual action.
 */
export async function runBoxSetup(io: SetupIO, opts: { yes: boolean }): Promise<SetupOutcome> {
  let done: SetupStep["id"] | undefined;
  for (let round = 0; round < 8; round++) {
    const probes = io.probe();
    const [next, ...rest] = planBoxSetup(probes);
    if (!next) return "ready";
    if (next.id === "manual") {
      io.say(next.title);
      return "manual";
    }
    // A step that just succeeded but is still pending: running it again would not help.
    if (next.id === done) {
      io.say(`El paso "${next.title}" terminó bien, pero todavía no se ve su efecto. Abrí una terminal nueva y volvé a correr \`zero box setup\`.`);
      return "manual";
    }
    const sensitive = next.installs || next.admin || next.reboot;
    if (sensitive && !opts.yes) {
      const ok = await io.confirm(`${next.title}${next.admin ? " (requiere administrador)" : ""}. ¿Continuar?`);
      if (!ok) {
        io.say(`Plan pendiente:\n${[next, ...rest].map((s, i) => `${i + 1}. ${s.title}`).join("\n")}`);
        return "needs-consent";
      }
    }
    io.say(`→ ${next.title}`);
    if (next.id === "image") {
      const runtime = probes.responding ?? probes.runtimes[0];
      if (!runtime) return "failed";
      try {
        await io.buildImage(runtime, (chunk) => io.say(chunk.trimEnd()));
      } catch (err) {
        io.say(`No se pudo construir la imagen: ${err instanceof Error ? err.message : String(err)}`);
        return "failed";
      }
      done = next.id;
      continue;
    }
    const code = io.run(next.command!.bin, next.command!.args);
    if (code !== 0) {
      io.say(`El paso terminó con código ${code}.`);
      return "failed";
    }
    done = next.id;
    if (next.reboot) {
      io.say("\nListo. Windows no lo avisa, pero hay que REINICIAR EL EQUIPO para que funcione.\nDespués del reinicio, volvé a correr `zero box setup` para continuar.");
      return "reboot";
    }
  }
  return "failed";
}

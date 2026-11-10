import { spawnSync, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Processes that outlive what started them. A command killed by its time limit, a stop or a shutdown leaves
 * what it had started running (on Windows `kill` ends only the shell, not npm, the test runner or a dev
 * server), and an agent may leave a server of its own behind. They keep using the machine and, on Windows,
 * keep the work copy of the job locked, so it cannot be removed.
 */

const windowsTools = () => join(process.env.SystemRoot ?? "C:\\Windows", "System32");

/** Kills a process and everything it started. Never throws. */
export function killTree(child: Pick<ChildProcess, "pid" | "kill">): void {
  try {
    if (child.pid && process.platform === "win32") {
      spawnSync(join(windowsTools(), "taskkill.exe"), ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 15_000, stdio: "ignore" });
    } else if (child.pid) {
      // The command runs as the leader of a process group of its own (`detached`), so the group is its whole tree.
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // No group of its own, or already gone: the process alone.
      }
    }
    child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
}

/** Whether a command line or a path names something inside `folder`: the folder itself or a path under it, never a sibling that only starts the same. */
export function mentionsFolder(text: string, folder: string, windows = process.platform === "win32"): boolean {
  const norm = (s: string) => (windows ? s.replaceAll("/", "\\").toLowerCase() : s);
  const hay = norm(text);
  const needle = norm(folder).replace(/[\\/]+$/, "");
  if (!needle) return false;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    const next = hay[at + needle.length];
    if (next === undefined || !/[\w.-]/.test(next)) return true;
  }
  return false;
}

export interface RunningProcess {
  pid: number;
  parent: number;
  /** Command line, executable and, where the system tells, the working directory. */
  text: string[];
}

interface WindowsRow {
  p: number;
  pp: number;
  c?: string | null;
  e?: string | null;
}

function windowsProcesses(): RunningProcess[] {
  // The listing comes back as JSON and is filtered here: nothing of the folder name reaches the command.
  const script = "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ p = $_.ProcessId; pp = $_.ParentProcessId; c = $_.CommandLine; e = $_.ExecutablePath } } | ConvertTo-Json -Compress";
  const r = spawnSync(join(windowsTools(), "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return [];
  const rows = JSON.parse(r.stdout) as WindowsRow[] | WindowsRow;
  return (Array.isArray(rows) ? rows : [rows]).map((x) => ({ pid: x.p, parent: x.pp, text: [x.c ?? "", x.e ?? ""] }));
}

function linuxProcesses(): RunningProcess[] {
  const procs: RunningProcess[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const cmd = readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " ");
      let cwd = "";
      try {
        cwd = readlinkSync(`/proc/${name}/cwd`);
      } catch {
        // A process of another user.
      }
      procs.push({ pid: Number(name), parent, text: [cmd, cwd] });
    } catch {
      // Gone while reading.
    }
  }
  return procs;
}

function psProcesses(): RunningProcess[] {
  const r = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return [];
  return r.stdout.split("\n").flatMap((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), text: [m[3]!] }] : [];
  });
}

export type ProcessLister = () => RunningProcess[];
const systemProcesses: ProcessLister = () => (process.platform === "win32" ? windowsProcesses() : process.platform === "linux" ? linuxProcesses() : psProcesses());

/** The processes running from a folder, leaving out this process and its ancestors. Pure over the listing. */
export function leftoversIn(folder: string, procs: RunningProcess[], self = process.pid, windows = process.platform === "win32"): number[] {
  const parent = new Map(procs.map((p) => [p.pid, p.parent]));
  const mine = new Set<number>();
  for (let pid: number | undefined = self; pid !== undefined && !mine.has(pid); pid = parent.get(pid)) mine.add(pid);
  // Pids up to 4 are the system itself on Windows and init elsewhere.
  return procs.filter((p) => !mine.has(p.pid) && p.pid > 4 && p.text.some((t) => mentionsFolder(t, folder, windows))).map((p) => p.pid);
}

/**
 * Kills what is still running from a folder (the work copy of a job): processes whose command line, executable or
 * working directory is in it. Returns how many it killed; never throws, and a listing that fails counts as none.
 */
export function killLeftovers(folder: string, list: ProcessLister = systemProcesses, kill: (pid: number) => void = (pid) => killTree({ pid, kill: (signal) => process.kill(pid, signal as NodeJS.Signals) })): number {
  try {
    const path = resolve(folder);
    // Never a drive or a top-level folder: only something as deep as a work copy.
    if (path.split(sep).filter(Boolean).length < 3) return 0;
    const pids = leftoversIn(path, list());
    for (const pid of pids) kill(pid);
    return pids.length;
  } catch {
    return 0;
  }
}

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
  d?: string | null;
}

/**
 * Windows tells a process's command line and executable, but not its working directory, and that is what locks a
 * folder: a shell an agent left waiting in a loop names the folder nowhere else. It is read from the process
 * itself (its PEB, 64-bit only); a process that cannot be opened simply has none.
 */
const WINDOWS_CWD = `
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ZeroCwd {
  [StructLayout(LayoutKind.Sequential)]
  struct PBI { public IntPtr Reserved1; public IntPtr Peb; public IntPtr R2a; public IntPtr R2b; public IntPtr Pid; public IntPtr R3; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI pbi, int len, out int ret);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Of(int pid) {
    if (IntPtr.Size != 8) return null;
    IntPtr h = OpenProcess(0x0410, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      PBI pbi = new PBI(); int ret; IntPtr read;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;
      byte[] p = new byte[8];
      if (!ReadProcessMemory(h, IntPtr.Add(pbi.Peb, 0x20), p, 8, out read)) return null;
      IntPtr pp = (IntPtr)BitConverter.ToInt64(p, 0);
      byte[] us = new byte[16];
      if (!ReadProcessMemory(h, IntPtr.Add(pp, 0x38), us, 16, out read)) return null;
      int len = BitConverter.ToUInt16(us, 0);
      if (len <= 0 || len > 65534) return null;
      byte[] s = new byte[len];
      if (!ReadProcessMemory(h, (IntPtr)BitConverter.ToInt64(us, 8), s, len, out read)) return null;
      return Encoding.Unicode.GetString(s);
    } catch { return null; } finally { CloseHandle(h); }
  }
}`;

function windowsProcesses(): RunningProcess[] {
  // The listing comes back as JSON and is filtered here: nothing of the folder name reaches the command.
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$cwd = $false",
    `try { Add-Type -TypeDefinition @'${WINDOWS_CWD}\n'@ -ErrorAction Stop; $cwd = $true } catch { }`,
    "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ p = $_.ProcessId; pp = $_.ParentProcessId; c = $_.CommandLine; e = $_.ExecutablePath; d = $(if ($cwd) { [ZeroCwd]::Of([int]$_.ProcessId) }) } } | ConvertTo-Json -Compress",
  ].join("\n");
  // Encoded, so no quoting of the script depends on how the command line is parsed.
  const r = spawnSync(join(windowsTools(), "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return [];
  const rows = JSON.parse(r.stdout) as WindowsRow[] | WindowsRow;
  return (Array.isArray(rows) ? rows : [rows]).map((x) => ({ pid: x.p, parent: x.pp, text: [x.c ?? "", x.e ?? "", x.d ?? ""] }));
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
export const systemProcesses: ProcessLister = () => (process.platform === "win32" ? windowsProcesses() : process.platform === "linux" ? linuxProcesses() : psProcesses());

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

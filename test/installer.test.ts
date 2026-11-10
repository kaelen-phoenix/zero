import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const shPath = join(root, "site", "install.sh");
const sh = readFileSync(shPath, "utf8");
const ps1 = readFileSync(join(root, "site", "install.ps1"), "utf8");
const scripts = [["install.sh", sh], ["install.ps1", ps1]] as const;
const REPO = "https://github.com/kaelen-phoenix/zero";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Whether sh can be started here; the behaviour tests skip without it. */
const shWorks = spawnSync("sh", ["-c", "exit 0"]).status === 0;

/** A prefix that starts sh with no reachable /dev/tty, or undefined when that cannot be arranged here. */
function noTerminal(): string[] | undefined {
  if (!shWorks) return undefined;
  for (const prefix of [["sh"], ["setsid", "sh"]]) {
    const probe = spawnSync(prefix[0]!, [...prefix.slice(1), "-c", ": </dev/tty"], { stdio: ["ignore", "pipe", "pipe"] });
    if (!probe.error && probe.status !== 0 && probe.status !== null) return prefix;
  }
  return undefined;
}

/** A temporary folder with fake node, npm and git first in PATH, and a home for the script. */
function fakeTools(nodeVersion: string): { env: NodeJS.ProcessEnv; base: string } {
  const base = mkdtempSync(join(tmpdir(), "zero-installer-"));
  temps.push(base);
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "node"), `#!/bin/sh\necho ${nodeVersion}\n`, { mode: 0o755 });
  for (const tool of ["npm", "git"]) writeFileSync(join(bin, tool), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  mkdirSync(join(base, "home"));
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, HOME: join(base, "home") };
  return { env, base };
}

function run(prefix: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(prefix[0]!, [...prefix.slice(1), shPath], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 20_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("installer scripts", () => {
  it("ships both scripts in the site, cloning, building and launching setup", () => {
    const site = readdirSync(join(root, "site"));
    expect(site).toContain("install.sh");
    expect(site).toContain("install.ps1");
    for (const [name, text] of scripts) {
      for (const piece of [REPO, "npm ci", "npm run build", "setup"]) expect(text, `${name}: ${piece}`).toContain(piece);
    }
  });

  it("writes install.sh in POSIX sh", () => {
    expect(sh.split("\n")[0]).toBe("#!/bin/sh");
    for (const bashism of ["[[", "function ", "local -a"]) expect(sh).not.toContain(bashism);
  });

  it("keeps install.ps1 in ASCII, since irm may decode it with another charset", () => {
    expect(ps1).toMatch(/^[\x00-\x7f]*$/);
  });

  it("checks Node 22, npm and git and calls no package manager for them", () => {
    for (const [name, text] of scripts) {
      for (const piece of ["Node 22", "npm", "git"]) expect(text, `${name}: ${piece}`).toContain(piece);
      for (const manager of ["apt", "brew install", "winget", "choco", "dnf", "yum", "pacman"]) expect(text, `${name}: ${manager}`).not.toContain(manager);
    }
  });

  it("asks with a default of no and goes on only on s/S or y/Y", () => {
    for (const [, text] of scripts) expect(text).toContain("[s/N]");
    expect(sh).toMatch(/read -r answer <\/dev\/tty/);
    expect(sh).toMatch(/\[sSyY\]\*\) ;;\n\s*\*\) say "No se cambió nada."; exit 1 ;;/);
    expect(ps1).toMatch(/\$answer -notmatch '\^\[sSyY\]'/);
  });

  it("asks for no administrator rights", () => {
    for (const [name, text] of scripts) {
      for (const word of ["sudo", "runas", "-Verb RunAs", "npm install -g", "npm i -g", "npm link"]) expect(text, `${name}: ${word}`).not.toMatch(new RegExp(word.replace(/[-]/g, "\\-"), "i"));
    }
    expect(sh).toContain('DIR="${ZERO_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/zero}"');
    expect(sh).toContain('BIN_DIR="$HOME/.local/bin"');
    expect(ps1).toContain("Join-Path $env:LOCALAPPDATA 'zero'");
    expect(ps1).toContain("$env:ZERO_INSTALL_DIR");
    expect(ps1).toContain("Join-Path $binDir 'zero.cmd'");
  });

  it("changes only the user PATH on Windows", () => {
    const changes = ps1.split("\n").filter((l) => /SetEnvironmentVariable/.test(l));
    expect(changes.length).toBeGreaterThan(0);
    for (const line of changes) expect(line).toMatch(/\[Environment\]::SetEnvironmentVariable\('Path', \$\w+, 'User'\)/);
    expect(ps1).not.toMatch(/Machine/i);
    expect(ps1).not.toMatch(/\$env:Path\s*[+]?=/i);
  });

  it("edits no shell rc file and only prints the PATH line", () => {
    for (const rc of [".bashrc", ".zshrc", ".profile"]) expect(sh).not.toContain(rc);
    expect(sh).toContain('say "  export PATH=\\"\\$HOME/.local/bin:\\$PATH\\""');
  });

  it("handles no secrets", () => {
    for (const [name, text] of scripts) {
      for (const word of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "Read-Host -AsSecureString", "read -s"]) expect(text, `${name}: ${word}`).not.toContain(word);
    }
  });

  it("launches setup on the terminal by the built cli's absolute path", () => {
    expect(sh).toMatch(/node "\$DIR\/dist\/cli\.js" setup <\/dev\/tty\s*$/);
    expect(ps1).toContain("& node (Join-Path $dir 'dist\\cli.js') setup");
  });

  it("updates only an existing clone of zero, after checking its remote", () => {
    for (const [name, text] of scripts) {
      expect(text, name).toContain("pull --ff-only");
      expect(text, name).toContain("remote get-url origin");
    }
  });
});

describe("install.sh behaviour", () => {
  it.skipIf(!shWorks)("refuses an old Node and touches nothing", () => {
    const { env, base } = fakeTools("v20.11.0");
    const target = join(base, "target");
    mkdirSync(target);
    const result = run(["sh"], { ...env, ZERO_INSTALL_DIR: target });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Node 22");
    expect(readdirSync(target)).toEqual([]);
  });

  it.skipIf(!shWorks)("refuses a foreign folder and leaves it as it was", () => {
    const { env, base } = fakeTools("v22.3.0");
    const target = join(base, "target");
    mkdirSync(target);
    writeFileSync(join(target, "notes.txt"), "mine");
    const result = run(["sh"], { ...env, ZERO_INSTALL_DIR: target });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("no es una copia");
    expect(readdirSync(target)).toEqual(["notes.txt"]);
    expect(readFileSync(join(target, "notes.txt"), "utf8")).toBe("mine");
  });

  const prefix = noTerminal();
  it.skipIf(!prefix)("needs a terminal and creates nothing without one", () => {
    const { env, base } = fakeTools("v22.3.0");
    const target = join(base, "target");
    const result = run(prefix!, { ...env, ZERO_INSTALL_DIR: target });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("necesita una terminal");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(base, "home", ".local"))).toBe(false);
  });
});

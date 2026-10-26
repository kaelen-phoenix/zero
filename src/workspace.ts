import { git, sh } from "./shell.js";

/** The git working copy a task is executed in. */
export interface Workspace {
  cwd: string;
  checkoutBranch(name: string, base: string): void;
  hasChanges(): boolean;
  commitAll(message: string): void;
  /** Drop uncommitted changes, including new files (ignored files such as node_modules are kept). */
  discardChanges(): void;
  push(branch: string): void;
  /** Run the verify commands; returns null when all pass, else a failure report. */
  verify(commands: string[]): string | null;
}

const MAX_REPORT = 8_000;

export function createWorkspace(cwd: string): Workspace {
  return {
    cwd,
    checkoutBranch(name, base) {
      git(["fetch", "origin", base], cwd);
      git(["checkout", "-B", name, `origin/${base}`], cwd);
    },
    hasChanges() {
      return git(["status", "--porcelain"], cwd).length > 0;
    },
    commitAll(message) {
      git(["add", "-A"], cwd);
      git(["commit", "-m", message], cwd);
    },
    discardChanges() {
      git(["reset", "--hard", "HEAD"], cwd);
      git(["clean", "-fd"], cwd);
    },
    push(branch) {
      git(["push", "--force-with-lease", "origin", branch], cwd);
    },
    verify(commands) {
      for (const command of commands) {
        const { code, output } = sh(command, cwd);
        if (code !== 0) return `\`${command}\` exited with ${code}:\n${output.slice(-MAX_REPORT)}`;
      }
      return null;
    },
  };
}

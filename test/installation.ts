import { join } from "node:path";
import type { FactoryContext } from "../src/app.js";
import { selfUpdateGit, type SelfUpdateDeps } from "../src/self-update.js";
import { gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

/** zero's install folder at the first commit of a bare remote, with real git and fake npm and node. */
export function installation() {
  const bare = tempDir("zero-bare-");
  gitIn(bare, "init", "-q", "--bare", "-b", "main");
  const source = gitRepo({ "package.json": '{"version":"1.0.0"}\n' });
  gitIn(source, "remote", "add", "origin", bare);
  gitIn(source, "push", "-q", "-u", "origin", "main");
  const install = join(tempDir("zero-install-"), "zero");
  gitIn(source, "clone", "-q", bare, install);
  const clock = { at: new Date("2026-11-11T10:00:00Z") };
  const calls: { tool: string; args: string[] }[] = [];
  const fail: { remote?: boolean; npm?: string } = {};
  const deps: SelfUpdateDeps = {
    install,
    git: async (args, opts) => {
      calls.push({ tool: "git", args });
      if (fail.remote && (args[0] === "fetch" || args[0] === "ls-remote")) throw new Error("sin red");
      return selfUpdateGit(args, opts);
    },
    npm: async (args) => {
      calls.push({ tool: "npm", args });
      if (fail.npm) throw new Error(fail.npm);
      return "";
    },
    node: async (args) => {
      calls.push({ tool: "node", args });
      return "";
    },
    now: () => clock.at,
  };
  const commit = (name: string) => {
    writeTree(source, { [name]: `${name}\n` });
    gitIn(source, "add", "-A");
    gitIn(source, "commit", "-q", "-m", name);
    return gitIn(source, "rev-parse", "HEAD");
  };
  return {
    install,
    source,
    clock,
    calls,
    fail,
    deps,
    head: () => gitIn(install, "rev-parse", "HEAD"),
    /** A commit of the remote's branch. */
    merged: (name: string) => {
      const c = commit(name);
      gitIn(source, "push", "-q", "origin", "main");
      return c;
    },
    /** A commit the remote has only on another branch. */
    elsewhere: (name: string) => {
      gitIn(source, "checkout", "-q", "-b", name);
      const c = commit(name);
      gitIn(source, "push", "-q", "origin", name);
      gitIn(source, "checkout", "-q", "main");
      return c;
    },
    release: (version: string, at: string) => gitIn(source, "push", "-q", "origin", `${at}:refs/tags/v${version}`),
    factory: (selfUpdate?: Record<string, unknown>) =>
      testFactory({ isolation: "worktree", ...(selfUpdate && { selfUpdate }), lines: [{ name: "zero", repo: install, verify: ["npm test"] }] }, () => clock.at),
    later: (ms: number) => (clock.at = new Date(clock.at.getTime() + ms)),
    fetches: () => calls.filter((c) => c.tool === "git" && c.args[0] === "fetch" && c.args[1] === "origin").length,
    built: () => calls.filter((c) => c.tool !== "git").length,
  };
}

export const configure = (ctx: FactoryContext, over: Partial<FactoryContext["config"]["selfUpdate"]>) => {
  ctx.config = { ...ctx.config, selfUpdate: { ...ctx.config.selfUpdate, ...over } };
};

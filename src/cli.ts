#!/usr/bin/env node
import { createAgentRunner } from "./agent.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { runTask } from "./pipeline.js";
import { createGitHubTracker } from "./tracker.js";
import { createWorkspace } from "./workspace.js";

const USAGE = `zero — Kaelen autonomous agent network

Usage:
  zero tick            Pick the oldest issue labelled ready and run it
  zero run <issue>     Run a specific issue

Environment:
  ANTHROPIC_API_KEY    Claude credentials
  GH_TOKEN             GitHub token (issues, PRs, push)
  GITHUB_REPOSITORY    owner/repo
  ZERO_WORKDIR         Working copy (default: cwd)`;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

async function main(argv: string[]): Promise<number> {
  const [command, arg] = argv;
  if (command !== "tick" && command !== "run") {
    console.log(USAGE);
    return command ? 2 : 0;
  }

  const cwd = process.env.ZERO_WORKDIR ?? process.cwd();
  const config = await loadConfig(cwd);
  const tracker = createGitHubTracker(env("GH_TOKEN"), env("GITHUB_REPOSITORY"));
  const deps = { config, tracker, workspace: createWorkspace(cwd), runAgent: createAgentRunner(config) };

  const task = command === "run" ? await tracker.get(Number(arg)) : await tracker.nextReady(config.labels.ready);
  if (!task) {
    log.info("no ready tasks");
    return 0;
  }
  const outcome = await runTask(task, deps);
  log.info("outcome", { task: task.number, ...outcome });
  return outcome.status === "review" ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    log.error("fatal", { error: err instanceof Error ? err.stack : String(err) });
    process.exit(1);
  },
);

#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { createAgentRunner } from "./agent.js";
import { loadConfig, type Config } from "./config.js";
import { log } from "./log.js";
import { runTask } from "./pipeline.js";
import { createTownhall, resilient, silentTownhall, type Townhall } from "./townhall/index.js";
import { renderBriefing } from "./townhall/briefing.js";
import { createGitHubStore, createLocalStore } from "./townhall/store.js";
import { createGitHubTracker } from "./tracker.js";
import { createWorkspace } from "./workspace.js";

const USAGE = `zero — Kaelen autonomous agent network

Usage:
  zero tick            Pick the oldest issue labelled ready and run it
  zero run <issue>     Run a specific issue
  zero briefing        Publish the townhall briefing for the control room

Environment:
  GH_TOKEN             GitHub token (issues, PRs, push, townhall)
  GITHUB_REPOSITORY    owner/repo
  ZERO_WORKDIR         Working copy (default: cwd)
  + the API key of each engine in use (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...)`;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function openTownhall(config: Config): Townhall {
  const { store, branch, localDir } = config.townhall;
  if (store === "off") return silentTownhall;
  const backend =
    store === "github"
      ? createGitHubStore(env("GH_TOKEN"), env("GITHUB_REPOSITORY"), branch)
      : createLocalStore(localDir ?? join(homedir(), ".zero", "townhall", env("GITHUB_REPOSITORY").replace("/", "_")));
  return resilient(createTownhall(backend));
}

async function briefing(config: Config): Promise<number> {
  const to = new Date();
  const from = new Date(to.getTime() - config.townhall.briefing.days * 86_400_000);
  const posts = await openTownhall(config).recall({ since: from, limit: Number.MAX_SAFE_INTEGER });
  const report = renderBriefing(posts, from, to);
  console.log(`# ${report.title}\n\n${report.body}`);
  if (config.townhall.briefing.sink === "issue") {
    const tracker = createGitHubTracker(env("GH_TOKEN"), env("GITHUB_REPOSITORY"));
    const url = await tracker.createIssue({ title: report.title, body: report.body, labels: [config.townhall.briefing.label] });
    log.info("briefing published", { url, ...report.stats });
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, arg] = argv;
  if (command !== "tick" && command !== "run" && command !== "briefing") {
    console.log(USAGE);
    return command ? 2 : 0;
  }

  const cwd = process.env.ZERO_WORKDIR ?? process.cwd();
  const config = await loadConfig(cwd);
  if (command === "briefing") return briefing(config);

  const tracker = createGitHubTracker(env("GH_TOKEN"), env("GITHUB_REPOSITORY"));
  const deps = {
    config,
    tracker,
    workspace: createWorkspace(cwd),
    runAgent: createAgentRunner(config),
    townhall: openTownhall(config),
  };

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

import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { agentName } from "../src/agent.js";
import { runDaemon } from "../src/daemon.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;

/** The removed proof of concept had its own idle pass: the others keep their order without it. */
describe("the daemon's idle run", () => {
  it("runs scout, research and the packages' stations, and nothing else", async () => {
    const dir = tempDir("zero-pkg-");
    writeTree(dir, {
      "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", stations: [{ name: "nota", module: "nota.mjs", instructions: "nota.md" }] }),
      "nota.mjs": `export async function pass(ctx) { await ctx.runAgent({ prompt: "p" }); }\n`,
      "nota.md": "# nota\nWrite a note.\n",
    });
    const ctx = testFactory({
      level: "L2",
      isolation: "worktree",
      packages: [{ path: dir, allowCode: true }],
      lines: [{ name: "demo", repo: gitRepo(), verify: [passes], stations: { research: { skills: ["investigar"] } } }],
    });
    const agents = fakeAgents({});
    await runDaemon(ctx, { once: true, pollMs: 10, panel: false, scout: true, research: true, packages: true, agentRunner: () => agents.runner });
    expect(agents.calls.map(agentName)).toEqual(["scout", "research", "package:hello/nota"]);
  });
});

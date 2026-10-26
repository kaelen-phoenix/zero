import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestWork } from "../src/app.js";
import { createBoxExecutor } from "../src/box/executor.js";
import { inspectBox } from "../src/box/status.js";
import { runJob } from "../src/line/runner.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

/**
 * Runs a real job inside a real container. Needs Docker or Podman and the box
 * image (`zero box setup --yes`); CI runs it with ZERO_BOX_E2E=1.
 */
const enabled = process.env.ZERO_BOX_E2E === "1";

afterEach(cleanup);

// Engines with no model: plain scripts that run inside the box and report what they could do there.
const tryWrite = "let writable = true; try { require('fs').writeFileSync('/work/should-not-exist', 'x') } catch { writable = false }";
const specScript = `${tryWrite}; console.log(JSON.stringify({ feasible: !writable, reason: writable ? 'spec could write to /work' : '', title: 'Health', summary: 'Un endpoint de salud para el servicio de prueba.', capability: 'health', requirements: [{ name: 'Health', text: 'The service SHALL report ok.', scenarios: [{ name: 'ok', when: 'asked', then: 'reports ok' }] }], tasks: ['write it'], risks: [], learnings: [], followUps: [] }))`;
const buildScript = "require('fs').mkdirSync('src', { recursive: true }); require('fs').writeFileSync('src/health.ts', \"export const status = 'ok';\\n\"); console.log('built in ' + process.cwd() + ' as ' + process.env.HOME)";
const reviewScript = `${tryWrite}; console.log(JSON.stringify({ summary: 'writable=' + writable, findings: writable ? [{ severity: 'critical', file: 'src/health.ts', line: 1, problem: 'review could write to /work', fix: 'mount read-only' }] : [], learnings: [] }))`;

describe.skipIf(!enabled)("isolation box (real container)", () => {
  it("builds, verifies and reviews inside the box, read-only where it must be, and delivers", async () => {
    const repo = gitRepo();
    const engine = (script: string) => ({ command: ["node", "-e", script] });
    const ctx = testFactory({
      level: "L3",
      isolation: "container",
      engines: { espec: engine(specScript), ebuild: engine(buildScript), ereview: engine(reviewScript) },
      stations: { spec: { engine: "espec", timeoutMinutes: 5 }, build: { engine: "ebuild", timeoutMinutes: 5 }, review: { engine: "ereview", timeoutMinutes: 5 } },
      lines: [{ name: "demo", repo, maxAttempts: 1, verify: [] }],
    });
    // Inside the box the factory's own directory on the host must not exist, and HOME is the box's.
    ctx.config.lines[0]!.verify = [`test -f src/health.ts && test "$HOME" = /home/zero && test ! -e '${ctx.home.root}'`];

    const status = inspectBox(ctx.config);
    expect(status.problems).toEqual([]);
    const box = createBoxExecutor(ctx.config, status, ctx.secrets);
    const { job } = requestWork(ctx, { text: "agregá un endpoint de salud" });

    const done = await runJob(job.id, { ...ctx, runAgent: fakeAgents({}).runner, box, boxAvailability: { ready: true, problems: [] } });

    expect(done.reason).toBeUndefined();
    expect(done).toMatchObject({ status: "delivered", isolation: "container" });
    expect(readFileSync(join(repo, "src/health.ts"), "utf8")).toContain("ok");
    const boxRuns = ctx.store.spansForJob(job.id).filter((s) => s.name === "zero.box.run");
    expect(boxRuns.map((s) => s.attrs["zero.box.mount"])).toEqual(["ro", "rw", "rw", "ro"]);
    expect(boxRuns.every((s) => s.attrs["process.exit.code"] === 0)).toBe(true);
  }, 300_000);
});

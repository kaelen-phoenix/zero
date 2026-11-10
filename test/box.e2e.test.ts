import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestWork, type FactoryContext } from "../src/app.js";
import { egressPolicy } from "../src/box/egress.js";
import { createBoxExecutor } from "../src/box/executor.js";
import { createGateHost, gateName } from "../src/box/network.js";
import { inspectBox } from "../src/box/status.js";
import { runJob } from "../src/line/runner.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

/**
 * Runs real jobs inside a real container. Needs Docker or Podman and the box
 * image (`zero box setup --yes`); CI runs it with ZERO_BOX_E2E=1, once per runtime.
 */
const enabled = process.env.ZERO_BOX_E2E === "1";

afterEach(cleanup);

function realBox(ctx: FactoryContext) {
  const status = inspectBox(ctx.config);
  expect(status.problems).toEqual([]);
  const gate = createGateHost({ runtime: status.runtime!, image: status.image, dir: ctx.home.gate, store: ctx.store, policy: () => egressPolicy(ctx.config) });
  return { box: createBoxExecutor(ctx.config, status, ctx.secrets, gate), gate };
}

// Engines with no model: plain scripts that run inside the box and report what they could do there.
const tryWrite = "let writable = true; try { require('fs').writeFileSync('/work/should-not-exist', 'x') } catch { writable = false }";
const specScript = `${tryWrite}; console.log(JSON.stringify({ feasible: !writable, reason: writable ? 'spec could write to /work' : '', title: 'Health', summary: 'Un endpoint de salud para el servicio de prueba.', capability: 'health', requirements: [{ name: 'Health', text: 'The service SHALL report ok.', scenarios: [{ name: 'ok', when: 'asked', then: 'reports ok' }] }], tasks: ['write it'], risks: [], learnings: [], followUps: [] }))`;
const buildScript = "require('fs').mkdirSync('src', { recursive: true }); require('fs').writeFileSync('src/health.ts', \"export const status = 'ok';\\n\"); console.log('built in ' + process.cwd() + ' as ' + process.env.HOME)";
const reviewScript = `${tryWrite}; console.log(JSON.stringify({ summary: 'writable=' + writable, findings: writable ? [{ severity: 'critical', file: 'src/health.ts', line: 1, problem: 'review could write to /work', fix: 'mount read-only', confidence: 10 }] : [], learnings: [] }))`;

describe.skipIf(!enabled)("isolation box (real container)", () => {
  it("builds, verifies, reviews and checks security inside the box, read-only where it must be, and delivers", async () => {
    const repo = gitRepo();
    const engine = (script: string) => ({ command: ["node", "-e", script] });
    const ctx = testFactory({
      level: "L3",
      isolation: "container",
      engines: { espec: engine(specScript), ebuild: engine(buildScript), ereview: engine(reviewScript) },
      stations: { spec: { engine: "espec", timeoutMinutes: 5 }, build: { engine: "ebuild", timeoutMinutes: 5 }, review: { engine: "ereview", timeoutMinutes: 5 }, security: { engine: "ereview", timeoutMinutes: 5 } },
      lines: [{ name: "demo", repo, maxAttempts: 1, verify: [] }],
    });
    // Inside the box the factory's own directory on the host must not exist, and HOME is the box's.
    ctx.config.lines[0]!.verify = [`test -f src/health.ts && test "$HOME" = /home/zero && test ! -e '${ctx.home.root}'`];

    const { box } = realBox(ctx);
    const { job } = requestWork(ctx, { text: "agregá un endpoint de salud" });

    const done = await runJob(job.id, { ...ctx, runAgent: fakeAgents({}).runner, box, boxAvailability: { ready: true, problems: [] } });

    expect(done.reason).toBeUndefined();
    expect(done).toMatchObject({ status: "delivered", isolation: "container" });
    expect(readFileSync(join(repo, "src/health.ts"), "utf8")).toContain("ok");
    const boxRuns = ctx.store.spansForJob(job.id).filter((s) => s.name === "zero.box.run");
    expect(boxRuns.map((s) => s.attrs["zero.box.mount"])).toEqual(["ro", "rw", "rw", "ro", "ro"]);
    expect(boxRuns.every((s) => s.attrs["process.exit.code"] === 0)).toBe(true);
  }, 300_000);

  it("reaches the internet only through the gate, which records everything and refuses what is suspicious", async () => {
    const ctx = testFactory({ isolation: "container", lines: [{ name: "demo", repo: gitRepo() }] });
    const { box, gate } = realBox(ctx);
    const { job } = requestWork(ctx, { text: "probar la salida" });

    const checks = [
      // No DNS and no route of its own.
      "! getent hosts example.com",
      "! curl -sS --noproxy '*' --max-time 5 -o /dev/null https://1.1.1.1",
      // An ordinary site goes through the gate.
      "curl -sS --fail --max-time 60 -o /dev/null https://registry.npmjs.org/",
      // A suspicious one is refused by the gate.
      "! curl -sS --max-time 30 -o /dev/null https://pastebin.com/",
      "echo all-checks-passed",
    ].join(" && ");
    const r = await box.shell(checks, { cwd: gitRepo(), mount: "ro", jobId: job.id, station: "verify", timeoutMs: 180_000 });
    if (!r.output.includes("all-checks-passed")) {
      const rt = process.env.ZERO_BOX_RUNTIME ?? "podman";
      const sh = (c: string) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { const x = e as { stdout?: string; stderr?: string }; return `ERR ${x.stdout ?? ""}${x.stderr ?? ""}`; } };
      const name = gateName(ctx.home.gate);
      const out: string[] = [];
      out.push("VERSION " + sh(`${rt} version`));
      for (const f of readdirSync(ctx.home.gate)) if (f.startsWith("events-")) out.push("EVENTS " + readFileSync(join(ctx.home.gate, f), "utf8"));
      out.push("NETSETTINGS " + sh(`${rt} inspect ${name} --format '{{json .NetworkSettings}}'`));
      out.push("RESOLV " + sh(`${rt} exec ${name} cat /etc/resolv.conf`));
      out.push("ROUTE " + sh(`${rt} exec ${name} cat /proc/net/route`));
      out.push("LOOKUP " + sh(`${rt} exec ${name} node -e "require('dns').lookup('registry.npmjs.org',{all:true},(e,a)=>console.log(String(e),JSON.stringify(a)))"`));
      out.push("TCP " + sh(`${rt} exec ${name} node -e "require('net').connect(443,'1.1.1.1').on('connect',()=>{console.log('tcp ok');process.exit()}).on('error',e=>{console.log('tcp err',e.message);process.exit()})"`));
      out.push("NETWORKS " + sh(`${rt} network inspect zero-box ${rt === "podman" ? "podman" : "bridge"}`));
      out.push("LOGS " + sh(`${rt} logs ${name}`));
      console.log(["DIAG-BEGIN", ...out, "DIAG-END"].join(String.fromCharCode(10) + "---" + String.fromCharCode(10)));
    }
    expect(r.output).toContain("all-checks-passed");
    expect(r.code).toBe(0);

    // Allowed connections are recorded when they close, which may be just after the run ends.
    let rows = ctx.store.listEgress({ job: job.id });
    for (let i = 0; i < 50 && !rows.some((e) => e.host === "registry.npmjs.org"); i++) {
      await new Promise((res) => setTimeout(res, 100));
      gate.ingest();
      rows = ctx.store.listEgress({ job: job.id });
    }
    expect(rows.find((e) => e.host === "registry.npmjs.org")).toMatchObject({ allowed: true, station: "verify", port: 443 });
    expect(rows.find((e) => e.host === "registry.npmjs.org")!.bytesDown).toBeGreaterThan(0);
    expect(rows.find((e) => e.host === "pastebin.com")).toMatchObject({ allowed: false, rule: "suspicious", station: "verify" });
    expect(rows.some((e) => e.host === "1.1.1.1")).toBe(false);
  }, 300_000);
});

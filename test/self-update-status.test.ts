import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { briefing, factoryStatus } from "../src/app.js";
import { formatStatus } from "../src/format.js";
import { overviewPage } from "../src/panel/html.js";
import { importSwitchResult, readSelfUpdate, recordSelfUpdate } from "../src/self-update.js";
import { resultPath } from "../src/self-update-switch.js";
import { cleanup, testFactory } from "./helpers.js";

afterEach(cleanup);

const FROM = "a".repeat(40);
const TO = "b".repeat(40);
const NOW = () => new Date("2026-11-11T12:00:00Z");
const ROLLED_BACK = "volvió a la versión anterior aaaaaaaaaaaa (no arrancó bbbbbbbbbbbb)";

describe("self-update in status, panel and briefing", () => {
  it("tells a rollback found at daemon start everywhere", async () => {
    const ctx = testFactory({ lines: [], selfUpdate: { enabled: true } }, NOW);
    recordSelfUpdate(ctx.store, { state: { status: "switching", from: FROM, to: TO, switchingAt: "2026-11-11T10:00:00Z" } });
    mkdirSync(dirname(resultPath(ctx.home.root)), { recursive: true });
    writeFileSync(resultPath(ctx.home.root), JSON.stringify({ from: FROM, to: TO, at: "2026-11-11T10:03:00Z", outcome: "rolled-back", reason: "no tomó el candado" }));
    await importSwitchResult(ctx);
    expect(readSelfUpdate(ctx.store).history.map((e) => e.outcome)).toEqual(["rolled-back"]);

    const s = factoryStatus(ctx);
    expect(s.selfUpdate?.last?.outcome).toBe("rolled-back");
    // The rollback's own problem is told by its entry, not twice.
    expect(s.selfUpdate?.problem).toBeUndefined();
    const text = formatStatus(s);
    expect(text).toContain(`Autoactualización: ${ROLLED_BACK}`);
    expect(text.match(/Autoactualización/g)).toHaveLength(1);
    const html = overviewPage(s, [], "nonce");
    expect(html).toContain(`<span class="bad">Autoactualización: ${ROLLED_BACK}`);
    const body = (await briefing(ctx)).body;
    expect(body).toContain(`- **Autoactualización**: ${ROLLED_BACK}`);
  });

  it("says nothing while off and without history", async () => {
    const ctx = testFactory({ lines: [] }, NOW);
    const s = factoryStatus(ctx);
    expect(s.selfUpdate).toBeUndefined();
    expect(formatStatus(s)).not.toContain("Autoactualización");
    expect(overviewPage(s, [], "nonce")).not.toContain("Autoactualización");
    expect((await briefing(ctx)).body).not.toContain("Autoactualización");
  });

  it("tells a version waiting for a free factory, an update and a problem of its own", async () => {
    const ctx = testFactory({ lines: [], selfUpdate: { enabled: true } }, NOW);
    recordSelfUpdate(ctx.store, {
      state: { status: "ready", from: TO, to: "c".repeat(40), problem: "cambios locales en /zero: no actualizo" },
      entry: { from: FROM, to: TO, at: "2026-11-11T09:00:00Z", outcome: "updated" },
    });
    const text = formatStatus(factoryStatus(ctx));
    expect(text).toContain("Autoactualización: cccccccccccc está lista");
    expect(text).toContain("Autoactualización: de aaaaaaaaaaaa a bbbbbbbbbbbb el ");
    expect(text).toContain("Autoactualización: PROBLEMA: cambios locales en /zero: no actualizo");
    // A successful update is not a decision for the briefing.
    expect((await briefing(ctx)).body).not.toContain("Autoactualización");
  });

  it("lists a failed preparation in the briefing", async () => {
    const ctx = testFactory({ lines: [], selfUpdate: { enabled: true } }, NOW);
    const why = "no pude preparar bbbbbbbbbbbb: build roto";
    recordSelfUpdate(ctx.store, { state: { status: "idle", problem: why, failed: [TO] }, entry: { from: FROM, to: TO, at: "2026-11-11T11:00:00Z", outcome: "failed", reason: why } });
    const s = factoryStatus(ctx);
    expect(s.selfUpdate?.problem).toBeUndefined();
    expect(formatStatus(s)).toContain(`Autoactualización: no pudo pasar a bbbbbbbbbbbb, sigue en aaaaaaaaaaaa`);
    expect((await briefing(ctx)).body).toContain(`- **Autoactualización**: no pudo pasar a bbbbbbbbbbbb, sigue en aaaaaaaaaaaa`);
  });
});

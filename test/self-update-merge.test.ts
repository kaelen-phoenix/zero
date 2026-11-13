import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { formatStatus } from "../src/format.js";
import { INSTALL_FRESHNESS_KEY } from "../src/install-freshness.js";
import { recordSelfUpdate } from "../src/self-update.js";
import { Store } from "../src/state/store.js";
import { computeMetrics } from "../src/telemetry/metrics.js";
import { renderBriefing } from "../src/townhall/briefing.js";
import { cleanup, testFactory } from "./helpers.js";

afterEach(cleanup);

const FROM = "a".repeat(40);
const TO = "b".repeat(40);

describe("self-update next to install freshness and jams", () => {
  it("shows both the install warning and the self-update lines in status", () => {
    const ctx = testFactory({ lines: [], selfUpdate: { enabled: true } });
    ctx.store.setKv(INSTALL_FRESHNESS_KEY, JSON.stringify({ checkedAt: new Date().toISOString(), behind: 2, staleBuild: false, upstream: "origin/main" }));
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: FROM, to: TO } });
    const s = factoryStatus(ctx);
    expect(s.install).toBeDefined();
    expect(s.selfUpdate).toBeDefined();
    const text = formatStatus(s);
    expect(text).toContain("Instalación atrasada");
    expect(text).toContain("Autoactualización:");
  });

  it("renders jams, the install section and a rolled-back self-update in the briefing", () => {
    const store = new Store(":memory:");
    const at = new Date().toISOString();
    const b = renderBriefing(
      computeMetrics(store, new Date(0)),
      [],
      undefined,
      [],
      undefined,
      [],
      [],
      [],
      undefined,
      [],
      [],
      [{ line: "demo", title: "tests lentos", kind: "flaky-test", action: "none", jams: 2, at }],
      { checkedAt: at, behind: 3, staleBuild: false, upstream: "origin/main" },
      [{ from: FROM, to: TO, at, outcome: "rolled-back", reason: "no tomó el candado" }],
    );
    expect(b.body).toContain("## Trabas");
    expect(b.body).toContain("## Instalación");
    expect(b.body).toContain("Autoactualización");
  });

  it("keeps autostart and self-update off by default", () => {
    const config = parseFactory("lines: []\n");
    expect(config.selfUpdate.enabled).toBe(false);
    expect(config.autostart).toBe(false);
  });

  it("numbers the self-update ADR after the MCP one", () => {
    const adrs = readdirSync("docs/adr");
    expect(adrs.filter((f) => f.startsWith("0004"))).toEqual(["0004-servidores-mcp.md"]);
    expect(readFileSync("docs/adr/0005-autoactualizacion.md", "utf8").split("\n")[0]).toMatch(/^# ADR 0005/);
  });
});

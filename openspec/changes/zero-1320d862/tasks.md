# Tasks

## 1. Etapa 1: Demand runs in their own daemon pass, with a recorded outcome

- [x] 1.1 Write the OpenSpec change zero-1320d862 (agent-packages) with all requirements.
- [x] 1.2 packages.ts: busy-station guard in runTurn, `ended` callback, `stationOnDemandLastKey` + `OnDemandRecord`, `runOnDemand` writing the record, exported `onDemandPass` (andon/budget/signal gates, no queue check); packagesPass runs only regular turns and skips stations with a pending request.
- [x] 1.3 daemon.ts: remove the onDemandPending bypass from idlePasses; add the `runOnDemand` background pass next to runSchedules and await it on exit.
- [x] 1.4 Rewrite and extend the demand-run tests in test/package-on-demand.test.ts (onDemandPass with queued/running jobs, gates, night cap, records per outcome, guard, packagesPass behaviour, daemon once run); run focused tests and typecheck.

## 2. Etapa 2: Status, panel and briefing show pending and finished runs; docs

- [x] 2.1 app.ts: `FactoryStatus.onDemandRuns` (24 h window, stale flag) and the new requestStationRun text; format.ts state helper and the `Corridas a demanda recientes:` line.
- [x] 2.2 panel html.ts overviewPage: pending and recent demand runs, escaped.
- [x] 2.3 briefing.ts: trailing `onDemand` argument and `## Corridas a demanda` section; app.ts `briefing()` feeds it.
- [x] 2.4 Update the CLI help, the MCP tool description, README.md/README.es.md and AGENTS.md.
- [x] 2.5 Tests for status/format, overviewPage and briefing; run focused tests including docs and wording tests, plus typecheck and `npx openspec validate --all`.

# Tasks

## 1. Etapa 1: Pedido en texto y registro de la corrida

- [x] 1.1 Write the OpenSpec change (proposal, tasks, specs/agent-packages/spec.md delta) and run `npx openspec validate --all`
- [x] 1.2 In src/line/packages.ts export `stationOnDemandRequestKey(pkg, name)` (`...:on-demand:request`) and `stationRunKey(pkg, name)` (`...:on-demand:run`, JSON `{requestedAt, request?, startedAt?, state: 'running'|'ended', outcome?: 'done'|'failed'|'timeout'|'stopped', finishedAt?, error?}`)
- [x] 1.3 Change requestStationRun(ctx, ref, now, request?) in src/app.ts: clean the request (replace the station's declared secret values with REDACTED, `publicText` with the lines' repos, trim, cut to 4000; move or export the `withoutSecrets` helper so both modules share it), store it in stationOnDemandRequestKey only when non-empty, and return `requestedAt` in the ok result
- [x] 1.4 Extend StationHook's slot type to `{ onDemand: true; request?: string }`. In runStation's on-demand branch, read the request before clearing, delete both keys in clear, and call hook with `{ onDemand: true, ...(request && { request }) }`
- [x] 1.5 Add an optional `ended(outcome, error?)` callback to StationTurn. runTurn calls it once with done / failed (pass threw, or module import, export or config failure) / timeout / stopped (outer abort). The on-demand turn writes the run record: `running` with startedAt at mark (idempotent, since mark can run twice), then the outcome with finishedAt and the error (secrets replaced, publicText, 600 chars)
- [x] 1.6 Tests in test/package-on-demand.test.ts: request passed cleaned and cut; no-text shape unchanged; record running/done/failed/timeout; request cleared after the run; ctx exposes no station-run request; then `npm run typecheck` and the focused tests

## 2. Etapa 2: CLI y chat esperan el inicio

- [x] 2.1 Add `waitStationStart(ctx, ref, requestedAt, { timeoutMs, pollMs, sleep? })` in src/app.ts: re-read the run record from the store until its requestedAt equals the given one and it has startedAt (started), or the limit passes (pending). Return the text to show
- [x] 2.2 In src/cli.ts add a `pedido` string option. `zero package run` passes it, ensures the daemon, waits through waitStationStart (2 minutes) and prints the result. Update the usage text
- [x] 2.3 In src/mcp/server.ts add an optional `request` to zero_package_run and wait 30 s with the same function
- [x] 2.4 Tests for waitStationStart (started and pending, with an injected sleep and short limits) and for the MCP/CLI request reaching the store

## 3. Etapa 3: Estado, panel y documentación

- [ ] 3.1 In factoryStatus, add the optional `request` to `onDemand` entries only when present, and add `stationRuns` (one entry per onDemand station with a run record: station, state, outcome, request, times, error). Show them in formatStatus (en curso / último resultado lines)
- [ ] 3.2 Add `packageList`'s station view fields for the last run record (optional, omitted when absent)
- [ ] 3.3 Panel: in src/panel/html.ts add `packagesPage` (stations with state, last outcome, and the "Pedir ahora" form with an optional `pedido` textarea for onDemand stations, all text through esc) and a NAV entry "Paquetes". In src/panel/server.ts add GET /packages and POST /packages/run calling requestStationRun, redirecting 303 to /packages with the message, and map `/packages` in returnTo
- [ ] 3.4 Panel tests: the form shows only for onDemand stations, an authenticated POST records the request, a refusal redirects to /packages, and a POST without a session records nothing
- [ ] 3.5 Document `--pedido`, `run.request`, the chat field, the panel button and the status lines in README.md and README.es.md with the same structure and code blocks, and update the on-demand paragraph of AGENTS.md. Run `npm run typecheck`, the focused tests and test/docs.test.ts and test/wording.test.ts

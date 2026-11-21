# Tasks

## 1. Implementación

- [ ] 1.1 Create the OpenSpec change openspec/changes/zero-0625d242: proposal.md, tasks.md and specs/agent-packages/spec.md, with ADDED requirements matching this spec. Follow the format of openspec/changes/zero-eb904e3d. Check it with `npx openspec validate --all`.
- [ ] 1.2 src/panel/html.ts `packageStation`: when `s.whenBusy` is true, append ` · corre aunque la fábrica esté ocupada` to the state text in the `<span class="muted">` of the `<h3>`. Use the same wording as src/format.ts:262 and keep it escaped through `esc`. Update the function's doc comment.
- [ ] 1.3 src/panel/html.ts `overviewPage`: next to the onDemand/onDemandRuns lines, add `${s.whenBusy.length ? `<p class="muted">Estaciones que corren aunque la fábrica esté ocupada: ${s.whenBusy.map((n) => `<b>${esc(n)}</b>`).join(", ")}.</p>` : ""}`, or an equivalent that keeps the text «Estaciones que corren aunque la fábrica esté ocupada: » followed by the escaped names.
- [ ] 1.4 Tests: in test/package-when-busy.test.ts, add a describe block (for example 'the panel') that imports packagesPage and overviewPage from ../src/panel/html.js and reuses `stationPackage`/`factory`. Cover four cases: packagesPage contains BUSY with whenBusy and does not without it; overviewPage contains STATUS_LINE and 'hello/nota' with whenBusy and does not contain STATUS_LINE without it.
- [ ] 1.5 Docs: in docs/agents/packages.md, where it says the panel summary shows pending and recent runs and the /packages page shows the stations, add that the /packages station card marks whenBusy stations and that the summary lists `FactoryStatus.whenBusy`. In docs/agents/panel.md, add a short sentence that the summary and /packages show whenBusy stations with the CLI's wording. Keep test/wording.test.ts rules.
- [ ] 1.6 Run `npm run typecheck` and `npm test`.

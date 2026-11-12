# Tasks

## 1. Etapa 1: Fundir a pedido: operación, CLI y chat

- [ ] 1.1 src/line/automerge.ts: `mergeRequested` (decision, merge, MergeState merged, branch deletion, issue comment, `zero.merge` span, townhall post; refusals as `{merged:false, why}`)
- [ ] 1.2 src/app.ts: `mergePullRequest(ctx, target, {via, api?})` with job/url resolution and the default signed real adapter outside the meter
- [ ] 1.3 src/format.ts `formatMerge`; src/cli.ts `zero fusionar` + USAGE; src/mcp/server.ts `zero_merge` with an injectable adapter
- [ ] 1.4 test/merge-request.test.ts covering merges, refusals, trace, townhall and the MCP tool; typecheck and those tests pass

## 2. Etapa 2: Botón Fundir en el panel

- [ ] 2.1 src/panel/html.ts: `Fundir` form on jobPage (only for a delivered GitHub pull request whose MergeState is not merged/closed) and `confirmMergePage`
- [ ] 2.2 src/panel/server.ts: `/job/<id>/merge` with the confirm=1 step and `PanelOptions.merges`; src/daemon.ts passes the metered real adapter
- [ ] 2.3 Panel tests: visibility, confirmation first, confirmed merge with via panel

## 3. Etapa 3: Detectar y avisar checks frenados por facturación

- [ ] 3.1 src/line/automerge.ts: `Check.billing`/`Check.started`, `billingRefusal`, adapter reading output and annotations, the `checks-billing:<repo>` record, `billingText`, and `MergeState.billing`/`billingRerun` in `kept()`; hold in `watch` before the outage logic, with no comment, refresh or rerun
- [ ] 3.2 src/app.ts `FactoryStatus.billing` (held pull requests out of `merges`); formatStatus line; panel overview line; briefing line
- [ ] 3.3 test/automerge-billing.test.ts: billingRefusal, hold, one record per repository, notice once and absent

## 4. Etapa 4: Volver a correr cuando GitHub deja

- [ ] 4.1 src/line/automerge.ts: `followBilling` at the end of pollMerges: recovery from started non-billing checks at watched tips or the base (base read at most every 5 minutes), reruns of one held pull request per pass with the repository free, at most once per run, the refreshing hold, and the record deleted when none is left
- [ ] 4.2 Extend test/automerge-billing.test.ts: no rerun before recovery, rerun after recovery, one at a time, once per run, record forgotten; the existing automerge tests still pass

## 5. Etapa 5: Documentación

- [ ] 5.1 README.md and README.es.md: bullets next to 'It merges only when GitHub says so' and `zero fusionar` among the daily commands; assertion in test/docs.test.ts
- [ ] 5.2 AGENTS.md: automerge.ts entry updated
- [ ] 5.3 Run typecheck, the touched test files, test/wording.test.ts, `npx openspec validate --all` and `npm run build`

# Tasks

## 1. Implementación

- [ ] 1.1 Add an OpenSpec change under openspec/changes/ with a delta for capability `factory-daemon` holding these three requirements and their scenarios; check it with `npx openspec validate --all`.
- [ ] 1.2 src/app.ts: add `retry?: SelfUpdateRetry` (import the type from ./self-update.js) to `SelfUpdateStatus`, and spread `...(state.retry && { retry: state.retry })` in `selfUpdateStatus`.
- [ ] 1.3 src/format.ts: add a `selfUpdateRetryText(r: SelfUpdateRetry, now)` helper returning `vuelve a intentar pasar a ${commit(r.commit)} a las ${resetTime(r.at, now)} (intento ${r.tries + 1})`. Use it in `selfUpdateLines` for a `bad: false` line after the `ready` line, and update the doc comment.
- [ ] 1.4 src/townhall/briefing.ts: add an optional trailing `selfUpdateRetry?: SelfUpdateRetry` parameter to `renderBriefing`, rendering `- **Autoactualización**: ${selfUpdateRetryText(r, new Date(metrics.to))}.` right after the `selfUpdates` bullets. In app.ts `briefing`, pass `status.selfUpdate?.retry`.
- [ ] 1.5 test/self-update-status.test.ts: add cases with a state holding `retry` (status, panel HTML not bad, briefing) and assert `vuelve a intentar` is absent from all three in the existing no-retry cases.
- [ ] 1.6 Update the self-update paragraph of AGENTS.md to mention that `retry` is shown by `selfUpdateLines` and the briefing. Run `npm run typecheck` and `npm test`.

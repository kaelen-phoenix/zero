# Tasks

## 1. Implementación

- [ ] 1.1 Add an OpenSpec change `openspec/changes/zero-94333bdc/` with proposal.md, tasks.md and specs/production-line/spec.md, holding the two ADDED requirements above (Spanish names, English text with MUST/SHALL). Check it with `npx openspec validate --all`.
- [ ] 1.2 In src/line/runner.ts, replace `subscription plan used up` with `engine quota or credit used up` in all five places: the requeue `log.info` in runJob's catch (~line 211, keeping `; job back in the queue until it renews`), the replacement `log.info` in goesOn (~line 332, keeping `; going on with a replacement`), and the three `attemptSpan.end("error", { "error.message": ... })` calls (~lines 597, 672 and 815). Ideally use one module constant, for example `const QUOTA_USED_UP = "engine quota or credit used up"`.
- [ ] 1.3 Change the doc comment on `Interrupted` (~line 57) so it says `quota` means the engine's plan window or API credit refused a call, and that the job waits in the queue until the engine is available again.
- [ ] 1.4 Add a test, for example in test/budget-cut.test.ts or test/fallback.test.ts, that reuses the existing fakeAgents/testFactory helpers. Run a job whose build agent returns `ok: false` with quota `{ billing: 'api', windows: [], limited: true }`. Assert that the job is `queued` and that `ctx.store.spansForJob(job.id).find(s => s.name === 'zero.attempt')` has status `error` and `attrs['error.message'] === 'engine quota or credit used up'`.
- [ ] 1.5 Run `npm run typecheck` and `npm test`.

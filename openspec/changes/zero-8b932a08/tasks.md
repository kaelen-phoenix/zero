# Tasks

## 1. Etapa 1: Conflict first, tested locally

- [ ] 1.1 Add the OpenSpec change for production-line with all requirements.
- [ ] 1.2 Implement the local conflict test in src/line/automerge.ts and wire it into `watch` before the wait, billing, outage and unblock handling, through `takeBack`.
- [ ] 1.3 Add tests with the automerge-conflicts fixture for `mergeable: null` plus failed checks (taken back; used-up resolutions reported as conflict; clean merge keeps the checks path), and keep the existing automerge tests passing.

## 2. Etapa 2: Take back to fix failed checks

- [ ] 2.1 Add `PrRefresh.checks`, `MergeState.fixing`/`fixes` in `kept()`, `MAX_CHECK_FIXES`, `failedTests`, `checksFeedback` and `fixChecks`, and call it in `watch` after `unblock` has nothing left to try.
- [ ] 2.2 Handle the checks mark in `runJob` and `updateProblem` in src/line/runner.ts.
- [ ] 2.3 Extend `retryJob` in src/app.ts.
- [ ] 2.4 Add tests for queuing, feedback and scrubbing, pushing to the same pull request, a failed fix, the limits, persistence, retry and `failedTests`; update any existing test whose expectations change; update AGENTS.md; run typecheck and tests.

# Tasks

## 1. Implementación

- [ ] 1.1 src/engines/types.ts: add `budgetLimited?: boolean` to EngineResult with a doc comment (the call stopped at `maxBudgetUsd`).
- [ ] 1.2 src/agent.ts: add `budgetLimited?: boolean` to AgentRun and copy it in createAgentRunner (`...(result.budgetLimited && { budgetLimited: true })`). Optionally record it on the agent span as `zero.budget.limited`.
- [ ] 1.3 src/engines/claude.ts: pull the result mapping (current lines 111-114) into an exported pure function, for example `claudeResult(result, quota)`. Set budgetLimited when subtype === 'error_max_budget_usd' or the error text/`errors` contains 'Reached maximum budget'. Keep the current ok/text/cost behaviour otherwise.
- [ ] 1.4 src/line/runner.ts: pull the budget-exceeded branch (fail via finalizeJob or askOwner with kind 'budget-exceeded', extraUsd = limits.usdPerJob) into a helper used by both the loop-start check and the new cut-short path.
- [ ] 1.5 src/line/runner.ts: at the loop-start check, also take the budget path when the next engine is not on a subscription and the remaining budget is below 10% of the total cap (named constant, for example MIN_ATTEMPT_SHARE = 0.1).
- [ ] 1.6 src/line/runner.ts: after the build run (after the abort and quota handling, before `if (!run.ok)`), when run.budgetLimited: discard the copy's changes, set attempt back to attempt - 1 and station 'build', end the attempt span with error 'job budget used up' without writing feedback, and return the budget helper's result.
- [ ] 1.7 test/: add runner tests with fakeAgents returning {ok:false, text:'Reached maximum budget', budgetLimited:true}: L2 asks (attempt 0, checkpoint spec, no 'más chicos' feedback, one build call), L3 fails by budget after one build call, approving resumes without re-running spec and delivers. Add the minimum-remaining tests (billed 0.95 of 1 → asks without calling build; subscription is not blocked), seeding spend through fake costs or spans as test/fallback.test.ts does.
- [ ] 1.8 test/: add tests for the Claude result mapping (subtype error_max_budget_usd, the 'Reached maximum budget' text, error_max_turns, success) and for createAgentRunner passing budgetLimited through, with a fake EngineExecute like test/fallback.test.ts.
- [ ] 1.9 Run npm run typecheck, npm test and npx openspec validate --all.

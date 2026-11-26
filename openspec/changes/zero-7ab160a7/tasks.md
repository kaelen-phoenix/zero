# Tasks

## 1. Etapa 1: Expired session: neutral signal, engine pause and requeue

- [ ] 1.1 Add EngineResult.signedOut (src/engines/types.ts) and detect it in failed calls in src/engines/claude.ts (claudeThrown, claudeResult's error and is_error branches).
- [ ] 1.2 Carry it to AgentRun.signedOut and the span attribute zero.engine.signed_out in src/agent.ts, and spread the same attribute in test/helpers.ts fakeAgents.
- [ ] 1.3 In src/budget.ts, pause a signed-out engine for UNKNOWN_RESET_MS after its latest call, with the Spanish reason `falta iniciar sesión en el motor <engine>`, cleared by a later call without the mark.
- [ ] 1.4 In src/line/runner.ts, treat signedOut like quota.limited (engineOut helper in goesOn, quotaStop, build, writer agents and reviewers), keeping the existing neutral texts.
- [ ] 1.5 Tests: claude mapping (including the successful answer containing the text), span attribute, budget pause/expiry/clear and reason, spec with and without a replacement, build attempt not spent, resuming after the wait.
- [ ] 1.6 Document it in docs/agents/engines.md and docs/agents/production-line.md; run typecheck and tests.

## 2. Etapa 2: Retry of failed jobs without a specification

- [ ] 2.1 In src/app.ts retryJob, accept a failed job without a spec whose reason does not start with SPEC_REFUSAL: queue it from the start (attempt 0, checkpoint none, station/stagesDone/feedback/finishedAt/worktree/base/branch cleared, stopRequested false, network and busy retry kv deleted). Spec refusals keep the current error.
- [ ] 2.2 Update test/unjam.test.ts: a spec refusal is still refused unchanged, and a failed job without a spec and with another reason is queued from the start; the existing cases still pass.
- [ ] 2.3 Document it in docs/agents/production-line.md and docs/agents/night-shift.md (retryCauses keeps its limits); run npm run typecheck, npm test and npx openspec validate --all.

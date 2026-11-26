# Tasks

## 1. Implementación

- [ ] 1.1 Create the OpenSpec change openspec/changes/zero-693ad55a/ (proposal.md, tasks.md, specs/production-line/spec.md with ADDED requirements matching this spec), following the layout of openspec/changes/zero-7ab160a7/.
- [ ] 1.2 In src/engines/claude.ts, extend the SIGNED_OUT regex (and its doc comment) to also match `could not be refreshed`, `\binvalid_grant\b`, `API Error: 401\b` and `\b401 Unauthorized\b`, case-insensitively. Do not match a bare 401.
- [ ] 1.3 Add src/engines/sign-in.ts with no runtime imports, exporting signInHint(engine). Claude: "corré `claude` en una terminal y escribí /login". Codex: "corré `codex login`". Any other engine: undefined. Re-export it from src/engines/index.ts.
- [ ] 1.4 In src/budget.ts engineBudget, import signInHint from ./engines/sign-in.js (not index.js, so the SDK is not pulled in) and build the signed-out reason as `falta iniciar sesión en el motor ${engine}` plus `: ${hint}` when there is a hint.
- [ ] 1.5 Tests: extend test/budget-cut.test.ts with the new detection cases and the bare-401 negative case; add signInHint cases; in test/budget.test.ts, update the 'an engine whose session expired' suite to check the hint and the no-hint custom engine; add a runner test (next to the existing signed-out runner tests in test/budget-cut.test.ts) where an invalid_grant spec call parks the job and it resumes after 16 minutes.
- [ ] 1.6 Document it in docs/agents/engines.md (the detected texts and signInHint living in src/engines/) and docs/agents/production-line.md (the waiting reason now says how to sign in). English only, third person «the person in charge».
- [ ] 1.7 Run npm run typecheck, npm test and npx openspec validate --all.

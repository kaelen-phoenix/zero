# Tasks

## 1. Implementación

- [x] 1.1 Add an OpenSpec change under openspec/changes/ (proposal.md, tasks.md, specs/production-line/spec.md) with the ADDED requirements above, and make sure `npx openspec validate --all` passes.
- [x] 1.2 In src/line/unjam.ts, add `const REFUSED_HOLD_DAYS = 7` (exported if tests need it) and move `refusedAtSpec` above `holdsTitle`.
- [x] 1.3 Change `holdsTitle(ctx, p)` to `holdsTitle(ctx, p, now: Date)`: return true when the status is not approved; return true when the job is not final; return true when `refusedAtSpec(job)` and `now - (job.finishedAt ?? job.updatedAt)` is less than REFUSED_HOLD_DAYS days; otherwise return false. Update its doc comment.
- [x] 1.4 Pass `now` from `openFixes` and `openCapabilities` to `holdsTitle`.
- [x] 1.5 In test/unjam.test.ts, next to 'proposes again once the earlier job finished', add tests for three cases: refused at spec within 7 days (no new proposal, the cause records the held proposal and job); refused at spec after 7 days (a new proposal); failed with a verify reason (a new proposal right away). Use the existing `at(h, m, day)` helper, `SPEC_REFUSAL` and `updateJob` with status, reason and finishedAt. Optionally add a capability-hold test in 'missing capabilities'.
- [x] 1.6 Update the `openFixes` sentence in docs/agents/night-shift.md: the title is also held by an approved unjam proposal whose job was refused at spec within the last 7 days of finishing (`REFUSED_HOLD_DAYS`), for both openFixes and openCapabilities.
- [x] 1.7 Run `npm run typecheck` and `npm test`.

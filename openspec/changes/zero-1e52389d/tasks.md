# Tasks

## 1. Implementación

- [ ] 1.1 Create the OpenSpec change `openspec/changes/zero-1e52389d/` (proposal.md, tasks.md, specs/production-line/spec.md with ADDED requirements matching this spec), and check that `npx openspec validate --all` passes.
- [ ] 1.2 In `src/line/discard.ts`, add an optional last parameter `onClosed?: (closed: { line: string; job: string }) => void` to `discardResolved`, and pass it down to `discardResolvedIn`, which calls it right after a successful `finalizeJob` (next to `closed++`). Keep the return value and the order of the existing parameters.
- [ ] 1.3 In `src/line/unjam.ts`, add `closed?: { line: string; job: string }[]` (documented) to `UnjamRunRecord`, maybe exported as `UnjamClosedJob`. Give `UnjamDemand` an optional `closed` callback, and have `unjamPass` pass `demand?.closed` to its `discardResolved` call.
- [ ] 1.4 In `unjamOnDemandPass`, collect the closures in an array through that callback. Add `closed` to the final `write` only when the array is not empty, for every ending: ok, failed (demandEnd), stopped (cut) and the catch branch. Leave `readUnjamRun` accepting records without `closed`.
- [ ] 1.5 In `src/format.ts`, add a helper (for example `unjamClosedText`) with singular/plural, ids grouped by line, at most 5 ids (a named constant) and 'y M más'. Make `describeUnjamRun` put it as a segment after the state and before `r.lines`, only when `Array.isArray(r.closed) && r.closed.length`. Update the JSDoc example.
- [ ] 1.6 Tests: in `test/discard-resolved.test.ts`, the callback when one and two jobs close and when none does; update the on-demand test at line ~209 to also expect `closed: [{ line: 'demo', job: job.id }]`; add a run on two lines asked for one; a run cut after closing (budget reached or abort signal) with `outcome: 'stopped'` and `closed`; and a run without closures with no `closed` field.
- [ ] 1.7 Tests in `test/unjam-on-demand.test.ts` ('seeing it'): status text for one closed job (singular), several on two lines (plural), more than 5 (bounded with 'y N más'), a stopped run with closures, and an old record without `closed` keeping today's text. In `test/panel-unjam.test.ts`, the overview HTML carries the closure text.
- [ ] 1.8 Document `closed` and the closure text in the on-demand unjam bullet of `docs/agents/night-shift.md`. Run `npm run typecheck` and `npm test` on the touched test files.

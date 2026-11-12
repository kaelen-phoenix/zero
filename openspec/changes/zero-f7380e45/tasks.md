# Tasks

## 1. Implementación

- [x] 1.1 In `buildLoop` (src/line/runner.ts ~677-680), read the job's `prRefresh(store, jobId)` mark before computing `resuming`. Add a flag `cleanMerge = job.attempt === 0 && job.station === "verify" && mark?.resolved === true`. Make `resuming` true when the existing condition holds or `cleanMerge` is true. Leave `resumingWriter` and `resumingCustom` as they are, gated on `attempt > 0`. Reuse the same mark for the later `conflicted` computation instead of reading it twice, if that reads cleanly.
- [x] 1.2 Make the attempt number used for the span and later checks `Math.max(resuming ? job.attempt : job.attempt + 1, 1)`, or equivalent. Do not write a new `attempt` to the job on the resume path. Confirm that `failAttempt` still sets station `build`, so a verify failure leads to a normal build attempt (attempt 1) next.
- [x] 1.3 Update the comment at src/line/runner.ts:201 and the one at line 676 so they say that a clean merge resumes at verify at any attempt count.
- [x] 1.4 In test/automerge-conflicts.test.ts, add a test next to 'spends no attempt and calls no build when the merge is clean': deliver with `delivered()`. Set MergeState to blocked in conflict, e.g. `{ ...f.merge(), status: 'blocked', backoff: { mergeable: false, ... } }` or through a pass with `state.pr.mergeable = false`. Call `retryJob(f.ctx, f.job.id)` from src/app.ts and expect attempt 0. Move the base in `other.txt`, run `f.pass()` and then `f.again()`. Assert: delivered, build count unchanged, review count +1, verify ran once more, stored attempt 0, and the `zero.attempt` span of that run has `zero.attempt` 1 (read through the store's spans).
- [x] 1.5 Add a test (or extend an existing one) for a conflicted merge at attempt 0: build is still called and the job ends at attempt 1.
- [x] 1.6 Add an OpenSpec change `openspec/changes/zero-f7380e45/` with proposal.md, tasks.md and specs/production-line/spec.md, using ADDED Requirements in the same format as openspec/changes/zero-022faac2. Run `npx openspec validate --all`.
- [x] 1.7 Run `npm run typecheck` and `npm test`.

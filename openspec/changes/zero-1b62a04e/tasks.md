# Tasks

## 1. Implementación

- [x] 1.1 In src/line/automerge.ts `watchedJobs`, call `ctx.store.listJobs({ status: ["delivered"], limit: -1 })`, so no delivered job is dropped. Keep the existing autoMerge, url and FINAL filtering.
- [x] 1.2 In src/app.ts, change the delivered lookup by url in the merge-request resolver (around line 1258, `limit: 1000`) to `limit: -1`.
- [x] 1.3 In src/self-update.ts `due`, pass `limit: -1` to `listJobs({ status: ["delivered"] })`, which today uses the default cap of 1000.
- [x] 1.4 In src/app.ts `briefing`, change the `limit: 10_000` calls (FINAL_STATUSES list, waiting list, packages list) to `limit: -1`. In src/line/scout.ts `scoutDigest` and src/line/unjam.ts `collectJams`, change `limit: 10_000` to `limit: -1`.
- [x] 1.5 Check that no other `listJobs` call that looks for live or recent jobs keeps a numeric cap. Calls with `limit: 1` used only as an existence check (`ownerWork`, packages) stay as they are. Optionally add a short doc comment on `Store.listJobs` saying that the default cap is 1000 rows in ascending creation order and that `-1` means no cap.
- [x] 1.6 Add a test (e.g. in test/automerge.test.ts or test/merge-request.test.ts, following their fixtures) that creates more than 200 delivered auto-merge jobs, marks the oldest ones `merged` in kv `automerge:<id>`, and asserts that `watchedJobs` returns the newest unmerged ones. Add a second assertion that pollMerges with a fake MergeApi asks about the newest job's pull request. Create the jobs straight through `ctx.store.createJob` + `finishJob('delivered', { delivery: {...} })` for speed.
- [x] 1.7 Add a test that mergePullRequest resolves a url delivered by a job created after more than 1000 other delivered jobs.
- [x] 1.8 Add an OpenSpec change under openspec/changes/zero-1b62a04e/ (proposal.md, tasks.md, specs/production-line/spec.md with ADDED requirements matching this spec), and run `npx openspec validate --all`.
- [x] 1.9 Run `npm run typecheck` and the touched test files.

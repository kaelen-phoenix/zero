# Tasks

## 1. Implementación

- [ ] 1.1 src/line/spec.ts: add optional `stages: z.array(z.object({ title: z.string(), tasks: z.array(z.string()) })).optional()` to SpecSchema (described for the agent), add the stage checks to `specProblems`, add a small helper `specStages(spec)` that returns `[]` when absent, and make `renderOpenSpecChange` write tasks.md with one section per stage when present (unchanged otherwise).
- [ ] 1.2 agents/spec.md: add a short rule on when and how to fill `stages`: many tasks or many areas of the code, each stage small enough for one build call within its time limit, each stage builds on the previous one and leaves the tests passing, and no `stages` for small requests.
- [ ] 1.3 src/state/store.ts: add `stagesDone?: number` to Job, an INTEGER column `stages_done` added in `migrate()`, mapped in COLUMNS and read in the row mapper.
- [ ] 1.4 src/line/runner.ts buildLoop: compute the current stage from `specStages(spec)` and `job.stagesDone`. Add the stage block (`## Stage n of N: title` plus its tasks, with a note that earlier stages are committed and verified) to the build and writer prompts. After verify passes on a stage that is not the last, set stagesDone+1, attempt 0, feedback null and station build, end the attempt span ok and continue the loop. Only after the last stage, run dependencies and reviewers. Put the stage in the exhausted-attempts reason. Unstaged specs follow the current path unchanged.
- [ ] 1.5 src/format.ts: append `, etapa n de N` in describeJobStatus for running staged jobs.
- [ ] 1.6 src/app.ts LineRow builder plus src/panel/html.ts lineRow: add an optional `stage` ({n, total, title}) and render it (escaped) inside the job's article, for example in the retry part, without changing the station markup the tests read.
- [ ] 1.7 README.md and README.es.md: add a short subsection on staged requests in the same place in both, with the same structure.
- [ ] 1.8 Tests: specProblems and renderOpenSpecChange cases in the existing spec tests; runner tests with the fake agent in test/runner.test.ts (3 stages all pass; stage 2 times out once and is retried alone; attempts per stage exhausted; resume from stagesDone; unstaged unchanged); describeJobStatus; one panel line row case. Keep the new tests few and fast.
- [ ] 1.9 Run npm run typecheck, npm test and npx openspec validate --all.

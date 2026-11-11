# Tasks

## 1. Implementación

- [ ] 1.1 Add an OpenSpec change `openspec/changes/zero-7eda98a0/` (proposal.md, tasks.md, specs/production-line/spec.md) with these requirements as ADDED Requirements; run `npx openspec validate --all`.
- [ ] 1.2 In src/line/runner.ts add `isLockedFolderError(err)` (EBUSY in code/message along the cause chain, depth 5, false for SetupFailed), a `busyRetryKey(jobId)` = `busy-retry:<id>`, `MAX_BUSY_RETRIES = 2`, and an optional `killLeftovers?: (folder: string) => number` in RunnerDeps (default the real one from src/leftovers.ts).
- [ ] 1.3 In runJob's final catch, after the network-cut branch, handle locked-folder errors: kill leftovers in `job.worktree` when set, then requeue through a helper shaped like `requeueAfterCut` but with its own counter, logging (not failing) when `discardChanges` throws; once retries run out, fail with a Spanish reason that names the locked folder.
- [ ] 1.4 In src/daemon.ts add `killLeftovers?: (folder: string) => number` to DaemonOptions and call it (try/catch, existsSync check) for each `running` job's worktree in the resume loop before re-queuing.
- [ ] 1.5 In src/line/integrate.ts give IntegrateOptions an optional `removeCopy` and `onLeftover(path, error)`; in mergeIntoBase, if removing a leftover `merge-<jobId>` fails, use `merge-<jobId>-<timestamp>` instead; wrap the removal in `finally` so a failure calls `onLeftover` and does not throw. In runJob pass `deps.removeCopy` and an `onLeftover` that calls `recordCleanup(store, `${jobId}-merge`, ...)`.
- [ ] 1.6 Add focused tests in test/cleanup.test.ts (or a new test/busy-resume.test.ts) using fake agents, injected `removeCopy`/`killLeftovers`, and a daemon `once` run for the resume kill; no real process listing in tests.
- [ ] 1.7 Add the sentence to README.md and README.es.md next to the existing cleanup sentence (same place, same structure).
- [ ] 1.8 While building, run only the affected tests (`npx vitest run test/cleanup.test.ts test/runner.test.ts test/daemon.test.ts test/docs.test.ts test/wording.test.ts`) plus `npm run typecheck`.

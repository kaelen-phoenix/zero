# Tasks

## 1. Implementación

- [ ] 1.1 Add an OpenSpec change under openspec/changes/ with a delta for `production-line` (ADDED requirements, the names above), and check it with `npx openspec validate --all`.
- [ ] 1.2 src/workspace.ts: make `removeWorkCopy` also run `git worktree prune` after the direct `rmSync`, so a later retry leaves no stale worktree entry. Keep it synchronous and still throwing on failure.
- [ ] 1.3 Create src/line/cleanup.ts with `cleanupKey(jobId)` (`cleanup:<id>`), a `PendingCleanup` type ({repo, path, error, since}), `recordCleanup(store, jobId, record)`, `pendingCleanups(store)` (through `store.kvWithPrefix`, skipping records that are not valid JSON) and `cleanupPass(ctx, remove = removeWorkCopy)`. The pass tries each record, deletes it on success or when the path no longer exists, keeps it with the updated error on failure, and never throws. Store failures are logged, not thrown.
- [ ] 1.4 src/line/finish.ts: add an optional `removeCopy?: (repo: string, path: string) => void` to `LedgerDeps` (default `removeWorkCopy`). Wrap the removal in `finalizeJob` in try/catch: on error, `log.warn` and `recordCleanup`, then carry on to the townhall posts.
- [ ] 1.5 src/daemon.ts: add a background `retryCleanups` pass guarded like `findReverts` (INTAKE_MS throttle, no overlap, outside the GitHub pause), called in the loop, and await it in the final `finally`.
- [ ] 1.6 src/app.ts: add `cleanups: { job: string; path: string; since: string }[]` to `FactoryStatus` from `pendingCleanups`. src/format.ts: in `formatStatus`, add the `Limpiezas pendientes: N copia(s) de trabajo (se reintenta en segundo plano)` line only when non-empty.
- [ ] 1.7 Tests in a new small file test/cleanup.test.ts (use test/helpers.js `testFactory`): finalizeJob keeps `delivered` when the injected removal throws EBUSY and records the kv; no record on success; cleanupPass succeeds / fails again / handles a missing path; status line shown and absent. Add one runJob case with a removal that throws, checking the job ends `delivered`. Keep the tests fast: no daemon loops with long waits.
- [ ] 1.8 README.md and README.es.md: extend the bullet 'It never overwrites your work' / its Spanish counterpart in 'How it works' / 'Cómo funciona' with one sentence on the background cleanup retry and `zero status`. Add a no-new-heading assertion in test/docs.test.ts that both mention it.
- [ ] 1.9 Update AGENTS.md: one sentence in the `src/line/` entry about `finalizeJob` recording failed removals as `cleanup:<job>` and the daemon's cleanup pass.
- [ ] 1.10 Run `npm run typecheck`, `npx vitest run test/cleanup.test.ts test/docs.test.ts test/daemon.test.ts`, and `npm run build`.

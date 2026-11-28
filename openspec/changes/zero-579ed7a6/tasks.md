# Tasks

## 1. Implementación

- [x] 1.1 In test/automerge-conflicts.test.ts and test/conflict-agents.test.ts, add a module-level `vi.setConfig({ testTimeout: 180_000 })` next to the existing afterEach (`vi` is already imported). Add a short comment that these suites drive many real git clones and merges and passed the 60 s limit when the whole suite ran in parallel on Windows. Change nothing else in those files.
- [x] 1.2 In test/helpers.ts, extract and export a `removeTempDir(dir, rm = rmSync)` helper. It calls `rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })`. On an error whose code is EBUSY, EPERM or ENOTEMPTY it writes `console.warn` with the folder and the code and returns. Any other error is rethrown. Make `cleanup()` use it for every folder in `dirs`, so one failure does not stop the rest.
- [x] 1.3 Add test/helpers.test.ts (Vitest): check the rm options passed by removeTempDir; check that EBUSY and EPERM produce a warning and no throw (spy on console.warn); check that EACCES and an error without a code are rethrown; check that cleanup() removes a real tempDir() with files in it, and that a failing first folder still lets a second one go (inject the failure through removeTempDir, or test the loop with two calls); check by reading the source that both conflict test files set testTimeout >= 180000.
- [ ] 1.4 Run `npm run typecheck` and `npx vitest run test/helpers.test.ts test/automerge-conflicts.test.ts test/conflict-agents.test.ts`. Then run `npm test`.

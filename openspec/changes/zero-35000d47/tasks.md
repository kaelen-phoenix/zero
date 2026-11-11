# Tasks

## 1. Implementación

- [ ] 1.1 test/panel-line.test.ts line ~405: change `open(ctx, { watchMs: 1000 })` to `open(ctx, { watchMs: 100 })` in 'pushes the new fragment within 2 s when a job moves to the next station'. Keep `stream.until(() => stream.data.length > 1, 2000)` and `expect(took).toBeLessThan(2000)`.
- [ ] 1.2 test/panel-line.test.ts line ~61: raise the default `ms` of the `until` helper in `events()` from 2000 to 10000 and update its doc comment. These waits only wait for readiness (first fragment, new job row, stream end); the measured 2 s wait passes 2000 explicitly.
- [ ] 1.3 Check that no other test in the file depends on the old 2000 ms default as an assertion. Wall-clock checks such as the shutdown `toBeLessThan(2000)` and the `wait(300)` no-data check stay as they are.
- [ ] 1.4 Run `npx vitest run test/panel-line.test.ts` and `npm run typecheck`. Do not touch src/.

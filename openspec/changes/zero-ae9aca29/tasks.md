# Tasks

## 1. Etapa 1: Results matched to their switch, machine retries and clean state on the daemon side

- [ ] 1.1 Add the OpenSpec change for factory-daemon with all the requirements.
- [ ] 1.2 Add `machine?: boolean` to `SwitchResult` (type only) and `retry`/`head` to `SelfUpdateState`; add `isMachineFailure` and the retry/defer logic (1 h doubling to 24 h).
- [ ] 1.3 Rework `importSwitchResult`: apply only a matching result, history-only for others, a late `updated` clears `failed`/`retry`, remove only the result's own prepared folder, stale verdict through the retry path (with an injectable 'switch still running' check, false by default in this stage).
- [ ] 1.4 Rework `selfUpdateCheck`/`due`: retry due time, HEAD change makes it due, clean `{status, checkedAt, head}` when tip === head, `ready` whose `to` is HEAD goes back to clean idle, a machine preparation failure becomes a retry.
- [ ] 1.5 Make the daemon's `switchVersion` launch failure use the same classification.
- [ ] 1.6 Tests in test/self-update.test.ts and test/self-update-switch.test.ts for these behaviours; adjust the stale test's expectations.

## 2. Etapa 2: Switch lock, machine flag in the switch and result before cleanup

- [ ] 2.1 In src/self-update-switch.ts add the switch lock (built-ins only) behind `SwitchDeps`; `runSwitch` takes it first and refuses without touching anything when it cannot.
- [ ] 2.2 Keep the error code on `renameRetrying`'s error and set `machine: true` on the machine causes in `apply`/`runSwitch`.
- [ ] 2.3 `freshStaging` stops removing leftovers. `runSwitch` lists the leftovers under the lock, writes result.json, releases the lock, then removes only named folders (never the root).
- [ ] 2.4 Wire `switchLockHeldAt` into `importSwitchResult` (no stale verdict while held), `selfUpdateCheck` (no preparation while held) and the daemon's `switchVersion` (no launch while held, logged once).
- [ ] 2.5 Tests for the lock, the machine flag cases, the order of result and cleanup, no root removal, and no second launch; update AGENTS.md; run typecheck, tests and openspec validate.

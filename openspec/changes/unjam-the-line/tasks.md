# Tasks

## 1. Verificación y comandos

- [x] 1.1 `verifyTimeoutMs` and `localCommands` in `src/line/pace.ts`; `lines[].verifyTimeoutMinutes` and `commandConcurrency` in `src/config.ts`.
- [x] 1.2 `verifyChange` takes the limit per command (`timeoutFor`), records `zero.timeout_ms` and `zero.run_ms`, and names the limit and the option when it is reached.
- [x] 1.3 The runner's local `shell` goes through `localCommands`; `prepareWorkCopy` tries a failed setup once more in a fresh copy.
- [x] 1.4 `machineTrouble` in `src/line/verify.ts`: a failed verify command that reads like the machine is run once more.

## 2. Procesos que quedan vivos

- [x] 2.1 `killTree` and `killLeftovers` in `src/leftovers.ts`; `sh` and `runProcess` kill the whole tree.
- [x] 2.2 `removeWorkCopy` kills what runs from a copy it cannot remove, then tries again.

## 3. Fusión automática

- [x] 3.1 `MergeApi.behind`, `updateBranch` and `rerun` (optional), `Check.run`, `PullRequestState.base`.
- [x] 3.2 `unblock` in `src/line/automerge.ts`: refresh behind pull requests one per repository at a time, at most 3 times each; run failed runs again once per tip.

## 4. Registro

- [x] 4.1 `emit` in `src/log.ts` never throws; `guardLogStreams` in `runDaemon`.

## 5. Pruebas y documentación

- [x] 5.1 `test/pace.test.ts` and `test/automerge-unblock.test.ts`.
- [x] 5.2 README.md, README.es.md and AGENTS.md.

# Tasks

## 1. Etapa 1: Config, version and records

- [ ] 1.1 src/config.ts: add strict `selfUpdate` to FactorySchema (`enabled` false, `remote` 'origin', optional `branch`, `startTimeoutSeconds` int ≥10 default 120), prefaulted to {}.
- [ ] 1.2 src/cli.ts: `zero --version` (also `-v`) printing `zero <package.json version>` plus the short commit from `git rev-parse HEAD` in the install folder when it works; handled before `openFactory`.
- [ ] 1.3 Create src/self-update.ts: `installFolder(entry = process.argv[1])` (the parent of the `dist` holding cli.js), kv keys `self-update:state` (`{status: 'idle'|'ready'|'switching', from?, to?, dir?, checkedAt?, problem?, failed?: string[]}`) and `self-update:history` (last 20 `{from, to, at, outcome: 'updated'|'rolled-back'|'failed', reason?}`), `readSelfUpdate`/`recordSelfUpdate` that log store failures instead of throwing.
- [ ] 1.4 Write the OpenSpec change (proposal, tasks, spec delta).
- [ ] 1.5 Tests in test/self-update.test.ts: schema defaults and the refusal of unknown keys; `--version` output; history capped at 20.

## 2. Etapa 2: Detection and side preparation

- [ ] 2.1 src/self-update.ts: `SelfUpdateDeps` {git: GitRunner, npm(args, cwd), node(args, cwd), now}. Write `selfUpdateCheck(ctx, deps)` that returns at once unless enabled and runs when 24 h have passed since `checkedAt` or a job of an install-folder line (same `realpathSync` of `line.repo`) has `automerge:<job>` status `merged` after `checkedAt`.
- [ ] 2.2 Guards: the folder is the root of its own git repository (`rev-parse --show-cdup` empty), it is on the configured branch, and `status --porcelain --untracked-files=no` is empty. Then `fetch <remote> <branch>`, the tip through `rev-parse FETCH_HEAD`, and `merge-base --is-ancestor HEAD <tip>`. A problem is stored and logged only when it differs from the stored one. A tip already in `failed` is skipped.
- [ ] 2.3 Preparation: `lockProblemAt(git, install, tip)`; a fresh `<ZERO_HOME>/self-update/<short sha>` made with `git clone --no-hardlinks --no-local <install>` plus `checkout --detach <tip>`; `npm ci --ignore-scripts` (through `runNpm`/`npmCiArgs` in production), `npm run build`, `node dist/cli.js --version` and `node dist/cli.js self-update check` (a new hidden CLI subcommand that only runs `factoryConfig(home)` and exits 0). On failure, push the tip to `failed`, add a `failed` history entry, warn once and remove the folder. On success, set state `ready`.
- [ ] 2.4 src/daemon.ts: a background `checkSelfUpdate` pass following the INTAKE_MS / in-flight / `.catch(log.warn)` pattern, awaited in the final `finally`. Add `DaemonOptions.selfUpdate?: SelfUpdateDeps`. It is off in `once` runs unless injected.
- [ ] 2.5 Tests with fake git and npm: off does nothing; local changes; diverged; up to date; daily throttle; recheck after a merge; bad lock stops before npm; build failure recorded once and not retried; success gives `ready`; the install folder is never written.

## 3. Etapa 3: Switch process and restart with rollback

- [ ] 3.1 Create src/self-update-switch.ts, importing only `node:` modules (node:sqlite for the lock check, mirroring `daemonLockHeld`). `runSwitch(plan, deps)` with plan {home, install, prepared, from, to, branch, timeoutMs, log}: - wait up to 60 s for the lock to be released; - move the install folder's `dist` and `node_modules` to `<ZERO_HOME>/self-update/previous`, then move in the prepared ones (copy when a rename gives EXDEV); - run `git merge --ff-only <to>` in the install folder; - launch `node <install>/dist/cli.js start` detached, with the daemon log as stdio and ZERO_HOME set; - poll the lock until `timeoutMs`. On timeout: - kill the started tree (taskkill /T /F, or the process group); - put the previous `dist`/`node_modules` back; - `git reset --keep <from>`; - launch the previous version and wait for its lock. It writes `<ZERO_HOME>/self-update/result.json` with from, to, at, outcome and reason. A main guard runs it when invoked with a plan file path.
- [ ] 3.2 src/self-update.ts: `launchSwitch(ctx, state)` copies `dist/self-update-switch.js` to `<ZERO_HOME>/self-update/switch.mjs`, writes `plan.json`, and spawns `process.execPath switch.mjs plan.json` detached and unref'd, like `ensureDaemon`. It is injectable.
- [ ] 3.3 src/daemon.ts: while state is `ready`, skip starting queued jobs (log once). When `running.size === 0`, set state `switching`, call the launcher, set SHUTDOWN_KEY and let the loop stop as usual. At daemon start (after the lock), `importSwitchResult(ctx)` moves result.json into the history and resets the state to `idle`. On `rolled-back`, add the target to `failed`.
- [ ] 3.4 Tests: `runSwitch` with fake fs, git, launch and lock (success; rollback on timeout with kill, restore, reset and relaunch); the daemon with an injected ready state does not start a queued job while one is running, and launches once and stops when free; importing a result.

## 4. Etapa 4: Visibility, docs and ADR

- [ ] 4.1 src/app.ts: add `selfUpdate?: {last?: HistoryEntry; problem?: string; ready?: {from, to}}` to `FactoryStatus` (only when enabled or there is history). src/format.ts: add a `Autoactualización:` line in `formatStatus` (updated `de <from> a <to> el HH:MM`; `volvió a la versión anterior <from> (no arrancó <to>)`; or the problem). src/panel/html.ts: show it as a muted paragraph in the first card of `overviewPage`. src/townhall/briefing.ts: a new trailing optional parameter fed from `briefing()` in app.ts, listing rollbacks and failures in the decisions list.
- [ ] 4.2 docs/adr/0004-autoactualizacion.md: the decisions (off by default and only from the file, side preparation, a separate switch process with built-ins only, the lock as proof of start, rollback, and no retrying a failed commit).
- [ ] 4.3 README.md and README.es.md: a section on self-update with the same structure and code block (`selfUpdate: { enabled: true }`). Extend test/docs.test.ts to check both mention `selfUpdate`, and keep test/wording.test.ts passing.
- [ ] 4.4 AGENTS.md: a Layout entry for src/self-update.ts and src/self-update-switch.ts.
- [ ] 4.5 Tests: status and panel lines shown after a rollback and absent when off; a briefing section. Run `npm run typecheck`, the new and touched test files, `npm run build` and `npx openspec validate --all`.

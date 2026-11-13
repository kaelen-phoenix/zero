# Tasks

## 1. Implementación

- [ ] 1.1 Run `git merge origin/zero/7dd6e0f1` in the job's work copy (do not push to zero/7dd6e0f1, since a job cannot push to another job's branch). If origin/zero/7dd6e0f1 is missing, fetch it first.
- [ ] 1.2 Resolve src/config.ts: keep main's top-level keys (autostart and the rest) and add the PR's strict `selfUpdate` object.
- [ ] 1.3 Resolve src/state/store.ts: keep main's methods and add the PR's `kvUpdatedAt`.
- [ ] 1.4 Resolve src/daemon.ts: keep main's imports, DaemonOptions (install, killLeftovers, billing, alerts, ...) and passes, and add the PR's self-update import, the `selfUpdate`/`launchSwitch` options, `importSwitchResult` at start and on each loop, `checkSelfUpdate`, `switchVersion`, the `selfReady` gate on starting jobs and idle passes, and `await selfChecking` on exit.
- [ ] 1.5 Resolve src/app.ts: keep main's FactoryStatus fields (install, jams, daemon, ...) and add `SelfUpdateStatus`/`selfUpdateStatus` and `FactoryStatus.selfUpdate`. In `briefing`, call `renderBriefing(..., status.outages, status.billing, status.jams, status.install, selfUpdates)`.
- [ ] 1.6 Resolve src/townhall/briefing.ts: the signature ends `jams = [], install?: InstallFreshness, selfUpdates: SelfUpdateEntry[] = []`. Keep both sets of imports and both the Trabas/Instalación sections and the Autoactualización lines.
- [ ] 1.7 Resolve src/format.ts: merge the import lists (installLine/jamLine plus SelfUpdateStatus/SelfUpdateEntry), keep main's install and jams lines in formatStatus, and keep the PR's `selfUpdateLines`/`selfUpdateEntryText`.
- [ ] 1.8 Resolve src/cli.ts (main's commands such as `autostart`, `fusionar`, `reintentar` and `simulacro`, plus the PR's `--version`/`versionText` and the hidden `self-update check`) and src/panel/html.ts (main's summary lines plus the PR's selfUpdateLines).
- [ ] 1.9 Resolve AGENTS.md, README.md and README.es.md by keeping both sides' bullets and sections, with the same structure in both READMEs.
- [ ] 1.10 Rename docs/adr/0004-autoactualizacion.md to docs/adr/0005-autoactualizacion.md, set its header to `# ADR 0005 — …`, and update references in openspec/changes/zero-7dd6e0f1/tasks.md, AGENTS.md and the READMEs if any.
- [ ] 1.11 Check the PR's src/package-install.ts exports (`findGit`, `runProcess`) against main's version of that file, and the PR's tests against any helper signatures main changed (for example renderBriefing positional arguments or FactoryStatus fixtures in tests that build a full status).
- [ ] 1.12 Run `git grep -nE '^(<<<<<<<|>>>>>>>)'` and expect no output. Then run `npm run typecheck`, `npm test` and `npx openspec validate --all` and fix any failures without dropping either side's behaviour.
- [ ] 1.13 Commit the merge (it keeps both parents).

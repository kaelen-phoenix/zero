# Tasks

## 1. Etapa 1: Versiones liberadas y `zero liberar`

- [x] 1.1 Add src/releases.ts (RELEASE_TAG, parsing and numeric ordering of `ls-remote --tags` output with peeled lines, newest release, next patch, listReleases through a GitRunner) and the OpenSpec change; unit tests.
- [x] 1.2 Add the release operation: fetch the remote's base branch with --no-tags, resolve commit and version, run every refusal, then `git push --no-verify <remote> <sha>:refs/tags/vX.Y.Z` without force; injectable git and confirm; tests against real bare repositories.
- [x] 1.3 Add `zero liberar [<commit>] [<versión>] [--line] [--yes]` to src/cli.ts with its usage text.

## 2. Etapa 2: Canal en el archivo y comprobación por canal

- [x] 2.1 Add optional `channel` to selfUpdate in src/config.ts.
- [x] 2.2 Make selfUpdateCheck resolve its target by channel (branch tip, or the newest release inside the tracked branch), record `channel` in the state only when set, drop a ready version of another channel, and record the look in a kv of its own, refreshed by importSwitchResult; split looking from preparing for `enabled: false`; hourly due in estable.
- [x] 2.3 Make the daemon's checkSelfUpdate run when `enabled` or `channel` is set, and selfReady require the state's channel to match the configured one.
- [x] 2.4 Make checkInstall leave out `behind` with channel estable, record the channel and look again when it changes; check status, briefing and unjam.

## 3. Etapa 3: Actualización a pedido: daemon y `zero actualizar`

- [ ] 3.1 Add the request and run record (kv) to src/self-update.ts, requestUpdate and waitUpdate in src/app.ts, an on-demand path in selfUpdateCheck that ignores `enabled`, `failed` and `retry`, an `onDemand` mark on the state so selfReady works with `enabled: false`, and closeInterruptedUpdate at daemon start; a pending request skips the INTAKE_MS throttle.
- [ ] 3.2 Add `zero actualizar` to src/cli.ts with its usage text.

## 4. Etapa 4: Estado, panel y chat

- [ ] 4.1 Extend selfUpdateStatus, selfUpdateLines/formatStatus and the panel summary with channel, current version, available version and request, all from the record.
- [ ] 4.2 Add the `zero_update` tool with `delicate`, its RemoteAction with description and confirmation, its bullets in both READMEs (test/docs.test.ts needs them), and update test/interface.test.ts and test/mcp-remote.test.ts.
- [ ] 4.3 Add the panel's `Actualizar ahora` form and POST route with session and same-origin tests.

## 5. Etapa 5: Paquetes de git en el canal estable o fijados a una etiqueta

- [ ] 5.1 Add `channel: estable` to PackageEntrySchema with its refusals; resolve the newest release in packageAddGit, planGitUpdate and packageUpdatesPass; record the release version next to the seen commit; never move a package back.
- [ ] 5.2 Add `--canal estable` to `zero package add` and `--etiqueta` to `zero package update`, writing channel, source reference and commit through editConfig.
- [ ] 5.3 Show channel, pin, current and available version in packageList, formatPackages and packagesPage.

## 6. Etapa 6: Actualización automática de los paquetes estables

- [ ] 6.1 Add the daemon's automatic update of stable packages: an injectable launcher that starts `cli.js package update <name>` detached without a terminal, a kv record per package with the release attempted, and no job starts while it runs.
- [ ] 6.2 Tell in packageList and status the release that was attempted and not applied.

## 7. Etapa 7: Documentación

- [ ] 7.1 Write the README sections in both languages, ADR 0010, docs/agents/self-update.md, packages.md, panel.md and daemon.md, and extend test/docs.test.ts.

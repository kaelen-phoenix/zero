# Proposal

## Why

You can turn on `selfUpdate: { enabled: true }` in the factory file. It is off by default, and no chat tool can change it. Once it is on, zero updates its own installation (the folder that `dist/cli.js` runs from): - **When it checks:** after a pull request of the zero line merges, and once a day. - **How it updates:** only by fast-forward from the configured remote. If the install folder has local changes in tracked files, it warns and does nothing. - **Preparing the new version:** it builds it in a separate folder under ZERO_HOME, without touching the version that is running: `npm ci --ignore-scripts` with the same lock rules as packages, then `npm run build`, then a quick smoke test (`node dist/cli.js --version` and loading the factory file). If any step fails, it stays on the current version, warns once and doesn't try that commit again. - **Switching:** when the new version is ready, the factory stops starting new jobs and waits until none are running. Then a small separate process, which survives the shutdown, does the switch: it waits for the daemon to stop, swaps the build in, starts the new daemon the same way `zero start --detach` does and checks that it takes the lock. When the new daemon starts, the panel and the tunnel come back with it, and queued jobs carry on from their checkpoints. - **Going back:** if the new daemon doesn't take the lock in time, the switch process restores the previous version, starts it and leaves a warning in `zero status`, the panel and the briefing. - **Records:** every attempt is recorded: from which version to which, when, and whether it rolled back. Installed packages (like ~/.zero/plus) are not part of this change. Job 724cecae did not add package auto-update after all: it only shipped the work-copy cleanup and left package auto-update as pending work. So that part is left as a follow-up that should reuse this same machinery.

## What Changes

- The factory updates its own installation after its changes merge
- Supuesto: Assumption: the install folder is the parent of the `dist` folder holding `process.argv[1]`, which is how site/install.sh and install.ps1 lay it out. A run from `tsx src/cli.ts` (dev) has no dist: self-update must then record a problem and do nothing.
- Supuesto: Assumption: the 'zero line' is any line whose `repo` resolves to the install folder. If the person in charge runs the line from a different clone, only the daily check applies.
- Supuesto: Assumption: 'at a checkpoint' is read as: stop starting new jobs and switch once none are running. A long job delays the switch, and the queue waits meanwhile. The spec does not cut running jobs.
- Supuesto: The prepared folder lives under ZERO_HOME, which may be on another volume than the install folder. Renames can then fail with EXDEV, and the copy fallback is slower. node_modules built in the side folder must work after being moved: there are no install scripts, and @napi-rs/keyring ships prebuilt binaries.
- Supuesto: On Windows, replacing `dist`/`node_modules` can fail with EBUSY if another zero process (an MCP server started by a chat client, the panel or the CLI) still has files open. The switch must then roll back cleanly rather than leave a half-swapped folder.
- Supuesto: `git reset --keep <from>` on rollback moves the local install branch back. No remote history is touched. The failed target is then remembered so it is not retried in a loop.
- Supuesto: The new daemon taking the lock is used as proof that it started. A daemon that takes the lock and then crashes later is not rolled back.
- Supuesto: The request says job 724cecae 'already adds' package auto-update. The code and openspec/changes/zero-724cecae say otherwise (it only did work-copy cleanup). Package auto-update (~/.zero/plus) is therefore left as a follow-up instead of being duplicated or guessed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: The factory updates its own installation after its changes merge

## Impact

Generado por zero para el trabajo 7dd6e0f1.

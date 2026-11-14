# Spec Delta

## ADDED Requirements

### Requirement: The self-update switch stages and checks the new build before touching the install
Before moving anything out of the install folder, the switch MUST put the prepared `dist` and `node_modules` in a staging folder inside the install folder (`<install>/.zero-switch/new`, on the same volume as the install). It SHALL compare the staged files (relative paths and sizes) with the prepared ones listed before the move. When a part is missing or the lists differ, it SHALL leave the install folder's `dist` and `node_modules` untouched and end `failed` with a reason naming the part.

#### Scenario: Incomplete staged copy
- **WHEN** the injected copy drops a file of node_modules while staging
- **THEN** runSwitch returns outcome `failed` with a reason that names node_modules, the install folder's dist/cli.js and node_modules still hold the old content, no git merge is run and result.json holds that outcome

#### Scenario: Complete staged copy
- **WHEN** staging copies every file
- **THEN** the switch goes on to swap the parts and ends `updated` when the new daemon takes the lock

### Requirement: Install parts are swapped only by same-volume renames
The switch MUST move the install folder's current `dist` and `node_modules` aside only by renaming them into `<install>/.zero-switch/old`, and the staged parts into place only by renaming. It SHALL NOT copy and delete the install folder's own parts across volumes, nor delete them, before the new daemon has taken the lock.

#### Scenario: Prepared folder on another volume
- **WHEN** renames across the home and the install folder fail with EXDEV but renames inside the install folder succeed
- **THEN** the switch ends `updated`, the install folder holds the new build, and the old build ends up in `<ZERO_HOME>/self-update/previous`

#### Scenario: Old build stays in place until the start is confirmed
- **WHEN** the new daemon does not take the lock in time
- **THEN** the old dist and node_modules are renamed back from `.zero-switch/old`, the outcome is `rolled-back` and the install folder holds the old content

### Requirement: Locked folders are retried and then given up cleanly
When renaming a part fails with EBUSY, EPERM, EACCES or ENOTEMPTY, the switch MUST try again several times with a growing wait through `deps.sleep`. If it still fails, it SHALL put back every part it already moved, leave the part that failed where it was, and end `failed` with a reason naming the part, the error code and the hint that another process (for example the chat's MCP server) may have its files open.

#### Scenario: Transient lock
- **WHEN** renaming the install folder's node_modules fails with EBUSY twice and then succeeds
- **THEN** the switch ends `updated` and the new node_modules is in the install folder

#### Scenario: Persistent lock
- **WHEN** renaming the install folder's node_modules always fails with EPERM
- **THEN** runSwitch returns `failed` with a reason containing `node_modules` and `EPERM`, the install folder's dist/cli.js and node_modules hold the old content, no merge is run, the previous daemon is launched and result.json holds that outcome

### Requirement: The installed copy must run before the update counts
After the swap and before fast-forwarding the branch and launching the new daemon, the switch MUST run `node <install>/dist/cli.js --version` from the install folder through an injected `SwitchDeps` check, with a time limit. If the check fails, it SHALL restore the previous dist and node_modules (and commit, if it was merged) and end `failed` with a reason that includes the end of the command's error output.

#### Scenario: Version check fails
- **WHEN** the injected check rejects with `ERR_MODULE_NOT_FOUND @napi-rs/keyring`
- **THEN** runSwitch returns `failed` with a reason containing `ERR_MODULE_NOT_FOUND`, the install folder holds the old dist and node_modules, no `merge --ff-only` is run, the previous daemon is launched and result.json holds that outcome

#### Scenario: Version check passes
- **WHEN** the injected check resolves
- **THEN** it was called with the install folder's dist/cli.js, and the switch merges and launches the new daemon

### Requirement: The switch always leaves a result
The switch MUST write `<ZERO_HOME>/self-update/result.json` with outcome `updated`, `rolled-back` or `failed` and a reason for every outcome except `updated`. It SHALL do so even when a dependency throws unexpectedly (launch, git, filesystem, restore), and it SHALL retry the write a few times before giving up, so that importSwitchResult records an entry in `self-update:history`.

#### Scenario: Launch throws
- **WHEN** the injected launch throws synchronously after a failed swap
- **THEN** runSwitch resolves (does not reject) with outcome `failed`, and result.json exists with that outcome and a reason

#### Scenario: Result write fails once
- **WHEN** the injected writeFile fails the first time for result.json and succeeds afterwards
- **THEN** result.json exists with the outcome

#### Scenario: History entry
- **WHEN** importSwitchResult runs after a switch that ended `failed` for a locked node_modules
- **THEN** self-update:history has a `failed` entry whose reason names node_modules

### Requirement: The staging folder is cleaned up and ignored by git
The switch MUST remove `<install>/.zero-switch` when it ends, as best effort: a leftover it cannot remove is only logged, and a leftover from an earlier switch is removed (or replaced by a fresh name) before staging. The repository's `.gitignore` SHALL ignore `.zero-switch/`.

#### Scenario: Cleanup after success
- **WHEN** a switch ends `updated`
- **THEN** `<install>/.zero-switch` does not exist

#### Scenario: Leftover from an earlier switch
- **WHEN** `<install>/.zero-switch/new/dist` exists before the switch starts
- **THEN** the switch still ends `updated` with the new build in place

#### Scenario: Gitignore
- **WHEN** reading .gitignore
- **THEN** it contains a line `.zero-switch/`

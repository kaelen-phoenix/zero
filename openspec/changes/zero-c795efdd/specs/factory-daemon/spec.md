# Spec Delta

## ADDED Requirements

### Requirement: Releases are version tags
A released version SHALL be a git tag named exactly `vX.Y.Z` (three non-negative integers) on the repository's remote, read with `ls-remote` using the peeled commit of annotated tags and ordered numerically; any other tag MUST be ignored.

#### Scenario: Numeric order and noise
- **WHEN** the remote has the tags v1.2.0, v1.10.0, v2.0.0-rc1, nightly and an annotated v1.9.0
- **THEN** the releases read are 1.2.0, 1.9.0 (with its peeled commit) and 1.10.0, and the newest is 1.10.0

#### Scenario: No releases
- **WHEN** the remote has no tag of that form
- **THEN** the list is empty and nothing throws

### Requirement: zero liberar publishes a release
`zero liberar` SHALL push a new `vX.Y.Z` tag to the remote for a commit contained in the remote's base branch: given a version it tags the tip of that branch; given a commit (7 to 64 hex characters) it tags that commit with the next patch of the newest release, or, without releases, the `version` in that commit's package.json or 0.1.0; given both it uses both. It targets zero's install folder (`selfUpdate.remote` and `branch`), or with `--line` that line's repository, remote and base branch.

#### Scenario: By commit
- **WHEN** the remote has v1.2.0 and `zero liberar <sha>` is confirmed for a later commit of the base branch
- **THEN** the remote has v1.2.1 pointing to that commit and the output names the version and the short commit

#### Scenario: By version
- **WHEN** `zero liberar 1.3.0` is confirmed
- **THEN** the remote has v1.3.0 pointing to the tip of the base branch

#### Scenario: Another line
- **WHEN** `zero liberar 0.2.0 --line paquete --yes` runs
- **THEN** the tag is pushed to that line's remote and zero's own remote gets none

#### Scenario: Nothing local changes
- **WHEN** a release is published
- **THEN** the repository's working tree, branch, HEAD and local tags are the same as before

### Requirement: zero liberar asks first and refuses unsafe releases
`zero liberar` MUST show what it would publish and push nothing without a yes (or `--yes`), and MUST refuse with a reason in Spanish, pushing nothing, when the version already exists, is not higher than the newest release, the commit is not in the remote's base branch, the commit is the newest release's or does not descend from it, or the repository has no such remote. It MUST never force or move a tag, and no chat tool nor panel route SHALL release.

#### Scenario: Not confirmed
- **WHEN** the confirmation answers no, or there is no terminal and no `--yes`
- **THEN** no push runs and the output says nothing was published

#### Scenario: Unmerged commit
- **WHEN** the commit exists only on another branch
- **THEN** it is refused and no tag is pushed

#### Scenario: Existing version
- **WHEN** `zero liberar 1.2.0` runs and v1.2.0 exists
- **THEN** it is refused and v1.2.0 still points to the same commit

#### Scenario: Going back
- **WHEN** the commit is an ancestor of the newest release
- **THEN** it is refused saying installations only move forward

#### Scenario: Terminal only
- **WHEN** the MCP tool list and the panel's POST routes are inspected
- **THEN** none of them publishes a release

### Requirement: The channel is chosen in the factory file
The strict `selfUpdate` object SHALL accept an optional `channel` of `estable` or `ultimo`, with no default, and no chat tool nor panel route MUST write it.

#### Scenario: Absent
- **WHEN** a factory file without `selfUpdate` is parsed
- **THEN** the result is exactly `{ enabled: false, remote: 'origin', startTimeoutSeconds: 120 }`

#### Scenario: Valid
- **WHEN** `selfUpdate: { channel: estable }` is parsed
- **THEN** channel is `estable` and enabled is false

#### Scenario: Invalid
- **WHEN** `selfUpdate: { channel: beta }` is parsed
- **THEN** the file fails validation

### Requirement: Without a channel nothing changes
With `channel` absent and no update requested, the checks, their moments, what gets prepared and switched, the stored state, and the text of status, panel and briefing MUST be the same as before this change.

#### Scenario: Off
- **WHEN** the daemon's self-update pass runs with `channel` absent, `enabled: false` and no request
- **THEN** no git command runs and no self-update record is written

#### Scenario: On
- **WHEN** `enabled: true` without channel and the remote branch moved ahead
- **THEN** the branch tip is prepared as today, even with no release

#### Scenario: Nothing shown
- **WHEN** `channel` is absent and self-update never ran
- **THEN** status and panel contain neither `Canal` nor `Autoactualización`

### Requirement: The stable channel only takes releases
With `channel: estable`, the check SHALL target only the newest release's commit, and MUST NOT prepare or switch to any other commit; a release that is not in the remote's tracked branch, or is not a fast-forward from HEAD (unless HEAD already contains it), MUST be recorded as a problem. The rest of the preparation and switch guarantees stay the same.

#### Scenario: Unreleased main is ignored
- **WHEN** the remote branch is ahead of HEAD and the newest release is HEAD
- **THEN** nothing is prepared and the state is up to date

#### Scenario: New release
- **WHEN** `enabled: true`, HEAD is v1.0.0 and the remote has v1.1.0 and a later unreleased commit
- **THEN** the prepared `to` is v1.1.0's commit, not the branch tip

#### Scenario: Tag outside the branch
- **WHEN** the newest tag points to a commit that is not in the remote's branch
- **THEN** nothing is prepared and a problem names that version

#### Scenario: Ahead of the releases
- **WHEN** HEAD already contains the newest release plus unreleased commits
- **THEN** nothing is prepared and no problem is recorded

### Requirement: A prepared version of another channel is dropped
The state SHALL record the channel a version was prepared for (absent means `ultimo`), and the daemon MUST NOT switch to a prepared version whose channel is not the configured one; it SHALL drop it with its prepared folder.

#### Scenario: From ultimo to estable
- **WHEN** a version prepared without channel is `ready` and the file now says `channel: estable`
- **THEN** the switch launcher is never called, jobs start as usual, the state goes back to idle and the prepared folder is removed

### Requirement: With a channel and no automatic updates, the factory only looks
With `channel` set and `enabled: false`, the daemon SHALL look for the channel's newest version and record it without preparing or switching anything; in `estable` a look is due at most once an hour, in `ultimo` at the moments of today.

#### Scenario: Only looks
- **WHEN** `channel: estable`, `enabled: false` and a newer release exists
- **THEN** the available version is recorded, npm and node are never called and the state is not `ready`

#### Scenario: Hourly
- **WHEN** two passes run 30 minutes apart in `estable` with HEAD unchanged and no request
- **THEN** the remote is asked once

### Requirement: A stable installation is not behind for unreleased work
With `channel: estable`, the installation check MUST NOT count commits of the tracked branch as missing, neither in status, panel and briefing nor as a jam for the unjam station, while a stale build is still told; a change of channel SHALL make the recorded check due again.

#### Scenario: Unreleased commits
- **WHEN** `channel: estable` and the install folder is 3 commits behind its upstream
- **THEN** there is no `Instalación atrasada` line and unjam gathers no installation jam

#### Scenario: Stale build
- **WHEN** `channel: estable` and a file under src/ is newer than dist/cli.js
- **THEN** the `Instalación atrasada` line names only the build

#### Scenario: Channel changed
- **WHEN** the last record was made without channel 10 minutes ago and the file now says `estable`
- **THEN** the next pass records again

### Requirement: Update on request
The daemon SHALL serve a recorded update request in its background pass, without waiting for the daily check and whatever `enabled` says: it looks at the channel's newest version (`ultimo` when absent), prepares it and, once ready, switches when no job runs, with the same preparation, switch and rollback as the automatic update. The request MUST be consumed once, and its run record SHALL say how it ended: `ready`, `up-to-date`, `failed` with its reason, or `stopped`.

#### Scenario: With automatic updates off
- **WHEN** `enabled: false`, a request is pending and a newer version exists
- **THEN** it is prepared, the state becomes `ready` and, with no job running, the launcher is called once

#### Scenario: Jobs running
- **WHEN** the requested version is ready while a job runs
- **THEN** the launcher is not called and no queued job starts until it ends

#### Scenario: Nothing new
- **WHEN** a request is pending and HEAD is already the channel's newest version
- **THEN** the record ends `up-to-date` and nothing is prepared

#### Scenario: Already ready
- **WHEN** a version of the configured channel is `ready` and a request arrives
- **THEN** that version is switched to, without preparing it again

#### Scenario: Interrupted
- **WHEN** the daemon starts and finds a run record without an end
- **THEN** the record ends `stopped` and the run is not repeated

### Requirement: A request may retry a failed version
An update request SHALL prepare the channel's newest version once even when that commit is among the failed ones or waits for a machine retry, while automatic checks MUST still skip it.

#### Scenario: Asked again
- **WHEN** commit T failed before and a request is pending with T as target
- **THEN** T is prepared once; if it fails again it stays failed and the run record says why

#### Scenario: Automatic
- **WHEN** commit T failed before, and the daily check runs without a request
- **THEN** T is not prepared

### Requirement: zero actualizar
`zero actualizar` SHALL record the request, start the factory if it is off, wait up to 2 minutes for the pass to say what it found and print it (already up to date, preparing which version, why it could not, or still pending), exiting 1 only when refused or failed; it MUST refuse without writing anything when a request is already pending or a switch is under way.

#### Scenario: New version
- **WHEN** the pass finds v1.1.0 while the command waits
- **THEN** the output names v1.1.0 and says it switches when no job is running, and the exit code is 0

#### Scenario: Already pending
- **WHEN** a request is pending and `zero actualizar` runs again
- **THEN** it says so, the pending request is unchanged and the exit code is 1

#### Scenario: Switch under way
- **WHEN** the state is `switching` or the switch lock is held
- **THEN** it is refused with that reason and nothing is recorded

### Requirement: Update from the chat
The MCP server SHALL offer `zero_update`, with no arguments, which records the same request as `zero actualizar` and waits at most the chat's wait; over the remote server it MUST be held for the person in charge to confirm, and a token with only `zero:read` MUST NOT see it.

#### Scenario: Local chat
- **WHEN** `zero_update` is called on the local server
- **THEN** a request is recorded and the answer says what was found or that it is still pending

#### Scenario: Remote chat
- **WHEN** `zero_update` is called over the remote server with `zero:act`
- **THEN** no request is recorded, a pending action is held, and confirming it records the request

#### Scenario: Read only
- **WHEN** a remote token with `zero:read` lists the tools
- **THEN** `zero_update` is not among them

### Requirement: Update from the panel
The panel summary SHALL show, when `channel` is set or self-update is enabled, an `Actualizar ahora` form that posts to a route recording the same request, behind the session and same-origin checks.

#### Scenario: Asked
- **WHEN** an authenticated same-origin POST is sent
- **THEN** a request is recorded and the page redirects to the summary with the request's text

#### Scenario: Refused
- **WHEN** the POST comes without a session or from another origin
- **THEN** it answers 401 or 403 and no request is recorded

#### Scenario: No channel and off
- **WHEN** `channel` is absent and `enabled` is false
- **THEN** the summary has no such form

### Requirement: Status shows channel, version and news
With `channel` set, `zero status` and the panel summary SHALL show the channel, the current version (its release version when HEAD is a release, otherwise the short commit marked as not released in `estable`), and either the newer version available or that there is none, plus a pending or recent update request and its result; they MUST use only what is on record, with no network, and after a switch MUST NOT offer the version just installed.

#### Scenario: New version
- **WHEN** `channel: estable`, HEAD is v1.0.0 and v1.1.0 is recorded as available
- **THEN** status and panel contain `Canal: estable`, v1.0.0 and v1.1.0, with the way to update

#### Scenario: Up to date
- **WHEN** the last look found nothing newer
- **THEN** they show the current version and say there is no new version

#### Scenario: Never looked
- **WHEN** `channel` is set and no look is on record
- **THEN** they show the channel and say it was not checked yet

#### Scenario: Just updated
- **WHEN** a switch result `updated` to v1.1.0 was imported
- **THEN** v1.1.0 is not shown as available

### Requirement: Packages from git can follow the stable channel
A git entry of `packages` SHALL accept an optional `channel: estable`, refused on npm or folder entries and together with a `#reference`; with it, the daily look, `zero package add <source> --canal estable` and `zero package update` MUST take only the newest `vX.Y.Z` release of the package's remote, never the branch tip, refusing with a reason when there is none. `zero package add --canal estable` on a source already declared SHALL only set its channel.

#### Scenario: Install
- **WHEN** the remote has v1.0.0 and later unreleased commits and `zero package add <git> --canal estable` is confirmed
- **THEN** the installed commit is v1.0.0's and the entry has `channel: estable`

#### Scenario: Unreleased commits
- **WHEN** a package at v1.0.0 with `channel: estable` is updated and only unreleased commits are newer
- **THEN** it says it is up to date and its folder does not change

#### Scenario: New release
- **WHEN** v1.1.0 is released and `zero package update <name>` runs
- **THEN** the package moves to v1.1.0 with the same guards, confirmation and way back as today

#### Scenario: No releases
- **WHEN** `--canal estable` is asked on a remote without releases
- **THEN** it is refused and nothing is installed

#### Scenario: Ahead of the newest release
- **WHEN** the installed commit already contains the newest release and is not that release
- **THEN** the package is not moved back and it says why

### Requirement: A package's pin can be moved on request
`zero package update <name> --etiqueta <tag>` SHALL move a git package to that tag of its remote, with the same guards, confirmation and way back as any update, and record the tag as the reference of its source; it MUST refuse an invalid or missing tag, a package that is not from git, one with `channel: estable`, and a call without a name.

#### Scenario: Moves the pin
- **WHEN** a package from `github:c/r#v1.0.0` is updated with `--etiqueta v1.1.0`
- **THEN** its entry has the source with `#v1.1.0` and that tag's commit

#### Scenario: Stays pinned
- **WHEN** a package pinned to `#v1.0.0` is updated without `--etiqueta` and v1.1.0 exists
- **THEN** it says it is up to date and does not move

#### Scenario: Missing tag
- **WHEN** the remote does not have the tag
- **THEN** the update fails and neither the folder nor the factory file changes

### Requirement: Stable packages update themselves only when automatic updates are on
With `selfUpdate.enabled: true`, the daemon SHALL update a git package with `channel: estable` when its look recorded a newer release, by launching the package update as a process of its own once no job runs, no version of zero is ready or switching, and no other package update runs; it MUST NOT start jobs while that process runs, MUST attempt each release at most once, and MUST NOT answer yes to a package that asks for more than before. With `enabled: false`, or without the package's channel, it MUST update no package on its own.

#### Scenario: New release
- **WHEN** `enabled: true`, a stable package has a newer release on record and no job runs
- **THEN** the injected launcher is called once with that package's name

#### Scenario: Job running
- **WHEN** a job is running
- **THEN** the launcher is not called

#### Scenario: Attempted once
- **WHEN** the attempt for that release failed and the daemon passes again, also after a restart
- **THEN** the launcher is not called for that release, and `zero package list` says to apply it by hand

#### Scenario: Asks for more
- **WHEN** the new release declares a new secret and the update runs without a terminal
- **THEN** it is not applied and the package stays on its version

#### Scenario: Off
- **WHEN** `enabled: false` or the entry has no channel
- **THEN** the launcher is never called

### Requirement: Package lists show channel and news
`zero package list` and the panel's packages page SHALL show, for each git package, its channel or pinned reference, its current release version or commit, and the newer version on record, escaping every third-party text in the panel.

#### Scenario: Stable with news
- **WHEN** a package with `channel: estable` is at v1.0.0 and v1.1.0 is on record
- **THEN** both show `estable`, v1.0.0, v1.1.0 and the command to update it

#### Scenario: Pinned
- **WHEN** a package comes from `#v1.0.0` without channel
- **THEN** both show it is pinned to v1.0.0

### Requirement: Channels are documented
Both READMEs SHALL document `channel`, `zero liberar`, `zero actualizar`, `zero_update` and the packages' channel with identical code blocks, keeping `selfUpdate: { enabled: true }`, and the area files and a new ADR MUST describe the decision.

#### Scenario: Both languages
- **WHEN** test/docs.test.ts and test/wording.test.ts run
- **THEN** both READMEs contain `channel: estable`, `zero liberar`, `zero actualizar` and `--canal estable` in code blocks, name `zero_update` in their tool list, and keep the same structure

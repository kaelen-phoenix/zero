# Spec Delta

## ADDED Requirements

### Requirement: Installed copy freshness record
A daemon pass on the intake interval SHALL, at most once per hour, check the installed copy of zero (the folder holding the running dist/cli.js) and store in kv `install:freshness` a record with `checkedAt`, `behind` (commits in the checkout's upstream ref, or `<remote>/<branch>` when no upstream is set, that are not in HEAD, after a best-effort `git fetch`), `staleBuild` (a file under `src/` newer than `dist/cli.js`) and `repository` (owner/repo of the upstream remote when it is on GitHub). A folder that is not a git repository MUST store only a problem and never count as behind.

#### Scenario: Merged commits not installed
- **WHEN** the installation's checkout is 3 commits behind its upstream ref and the pass runs with injected git and clock
- **THEN** kv `install:freshness` holds `behind: 3` and the current `checkedAt`

#### Scenario: Rebuild missing
- **WHEN** a file under src/ has a later modification time than dist/cli.js
- **THEN** the record has `staleBuild: true`

#### Scenario: Hourly at most
- **WHEN** the pass runs twice within one hour
- **THEN** git is asked only on the first run

#### Scenario: Fetch fails
- **WHEN** the fetch fails
- **THEN** the record is still written from the local refs and nothing is thrown

#### Scenario: Not a repository
- **WHEN** the installation folder is not a git repository
- **THEN** the record carries a problem and `formatStatus` shows no warning

### Requirement: Installed copy warning in status and briefing
`zero status` (formatStatus), the panel summary and the briefing MUST show a warning when the freshness record has `behind` > 0 or `staleBuild`. The warning SHALL say how many merged commits are missing or that the build is older than the code, and when it was checked.

#### Scenario: Status warns
- **WHEN** kv `install:freshness` has behind 2
- **THEN** formatStatus output contains a line starting with `Instalación atrasada` that mentions 2 commits

#### Scenario: Briefing warns
- **WHEN** the record has staleBuild true
- **THEN** the briefing has an `## Instalación` section

#### Scenario: Up to date
- **WHEN** behind is 0 and staleBuild is false
- **THEN** neither status nor the briefing mentions the installation

### Requirement: Installed copy as a jam
`collectJams` SHALL add one jam of kind `install` to every non-package line whose GitHub repository equals the freshness record's `repository` while the record says behind or staleBuild, so the unjam station diagnoses why the installed copy is behind.

#### Scenario: Zero's line gets the jam
- **WHEN** a line's remote is owner/zero, and the record has repository owner/zero and behind 4
- **THEN** collectJams for that line includes a jam with id `install` and kind `install`

#### Scenario: Other lines do not
- **WHEN** a line's repository is different
- **THEN** it gets no install jam

### Requirement: Evidence on unjam proposals
Every proposal the unjam station opens MUST carry in its `why`, after the diagnosis, an evidence block that zero computes from the cause's jams and not from the agent: the number of jams, the ids of the jobs, the pull request URLs, and the number of consecutive diagnoses in which the cause appeared (`Cause.seen`, the earlier diagnosis's same-title cause plus one, otherwise 1).

#### Scenario: Evidence lists jobs and pull requests
- **WHEN** a fix cause groups jams job:a, pr:b (url U) and outage:r
- **THEN** the created proposal's why contains `a`, `b`, U and `3 trabas`

#### Scenario: Repeated cause counted
- **WHEN** the earlier diagnosis has a cause of the same normalized title with seen 2
- **THEN** the new cause has seen 3 and the evidence says 3 revisiones

### Requirement: Repeated causes become townhall lessons
After storing a diagnosis, the unjam station SHALL publish one townhall `lesson` for the line for each cause with at least 2 jams or `seen` of at least 2, with the cause title in the topic and the diagnosis plus evidence in the body. A townhall failure MUST be logged and never fail the pass.

#### Scenario: Lesson published
- **WHEN** a diagnosis has a cause grouping two failed jobs
- **THEN** the townhall receives a lesson whose topic contains the cause title

#### Scenario: Single new jam
- **WHEN** a cause has one jam and seen 1
- **THEN** no lesson is published for it

#### Scenario: Townhall down
- **WHEN** publish throws
- **THEN** unjamLine still stores the diagnosis and resolves

### Requirement: Missing-capability proposals
The unjam output SHALL accept action `capability` with a target `line`. Zero MUST keep it only when the target is a configured non-package line and the cause includes at least one `failed-job` jam whose job failed at spec with a reason starting with `El pedido no se puede hacer sin ayuda`. It then opens one unjam proposal on the target line, carrying the request and the original job ids (`forJobs`, a new proposals column), that follows the target line's autonomy through `takeOnItsOwn`. A cause that does not qualify SHALL become `none` with a todo.

#### Scenario: Capability proposed on zero
- **WHEN** a failed job f on line soliloq has reason `El pedido no se puede hacer sin ayuda: falta X` and the agent returns a capability cause for jam job:f with line zero
- **THEN** a pending proposal exists on line zero with origin unjam and forJobs [f], and its why names job f

#### Scenario: Unknown target
- **WHEN** the target line is not configured
- **THEN** no proposal is created and the cause's action is none

#### Scenario: Not a spec refusal
- **WHEN** the cause's only failed-job jam failed at build
- **THEN** no capability proposal is created

#### Scenario: No repeat
- **WHEN** an unjam proposal with the same normalized title is pending on the target line
- **THEN** no second proposal is created and the cause records the existing one

### Requirement: Resend the original request once the capability is in
A daemon pass on the intake interval SHALL resend each original job of an approved capability proposal once (kv `unjam:resent:<job>` = the new job id) after that proposal's job has entered its base branch (delivered in merge mode with a commit, or with MergeState `merged`). The original job MUST still be `failed`. When the target line's repository equals the freshness record's repository, the resend MUST wait until a record checked after the job finished shows behind 0 and no staleBuild. The resend is `requestWork` on the original line with the original request and source.

#### Scenario: Resent after merge
- **WHEN** the capability job is delivered in merge mode with a commit on a line that is not the installation's
- **THEN** one new queued job exists on the original line with the original request, and `unjam:resent:<orig>` holds its id

#### Scenario: Only once
- **WHEN** the pass runs again
- **THEN** no other job is created

#### Scenario: Waits for the installed copy
- **WHEN** the target line is zero's own repository and the freshness record says behind 1
- **THEN** nothing is resent until a later record says behind 0

#### Scenario: Pull request not merged
- **WHEN** the capability job's pull request MergeState is blocked
- **THEN** nothing is resent

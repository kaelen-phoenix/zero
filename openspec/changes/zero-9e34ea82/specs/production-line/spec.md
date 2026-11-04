# Spec Delta

## ADDED Requirements

### Requirement: Opción commitAuthor global y por línea
zero.factory.yaml SHALL accept `commitAuthor` with values `zero` or `owner`, both at the top level (default `zero`) and on each line (optional). A line's effective commit author MUST be the line's value when present, otherwise the global value. Any other value MUST be rejected when the file is parsed.

#### Scenario: Por defecto zero
- **WHEN** parseFactory reads a file without `commitAuthor` anywhere
- **THEN** the effective commit author of every line is `zero`

#### Scenario: Global owner heredado
- **WHEN** the file has `commitAuthor: owner` at the top level and a line without `commitAuthor`
- **THEN** that line's effective commit author is `owner`

#### Scenario: La línea manda
- **WHEN** the file has `commitAuthor: owner` at the top level and a line with `commitAuthor: zero`
- **THEN** that line's effective commit author is `zero`

#### Scenario: Valor inválido
- **WHEN** a line has `commitAuthor: alguien`
- **THEN** parseFactory throws a validation error

### Requirement: Commits de la copia de trabajo con el autor elegido
When a line's effective commit author is `owner`, the commits the factory makes in a job's work copy (specification and build attempts, in both worktree and isolation-box clone copies) SHALL have as author the user.name and user.email that `git config` resolves in the line's repository. Their committer MUST stay `zero <zero@kaelen.invalid>`. When the effective commit author is `zero`, author and committer MUST both be `zero <zero@kaelen.invalid>`, as today.

#### Scenario: Autor dueño, committer zero
- **WHEN** a work copy is opened with author mode `owner` on a temp repo whose local git config has user.name `Dueña` and user.email `duena@example.com`, a file is written and commitAll is called
- **THEN** `git log -1 --format=%an <%ae>|%cn <%ce>` shows `Dueña <duena@example.com>|zero <zero@kaelen.invalid>`

#### Scenario: Autor zero como hoy
- **WHEN** a work copy is opened with author mode `zero` (or no mode) and commitAll is called
- **THEN** both author and committer of the new commit are `zero <zero@kaelen.invalid>`

#### Scenario: Copia en clon de la caja
- **WHEN** a clone copy (openCloneCopy) is opened with author mode `owner` on a repo with a local user.name and user.email, and commitAll is called
- **THEN** the commit author is the repo's configured identity and the committer is zero

### Requirement: Merge de integración con el autor elegido
With `integrate: merge`, the merge commit that integrate makes into the base branch SHALL use the line's effective commit author as its author, with committer `zero <zero@kaelen.invalid>`. This applies whether the base branch is checked out in the owner's copy or merged in a temporary worktree.

#### Scenario: Merge con autor dueño
- **WHEN** mergeIntoBase runs for a job whose effective commit author is `owner`, on a repo with local user.name/user.email configured
- **THEN** the base branch's new merge commit has the owner's name and email as author and zero as committer

#### Scenario: Merge con autor zero
- **WHEN** mergeIntoBase runs with effective commit author `zero`
- **THEN** the merge commit's author and committer are `zero <zero@kaelen.invalid>`

### Requirement: Sin identidad del dueño no se frena
When the effective commit author is `owner` but git config in the line's repository has no user.name or no user.email, the factory MUST make the commit with the zero identity as author and MUST NOT fail the job for that reason.

#### Scenario: Repo sin identidad
- **WHEN** author mode is `owner`, the repo has no user.name/user.email in any git config level (the test isolates global and system config, for example through GIT_CONFIG_GLOBAL pointing to an empty file and GIT_CONFIG_NOSYSTEM=1), and commitAll is called
- **THEN** commitAll returns true and the commit's author is `zero <zero@kaelen.invalid>`

### Requirement: El email del dueño no se escribe en la fábrica
The owner's identity SHALL be read from git config at commit time. It MUST NOT be written to zero.factory.yaml or required there, and it MUST be passed to git through the environment (GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL), not interpolated into a shell command.

#### Scenario: Archivo sin email
- **WHEN** a factory file with only `commitAuthor: owner` (no name or email) is parsed and a job commit is made on a repo with configured identity
- **THEN** the commit carries the owner's identity, and the parsed config has no name/email fields

### Requirement: Reconocimiento de commits de la fábrica intacto
Detection of reverted night-shift work SHALL keep working when commits are authored by the owner, because it relies on commit messages and recorded commit SHAs, not on authors.

#### Scenario: Revert de merge con autor dueño
- **WHEN** a merge-mode integration is made with author mode `owner` and the base branch then gets `git revert -m 1 <merge sha>`
- **THEN** the existing revert detection (detectReverts / its message matcher) recognises the revert of that commit

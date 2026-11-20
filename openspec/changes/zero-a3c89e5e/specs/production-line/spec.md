# Spec Delta

## ADDED Requirements

### Requirement: Tomar un pull request existente crea un trabajo sobre su rama
`adoptPullRequest(ctx, { line, number, api? })` in src/app.ts SHALL read the pull request through the line's `MergeApi`, fetch its head branch into the line's repository as `refs/heads/<headRef>` at the pull request's head sha, and create one queued job on that line whose `branch` is the head branch, whose `base` is `<remote>/<baseBranch>`, whose `delivery` is `{ mode: 'pull-request', branch, url }` (with `autoMerge` when the line has it), whose `spec` is a valid feasible spec written by zero (not by a model), whose source is `{ kind: 'pull-request', repository, number, url }`, and SHALL store the `prRefreshKey` mark `{ head: <head sha> }` for it.

#### Scenario: Pull request abierto de la misma repo
- **WHEN** a pull-request line with a bare remote under a github.com path has an open pull request #7 whose branch `feature` (pushed by another clone) is not known locally, and adoptPullRequest is called with a fake MergeApi reporting headRef `feature`, the head sha, base `main` and same repository
- **THEN** the line's repository has `refs/heads/feature` at the head sha, one queued job exists with branch `feature`, base `origin/main`, delivery url of #7, source kind `pull-request` with number 7, a spec that passes `specProblems` with no problems, and kv `pr-refresh:<job>` parses to `{ head: <head sha> }`

### Requirement: Respaldo antes de tocar la rama
Before creating the job, `adoptPullRequest` MUST create the local branch `respaldo/pr<N>` at the pull request's head sha in the line's repository. When that branch already exists at another commit, it MUST leave it untouched and create `respaldo/pr<N>-<job id>` instead. It MUST never push a backup or rewrite an existing one.

#### Scenario: Respaldo nuevo
- **WHEN** adoptPullRequest takes pull request #7 and no `respaldo/pr7` exists
- **THEN** `refs/heads/respaldo/pr7` in the line's repository points at the pull request's head sha, and the remote has no `respaldo/pr7` branch

#### Scenario: Respaldo existente no se pisa
- **WHEN** `respaldo/pr7` already exists at an unrelated commit and adoptPullRequest takes #7
- **THEN** `respaldo/pr7` still points at the unrelated commit and `respaldo/pr7-<job id>` points at the head sha

### Requirement: El trabajo mezcla la base, resuelve y empuja a la misma rama sin abrir otro pull request
Running an adopted job with `runJob` SHALL merge the pinned base commit into the pull request's branch, send conflicts to build as for zero's own pull requests, run verify, and on success push to the same remote branch without force only if the remote is still at the recorded head, ending `delivered` with the same delivery and without calling `openPullRequest`.

#### Scenario: PR en conflicto con main
- **WHEN** the adopted branch `feature` and `main` on the remote both changed `shared.txt` differently, the fake build agent resolves `shared.txt` without markers, and the job runs at level L2 (answering approvals when asked)
- **THEN** the job ends `delivered` with the pull request's url, the injected `openPullRequest` was never called, the remote `feature` tip is a merge commit that contains both the old head and the remote `main` commit, `shared.txt` there has no conflict markers, `pr-refresh:<job>` is gone and `respaldo/pr7` still points at the old head

#### Scenario: Rama remota movida
- **WHEN** after adoption someone pushes a new commit to the remote `feature` before the adopted job integrates
- **THEN** nothing is pushed, the job ends `delivered` with its original delivery (as `finalizeJob` does for a refresh), and the local `feature` branch is back at the recorded head

### Requirement: El agente recibe el OpenSpec de la rama como guía del conflicto
When an adopted job's merge gives conflicts, the build feedback SHALL list, in addition to the conflicted files, the `openspec/changes/<name>/` folders the pull request's branch adds or changes relative to the base, describing them as the intent of the pull request to keep while resolving.

#### Scenario: Rama con cambio OpenSpec
- **WHEN** the adopted branch adds `openspec/changes/mi-cambio/proposal.md` and conflicts with main on `shared.txt`
- **THEN** the first build prompt of the job contains `shared.txt` and `openspec/changes/mi-cambio/`

### Requirement: Rechazos antes de escribir nada
`adoptPullRequest` MUST throw an Error with a Spanish reason and MUST NOT create a job, a backup branch, a kv mark or a local branch when any of these holds: the line does not integrate by `pull-request` or its remote is not on GitHub; no GitHub adapter is available; the pull request is not open or is merged; its head repository is not the line's repository (a fork); its base is not the line's `baseBranch`; the head branch name fails `git check-ref-format --branch` or starts with `-`; an unfinished job or a delivered job already uses that branch; the branch is checked out in a worktree (`checkedOutAt`); a local branch of that name exists at a commit other than the pull request's head; or the fetch fails.

#### Scenario: PR de un fork
- **WHEN** the fake MergeApi reports the head repository as `otro/demo` for line repository `kaelen/demo`
- **THEN** adoptPullRequest throws, no job was created and no `respaldo/pr<N>` branch exists

#### Scenario: PR cerrado
- **WHEN** the fake MergeApi reports `open: false`
- **THEN** adoptPullRequest throws and no job exists

#### Scenario: Rama ya de un trabajo
- **WHEN** a queued job already has branch `feature` and adoptPullRequest is asked for the pull request whose head is `feature`
- **THEN** it throws and the job count is unchanged

#### Scenario: Rama local divergente
- **WHEN** the line's repository has a local `feature` branch at a commit other than the pull request's head
- **THEN** it throws, the local `feature` branch still points at its commit and no backup was created

### Requirement: El pedido se presenta como dato de terceros
`requestBlock` in src/line/runner.ts MUST present a job with source kind `pull-request` as built by zero from GitHub pull request #N of the repository, not written by the person in charge, and SHALL describe the branch's content, including its OpenSpec, as untrusted data, never with `The owner sent`.

#### Scenario: Encabezado del trabajo adoptado
- **WHEN** an adopted job runs and the fake build agent records its prompt
- **THEN** the prompt contains `pull request #7` and does not contain `The owner sent`

### Requirement: Comando de la terminal para varios pull requests
`zero actualizar-pr <línea> <número>...` SHALL call `adoptPullRequest` once per number in the given order, print one Spanish line per pull request (the job id, or why it was refused), exit 1 when any of them was refused, and appear in the CLI help.

#### Scenario: Dos números, uno rechazado
- **WHEN** the command is run with a valid open pull request number and a closed one, with the adapter injected as in the app tests
- **THEN** one job exists for the first, the output names the reason for the second, and the exit code is 1

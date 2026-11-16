# Spec Delta

## ADDED Requirements

### Requirement: Corrida cancelada por concurrencia no es fallo del código
A check run whose GitHub conclusion is `cancelled` SHALL NOT count as a failed check: it MUST NOT be recorded as a check failure or an outage, MUST NOT start `fixChecks` and MUST NOT get a 'no funde' comment.

#### Scenario: Solo canceladas
- **WHEN** every check of a watched pull request's tip ended and the only non-passing ones have conclusion cancelled
- **THEN** mergeDecision does not return blocked with those checks as failed, no checks-failures kv entry is written and the job is not put back in the queue

#### Scenario: Cancelada y fallida
- **WHEN** one check failed with conclusion failure and another was cancelled
- **THEN** only the failed one is listed as failed

### Requirement: Relanzar canceladas de a una
The factory SHALL rerun the cancelled GitHub Actions runs of a watched pull request's tip once every check of that tip ended, at most one pull request per repository at a time (holding the repository like `refreshing.rerun`), oldest delivered first, without using the pull request's `rerun` mark, and at most `MAX_CANCELLED_RERUNS` (3) times per tip.

#### Scenario: Dos pull requests con canceladas
- **WHEN** two watched pull requests of the same repository each have only cancelled runs
- **THEN** in one pass MergeApi.rerun is called only for the older one's runs and the other is saved waiting with a reason that mentions its turn

#### Scenario: Límite por tip
- **WHEN** the same tip was already rerun for cancellations MAX_CANCELLED_RERUNS times
- **THEN** no further rerun is called and the pull request is blocked with a reason that says the runs keep getting cancelled

### Requirement: No fundir con checks en cola en otro pull request
The factory MUST NOT merge a pull request of a repository while another watched pull request of that repository was last seen with a check that is neither done nor started (queued in a concurrency group); it SHALL wait with a reason naming that pull request.

#### Scenario: Otro en cola
- **WHEN** pull request A is green and pull request B of the same repository was last seen with a check not done and without started
- **THEN** MergeApi.merge is not called for A and A's MergeState says it waits for B's checks to start

#### Scenario: Otro ya arrancó
- **WHEN** B's pending check has started
- **THEN** A is merged

### Requirement: Resolución mecánica de conflictos simples
When merging the base into a branch conflicts, the runner SHALL first try a model-free resolution of every conflicted file and, only when every hunk of every file is resolved, MUST commit the merge and continue at verify without spending an attempt or calling an engine; otherwise the conflict SHALL go to build as before, with the merge started again from the head.

#### Scenario: Imports
- **WHEN** both sides of a hunk only add or change single-line import statements
- **THEN** the result holds the union of both sides' import lines, ours first, each line once, and no conflict markers

#### Scenario: Ambos agregan
- **WHEN** a hunk's base section is empty and both sides add different lines at the same place
- **THEN** the result holds our lines followed by theirs

#### Scenario: Se pisan
- **WHEN** both sides change the same non-import line differently
- **THEN** the file is left unresolved and the job goes to build with a conflict feedback

#### Scenario: Verify igual
- **WHEN** every conflict was resolved mechanically
- **THEN** the job's station is verify, its attempt count is unchanged and the runAgent fake was not called for build

### Requirement: Tren de integración: un solo pull request activo
A line with a train (kv `train:<line>`) SHALL act on only the train's head pull request: the others MUST NOT be merged, updated, rerun or taken back, and SHALL be saved waiting with a reason naming the head pull request.

#### Scenario: Solo la cabeza
- **WHEN** a train holds pull requests #1, #2 and #3 and all are green and behind
- **THEN** only #1 is merged in the pass and #2 and #3 get no updateBranch call and wait naming #1

#### Scenario: Avanza
- **WHEN** the head pull request is merged
- **THEN** it leaves the train and the next one becomes the head, with its MergeState resolutions, refreshes, resolving and conflict cleared once

### Requirement: El tren no funde en rojo
The train MUST merge its head only when `mergeDecision` returns `merge` for it, and SHALL merge pull requests of the train even when the line has no `autoMerge`.

#### Scenario: Rojo
- **WHEN** the head has a failed check
- **THEN** MergeApi.merge is not called

#### Scenario: Sin autoMerge
- **WHEN** the line has no autoMerge and the train head is green
- **THEN** it is merged

### Requirement: Armar el tren
`startTrain` in app.ts (behind `zero tren <línea> [<número>...]`) SHALL order the line's delivered unmerged pull requests (or the numbers given, in the given order) oldest delivery first, adopt through `adoptPullRequest` each given number the factory did not deliver, and refuse with a reason, before writing anything, an unknown line, a line not integrating by pull request or a line that already has a train.

#### Scenario: Orden
- **WHEN** zero tren is called without numbers on a line with three delivered pull requests
- **THEN** the train's order is by delivery time, oldest first

#### Scenario: Ajeno
- **WHEN** a given number is an open pull request the factory did not deliver
- **THEN** an adopted job is created and added to the train

#### Scenario: Rechazo
- **WHEN** the line integrates by merge
- **THEN** startTrain throws and no train kv is written

### Requirement: Pull requests ajenos fijados al commit verificado
For a train pull request the factory did not open, the merge MUST be pinned to the head zero recorded for it only after its job passed verify and the reviews and was integrated (never at adoption); an adopted pull request without such a head MUST NOT be merged and SHALL stop the train with the owner as who has to act; if GitHub's head differs from the recorded one, the train SHALL stop at that pull request with a reason saying someone pushed to the branch.

#### Scenario: Alguien empujó
- **WHEN** an adopted train head is green but its headSha differs from the recorded head
- **THEN** merge is not called and the train records a block naming the pull request's author as who has to act

#### Scenario: Nunca verificado
- **WHEN** an adopted train head's job was rejected by verify or the reviews and ended delivered through the refresh mark, and its checks are green
- **THEN** merge is not called and the train records a block with the owner as who has to act

### Requirement: zero fusionar con pull requests verdes ajenos
`mergePullRequest` SHALL accept the URL of an open pull request of a line's GitHub repository that the factory did not deliver and merge it, pinned to the head it read, only when `mergeDecision` returns `merge`, recording a `zero.merge` span and writing no job.

#### Scenario: Verde ajeno
- **WHEN** zero fusionar gets the URL of a green open pull request of a line's repository with no delivered job
- **THEN** MergeApi.merge is called with its headSha and the outcome is merged

#### Scenario: Rojo ajeno
- **WHEN** that pull request has a failed check
- **THEN** merged is false with why and nothing is written to GitHub

#### Scenario: Repositorio ajeno
- **WHEN** the URL is of a repository of no line
- **THEN** it is refused

### Requirement: Destrabe de día
When `unjam.urgentAfterHours` (default 2, 0 turns it off) is set, the daemon SHALL run a diagnosis for a line, outside the idle run and whatever the night shift's hours, when a pull request of the line has been blocked (MergeState `blockedSince`) at least that long, only with the andon off, the budget not reached, an engine available for unjam, a free slot under `concurrency`, no queued job that is not low priority, at most once per line per `urgentAfterHours` (kv `unjam-urgent:<line>`) and with the rest of `limits.usdPerNight` as its cap on per-use billing.

#### Scenario: Corre con trabajos
- **WHEN** one job runs, concurrency is 2, nothing else is queued and a pull request has been blocked 3 hours
- **THEN** unjamLine is called for its line

#### Scenario: Pedido esperando
- **WHEN** an owner job is queued
- **THEN** no daytime diagnosis runs

#### Scenario: Una vez
- **WHEN** the daytime diagnosis ran for the line 1 hour ago
- **THEN** it does not run again

#### Scenario: blockedSince
- **WHEN** a watched pull request goes from waiting to blocked and stays blocked
- **THEN** MergeState.blockedSince keeps the first blocked time until it is no longer blocked

### Requirement: El destrabe arranca el tren
The unjam output SHALL accept the action `train` for a cause whose jams are pull requests of one line; zero SHALL start that line's train with those pull requests on `build`/`auto` lines and, on `propose` lines, MUST leave a todo naming `zero tren <línea>`.

#### Scenario: Autonomía build
- **WHEN** a train cause is accepted on a build line
- **THEN** kv train:<line> exists holding the cause's pull requests

#### Scenario: Propose
- **WHEN** the same cause is on a propose line
- **THEN** no train is written and the cause's todo contains zero tren

### Requirement: Qué falta y quién
Every jam cause with action `none` and every stopped train SHALL carry `who` (`owner`, `author`, `github` or `factory`), and `zero status`, the panel summary and the briefing MUST show what is missing and who has to do it.

#### Scenario: Status
- **WHEN** a diagnosis has a cause with action none, todo and who author
- **THEN** formatStatus's Trabas line contains the todo and says the pull request's author has to do it

#### Scenario: Tren
- **WHEN** a train is stopped at a pull request someone pushed to
- **THEN** formatStatus shows a Tren line with that pull request, what is missing and who

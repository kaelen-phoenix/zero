# Spec Delta

## Purpose

Una línea podrá correr varios trabajos a la vez cuando no se pisan. Con la opción `parallel` elegís cuántos como máximo; por defecto sigue siendo 1, como hoy, y el límite global `concurrency` se sigue respetando. Cada trabajo declara qué archivos o carpetas espera tocar. La fábrica no construye al mismo tiempo dos trabajos de una línea que se solapen, y un trabajo que no declaró nada corre solo. Al final, la traza muestra lo que el trabajo cambió de verdad frente a lo declarado. Antes de integrar, el trabajo se actualiza con la rama base más reciente y, si eso cambió algo, vuelve a pasar la verificación. Si hay conflicto, no queda trabado: se resuelve como un intento más, dentro de `maxAttempts`. En las líneas con `autoMerge`, un pull request de la fábrica que quede con conflictos se actualiza y se resuelve solo con el mismo mecanismo. Los trabajos del turno nocturno siguen como hoy: de a uno y solo con la fábrica libre.

## ADDED Requirements

### Requirement: Per-line parallel option
A line in the factory file SHALL accept `parallel`, an integer of at least 1 that defaults to 1, as the maximum number of jobs of that line running at the same time.

#### Scenario: Default
- **WHEN** a line is parsed without `parallel`
- **THEN** its `parallel` value is 1

#### Scenario: Invalid value
- **WHEN** a line declares `parallel: 0`
- **THEN** parsing the factory file throws

### Requirement: Default keeps today's behaviour
With `parallel: 1` the daemon MUST run at most one job of the line at a time, and the job MUST go from spec to build in the same run without returning to the queue.

#### Scenario: One at a time
- **WHEN** two jobs are queued on a line without `parallel` and the daemon runs
- **THEN** the second job's spec station starts after the first job finished, and both end delivered

### Requirement: Global concurrency still applies
The daemon MUST NOT run more jobs across all lines than the global `concurrency`, whatever each line's `parallel` says.

#### Scenario: Line allows more than the factory
- **WHEN** a line has `parallel: 3`, `concurrency` is 1, and two non-overlapping jobs are queued
- **THEN** no two agent builds of those jobs overlap in time, and both end delivered

### Requirement: Spec declares expected paths
The spec station's output SHALL include `paths`, a list of file or folder patterns the job expects to touch, and the list MUST be stored with the job's spec; a stored spec without `paths` MUST be treated as having declared nothing.

#### Scenario: Stored with the job
- **WHEN** the spec station returns `paths: ["src/a/**"]`
- **THEN** the job's stored spec has those `paths`

#### Scenario: Older spec
- **WHEN** a job's stored spec has no `paths` field
- **THEN** the scheduling decision treats the job as having declared nothing, without throwing

### Requirement: Spec runs before the overlap decision
On a line with `parallel` above 1, a job without a spec yet MAY start its read-only spec station whenever the line's `parallel` and the global `concurrency` leave room, and once its spec is ready (and approved, if the level asks) it MUST go back to the queue with checkpoint `spec` so the daemon applies the overlap decision before build starts.

#### Scenario: Back to the queue after spec
- **WHEN** a job on a `parallel: 2` line completes spec in a run at level L2
- **THEN** that run returns the job with status `queued` and checkpoint `spec`, with no build call made

#### Scenario: Spec during another job's build
- **WHEN** a job with declared paths is building on a `parallel: 2` line and a new job with no spec is queued
- **THEN** the new job's spec station runs while the first job is still building

### Requirement: Non-overlapping jobs run together
The daemon SHALL run jobs of the same line at the same time, up to the line's `parallel`, when their declared patterns do not overlap.

#### Scenario: Two disjoint jobs
- **WHEN** a `parallel: 2` line with `concurrency: 2` has two jobs declaring `src/a/**` and `src/b/**`, and each fake build waits until the other build has started
- **THEN** both builds overlap in time and both jobs end delivered, with both changes on the base branch of a real temporary git repository

### Requirement: Overlapping jobs wait
The daemon MUST NOT start a job with a spec while another running job of the same line has declared patterns that overlap with it.

#### Scenario: Same folder
- **WHEN** a `parallel: 2` line has two jobs declaring `src/**` and `src/a.ts`
- **THEN** their build stations never overlap in time and both jobs end delivered

### Requirement: Undeclared jobs run alone
A job whose spec declared no paths MUST build only while no other job of its line is running, and while it runs no other job of its line SHALL start.

#### Scenario: Nothing declared
- **WHEN** a `parallel: 2` line has one job with empty `paths` and one job declaring `src/b/**`
- **THEN** no other job's agent call of that line overlaps in time with the undeclared job's build, and both end delivered

### Requirement: Conservative overlap rule
Pattern overlap SHALL be decided by a pure function that compares each pattern's literal prefix by path segment, case-insensitively, and MUST report an overlap whenever it cannot rule one out.

#### Scenario: Decisions
- **WHEN** the function compares pattern pairs
- **THEN** `src/a/**` with `src/b/**` and `src/a.ts` with `src/b.ts` do not overlap; `src/**` with `src/a.ts`, `src/` with `SRC/a.ts`, `src/*.ts` with `src/a.ts`, `**/*.ts` with `docs/x.md`, and `../x` with `docs/x.md` overlap

### Requirement: Declared versus actual in the trace
When a job reaches the integrate station, its span SHALL record the declared patterns, the files the job changed relative to its base, and the changed files outside the declared patterns, leaving out the job's own OpenSpec change folder; a difference MUST NOT affect the job's outcome.

#### Scenario: Undeclared file touched
- **WHEN** a job declares `src/a/**` and also changes `docs/x.md`
- **THEN** the `zero.station.integrate` span has `zero.paths.declared`, `zero.paths.changed` and `zero.paths.undeclared` with `docs/x.md` in the last one, and the job ends delivered

### Requirement: Update from the base before integrating
On `merge` and `pull-request` lines, immediately before integrating, the job's branch SHALL be updated by merging the newest base into it (the local base branch on `merge` lines, the remote's base after a fetch on `pull-request` lines), as a factory commit that uses the factory identity, the line's `commitAuthor` and its signature trailer; `branch` lines MUST NOT be updated.

#### Scenario: Base moved on a merge line
- **WHEN** the base branch of a real temporary repository gets a new commit touching another file while a job builds
- **THEN** the delivered branch contains that commit, committed by zero with the signature trailer, and `changedFiles` lists only the job's own files

#### Scenario: Base moved on a box copy
- **WHEN** the same happens to a job running in the simulated box's clone copy
- **THEN** the job ends delivered with both changes on the base branch

#### Scenario: Remote base moved
- **WHEN** a `pull-request` line's bare remote gets a new base commit while a job builds
- **THEN** the job's branch contains that commit before it is pushed

#### Scenario: Branch line
- **WHEN** a job on a `branch` line finishes while the base has moved
- **THEN** its branch does not contain the new base commit

### Requirement: Verification again after an update
If updating from the base changed the branch, the verification commands MUST run again before integrating; if it changed nothing they SHALL NOT run again.

#### Scenario: Base unchanged
- **WHEN** the base did not move while the job was built
- **THEN** each verification command ran once and the job ends delivered

#### Scenario: Base moved and verification passes
- **WHEN** the base moved without conflict and verification passes
- **THEN** each verification command ran twice, review and security each ran once, and the job ends delivered

#### Scenario: Verification fails after the update
- **WHEN** the update breaks a verification command
- **THEN** the job goes back to build as a new attempt with the failure as feedback, counted against `maxAttempts`

#### Scenario: Interrupted during the second verification
- **WHEN** the job is interrupted after the update commit and before that verification finishes, and then runs again
- **THEN** verification runs before the job integrates

### Requirement: Conflict resolved as an attempt
If updating from the base produces merge conflicts, the job MUST NOT park: it SHALL go back to build as a new attempt, counted against `maxAttempts`, with the merge in progress in its work copy and the conflicted paths in its feedback, and then pass verify, review and security again.

#### Scenario: Resolved in one attempt
- **WHEN** the base commits a different change to the same file while the job builds, and the fake build resolves the file on its second call
- **THEN** the second build's prompt names the conflicted file, the job ends delivered with `attempt` 2, the resolved content is on the base branch, and no question was asked

#### Scenario: Attempts exhausted
- **WHEN** a line with `maxAttempts: 1` hits a conflict when updating
- **THEN** the job ends `failed` with a reason naming the conflict, and its branch still exists

### Requirement: Unresolved markers never get committed
Zero MUST check the conflicted files after build, and if any still holds conflict markers the attempt MUST fail without committing them, with the merge started again on the next attempt.

#### Scenario: Build leaves markers
- **WHEN** the fake build's first conflict call leaves `<<<<<<<` markers in the file and its next call resolves them
- **THEN** no commit on the branch contains the markers, and the job ends delivered on the later attempt

#### Scenario: Interrupted while resolving
- **WHEN** the job is interrupted during the conflict attempt and runs again
- **THEN** the next build still receives the conflict state, and the job ends delivered

### Requirement: Going back to build needs integration approval again
When an update sends a job back to build, any earlier `approvals.integrate` MUST be cleared, so the level and the night-shift hold apply again to the new code.

#### Scenario: Approved at L1, then conflict
- **WHEN** an L1 job approved at `before-integrate` then hits a conflict on update
- **THEN** after the resolving attempt it waits on a new `before-integrate` question

### Requirement: Other integration blocks still park
Problems that are not conflicts between the branch and the base (unsaved changes in the owner's copy, a merge git refuses without unmerged paths, a push or GitHub failure) MUST keep parking the job with `integration-blocked`.

#### Scenario: Owner's unsaved changes
- **WHEN** the owner's copy of the base branch has unsaved changes at integration
- **THEN** the job waits on an `integration-blocked` question, and after the owner commits and approves it ends delivered without another build

### Requirement: Conflicted auto-merge pull requests resolved by the factory
When a watched `autoMerge` pull request reports conflicts with its base, its job has attempts left, the pull request's head is the tip of the job's local branch, and that head has not been tried yet, the daemon's merge pass SHALL put the job back in the queue to update and resolve through the same mechanism, pushing to the same pull request instead of opening a new one and without posting the "no funde" comment.

#### Scenario: Conflict with attempts left
- **WHEN** `pollMerges` sees `mergeable: false` on a delivered job with attempts left and a matching head
- **THEN** the job is `queued` at checkpoint `review` with `finishedAt` cleared, and no comment was posted

#### Scenario: Conflict while checks are pending or failed
- **WHEN** the same pull request also has unfinished or failed checks
- **THEN** the job is put back in the queue the same way

#### Scenario: Same pull request kept
- **WHEN** the requeued job runs against a real bare remote and resolves the conflict
- **THEN** the job ends delivered with the same `delivery.url`, the remote branch contains the resolution and the new base, no pull request is opened, and the pull request is watched again

#### Scenario: No attempts left, or someone else pushed
- **WHEN** the job has used `maxAttempts`, or the pull request's head differs from the local branch tip, or that head was already tried
- **THEN** the job stays delivered and the pull request gets today's comment once, with status `blocked`

#### Scenario: Resolution fails
- **WHEN** the requeued job ends `failed` or `stopped`
- **THEN** the next `pollMerges` comments once on the pull request saying it stays open with conflicts, and the job is no longer retried

### Requirement: Night shift unchanged
Jobs the night shift took on its own MUST keep running one at a time and only while the factory is otherwise free, whatever the line's `parallel`, without returning to the queue after spec, and while one runs no other job of its line SHALL start.

#### Scenario: Autonomous on a parallel line
- **WHEN** a `parallel: 2` line has a running autonomous job and an owner's job queued
- **THEN** the owner's job does not start until the autonomous job finished

#### Scenario: Two autonomous jobs
- **WHEN** a `parallel: 2` line has two queued autonomous jobs with disjoint paths
- **THEN** their agent calls never overlap in time

### Requirement: Documented in both languages
`README.md` and `README.es.md` SHALL document `parallel`, the declared paths, the update before integrating, conflict resolution as an attempt and what auto-merge does with conflicts, with identical code blocks.

#### Scenario: Docs
- **WHEN** `test/docs.test.ts` runs
- **THEN** both READMEs mention `parallel` and `maxAttempts`, keep the same structure and code blocks, and the tests pass

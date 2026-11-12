# Proposal

## Why

Sometimes an automatic pull request sits in conflict with its base branch and is retried with `zero reintentar`, or by the unjam station on its own. If the base then merges in with no conflict, the factory will run only verification and the reviews on the branch. Today it calls build again on code that is already built. That spends an attempt, and the job can fail with "No se hizo ningún cambio en el código" or pick up changes nobody asked for. It also happens on lines with only 1 attempt (maxAttempts 1). Nothing changes for jobs that really have a conflict to resolve.

## What Changes

- A clean base merge at attempt 0 resumes at verify without rebuilding
- Supuesto: Assumption: only station `verify` is covered, as the request asks. A clean-merge job at attempt 0 that is interrupted later in review or security still has station review/security and attempt 0, so it would rebuild on resume. That case is left for a follow-up.
- Supuesto: Assumption: the stored `attempt` stays 0 after a clean-merge resume, so the span may say 1 while the job says 0. If verify then fails, the next build attempt is also numbered 1, so two attempt spans of the same job can both show 1.
- Supuesto: `resolved: true` is also written after a conflict-resolving build (runner.ts:788), but the job's attempt is at least 1 by then, so the new attempt-0 path does not change that case.
- Supuesto: With a staged spec and `stagesDone` below the last stage, a clean-merge resume that passes verify moves on to building the next stage. That is the same as the existing attempt>0 resume behaviour.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: A clean base merge at attempt 0 resumes at verify without rebuilding

## Impact

Generado por zero para el trabajo f7380e45.

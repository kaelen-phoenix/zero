# Proposal

## Why

When the Claude Code session expires ("Failed to authenticate", "OAuth session expired"), jobs will no longer fail at spec. zero sees that the engine is signed out. If the station has a replacement engine, it goes on with it. If not, the job goes back to the queue at the same station without spending any tries, and the factory waits 15 minutes before trying again. While it waits, the status says in Spanish that you need to sign in to that engine again, and does not mention quota or credit. A real answer from the model that happens to contain those words is not mistaken for a failure. `zero reintentar` (and the unjam station's automatic retry) will also accept a job that failed before it had a specification, unless spec refused it as not feasible. That job goes back to the queue from the start with its attempts at zero. This lets you retry jobs 9db0aa22, ac2ec095, 1e52389d, d9f534bb and 39d7be87 once you have signed in again.

## What Changes

- Expired engine session pauses the engine instead of failing jobs, and failed jobs without a spec can be retried
- Supuesto: Assumption: the bounded wait reuses UNKNOWN_RESET_MS (15 minutes) and repeats while the session stays expired. Each new try spends one engine call that fails right away, with no cost.
- Supuesto: The signed-out pause is read only from this machine's spans. It is not shared with other machines of a distributed factory, since a login belongs to one machine.
- Supuesto: The texts Claude Code prints for an expired login may change between SDK versions. Only the two texts named in the request (plus the 'OAuth token has expired' variant) are recognized.
- Supuesto: Retrying a job without a spec deletes the job's own local branch reference only by clearing job.branch. If a stale `zero/<id>` branch remains in the line repo, prepareWorkCopy may reuse it. Since no spec was committed it should only carry base commits, but the build should check how openWorkCopy treats an existing branch, and delete it if it is unused and not checked out.
- Supuesto: Through retryCauses, unjam's automatic retry can now requeue failed jobs without a spec (once per job, within its daily cap). This spends some new budget on jobs that failed for other reasons before spec.
- Supuesto: With no replacement engine, `budgetState.reached` becomes true during the pause, so the daemon also holds other queued jobs that use the same engine. This is intended (the engine cannot work).

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Expired engine session pauses the engine instead of failing jobs, and failed jobs without a spec can be retried

## Impact

Generado por zero para el trabajo 7ab160a7.

# Proposal

## Why

Some pull requests now get stuck after their job has used all its build attempts. When one of these has a conflict with the base branch, the factory will send the job back to the queue to fix the conflict anyway. Each pull request gets its own allowance of 2 automatic conflict fixes over its life, and the job always comes back with at least one build attempt to use. While GitHub says the branch has a conflict, the factory stops asking GitHub to update the branch or re-run checks for that commit, because that cannot work and only uses up quota. `zero status`, the panel and the briefing will say "en conflicto con la rama base" instead of "fallaron los checks". When no automatic fixes are left, or the fix for that commit already failed, they will say so and point to fixing it by hand or with `zero reintentar`. Once this lands, zero #61 and soliloq #472, #474 and #476 should go back to the queue on their own and get resolved this way within about an hour, when their current wait runs out.

## What Changes

- Conflict resolution for auto-merge pull requests with its own limit, separate from build attempts
- Supuesto: Assumption: 'at least one attempt' means `attempt = min(job.attempt, maxAttempts - 1)`, not a reset to 0. A job that still has attempts keeps its count, and an exhausted one gets exactly one build attempt per resolution.
- Supuesto: With maxAttempts 1 the job comes back with attempt 0. If the base merges cleanly, buildLoop then runs a build instead of resuming at verify, because `resuming` needs attempt > 0. retryJob already behaves this way, so this is accepted.
- Supuesto: The four live pull requests keep their old 'fallaron los checks' text until their current backoff ends (at most 60 minutes). After that, takeBack picks them up. It still needs the local branch at the PR head, no pending cleanup and a base that fetches; if one of these fails, that pull request stays blocked with the new conflict text.
- Supuesto: Clearing resolutions in retryJob lets unjam's automatic retry (once per job's life) give one more allowance. That is bounded, but it is more than 2 resolutions in total.
- Supuesto: Putting the conflict decision before checks changes `mergeRequested`'s why for conflicted pull requests that also have failed checks. That is intended.
- Supuesto: Matching updateBranch's error on /merge conflict/i depends on GitHub's 422 message text.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Conflict resolution for auto-merge pull requests with its own limit, separate from build attempts

## Impact

Generado por zero para el trabajo 022faac2.

# Proposal

## Why

You get a new command, `zero actualizar-pr <línea> <número>...`. For each pull request you name, zero first saves a backup of its branch in the line's repository as `respaldo/pr<N>`. Then it creates a job that works on that same branch: it merges in the up-to-date base branch, the agent resolves any conflicts (using the OpenSpec changes the branch already has as a guide), the line's checks run, and the result is pushed to the same branch with no force and no new pull request. If something fails, the pull request stays the way it was. These cases are refused with a clear message: a pull request that is closed, comes from a fork, targets a different base, already belongs to a job, or whose branch is checked out somewhere else. This first part does not yet wait for one pull request to merge before starting the next.

## What Changes

- Actualizar con la rama base un pull request que la fábrica no abrió
- Supuesto: The five refused requests (407320e7, c50e3846, df595ccd, 85d93728, 293fa004) are written in plain language. If they are resent through `requestWork`, they still go through the spec station, which cannot create adoption jobs, so they may be refused again. For them to go through, someone has to run `zero actualizar-pr` with the pull request numbers, or a later change has to send this kind of request to `adoptPullRequest`.
- Supuesto: Assumption: the backup `respaldo/pr<N>` is a local branch in the line's repository and is never pushed. Pushing it to GitHub would be an outward action the request does not clearly ask for.
- Supuesto: Assumption: a pull request whose base is not the line's `baseBranch` is refused rather than merged with its own base, since the whole refresh path is tied to `<remote>/<baseBranch>`.
- Supuesto: A pull request that already contains the base ends through the existing `La rama ya contiene` path and is delivered unchanged, without running verify. That matches zero's own refreshes but does not re-check an already up-to-date branch.
- Supuesto: The same-repository check depends on `data.head.repo` from GitHub, which is null for a deleted fork. That case must count as a fork and be refused.
- Supuesto: At levels that ask before integrating, the adopted job parks at `before-integrate` like any refresh. That is intended, but at L0 to L2 nothing gets pushed without an approval.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Actualizar con la rama base un pull request que la fábrica no abrió

## Impact

Generado por zero para el trabajo a3c89e5e.

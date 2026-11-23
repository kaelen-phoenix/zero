# Proposal

## Why

The status will stop piling up jams that aren't real. 1) Isolation box: the factory file already lets you declare that there's no box: `isolation: worktree`. You edit it by hand and the chat can't change it. With it set, no box jam appears anywhere. When the box is configured but Docker or Podman is missing, it shows up as a single jam for the machine, not one per line. 2) Installation behind: right after a self-update the check said the build was older than the code. That was false, because the update moves in a build made beforehand and only then updates the code. The check now knows when the build came from the self-update itself. It runs again right after each update. The jam text says whether selfUpdate is actually on in your file, so nobody suggests turning on something that's already on. 3) New `zero descartar <trabajo> [--motivo "…"]` command, also available in the chat (with confirmation) and the panel. It closes the job through finalizeJob with a final status and a report, and closes its open pull request with a comment. It deletes its branch locally and on GitHub. On its own, the factory also closes failed jobs whose pull request is already merged or whose branch is already in main, and leaves a note in the report. Jams of jobs that are already closed stop showing in the status, and unjam no longer counts them. Once deployed, you'll need to run the discard on 86fbf404, 032ef08b, bd212fe2 and 293fa004, unless the automatic cleanup closes them first.

## What Changes

- Less noise in the jams: one machine-wide box jam, a correct install check, and discarding jobs (manually and on its own)
- Supuesto: The 'declare there is no box' switch already exists as `isolation: worktree`. I chose to reuse it instead of adding a new `box: { mode: off }` key. If you have `isolation: container` today, you need to change it by hand in the factory file.
- Supuesto: staleBuild now trusts the self-update's history. A build changed by hand without touching tracked files under src/ would not be flagged.
- Supuesto: Automatic detection covers a merged PR, a branch that is an ancestor of the base, or identical content in the base. A failed job that was refused at the spec stage because it was 'already done' and has no branch (as 86fbf404 seems to be) is not detected on its own and has to be discarded with `zero descartar`.
- Supuesto: Discarding a failed job moves it from `failed` to `stopped` through finalizeJob. That writes a new townhall report and closes the job's span a second time.
- Supuesto: Deleting the remote branch relies on MergeApi.deleteBranch. The guard on the `zero/` prefix and the base branch is what prevents losing the project's branches.
- Supuesto: Comparing against `<remote>/<baseBranch>` needs a fetch. Without network access, the local remote-tracking refs are used and detection may lag.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Less noise in the jams: one machine-wide box jam, a correct install check, and discarding jobs (manually and on its own)

## Impact

Generado por zero para el trabajo 668cc221.

# Proposal

## Why

Every job gets a priority: baja (low), media (medium, the default), alta (high) or urgente (urgent). The factory always starts the highest-priority job first and, within the same level, the oldest. A low job only starts when nothing else is queued or running, the way the night shift's and packages' jobs work today (and those keep low as their default). A high job goes ahead of everything in the queue but does not stop what is already running. An urgent job goes first of all, only you can mark one (terminal or chat), and only one urgent job runs at a time. So low jobs are not forgotten, a job that has waited a long time goes up one level per day of waiting, but never past high. You pick the priority when asking (`zero request --prioridad alta`, or in the chat with zero_request). You can change it while the job has not finished with `zero priority <id> <nivel>`. It shows in `zero status` and in the chat, and README.md and README.es.md explain it. This first part does not yet pause running jobs to make room for an urgent one, read priorities from GitHub labels, add priority to the panel, or put it in the briefing. Those are listed as next steps.

## What Changes

- Job priorities: low, medium, high and urgent, with aging
- Supuesto: Assumption: aging adds one level per full 24 hours queued, counted from `createdAt` (a requeued job keeps its age). The request only says 'sube de a poco'.
- Supuesto: Once aged to medium, autonomous night-shift and package jobs lose today's 'only when idle' rule and may run next to the owner's work. The request accepts this, but it is a change from current behaviour.
- Supuesto: This part lacks the defining trait of urgent (pausing running jobs at their next checkpoint). Until the follow-up lands, an urgent job only jumps the queue and waits for a free slot, and for its line, since the daemon runs one job per line.
- Supuesto: Assumption: 'only the person in charge can mark urgent' means requestWork refuses urgente from any job source. The CLI and chat count as the owner, and the GitHub zero:urgente label rule is left to the follow-up.
- Supuesto: The full test suite already takes about 20 minutes and has timed out earlier runs. New tests should stay in one focused file and avoid extra daemon end-to-end runs.

## Capabilities

### New Capabilities
- `job-priority`: Job priorities: low, medium, high and urgent, with aging

### Modified Capabilities

## Impact

Generado por zero para el trabajo 7ceb7573.

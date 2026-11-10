# Proposal

## Why

When you ask for a demand run of a package station (for example `zero package run plus/community`), it will start within about a minute, even while the factory has jobs running or queued. It won't wait for the factory to be idle, or for scout or research to finish. The same safeguards still apply: it won't run with the andon on, with the budget used up, past the nightly spending cap (`limits.usdPerNight`), or while a secret it needs is missing. It never takes a job's slot or delays your jobs, and a station never runs twice at the same time. `zero status`, the panel's summary page and the briefing will show whether the run is still pending, is running, or already ran, and how it ended.

## What Changes

- On-demand package station runs start right away, in their own daemon pass
- Supuesto: `limits.usdPerNight` is now shared by passes that can overlap: an on-demand run may call `ctx.runAgent` while scout or research is running in `idlePasses`. Each computes what is left from recorded spans, so the nightly cap can be exceeded by at most one concurrent call's budget.
- Supuesto: Assumption: "never starts a job" means the demand run takes no concurrency slot and adds nothing to the daemon's `running`. A station can still open jobs through `ctx.requestJob` during its run; those jobs enter the queue as low priority, as they do today.
- Supuesto: Assumption: "on the intake interval" means at most one on-demand pass start per `INTAKE_MS` (60 s), counted from the last start. A new request is therefore picked up within about a minute, not instantly.
- Supuesto: If the process crashes during a run, the record is left with `startedAt` and no `endedAt`. It shows as `sin resultado` once the station's `timeoutMinutes` have passed.
- Supuesto: Per the townhall, the full `npm test` has exceeded verify's time limit in earlier jobs, so the build should keep new tests focused and fast and avoid spawning CLIs unnecessarily.
- Supuesto: The busy-station guard is in-process only. That is enough because the daemon is the only process that runs stations (single-daemon lock).
- Supuesto: Existing tests that expected `packagesPass` to consume demand runs (including 'waits for queued jobs') must be rewritten for `onDemandPass`, because the behaviour changes on purpose.

## Capabilities

### New Capabilities
- `agent-packages`: On-demand package station runs start right away, in their own daemon pass

### Modified Capabilities

## Impact

Generado por zero para el trabajo 1320d862.

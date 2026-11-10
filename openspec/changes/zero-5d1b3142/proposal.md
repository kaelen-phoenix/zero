# Proposal

## Why

The factory reads the Dependabot alerts (dependencies with known vulnerabilities) of every line whose remote is on GitHub. It uses the factory's own GitHub quota and pauses with it. - **Which alerts become jobs:** each new open alert of high or critical severity gets a job on that line. The job updates the vulnerable dependency to the fixed version, the lowest one that fixes every alert of that package. - **Grouping:** alerts of the same package share one job. The factory remembers which alerts it already took and never opens a second job for them. - **Queue order:** the system has no job priorities yet, so these jobs come first in the queue, ahead of all other work. That is the most urgent order there is today. - **Lower severities:** if you lower the threshold, medium and low alerts also get a job, but in the normal queue position. - **Same path as any change:** the jobs go through verify, review and security like any other change. On lines with autoMerge they merge on their own once GitHub's checks pass. - **Per-line setting:** off, notify only, or open jobs. The default is to open jobs for high and critical only, and to notify the rest. - **Where you see it:** `zero status` and the briefing show which alerts are open and which job handles each one. `zero status` also shows a problem when GitHub won't let the factory read them. - **Docs:** README.md and README.es.md explain it.

## What Changes

- Dependabot alerts as urgent security jobs
- Supuesto: Job priorities do not exist in main (no field, no ordering). 'Urgente' is read as the strongest order available: high and critical security jobs go to the front of `ownerFirst`. If priorities land later, these jobs should map to urgente / media.
- Supuesto: There is no job 'type' field either, so the source kind `security-alert` plus its `jobOrigin` label carry the 'seguridad' type.
- Supuesto: The default is on for every GitHub line, so existing installs start reading Dependabot alerts and opening jobs right after upgrading. Tokens without Dependabot-alerts read access, or repositories with Dependabot disabled, get a 403 or 404. That is recorded as a line problem shown in `zero status`, which may be noisy.
- Supuesto: Alerts with no published fixed version open no job and are only shown, to avoid asking the build station to guess a fix.
- Supuesto: 'The minimum version that fixes it' is read as the highest first_patched_version among the package's grouped alerts. The build agent still decides how to change the manifest and lockfile, and on monorepos with several manifests it may update only some of them.
- Supuesto: Advisory summaries are third-party text that reaches the agents. They are framed as data in requestBlock but still go into the request text.
- Supuesto: The full `npm test` run has timed out in earlier jobs (over 20 minutes). The build should run the targeted test files rather than depend on the whole suite.

## Capabilities

### New Capabilities

### Modified Capabilities
- `work-intake`: Dependabot alerts as urgent security jobs

## Impact

Generado por zero para el trabajo 5d1b3142.

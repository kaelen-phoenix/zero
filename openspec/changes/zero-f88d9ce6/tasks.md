# Tasks

## 1. Etapa 1: Installed copy freshness

- [x] 1.1 Add src/install-freshness.ts with the record, the key, checkInstall with injected git/fs/clock and readInstallFreshness.
- [x] 1.2 Add the daemon's hourly pass, injectable through DaemonOptions.install and off in once runs unless injected.
- [x] 1.3 Add FactoryStatus.install, installLine in format.ts for formatStatus and the panel summary, and the briefing's ## Instalación section.
- [x] 1.4 Tests for the record (behind, staleBuild, hourly guard, failed fetch, not a repository) and for the status and briefing lines.

## 2. Etapa 2: Evidence, repeated causes and the install jam

- [x] 2.1 JamKind install with its text, and the install jam in collectJams for lines matching the record's repository.
- [x] 2.2 Cause.seen, evidenceText appended to the why of unjam proposals in openFixes.
- [x] 2.3 Townhall lessons for causes with at least 2 jams or seen of at least 2, resilient to townhall failure.
- [x] 2.4 Update agents/unjam.md for the install jam; tests for all of the above.

## 3. Etapa 3: Missing-capability proposals and resend

- [x] 3.1 Export the spec-refusal prefix constant from runner.ts and use it there.
- [x] 3.2 Add the proposals column for_jobs (migration, Proposal.forJobs, createProposal) and show it in the proposals view.
- [x] 3.3 Add UnjamOutput action capability with line, list the lines in unjamPrompt, and add openCapabilities with validation, downgrade, dedupe and takeOnItsOwn on the target line.
- [x] 3.4 Add resendAfterCapability with the entered check, the install gate and kv unjam:resent, wire it into the daemon, and add a townhall lesson on resend.
- [x] 3.5 Update agents/unjam.md and AGENTS.md; tests for acceptance, dedupe, resend once, wait for install, unmerged pull request.

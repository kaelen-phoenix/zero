# Spec Delta

## ADDED Requirements

### Requirement: Spec-refused unjam proposals keep their title for a fixed period
An approved unjam proposal whose job is refused at spec (status `failed`, no spec, and a reason that starts with `SPEC_REFUSAL:`) SHALL keep holding its title for `REFUSED_HOLD_DAYS` (7) days, counted from the job's `finishedAt` (or `updatedAt` when `finishedAt` is missing). While it holds the title, `openFixes` MUST NOT create another unjam proposal with the same normalized title on that line.

#### Scenario: Refused at spec, within the period
- **WHEN** a fix cause yields an approved unjam proposal on a build line, its job is then set to failed with reason `${SPEC_REFUSAL}: This is already done`, no spec, finishedAt at day D, and unjamLine runs again with the same cause title at day D+3
- **THEN** the line still has exactly one unjam proposal, and the diagnosis records that proposal's id (and its job) on the cause

#### Scenario: Refused at spec, after the period
- **WHEN** the same setup runs, but the second unjamLine runs at day D+8 (more than 7 days after the job finished)
- **THEN** a second unjam proposal with that title is created

### Requirement: Other failures release the title right away
An approved unjam proposal whose job reached a final status for any reason other than a spec refusal MUST stop holding its title at once, as it does today, so `openFixes` MAY propose the same title on the next pass.

#### Scenario: Failed at verify
- **WHEN** a fix cause's approved unjam proposal has its job set to failed with reason `verify falló` (or the job has a spec) and finishedAt at day D, and unjamLine runs again with the same title at day D+1
- **THEN** a second unjam proposal with that title is created

### Requirement: Capability proposals use the same hold
`openCapabilities` SHALL apply the same title hold as `openFixes`, through the shared `holdsTitle` check evaluated at the pass's `now`.

#### Scenario: Capability proposal refused at spec
- **WHEN** an approved unjam proposal on the target line has a job refused at spec 2 days before the pass, and a capability cause with the same title arrives with a new job refused at spec
- **THEN** no new proposal is created on the target line

# Spec Delta

## ADDED Requirements

### Requirement: Pull request #165's work is carried onto current main
The job branch MUST contain every commit of origin/zero/7dd6e0f1 up to b02d8f2 and the current main, with no conflict markers left in any tracked file.

#### Scenario: Both histories present
- **WHEN** `git merge-base --is-ancestor b02d8f2 HEAD` and `git merge-base --is-ancestor origin/main HEAD` run on the job branch
- **THEN** both exit 0

#### Scenario: No conflict markers
- **WHEN** tracked files are searched for lines starting with `<<<<<<<`, `=======` followed by `>>>>>>>`, or `>>>>>>>`
- **THEN** none are found outside test fixtures that already had them on main

### Requirement: Self-update behaviour is kept
After the merge, the self-update MUST behave as PR #165 specified: `selfUpdate` in FactorySchema (off by default, strict), `zero --version`, the daemon's `checkSelfUpdate` pass and switch, and the `Autoactualización:` lines in status, panel and briefing.

#### Scenario: PR tests pass
- **WHEN** test/self-update.test.ts, test/self-update-switch.test.ts and test/self-update-status.test.ts run
- **THEN** they all pass

#### Scenario: Config default
- **WHEN** a factory file without `selfUpdate` is parsed
- **THEN** `config.selfUpdate.enabled` is false and `remote` is `origin`

### Requirement: Main's behaviour is kept
The merge MUST keep every behaviour main had before it, including install freshness (`FactoryStatus.install`, `installLine`, the `## Instalación` briefing section), on-demand runs, jams and every other FactoryStatus field, daemon pass and briefing parameter.

#### Scenario: Main's tests pass
- **WHEN** `npm test` runs
- **THEN** every test file that exists on main passes, alongside the PR's tests

#### Scenario: Status shows both
- **WHEN** formatStatus gets a status with both `install` behind and `selfUpdate.last` rolled back
- **THEN** the output has both the `Instalación atrasada` line and the `Autoactualización:` line

### Requirement: ADR numbers stay unique
The self-update ADR MUST be docs/adr/0005-autoactualizacion.md with header `# ADR 0005`, and docs/adr/0004-servidores-mcp.md MUST stay unchanged.

#### Scenario: No duplicate number
- **WHEN** the files in docs/adr are listed
- **THEN** no two files share the same four-digit prefix, 0005-autoactualizacion.md exists and its first line starts with `# ADR 0005`

### Requirement: Checks pass
The merged branch MUST pass `npm run typecheck`, `npm test` and `npx openspec validate --all`.

#### Scenario: Typecheck, tests and specs
- **WHEN** the three commands run on the job branch
- **THEN** each exits 0

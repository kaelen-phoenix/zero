# Spec Delta

## ADDED Requirements

### Requirement: Self-update merged onto current main
The job's branch MUST contain every commit of origin/zero/7dd6e0f1 (head b02d8f2) and of main, with every file of the PR #165 diff present: src/self-update.ts, src/self-update-switch.ts, test/self-update.test.ts, test/self-update-switch.test.ts, test/self-update-status.test.ts and openspec/changes/zero-7dd6e0f1/.

#### Scenario: PR files present
- **WHEN** the repository is inspected after the build
- **THEN** src/self-update.ts, src/self-update-switch.ts and openspec/changes/zero-7dd6e0f1/specs/factory-daemon/spec.md exist, and `git merge-base --is-ancestor b02d8f2 HEAD` succeeds

#### Scenario: Main files intact
- **WHEN** the repository is inspected after the build
- **THEN** src/install-freshness.ts, test/install-freshness.test.ts and docs/adr/0004-servidores-mcp.md exist unchanged in behaviour, and test/adr-mcp.test.ts passes

### Requirement: No conflict markers
No tracked file SHALL contain a line that starts with `<<<<<<<`, `=======` used as a conflict separator, or `>>>>>>>`.

#### Scenario: Marker scan
- **WHEN** `git grep -nE '^(<<<<<<<|>>>>>>>)'` runs over the tree
- **THEN** it finds nothing

### Requirement: Both features kept in status and briefing
`renderBriefing` MUST keep main's `jams` and `install` parameters and add the PR's `selfUpdates` after them. `briefing` in src/app.ts MUST pass all three, and `FactoryStatus` MUST carry both `install` and `selfUpdate`, so that `formatStatus` shows both the `Instalación atrasada` line and the `Autoactualización:` lines.

#### Scenario: Status shows both
- **WHEN** formatStatus gets a FactoryStatus with an install-behind record and a selfUpdate with a ready version
- **THEN** the output contains both `Instalación atrasada` and `Autoactualización:`

#### Scenario: Briefing shows both
- **WHEN** renderBriefing is called with jams, an install record and a rolled-back selfUpdate entry
- **THEN** the briefing has the `## Trabas` and `## Instalación` sections and an `Autoactualización` line

### Requirement: Daemon runs both passes
`factoryLoop` in src/daemon.ts MUST keep main's passes, including `checkInstall`, the jams and unjam and the install options. It MUST also keep the PR's `checkSelfUpdate`, `importSwitchResult`, `switchVersion` and the `selfReady` gate on starting jobs and idle passes, and it MUST await `selfChecking` on exit.

#### Scenario: Self-update tests pass
- **WHEN** npm test runs test/self-update*.test.ts and test/install-freshness.test.ts
- **THEN** all pass

### Requirement: Config keeps both
`FactorySchema` in src/config.ts MUST accept `autostart` and every other top-level key main added, as well as the strict `selfUpdate` object (`enabled` default false, `remote` default origin, optional `branch`, `startTimeoutSeconds` default 120).

#### Scenario: Default off
- **WHEN** a factory file without selfUpdate is parsed
- **THEN** config.selfUpdate.enabled is false and config.autostart is false

### Requirement: ADR renumbered
The PR's self-update ADR MUST be at docs/adr/0005-autoactualizacion.md with the header `# ADR 0005 — …`. No docs/adr/0004-autoactualizacion.md SHALL remain, and every reference to it, such as openspec/changes/zero-7dd6e0f1/tasks.md, MUST name 0005.

#### Scenario: Single 0004
- **WHEN** docs/adr is listed
- **THEN** only one file starts with 0004 (0004-servidores-mcp.md), 0005-autoactualizacion.md exists, and its first line starts with `# ADR 0005`

### Requirement: Docs merged in both languages
AGENTS.md, README.md and README.es.md MUST keep main's content and add the PR's self-update text. README.md and README.es.md MUST keep the same structure and code blocks.

#### Scenario: Docs tests
- **WHEN** test/docs.test.ts and test/wording.test.ts run
- **THEN** they pass, including 'document self-update in both languages'

### Requirement: Checks pass
`npm run typecheck`, `npm test` and `npx openspec validate --all` MUST all succeed on the resolved branch.

#### Scenario: Full verify
- **WHEN** the three commands run
- **THEN** each exits 0

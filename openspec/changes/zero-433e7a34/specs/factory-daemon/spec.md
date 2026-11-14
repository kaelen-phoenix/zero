# Spec Delta

## ADDED Requirements

### Requirement: Self-update branch merged into the job branch
The job branch MUST contain commit b02d8f28fa3d15006dd7a93882f86d74fe90f353 (head of origin/zero/7dd6e0f1) as an ancestor, together with the current main it started from, so the self-update work of PR #165 is integrated through a merge and not rewritten.

#### Scenario: PR head is an ancestor
- **WHEN** running `git merge-base --is-ancestor b02d8f28fa3d15006dd7a93882f86d74fe90f353 HEAD` on the delivered branch
- **THEN** the command exits 0

#### Scenario: Main is an ancestor
- **WHEN** running `git merge-base --is-ancestor <job base commit> HEAD`
- **THEN** the command exits 0

### Requirement: No conflict markers left
The merged tree MUST NOT contain any line starting with `<<<<<<<`, `=======` used as a conflict separator, or `>>>>>>>` in the files both sides changed (AGENTS.md, README.md, README.es.md, src/app.ts, src/cli.ts, src/config.ts, src/daemon.ts, src/format.ts, src/panel/html.ts, src/state/store.ts, src/townhall/briefing.ts) or anywhere else in the repository's tracked files.

#### Scenario: Grep finds no markers
- **WHEN** running `git grep -nE '^(<<<<<<<|>>>>>>>)( |$)'` on HEAD
- **THEN** no line is reported

### Requirement: Self-update code present
The merged tree MUST include the PR's self-update modules (src/self-update.ts, src/self-update-switch.ts), the `selfUpdate` setting in the factory file schema in src/config.ts, and the PR's tests, all compiling under `npm run typecheck`.

#### Scenario: Self-update files exist and compile
- **WHEN** checking the tree and running `npm run typecheck`
- **THEN** src/self-update.ts and src/self-update-switch.ts exist, src/config.ts accepts `selfUpdate`, and typecheck exits 0

### Requirement: Main features kept
The merge MUST keep every main-side behaviour in the conflicted files: src/install-freshness.ts and its `checkInstall` daemon pass, `FactoryStatus.install` and `installLine`, the unjam passes (`unjamPass`, `resendRefused`), the auto-merge polling, and `renderBriefing`'s existing positional arguments ending in `billing, jams, install`, with any argument the PR adds placed after `install` and passed in the same order by `briefing` in src/app.ts.

#### Scenario: Existing tests still pass
- **WHEN** running `npm test`
- **THEN** the suites for install freshness, unjam, automerge, briefing and the daemon pass, along with the self-update suites

#### Scenario: Briefing argument order
- **WHEN** reading `renderBriefing`'s signature and its call in src/app.ts
- **THEN** `billing, jams, install` appear in that order and the PR's extra argument, if any, comes last in both places

### Requirement: ADR numbering without collision
docs/adr MUST keep docs/adr/0004-servidores-mcp.md unchanged, and the PR's self-update ADR MUST be docs/adr/0005-autoactualizacion.md with header `# ADR 0005 — …`, so no two ADRs share a number.

#### Scenario: Unique ADR numbers
- **WHEN** listing docs/adr
- **THEN** 0004-servidores-mcp.md and 0005-autoactualizacion.md exist, no 0004-autoactualizacion.md exists, and every NNNN prefix is unique

#### Scenario: References follow the rename
- **WHEN** grepping the repository for `0004-autoactualizacion`
- **THEN** there are no matches

### Requirement: Repository checks pass
After the merge, `npm run typecheck`, `npm test` and `npx openspec validate --all` MUST all succeed, README.md and README.es.md MUST keep the same structure (test/docs.test.ts), and AGENTS.md MUST describe both main's install freshness and the PR's self-update.

#### Scenario: All checks green
- **WHEN** running the three commands on the merged tree
- **THEN** each one exits 0

#### Scenario: AGENTS.md mentions both
- **WHEN** reading AGENTS.md
- **THEN** it contains entries for src/install-freshness.ts and src/self-update.ts

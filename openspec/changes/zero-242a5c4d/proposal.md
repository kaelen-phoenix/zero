# Proposal

## Why

Pull request #165 adds the factory's self-update: with `selfUpdate: { enabled: true }`, zero updates its own installation after its changes merge, and rolls back if the new version doesn't start. It can't merge because it conflicts with main, and zero won't retry the automatic resolution. This job joins that work with today's main on this job's own branch. It keeps everything the pull request added (self-update, `zero --version`, status, panel and briefing lines, README, ADR) and everything main added since (installed-copy freshness, MCP servers, unjam, and the rest). The pull request's ADR moves to number 0005, because main already uses 0004. You get a new pull request with no conflicts, and its typecheck, tests and specs pass. It replaces #165.

## What Changes

- Merge pull request #165 (self-update) with current main
- Supuesto: This job delivers on its own branch (zero/242a5c4d), not on zero/7dd6e0f1, so its pull request replaces #165 instead of updating it. Someone has to close #165 by hand once this one merges.
- Supuesto: If the build station's commit flow makes a plain commit instead of keeping MERGE_HEAD, the result is a squashed merge without b02d8f2 as an ancestor. The build should finish the merge itself (`git merge` and then commit the resolution) so both parents are recorded.
- Supuesto: Main added install freshness (src/install-freshness.ts, `installRoot`) after #165 branched. Self-update has its own `installFolder` and its own git checks. Both are kept as they are, which duplicates install-root logic but changes no behaviour.
- Supuesto: The PR's tests were written against main as of 167e0b7. Fixtures that build a FactoryStatus or call renderBriefing by position may need adjustments for parameters main added since.
- Supuesto: PR #165 was never reviewed on top of current main. The self-update gate in the daemon loop (`selfReady`) has to sit correctly beside main's newer loop logic (waitsForBox, ownerFirst, urgent limits, idle passes) so that jobs aren't started or blocked by mistake.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Merge pull request #165 (self-update) with current main

## Impact

Generado por zero para el trabajo 242a5c4d.

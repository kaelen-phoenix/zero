# Spec Delta

## ADDED Requirements

### Requirement: Conflict files rewritten with diff3 markers before the agents
After `resolveWithAgents` redoes the merge of the base (`copy.mergeBase`) and before it builds the conflict blocks, it MUST rewrite each conflicted path that has the three stages of a regular file (base, ours, theirs) with `git checkout --conflict=diff3 -- <path>` run through `spawnGit`. A path that lacks the three stages, is binary or fails the checkout SHALL be left exactly as the merge left it, without failing the agent call.

#### Scenario: Text file gets the base section
- **WHEN** a delivered pull request's job changed `shared.txt` from `base` to `job`, the base branch changed it to `theirs`, and a conflict agent is configured
- **THEN** when the agent is called, the work copy's `shared.txt` contains `<<<<<<<`, `job`, a `|||||||` line, `base`, `=======`, `theirs` and `>>>>>>>`, in that order

#### Scenario: File without a base stage left as is
- **WHEN** the shared helper is called on a path added on both sides (no stage 1) in a real temporary repository with a merge in progress
- **THEN** it returns false and the file's content is byte-for-byte what `git merge` left

### Requirement: Single helper shared with resolveSimply
`src/line/conflicts.ts` SHALL export one function that checks the three stages and runs `git checkout --conflict=diff3` for a path, returning whether the file now has diff3 markers. Both `resolveSimply` and `resolveWithAgents` MUST use it, and `resolveSimply` MUST keep its current behaviour: all files or none, and false for a missing stage, a failed checkout or a binary file.

#### Scenario: resolveSimply unchanged
- **WHEN** the existing `resolveSimply` tests in test/conflicts.test.ts run (all simple, one not simple, added on both sides)
- **THEN** they pass unchanged

#### Scenario: Helper on a regular conflict
- **WHEN** the helper is called on a regular-file path in conflict, in a real git repository in a temporary directory
- **THEN** it returns true and the file contains a line matching `^\|{7}`

### Requirement: Prompt carries and explains the base section
`conflictBlocks` MUST keep the `|||||||` line and the base lines inside each block, and the conflict agent's prompt SHALL say that, in each block, the section between `|||||||` and `=======` is the common base: the version before either side changed it.

#### Scenario: Prompt shows the base section
- **WHEN** a conflict agent is called for `shared.txt` (job side `job`, base `base`, base-branch side `theirs`) through `runJob` with a fake agent and a real git repository in a temporary directory
- **THEN** the prompt matches `<<<<<<<[^\n]*\njob\n\|{7}[^\n]*\nbase\n=======\ntheirs\n>>>>>>>` and contains an explanation that the part between `|||||||` and `=======` is the common base

#### Scenario: conflictBlocks keeps the base
- **WHEN** `conflictBlocks` reads a file whose block is `<<<<<<< ours`, `a`, `||||||| base`, `o`, `=======`, `b`, `>>>>>>> theirs`
- **THEN** the returned text contains all seven lines in order

### Requirement: Leftover base markers still rejected
`judgeResolution` MUST keep rejecting a resolution whose file still holds any conflict marker, including a line starting with `|||||||`; the agent's work is then discarded and the job goes on to the next agent or to build with `conflictFeedback`.

#### Scenario: Base marker left
- **WHEN** the conflict agent answers `resolved` for `shared.txt` but leaves a `||||||| base` line in it (and no `<<<<<<<` or `>>>>>>>`)
- **THEN** its span outcome is `invalid`, its work is discarded, and build is called with feedback containing the `conflictFeedback` text

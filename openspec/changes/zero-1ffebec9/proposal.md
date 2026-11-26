# Proposal

## Why

From now on, nothing zero publishes carries the name of a particular AI. That covers commits, branches, pull requests, merge messages and comments on GitHub, Linear and Jira, whatever engine did the work. zero checks this itself and does not trust the engine. - **Agent commits:** if an agent leaves lines such as "Co-Authored-By: Claude …", "🤖 Generated with …" or a session link in its commits, zero removes them before integrating or pushing the branch. It changes nothing else in the commit. It only touches the job's own commits that have not been published yet. It never rewrites commits of the base branch or of another person, and it never force-pushes. - **Published text:** the same cleanup applies to the pull request title and description, merge messages and comments. - **Human co-authors stay:** a co-author line that names a real person is kept. - **zero's own signature stays:** "Built-by: zero in the loop" is not AI attribution and is not removed. - **One list:** what counts as AI attribution is kept in one generic list that can be extended. - **Claude engine:** its own attribution setting is also turned off. - **Unchanged:** reports, traces and the panel still say which engine and model did each step. - **AGENTS.md:** gains the rule, so people working on the repo by hand follow it too.

## What Changes

- Commits and published text never credit an AI tool
- Supuesto: Assumption: "not yet published" means not reachable from the base, any refs/remotes/* ref, or a head zero already pushed. A commit pushed somewhere without a tracking ref would be rewritten. It is still never force-pushed, so in that case the push fails and nothing is forced.
- Supuesto: In a box clone the cleanup runs in the line repository after publish, so the clone keeps its original commits. The next publish force-fetches them back and the cleanup runs again. Determinism (same dates and identities) is what keeps the SHAs stable and the pushes fast-forward.
- Supuesto: The rewrite drops GPG signatures of the rewritten commits. They are only the job's own unpublished commits.
- Supuesto: Updating the ref of a branch checked out in a worktree is safe only because the tree is identical. The cleanup must not run while a merge is in progress in that copy.
- Supuesto: Making signedIssues/signedMerges always wrap may break existing tests that compare identity with the original api. Those tests need adjusting, not the behaviour.
- Supuesto: The pattern list must not match zero's configurable signature. A signature text the person in charge writes as "Generated with <an AI tool>" would be stripped. That is accepted by design.
- Supuesto: Only the Claude engine exposes an attribution setting today. Codex, Antigravity, OpenCode, ACP and custom engines rely on the code-side cleanup.
- Supuesto: The build station itself runs Claude Code with a harness that asks for Co-Authored-By lines. The new convention and the Claude setting override that, and the commits of this change must not carry them either.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Commits and published text never credit an AI tool

## Impact

Generado por zero para el trabajo 1ffebec9.

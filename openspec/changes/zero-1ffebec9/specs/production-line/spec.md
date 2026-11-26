# Spec Delta

## ADDED Requirements

### Requirement: Single extensible list of AI attribution
zero MUST define what counts as AI-tool attribution in a single module (src/attribution.ts), as a generic list of patterns that can be extended. It MUST expose a function that removes those lines from a text and leaves every other line (including the factory's own signature trailer and text) unchanged.

#### Scenario: AI co-author removed
- **WHEN** stripAttribution is given a message whose trailers include `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `Co-authored-by: Codex <codex@openai.com>`, `Claude-Session: https://claude.ai/code/session_x` and a line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- **THEN** none of those lines remain, the subject and body are unchanged, and no run of more than one blank line or trailing blank line is left where they were

#### Scenario: Human co-author kept
- **WHEN** stripAttribution is given a message with `Co-Authored-By: Ana Pérez <ana@example.com>` next to an AI co-author line
- **THEN** the human line is kept exactly and only the AI line is removed

#### Scenario: Factory signature kept
- **WHEN** stripAttribution is given a message ending with `Built-by: zero in the loop <https://zerointheloop.com>` or the default signature text
- **THEN** the text comes back identical

#### Scenario: Case and vendors
- **WHEN** lines name Gemini/Antigravity (google.com noreply addresses), OpenCode, Copilot or Cursor as co-author, in any letter case of the trailer key
- **THEN** they are recognised as AI attribution and removed

### Requirement: Unpublished job commits cleaned before integrating or pushing
Before zero integrates a job's branch (merge, branch or pull-request mode, including updating an existing pull request) or pushes its progress, it MUST rewrite the job's unpublished commits whose messages contain AI attribution, so that only the attribution lines are removed. The tree, parents (re-mapped within the rewritten range), author and committer (name, email and date) MUST stay unchanged.

#### Scenario: Agent commit cleaned
- **WHEN** a job's branch has a commit, made by an agent in its copy, whose message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`, and the job integrates
- **THEN** the integrated branch has no commit message containing that line, and each rewritten commit has the same tree, author, author date, committer and committer date as the original

#### Scenario: Clean branch untouched
- **WHEN** no commit of the job's branch carries AI attribution
- **THEN** the branch tip SHA is the same before and after the cleanup

#### Scenario: Deterministic
- **WHEN** the cleanup runs twice over the same original commits
- **THEN** it produces the same commit SHAs both times

### Requirement: Never rewrite base, published or foreign commits, never force
The cleanup MUST only rewrite commits reachable from the job's branch and not reachable from the line's base, from any remote-tracking ref, or from a head that zero already pushed (such as the existing pull request's head). The cleanup MUST NOT force-push.

#### Scenario: Base commit kept
- **WHEN** a commit on the base branch carries `Co-Authored-By: Claude <noreply@anthropic.com>` and a job branch starts from it
- **THEN** that commit keeps its SHA and message after the cleanup

#### Scenario: Already pushed commit kept
- **WHEN** a job commit with AI attribution is already reachable from refs/remotes/origin/<branch> (or is the head of the pull request being updated) and a newer unpublished commit also has attribution
- **THEN** only the newer commit is rewritten, the published one keeps its SHA, and the following push is a fast-forward

### Requirement: Published text cleaned
The pull request title and body, the messages of the merge commits zero makes, and every comment or issue zero publishes through its signed adapters (GitHub issues, automatic merge, Linear, Jira) MUST have AI attribution removed, whether or not a signature is configured.

#### Scenario: Pull request
- **WHEN** a job's spec title or delivery body contains `Generated with [Claude Code](https://claude.com/claude-code)` and the line integrates as pull-request
- **THEN** the title and body passed to openPullRequest do not contain it

#### Scenario: Comment without signature
- **WHEN** signedIssues or signedMerges wraps an api with signature undefined and a comment body contains an AI co-author line
- **THEN** the body reaching the api lacks that line

#### Scenario: Merge message
- **WHEN** mergeIntoBase merges a job whose title contains an AI attribution line
- **THEN** the merge commit message on the base lacks it

### Requirement: Claude engine attribution off
The Claude engine's options MUST turn off Claude Code's own commit and pull request attribution through its settings (`attribution` with empty commit and pr texts and no session URL). Other engines are left as they are, and no file outside src/engines/ names a vendor setting.

#### Scenario: Options
- **WHEN** claudeOptions builds the options for any request
- **THEN** options.settings.attribution hides the commit and pr attribution (empty strings) and the session URL, while disableAllHooks and autoMemoryEnabled are still set

### Requirement: Observability unchanged
Which engine and model did each step MUST still appear in the report, the trace and the panel, as before.

#### Scenario: Existing tests
- **WHEN** the existing engine, telemetry and panel test suites run
- **THEN** they pass without changes to their engine or model expectations

### Requirement: Repository convention
The Conventions section of AGENTS.md MUST state that no commit, branch, pull request or comment carries attribution to an AI tool, that a person's co-authorship is kept, and that the list lives in src/attribution.ts.

#### Scenario: Docs test
- **WHEN** test/docs.test.ts reads the Conventions section of AGENTS.md
- **THEN** it finds a line that mentions attribution and src/attribution.ts

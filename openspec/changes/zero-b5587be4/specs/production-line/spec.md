# Spec Delta

## ADDED Requirements

### Requirement: Custom agent type conflict
The factory file SHALL accept `type: conflict` for custom agents in `agents`, `lines[].agents` and package manifests; such an agent MUST get `access: write`, MUST refuse `after`, `files`, `blocking: false` and an `access` other than `write`, and MUST be listed by `agentList`, `zero agent list` and the panel's agents page as a conflict resolver.

#### Scenario: Conflict agent parses
- **WHEN** a line declares `agents: [{ name: resolver, type: conflict }]`
- **THEN** the loaded line agent has type `conflict`, access `write` and instructions `.zero/agents/resolver.md`

#### Scenario: Files refused
- **WHEN** a conflict agent declares `files: ["src/**"]`
- **THEN** loading the factory file fails with an error naming `files`

#### Scenario: Package conflict agent
- **WHEN** a package manifest declares an agent with `type: conflict`
- **THEN** the package loads and its agent appears in `lineAgents` with type `conflict`

#### Scenario: Add from the CLI
- **WHEN** `addAgent` is called with `type: conflict`
- **THEN** it writes a conflict template to `.zero/agents/<name>.md` and an entry `{ name, type: conflict }` to the line in the factory file; it refuses `files` and `blocking: false` with that type

### Requirement: Conflict agents called before build
When merging the base for a job with a prRefreshKey mark leaves conflicted files that `resolveSimply` does not resolve, and the line has conflict agents, the runner MUST call them in `lineAgents` order before build, each starting from the merge redone at the mark's head and base commit, with the job's request (`requestBlock`), its specification, each conflicted path with its conflict blocks and the base commits that touched those paths (from the base commit, not reachable from the head), all framed as data. Each agent SHALL run with write access and a schema that gives, for every file, `resolved` or `returned` with a reason.

#### Scenario: Prompt carries the data
- **WHEN** a delivered pull request's job merges a base whose commit changed `shared.txt` in conflict and a conflict agent is configured
- **THEN** the agent is called once with station `build`, `custom.name` equal to the agent's name, a schema, and a prompt containing the request, the specification title, `shared.txt` with `<<<<<<<` blocks and the subject of the base commit that changed it

#### Scenario: Simple conflicts skip the agent
- **WHEN** the conflict is resolved by `resolveSimply`
- **THEN** no conflict agent is called

#### Scenario: Order
- **WHEN** two conflict agents are configured and the first returns a file
- **THEN** the second agent is called on a merge started again from the head, without the first one's changes

### Requirement: Accepting a resolution
zero SHALL accept a conflict agent's resolution only when its output marks every conflicted path `resolved`, `conflictMarkers` finds no markers in them and, after zero commits the merge, the branch contains both the mark's base commit and head; then the mark MUST become resolved and the job MUST resume at verify without spending an attempt, so verify, the reviews and the rest run as always.

#### Scenario: Accepted
- **WHEN** the conflict agent writes a resolved `shared.txt` without markers and answers `resolved` for it
- **THEN** no build call is made, the merge commit contains the base commit and the old head, verify runs, the job's attempt count is not increased by the merge, and the prRefreshKey mark has `resolved: true`

#### Scenario: Markers left
- **WHEN** the agent answers `resolved` but leaves `<<<<<<<` in the file
- **THEN** its work is discarded and the job goes to build with `conflictFeedback` as feedback

#### Scenario: Base not included
- **WHEN** the agent aborts the merge (for example `git merge --abort`) and answers `resolved`
- **THEN** its work is discarded, the branch is back at the head, and the job goes to build with `conflictFeedback`

### Requirement: Fallback to the current path
When there is no conflict agent, or every conflict agent returns a file, ends abnormally, gives no valid output, has missing instructions or fails validation, the runner MUST discard its changes and continue exactly as today: build with `conflictFeedback`, with the merge started again from the head on each build call. A job interrupted while a conflict agent runs MUST resume on that same path; a stop MUST still stop the job.

#### Scenario: No conflict agent
- **WHEN** the line has no conflict agent and the merge conflicts beyond `resolveSimply`
- **THEN** the behaviour, feedback and spans are the same as before the change (build is called with the conflict feedback)

#### Scenario: Agent returns a file
- **WHEN** the only conflict agent answers `returned` for `shared.txt` with a reason
- **THEN** build is called with feedback containing the `conflictFeedback` text, and the job can still be delivered

#### Scenario: Agent fails
- **WHEN** the conflict agent's run ends with `ok: false`
- **THEN** its changes are discarded and build resolves the conflict

#### Scenario: Missing instructions
- **WHEN** the conflict agent's instructions file does not exist
- **THEN** the agent is not called, a skipped span records the missing path, and build resolves the conflict

### Requirement: Recorded in spans and trace
Every conflict agent call MUST produce a `zero.station.<agent>` span under the job span with `zero.agent.type: conflict`, the number of conflicted files, how many it resolved and returned, and an outcome (`resolved`, `returned`, `failed` or `invalid`) with a short reason, and `renderTrace` SHALL show that outcome in `zero trace`.

#### Scenario: Span attributes
- **WHEN** a conflict agent resolves one file
- **THEN** a span `zero.station.<agent>` exists with `zero.agent.type` = `conflict`, `zero.conflicts.files` = 1, `zero.conflicts.resolved` = 1 and `zero.conflicts.outcome` = `resolved`

#### Scenario: Trace line
- **WHEN** `renderTrace` renders a span with `zero.conflicts.outcome` = `returned` and `zero.conflicts.returned` = 1
- **THEN** its line contains the word `conflictos` and the outcome

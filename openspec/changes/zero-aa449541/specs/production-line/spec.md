# Spec Delta

## ADDED Requirements

### Requirement: The production-line spec includes the expired-session requirements
openspec/specs/production-line/spec.md MUST contain the six requirements added by the change zero-7ab160a7, with all their scenarios, and the requirements it already had MUST stay unchanged. The six are: 'Claude reports an expired session with a neutral signal', 'The signed-out mark reaches the agent run and its span', 'A signed-out engine is paused for a bounded wait with a sign-in reason', 'A signed-out call goes on with a replacement', 'A signed-out call without replacement sends the job back to the queue without spending tries' and 'A failed job without a spec can be retried from the start'.

#### Scenario: requirements present
- **WHEN** openspec/specs/production-line/spec.md is read after the archive
- **THEN** it has a '### Requirement:' heading for each of the six names, and each one has the same scenarios as in the change's delta (4, 2, 3, 1, 3 and 3)

#### Scenario: existing requirements kept
- **WHEN** the requirement headings of the spec are compared before and after the archive
- **THEN** every heading from before is still there, and the only new ones are the six from the change

### Requirement: The change is moved to the archive
The folder openspec/changes/zero-7ab160a7 MUST NOT exist after the archive, and its proposal.md, tasks.md and specs/production-line/spec.md MUST be under openspec/changes/archive/<YYYY-MM-DD>-zero-7ab160a7/, following the naming of the archived changes already there.

#### Scenario: folder moved
- **WHEN** openspec/changes is listed
- **THEN** zero-7ab160a7 is no longer there, and openspec/changes/archive/ has exactly one folder whose name ends with -zero-7ab160a7 and that contains proposal.md and tasks.md

### Requirement: OpenSpec validation passes
`npx openspec validate --all` MUST pass after the archive, and no file under src/ or test/ SHALL change.

#### Scenario: validate
- **WHEN** npx openspec validate --all is run
- **THEN** it exits with code 0

#### Scenario: no code change
- **WHEN** git diff --name-only main is run
- **THEN** it lists only files under openspec/ (and the openspec change of this job)

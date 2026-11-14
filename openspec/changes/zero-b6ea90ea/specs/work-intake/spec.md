# Spec Delta

## ADDED Requirements

### Requirement: Proposal issue title breaks @mentions
The title of the GitHub issue that syncProposalIssues creates for a proposal MUST have every @mention of the proposal's title broken with a zero-width space (`@​<name>`) and MUST NOT contain the bare `@<name>`.

#### Scenario: Title with a mention
- **WHEN** a pending proposal on a GitHub line with title `Avisar a @alguien` is synced with the fake IssueApi
- **THEN** the createIssue call's title contains `@​alguien` and does not contain `@alguien`

### Requirement: Proposal issue body breaks @mentions
The body of the GitHub issue that syncProposalIssues creates for a proposal MUST have every @mention of the proposal's `why` broken with a zero-width space and MUST NOT contain the bare `@<name>`.

#### Scenario: Why with a mention
- **WHEN** a pending proposal whose `why` is `lo pidió @alguien` is synced with the fake IssueApi
- **THEN** the createIssue call's body contains `@​alguien` and does not contain `@alguien`

### Requirement: Rejection comment breaks @mentions
The comment that syncProposalIssues posts on a proposal's issue when the proposal is rejected in the factory MUST have every @mention of the rejection reason broken with a zero-width space and MUST NOT contain the bare `@<name>`.

#### Scenario: Rejection reason with a mention
- **WHEN** a published proposal is rejected through rejectProposal with reason `preguntale a @alguien` and synced again
- **THEN** the comment posted on its issue contains `@​alguien` and does not contain `@alguien`

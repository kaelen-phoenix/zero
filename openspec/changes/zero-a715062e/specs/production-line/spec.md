# Spec Delta

## ADDED Requirements

### Requirement: Catalog accepts conflict findings
`acceptFindings` SHALL accept a finding whose type is `review`, `build` or `conflict`, storing that type on the entry. A finding with any other type MUST be dropped with the reason "el tipo no es review, build ni conflict".

#### Scenario: conflict finding stored
- **WHEN** acceptFindings receives a clean, MIT-licensed finding with type `conflict`, a new https source and a new name
- **THEN** it returns one entry with `type: "conflict"` and status `listed` (or `proposed` when it names a known line and a gap)

#### Scenario: unknown type dropped
- **WHEN** acceptFindings receives a finding with type `deploy`
- **THEN** no entry is returned and the drop reason is exactly "el tipo no es review, build ni conflict"

### Requirement: Adding a conflict entry from the catalog
`addFromCatalog`, once confirmed, MUST add a catalog entry of type `conflict` to the line through `addAgent` as a `conflict` agent: blocking, with no `files`, and with its factory-file entry being `{ name, type: conflict }`. It MUST mark the catalog entry `added`, as it does for the other types.

#### Scenario: conflict entry added as conflict
- **WHEN** a listed catalog entry with type `conflict` is added to line `demo` with a confirm that answers yes
- **THEN** `agentList(ctx, "demo")` lists that agent with type `conflict`, the factory file has the agent with `type: conflict` and no `files` or `blocking: false`, the instructions file exists with the source header, and the catalog entry is `added` for `demo`

#### Scenario: no confirmation writes nothing
- **WHEN** a conflict catalog entry is added without confirmation
- **THEN** the factory file and the line's repository are unchanged and the entry stays `listed`

### Requirement: Conflict template for entries without instructions
`catalogInstructions` SHALL use the conflict-resolver template body, after the source header, for a `conflict` entry that brings no instructions. A `review` entry MUST keep the reviewer template and a `build` entry the writer template.

#### Scenario: empty conflict instructions
- **WHEN** catalogInstructions is called for a `conflict` entry with empty instructions
- **THEN** the content holds the source header and the conflict template text (for example "conflict resolver" and the `resolved`/`returned` rule), and not the reviewer's "## What to check"

### Requirement: Catalog shows the conflict type
`formatCatalog` MUST describe a `conflict` entry's type as `conflict (resuelve conflictos al traer la rama base, antes de build)`, keep the existing texts for `build` and `review`, and never show a conflict entry as review. The panel's catalog card and confirmation page SHALL show the entry's type `conflict`.

#### Scenario: CLI text
- **WHEN** formatCatalog is given a conflict entry
- **THEN** the output contains "Tipo: conflict (resuelve conflictos al traer la rama base, antes de build)" and that entry's block does not contain "Tipo: review"

#### Scenario: panel card
- **WHEN** agentsPage renders a catalog with a conflict entry
- **THEN** the entry's card contains "Tipo: <b>conflict</b>"

### Requirement: Recruiter knows the third type
agents/recruit.md MUST name three custom agent types (`review`, `build` and `conflict`). It MUST say that a `conflict` agent runs with write access when merging the base branch into a job's branch leaves conflicts that zero's resolution without a model cannot resolve, before build. It MUST list `conflict` as a valid `type` of a finding.

#### Scenario: instructions mention conflict
- **WHEN** a test reads agents/recruit.md
- **THEN** it contains "`conflict`" in the type list of a finding ("`review`, `build` or `conflict`") and no longer says "custom agents of two types"

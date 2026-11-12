# Spec Delta

## ADDED Requirements

### Requirement: MCP servers decision record
The repository MUST contain the decision record docs/adr/0004-servidores-mcp.md, written in Spanish, with the header used by the earlier ADRs (title `# ADR 0004 — ...`, `**Estado:**` and `**Fecha:**`) and the sections `## Contexto`, `## Decisión` and `## Consecuencias`.

#### Scenario: ADR present with its sections
- **WHEN** a test reads docs/adr/0004-servidores-mcp.md
- **THEN** the file exists, its first line starts with `# ADR 0004`, and it contains `**Estado:**`, `**Fecha:**`, `## Contexto`, `## Decisión` and `## Consecuencias`

### Requirement: Evaluation per station
The decision record MUST evaluate MCP servers for each station: spec, build, verify, review, security, scout, research and reply. For each station it SHALL say which servers would help (or that none would) and with what risk.

#### Scenario: every station is covered
- **WHEN** a test reads the ADR
- **THEN** it names each of `spec`, `build`, `verify`, `review`, `security`, `scout`, `research` and `reply` in backticks

### Requirement: Catalog servers evaluated
The decision record MUST evaluate at least these servers from GitHub's catalog: Playwright, Chrome DevTools, GitHub, Serena and Skyvern.

#### Scenario: named servers present
- **WHEN** a test reads the ADR
- **THEN** it contains `Playwright`, `Chrome DevTools`, `GitHub`, `Serena` and `Skyvern`

### Requirement: Risk dimensions stated
The decision record MUST cover, for the servers it recommends or rejects, the risk in credentials, network access (the box and the egress gate) and writing outside the work copy. It SHALL also cover the rule that guarantees are enforced by zero and never by the engine.

#### Scenario: risk vocabulary present
- **WHEN** a test reads the ADR
- **THEN** it mentions credentials (`credencial`), the egress gate (`puerta`), the work copy (`copia de trabajo`) and the guarantee rule (`garantías`)

### Requirement: Current engine MCP exposure recorded
The decision record MUST say what each engine loads today. The Claude engine runs with `strictMcpConfig` and no servers. The ACP engine sends `mcpServers: []`. `codex exec`, opencode and agy are started without disabling MCP servers from the user's own configuration, which can include zero's own chat server. The record SHALL mark that last point as unverified, to be checked with a real run.

#### Scenario: engine facts present
- **WHEN** a test reads the ADR
- **THEN** it contains `strictMcpConfig` and `mcpServers`

### Requirement: Own MCP server in the catalog
The decision record MUST give a recommendation on publishing zero's own MCP server (`zero mcp`, the chat tools) in GitHub's MCP catalog, with its reasons.

#### Scenario: publication decision present
- **WHEN** a test reads the ADR
- **THEN** it mentions `zero mcp` and the word `catálogo`

### Requirement: Concrete next requests
The decision record MUST end its decision with a list of concrete next requests. Each one SHALL be small enough to send as a single zero job.

#### Scenario: next requests section
- **WHEN** a test reads the ADR
- **THEN** it has a heading containing `Próximos pedidos` followed by at least three list items

### Requirement: Research only, nothing installed
The change MUST NOT modify anything under src/, agents/, box/, docker/, package.json or package-lock.json, and MUST NOT add any MCP configuration (such as .mcp.json) to the repository.

#### Scenario: no code or config touched
- **WHEN** the change's diff is listed against the base branch
- **THEN** it touches only docs/adr/0004-servidores-mcp.md, the new test file and the job's own openspec change

### Requirement: Wording rules hold
The decision record MUST follow the repository's wording rules: it says `vos` or `quien está a cargo` / `la persona responsable`, and it never uses the forbidden word that test/wording.test.ts checks for.

#### Scenario: wording test passes
- **WHEN** `npm test` runs test/wording.test.ts
- **THEN** it passes with the new ADR among the docs files

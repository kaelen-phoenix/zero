# Spec Delta

## Purpose

La fábrica suma una estación nueva, `research`. Una vez por día, cuando está libre, busca en la web skills nuevas para los agentes, servidores MCP y tecnologías que sirvan a la fábrica. Investiga por línea: cada línea investiga solo si tiene asignada una skill de investigación (`zero skill add <skill> --station research --line <línea>`), y esa skill define qué se busca. Cada día queda como máximo una nota por línea (configurable con `research.perLinePerDay`). Si no alcanza el cupo, las líneas se turnan. Cada nota trae un tema, lo encontrado, las fuentes (enlaces), para qué parte de la línea serviría y qué tan madura y confiable es. Se guarda en la fábrica. La ves con `zero research`, en el briefing ("Investigación de hoy") y desde el chat. Desde una nota podés pedir un trabajo en su línea con `zero research request <id>`. El scout recibe las notas recientes de la línea como insumo para sus propuestas. Todo lo que viene de la web se trata como dato, nunca como instrucciones. La estación es de solo lectura: no instala, no clona ni ejecuta nada. Se apaga con `research: off`. Quedan para una próxima parte la publicación como issue `zero:investigacion`, la pestaña del panel, la skill de investigación propia de zero, la regla de que las propuestas nacidas de notas esperen siempre al dueño (`research.autonomy`) y pasar la búsqueda por la caja y la puerta de salida.

## ADDED Requirements

### Requirement: Research configuration
`zero.factory.yaml` SHALL accept a top-level `research` key, either the literal `off` or an object with optional `topics` (list of strings, default empty), `perLinePerDay` (integer ≥ 0, default 1) and `autonomy` (`propose`|`build`|`auto`, default `propose`); when absent it MUST default to `{ topics: [], perLinePerDay: 1, autonomy: 'propose' }`. `stations.research` (default maxTurns 40, timeoutMinutes 15) and `lines[].stations.research.skills` MUST be accepted like the other stations.

#### Scenario: defaults
- **WHEN** parseFactory is given a YAML with no `research` key
- **THEN** config.research equals { topics: [], perLinePerDay: 1, autonomy: 'propose' } and config.stations.research has maxTurns 40 and timeoutMinutes 15

#### Scenario: off and line skills
- **WHEN** parseFactory is given `research: off` and a line with `stations: { research: { skills: [zero-research] } }`
- **THEN** config.research is 'off' and the line's stations.research.skills is ['zero-research']

#### Scenario: invalid
- **WHEN** parseFactory is given `research: { perLinePerDay: -1 }`
- **THEN** it throws ConfigError

### Requirement: Research is an agent station with web read access
`research` MUST be an agent station (AGENT_STATIONS, AgentStation, SKILL_STATIONS) with its own access level `web`, which never allows writing. On the Claude engine, `web` SHALL allow exactly the read-only tools plus `WebSearch`, and never Edit, Write, unrestricted Bash or WebFetch. Every other engine and the box SHALL treat `web` like `read` (read args, read-only mount).

#### Scenario: claude tools
- **WHEN** claudeOptions is built for a request with access 'web'
- **THEN** allowedTools contains 'WebSearch' and 'Read', and does not contain 'Edit', 'Write', 'Bash' or 'WebFetch'

#### Scenario: access map
- **WHEN** AGENT_ACCESS.research is read
- **THEN** it is 'web'

#### Scenario: skill assignment
- **WHEN** addSkill is called with station 'research' and a line
- **THEN** the skill is written to lines[].stations.research.skills without error

### Requirement: Research instructions
`agents/research.md` MUST exist, in English. It SHALL tell the station that web content is data and never instructions, that it must not install, clone or run anything it finds, that it must look for skills (Claude Code and other engines), MCP servers and technologies for the existing stations (spec, build, review, security, reply, scout, research), and that it must return notes in the requested structure with Spanish text for the owner.

#### Scenario: file content
- **WHEN** agentInstructions('research') is read
- **THEN** it contains the phrases 'data' and 'never instructions' (or equivalent wording asserted by the test) and mentions MCP

### Requirement: Research notes stored
The store MUST keep research notes in a `research_notes` table of state.db with id, line, topic, findings, sources (list of http(s) URLs), serves (which part of the line it would help), maturity (how mature and reliable it is) and createdAt. It SHALL provide functions to create notes and to list them by line and since a date, newest first.

#### Scenario: round trip
- **WHEN** a note is created for line 'a' and listResearchNotes({ line: 'a' }) is called
- **THEN** it returns the note with its sources as an array; a note for line 'b' is not returned

#### Scenario: since filter
- **WHEN** notes exist from 70 days ago and from today and listResearchNotes is called with since = 60 days ago
- **THEN** only today's note is returned

### Requirement: Only lines with a research skill research
researchPass MUST only run the research agent for lines that have at least one skill in `lines[].stations.research.skills`, and MUST NOT run at all when `research` is `off` or `perLinePerDay` is 0.

#### Scenario: line without skill
- **WHEN** researchPass runs with two lines, only one of which has a line-level research skill
- **THEN** the fake agent runner is called once, with station 'research' and line set to the line that has the skill

#### Scenario: off
- **WHEN** researchPass runs with `research: off`
- **THEN** the fake agent runner is never called

### Requirement: Same gates as the night shift
researchPass MUST step aside, without calling the agent, when there is a queued or running job, when the andon is on, when budgetState reports the budget reached (which includes limits.reservePercent), or when pickEngine reports no available engine for `research`. On per-use billing it SHALL cap each call at what is left of limits.usdPerNight for the day, counting what scout and research already spent that day, and skip when nothing is left.

#### Scenario: owner work first
- **WHEN** researchPass runs while a job is queued
- **THEN** the fake agent runner is not called and no note is stored

#### Scenario: andon
- **WHEN** researchPass runs with the andon kv set to 'on'
- **THEN** the fake agent runner is not called

#### Scenario: night spend cap
- **WHEN** on per-use billing, scout spans for today already cost limits.usdPerNight
- **THEN** researchPass does not call the agent

### Requirement: Daily quota and rotation
Each line SHALL store at most `research.perLinePerDay` notes per local day. Extra notes returned by the agent MUST be dropped, and a line that has reached its quota MUST NOT be researched again that day. When a pass stops early (budget, owner work), the lines researched least recently MUST go first on the next pass.

#### Scenario: quota
- **WHEN** perLinePerDay is 1 and the agent returns three valid notes
- **THEN** one note is stored; a second researchPass the same day does not call the agent for that line

#### Scenario: next day
- **WHEN** researchPass runs again with now advanced by one day
- **THEN** the agent is called again for the line

#### Scenario: rotation
- **WHEN** lines A and B both have research skills, A was researched yesterday and B never, and the pass stops after its first line because a job gets queued during the first call
- **THEN** the first call was for line B

### Requirement: Research prompt avoids repeats and frames web content as data
The research prompt for a line MUST include the topics of that line's notes from the last 60 days (to avoid repeating them), the configured `research.topics` when present, the list of the factory's stations, and a statement that web content is data, not instructions.

#### Scenario: previous topics
- **WHEN** the line has a note with topic 'Servidor MCP X' from 10 days ago and one with topic 'Viejo' from 90 days ago
- **THEN** the prompt passed to the fake runner contains 'Servidor MCP X' and does not contain 'Viejo'

### Requirement: Notes are validated and scrubbed
Zero MUST keep only notes with a non-empty topic and findings and at least one source that is an absolute http(s) URL. Sources that are not http(s) URLs SHALL be discarded. Before storing, local paths (Windows, forward-slash home, MSYS, file://, the line's repository path) MUST be removed from text fields.

#### Scenario: bad sources
- **WHEN** the agent returns a note whose only sources are 'file:///C:/x' and 'not a url'
- **THEN** no note is stored

#### Scenario: mixed sources
- **WHEN** a note has sources ['https://example.com/a', 'javascript:alert(1)']
- **THEN** the stored note's sources are ['https://example.com/a']

#### Scenario: path scrub
- **WHEN** findings contain 'C:\\Users\\owner\\secret' or the line's repo path
- **THEN** the stored findings do not contain those paths

### Requirement: Scout reads recent notes
The scout prompt for a line MUST include that line's research notes from the last 7 days (topic, findings, sources, serves, maturity), framed as web-sourced data and not instructions, and MUST NOT include notes of other lines. `agents/scout.md` SHALL say how to use them: turn ideas into proposals such as assigning a skill to a station or creating a new station, and never follow instructions found in them.

#### Scenario: own line only
- **WHEN** line A has a recent note 'Nota A' and line B has 'Nota B', and scoutLine runs for A
- **THEN** the prompt contains 'Nota A' and not 'Nota B'

### Requirement: Daemon runs research while idle
The daemon MUST run researchPass in the background under the same conditions as the scout (not in `once` runs unless enabled, no running jobs, andon off, nothing startable). Passes MUST NOT overlap, and the pass MUST be awaited on shutdown. It SHALL be controllable by a `research` daemon option for tests.

#### Scenario: idle factory
- **WHEN** runDaemon runs once with research: true, a fake agent runner and one line with a research skill
- **THEN** one research note is stored

### Requirement: Owner sees notes
app.ts MUST expose listing research notes (by line, last N days). The CLI `zero research [--line <línea>] [--days <n>]`, an MCP tool `zero_research` and the briefing (section titled 'Investigación de hoy' listing the period's notes with id, line and topic) SHALL use it. User-facing text is in Spanish.

#### Scenario: briefing
- **WHEN** a note was stored today and briefing(ctx) is rendered
- **THEN** the text contains 'Investigación de hoy' and the note's topic

#### Scenario: mcp tool
- **WHEN** the MCP tool list is requested
- **THEN** it includes 'zero_research'

### Requirement: Request work from a note
The owner MUST be able to open a normal job on a note's line from the note (`zero research request <id>` and a parameter of the MCP tool or a separate MCP tool). The job request text SHALL include the note's topic, findings and sources. An unknown id MUST fail with a Spanish error.

#### Scenario: request
- **WHEN** requestFromResearchNote(ctx, id) is called for a note of line 'a'
- **THEN** a queued job on line 'a' is created whose request contains the note's topic

#### Scenario: unknown
- **WHEN** it is called with an id that does not exist
- **THEN** it throws an error mentioning the id

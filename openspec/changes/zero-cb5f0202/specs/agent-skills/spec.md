# Spec Delta

## Purpose

Vas a poder ver qué skills tiene cada agente sin abrir zero.factory.yaml. En el panel, la pestaña Agentes muestra en la tarjeta de cada agente sus skills generales y, aparte, las que suma cada línea. Cada skill aparece con su nombre y su descripción corta. Si una skill asignada no está instalada en tu Claude Code, aparece marcada como faltante con el motivo. El panel solo las muestra: no tiene botones ni formularios para cambiarlas. En el chat, la herramienta de proyectos (zero_lines) muestra las skills de cada agente, las generales y las de cada línea, y tampoco puede cambiarlas. En la traza de cada trabajo (zero trace o zero_trace), cada ejecución de un agente dice qué skills tuvo y cuáles le faltaron. Para asignar o quitar skills se sigue usando `zero skill` o el archivo.

## ADDED Requirements

### Requirement: Descripción corta de cada skill
Discovery SHALL read each skill's short description from the `description` field of its SKILL.md YAML frontmatter, parsed with a real YAML parser. When the frontmatter is missing, unparseable or has no string `description`, the skill MUST still be discovered, with no description, and discovery MUST NOT throw. The short description MUST be a single line (whitespace collapsed) of at most 200 characters, cut with an ellipsis when longer.

#### Scenario: con descripción
- **WHEN** a temp Claude home has skills/pdf/SKILL.md with frontmatter `description: Lee y genera PDF`
- **THEN** discovery returns skill `pdf` with description `Lee y genera PDF`

#### Scenario: sin frontmatter válido
- **WHEN** a SKILL.md has no frontmatter, or frontmatter that is invalid YAML
- **THEN** the skill is discovered with no description and no error is thrown

#### Scenario: descripción larga
- **WHEN** the description is 500 characters spread over several lines
- **THEN** the short description is one line of at most 200 characters ending in an ellipsis

### Requirement: Vista de skills por agente
app.ts SHALL provide one read-only operation that, for every agent station (spec, build, review, security, reply), returns its general skills (`stations.<agent>.skills`) and, separately, the skills each line adds (`lines[].stations.<agent>.skills`, only lines that add any). Each skill MUST carry the name as assigned, the full name and short description when it resolves, and a missing reason (the resolveSkill problem) when it does not. The panel and the chat MUST both use this operation.

#### Scenario: generales y por línea
- **WHEN** config assigns `pdf` to build globally, line `solilok` adds `vercel:nextjs` to build, and both are installed
- **THEN** the build entry lists `pdf` under general skills and `vercel:nextjs` under line `solilok`, each with its description and not missing

#### Scenario: faltante
- **WHEN** review is assigned `nope` and no such skill is installed
- **THEN** the review entry lists `nope` marked missing with reason `no está instalada en Claude Code`

### Requirement: Skills en la pestaña Agentes
The panel `/agents` page SHALL show, in each agent's card, a skills section with its general skills and, apart, one group per line that adds skills, naming the line. Each skill MUST show its name and short description (escaped). Missing skills MUST be marked as faltante with the reason. An agent with no skills MUST say it has none. The section MUST NOT contain forms, buttons or any action to change skills, and a POST to `/agents` MUST still change nothing.

#### Scenario: muestra nombre y descripción
- **WHEN** build has general skill `pdf` (description `Lee y genera PDF`) and line `solilok` adds `vercel:nextjs`, and the owner opens /agents with a session
- **THEN** the build card contains `pdf` with `Lee y genera PDF`, and a group for line `solilok` containing `vercel:nextjs`

#### Scenario: marca faltantes
- **WHEN** review is assigned a skill that is not installed
- **THEN** the review card shows that skill marked `faltante` with its reason

#### Scenario: sin skills
- **WHEN** spec has no skills assigned anywhere
- **THEN** the spec card says it has no skills

#### Scenario: solo lectura
- **WHEN** the /agents page is rendered with skills assigned
- **THEN** the HTML has no <form> or <button>, and a POST to /agents leaves zero.factory.yaml unchanged

#### Scenario: escapado
- **WHEN** a skill description contains `<script>`
- **THEN** the page contains it escaped and no raw `<script>` from the description

### Requirement: Skills en el chat
The MCP tool `zero_lines` SHALL return, besides each line's existing fields (name, repo, baseBranch, integrate, verify), the skills of each agent: the general ones per agent and, per line, the ones that line adds per agent, each with name, description and a missing marker when it does not resolve. `zero_lines` MUST remain read-only, and the chat MUST NOT gain any tool that changes skills.

#### Scenario: muestra skills
- **WHEN** build has general skill `pdf` and line `solilok` adds `vercel:nextjs` to build, and the chat calls zero_lines
- **THEN** the output names `pdf` for agent build in general and `vercel:nextjs` for build in line `solilok`, with their descriptions, and still includes each line's repo and baseBranch

#### Scenario: faltante en el chat
- **WHEN** a skill assigned to review is not installed
- **THEN** zero_lines marks it as missing with its reason

#### Scenario: sin herramientas de cambio
- **WHEN** the MCP tools are listed
- **THEN** the tool list is unchanged (no tool to add or remove skills) and zero_lines has readOnlyHint

### Requirement: Skills en la traza
Every agent run traced through createAgentRunner SHALL record on its `gen_ai.invoke_agent` span which skills the agent had in that run: attribute `zero.skills` with the full names of the skills given to it (comma-separated) and attribute `zero.skills.missing` with the assigned references that did not resolve. Each attribute MUST be absent when its list is empty. `zero trace` (and `zero_trace`) MUST show them on that run's line as `skills: <names>` and `skills faltantes: <names>`.

#### Scenario: registra skills por ejecución
- **WHEN** a fake agent run for build on line `solilok` with general `pdf` and line skill `vercel:nextjs` installed, traced to a job
- **THEN** the agent span has `zero.skills` = `pdf, vercel:nextjs` and trace(ctx, job) contains `skills: pdf, vercel:nextjs`

#### Scenario: registra faltantes
- **WHEN** the run's station is also assigned `nope`, which is not installed
- **THEN** the span has `zero.skills.missing` = `nope` and the trace shows `skills faltantes: nope`

#### Scenario: sin skills
- **WHEN** an agent runs with no skills assigned
- **THEN** its span has neither attribute and its trace line has no `skills` text

#### Scenario: por ejecución
- **WHEN** two runs of the same station happen in one job and skills change between them
- **THEN** each span records the skills of its own run

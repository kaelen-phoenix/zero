# Spec Delta

## Purpose

Vas a poder darles a los agentes de la fábrica (spec, build, review, security y reply) las skills que ya tenés instaladas en tu Claude Code: las personales de ~/.claude/skills y las de tus plugins. Las elegís por nombre, y si dos se llaman igual usás el nombre completo (plugin:skill). Las asignás para todas las líneas en `stations.<agente>.skills` o solo para un proyecto en `lines[].stations.<agente>.skills` (por ejemplo, el agente build de solilok suma nextjs y shadcn). Podés editarlas en zero.factory.yaml o con `zero skill add`, `zero skill remove` y `zero skill list`, que también muestra las disponibles. El chat no puede cambiarlas. Con Claude, el agente ve y activa solo las suyas. Con otros motores, zero agrega el texto de cada SKILL.md a sus instrucciones. Si una skill no existe, `zero status` lo avisa y el trabajo sigue sin ella. Las skills no les dan herramientas nuevas a los agentes: los de solo lectura las leen pero no pueden ejecutar sus scripts. Dentro de la caja se copian como solo lectura. Verlas en el panel y en las trazas queda para la parte 2.

## ADDED Requirements

### Requirement: Descubrimiento de skills instaladas
zero SHALL discover the available skills from the owner's Claude Code home: personal skills at `<claudeHome>/skills/<dir>/SKILL.md` (full name = the skill name) and skills of installed plugins listed in `<claudeHome>/plugins/installed_plugins.json` at `<installPath>/skills/<dir>/SKILL.md` (full name = `<plugin>:<skill>`, where plugin is the key before `@`). The Claude home MUST be injectable for tests (default `CLAUDE_CONFIG_DIR` or `~/.claude`). A missing or unreadable home or plugins file MUST yield an empty or partial list, not an error.

#### Scenario: personal y de plugin
- **WHEN** a temp Claude home has skills/pdf/SKILL.md and installed_plugins.json pointing plugin `vercel@mkt` to a dir with skills/nextjs/SKILL.md
- **THEN** discovery returns `pdf` (source personal) and `vercel:nextjs` (source plugin vercel), each with its directory

#### Scenario: sin home
- **WHEN** the Claude home directory does not exist
- **THEN** discovery returns an empty list without throwing

### Requirement: Resolución por nombre
A skill reference SHALL resolve by its short name when exactly one discovered skill has it, and by its full name `plugin:skill` otherwise. A short name shared by two or more skills MUST NOT resolve and MUST be reported as ambiguous, listing the full names to use.

#### Scenario: nombre único
- **WHEN** `nextjs` exists only in plugin vercel
- **THEN** reference `nextjs` resolves to `vercel:nextjs`

#### Scenario: ambiguo
- **WHEN** `lint` exists as a personal skill and in plugin `tools`
- **THEN** reference `lint` is unresolved with a problem naming `tools:lint` (and the personal one), and `tools:lint` resolves

### Requirement: Asignación por agente y por línea
The config SHALL accept `stations.<agent>.skills` (string list, default empty) for each of spec, build, review, security and reply, and `lines[].stations.<agent>.skills` per line. The skills an agent gets on a line MUST be the global list plus that line's list, without duplicates, in that order; other lines MUST get only the global list.

#### Scenario: suma por línea
- **WHEN** stations.build.skills=[a] and line solilok has stations.build.skills=[nextjs, shadcn, a]
- **THEN** build on solilok gets [a, nextjs, shadcn] and build on another line gets [a]

#### Scenario: agente inválido
- **WHEN** a line declares stations.verify.skills
- **THEN** parseFactory rejects the config

### Requirement: Skill que no existe
When an assigned skill does not resolve (missing or ambiguous), the agent run MUST proceed without it, and `zero status` SHALL list one warning per unresolved assignment naming the skill, the agent, the line when it is line-specific, and the reason.

#### Scenario: falta
- **WHEN** stations.review.skills=[ghost] and no skill `ghost` is installed
- **THEN** factoryStatus includes a skill warning for ghost/review, the CLI status text shows it, and a review agent run still executes with no skills

### Requirement: Comandos de skills
The CLI SHALL offer `zero skill add <skill> --station <agent> [--line <line>]`, `zero skill remove <skill> --station <agent> [--line <line>]` and `zero skill list`, through app.ts operations that edit zero.factory.yaml with editFactory (keeping comments). add MUST NOT duplicate an existing entry; an unknown agent or line MUST be refused with a Spanish message. list MUST show the assignments per agent (global and per line) and the available skills with their full names.

#### Scenario: agregar por línea
- **WHEN** `zero skill add nextjs --station build --line solilok` runs
- **THEN** the file has lines[solilok].stations.build.skills containing nextjs, other comments are kept, and running it again does not duplicate it

#### Scenario: quitar
- **WHEN** `zero skill remove a --station build` with a assigned globally
- **THEN** stations.build.skills no longer contains a

#### Scenario: agente inválido
- **WHEN** `zero skill add pdf --station verify`
- **THEN** the command fails with a message listing spec, build, review, security, reply

#### Scenario: listar
- **WHEN** `zero skill list` with discovered skills pdf and vercel:nextjs
- **THEN** the output lists assignments and the available names pdf and vercel:nextjs

### Requirement: El chat no cambia skills
The MCP server MUST NOT expose any tool that adds, removes or changes skill assignments.

#### Scenario: herramientas del chat
- **WHEN** the MCP tool list is inspected
- **THEN** no tool name or description refers to adding/removing skills

### Requirement: Activación nativa con Claude
For engines that support skills natively (claude), zero SHALL pass the agent's resolved skills so that only those are enabled: the Claude engine MUST load them from zero's staged copy as a local plugin (`plugins`) and set `skills` to exactly their names, so that with no assigned skills it sets `skills: []`. The Claude engine options MUST be produced by a pure, unit-tested builder.

#### Scenario: solo las asignadas
- **WHEN** the claude options builder gets a request with skills [pdf] staged at dir D
- **THEN** options.plugins contains a local plugin at D and options.skills enables only pdf

#### Scenario: sin skills
- **WHEN** the request has no skills
- **THEN** options.skills is an empty list and no plugin is added

### Requirement: Texto de la skill para otros motores
For engines without native skills, zero SHALL append each resolved skill's SKILL.md text to the agent's instructions, under a heading with the skill's full name, and MUST NOT do so for native engines.

#### Scenario: motor cli
- **WHEN** a custom engine runs a station with skill pdf whose SKILL.md says `PDF-BODY`
- **THEN** the instructions received by the engine contain the original station instructions followed by a section naming pdf and `PDF-BODY`

#### Scenario: motor claude
- **WHEN** the claude engine runs the same station
- **THEN** instructions equal the station instructions without the SKILL.md text

### Requirement: Las skills no cambian herramientas
Assigning skills MUST NOT change any agent's access level or allowed tools: the tools for a given access MUST be identical with and without skills, and zero's staged copy MUST remove any `allowed-tools` field from SKILL.md frontmatter so a skill cannot grant tools. Read-only stations (spec, review, security, reply) therefore can read a skill's files but cannot run its scripts; only build (write access) can.

#### Scenario: mismas herramientas
- **WHEN** the claude options are built for access read with and without skills
- **THEN** allowedTools is the same read list in both cases

#### Scenario: frontmatter saneado
- **WHEN** a skill's SKILL.md frontmatter has `allowed-tools: Bash`
- **THEN** the staged SKILL.md has no allowed-tools line and the rest of the file is unchanged

### Requirement: Skills dentro de la caja
When agents run in the isolation box, the staged skills directory SHALL be mounted read-only inside the container (fixed path, e.g. /skills, with `:ro`) for every station, and the request sent to the box MUST refer to the skills by their in-box paths. Without skills no extra mount MUST be added.

#### Scenario: montaje ro
- **WHEN** boxRunArgs gets a spec with a skills directory S
- **THEN** the args contain `-v S:/skills:ro`, also for a build (rw) run

#### Scenario: sin montaje
- **WHEN** the spec has no skills directory
- **THEN** no /skills mount is present

### Requirement: Copia efímera
zero SHALL copy the resolved skills into a per-run staging directory before the agent runs and MUST remove it after the run ends, whether the run succeeds or fails.

#### Scenario: limpieza
- **WHEN** an agent run with one skill finishes with an error
- **THEN** the staging directory no longer exists

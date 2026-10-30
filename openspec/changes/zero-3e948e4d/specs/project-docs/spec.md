# Spec Delta

## Purpose

El README de GitHub pasa a estar en inglés (README.md). El texto en español actual pasa a README.es.md. Los dos tienen el mismo contenido y la misma estructura, y arriba de todo un enlace para cambiar de idioma (English · Español). Los comandos, la configuración y los ejemplos quedan iguales en los dos. Se saca el lema viejo de Kaelen Global Defence y en su lugar va el lema del sitio: zero in the loop, la fábrica ocupa el lugar del humano en el circuito y el dueño decide dónde vuelve a entrar. No queda ninguna mención a Kaelen en el README, en docs/, en AGENTS.md ni en el contexto de OpenSpec. También se corrige lo desactualizado: - el turno nocturno deja de figurar como "hacia dónde va"; - las skills por agente y por línea salen de "próximas etapas", porque ya están hechas; - la lista de herramientas del chat queda completa; - "Empezar" incluye el git clone. El sitio enlaza al README en español cuando el visitante lo ve en español y al README en inglés cuando lo ve en inglés. AGENTS.md agrega la regla: el README se mantiene en los dos idiomas y todo cambio de la documentación se hace en los dos. Lo que zero le muestra al dueño (CLI, panel, chat) sigue en español.

## ADDED Requirements

### Requirement: README en inglés y en español
The repository MUST have README.md written in English and README.es.md written in Spanish (README.es.md holds the current Spanish text, corrected). The first non-heading line of each MUST be a language switch linking both files: 'English · [Español](README.es.md)' in README.md and '[English](README.md) · Español' in README.es.md.

#### Scenario: enlace de idioma arriba
- **WHEN** the test reads README.md and README.es.md
- **THEN** README.md, within its first 3 lines, contains a link to README.es.md and the word 'English'; README.es.md, within its first 3 lines, contains a link to README.md and the word 'Español'

#### Scenario: idioma de cada archivo
- **WHEN** the test reads both files
- **THEN** README.md contains '## How it works' and does not contain '## Cómo funciona'; README.es.md contains '## Cómo funciona'

### Requirement: Misma estructura y mismos comandos
README.md and README.es.md MUST have the same sequence of heading levels (##, ###) and the same fenced code blocks in the same order with the same info strings. Each `sh` and `yaml` block MUST be identical in both files after removing double-quoted strings and trailing ` #` comments. Untagged blocks (the diagram) and `markdown` blocks may be translated.

#### Scenario: encabezados paralelos
- **WHEN** the test extracts the level of every line starting with '## ' or '### ' from both files
- **THEN** the two sequences of levels are equal and non-empty

#### Scenario: bloques de código paralelos
- **WHEN** the test extracts every fenced block from both files and normalizes the sh and yaml ones (drop "..." strings, drop text from ' #' to end of line, trim)
- **THEN** both files have the same number of blocks with the same info strings, and every normalized sh/yaml pair is equal

### Requirement: Lema nuevo, sin Kaelen
Both READMEs MUST replace the old motto line ('Kaelen Global Defence: Autonomous agent network. Continuous execution. Zero human intervention required.') with the site's motto: zero in the loop, and the factory takes the human's place in the loop while the owner decides where to step back in. The text 'Kaelen' and 'Zero human intervention required' MUST NOT appear in README.md, README.es.md, AGENTS.md, any file under docs/, or openspec/config.yaml.

#### Scenario: lema en los dos idiomas
- **WHEN** the test reads both READMEs
- **THEN** both contain 'zero in the loop'; README.md contains 'the owner decides where to step back in'; README.es.md contains 'el dueño decide dónde vuelve a entrar'

#### Scenario: sin Kaelen
- **WHEN** the test reads README.md, README.es.md, AGENTS.md, every .md file under docs/ recursively, and openspec/config.yaml
- **THEN** none contains 'Kaelen' (case-insensitive) nor 'Zero human intervention required'

### Requirement: Documentación al día
Both READMEs MUST describe only what exists today. The roadmap ('Where it is going' / 'Hacia dónde va') MUST NOT list the night shift as future work, 'Next steps' / 'Próximas etapas' MUST NOT list per-agent and per-line skills, the chat tool list MUST name every tool the MCP server registers, and 'Getting started' / 'Empezar' MUST begin with the git clone of https://github.com/kaelen-phoenix/zero. Facts asserted by existing README tests MUST remain true in both languages.

#### Scenario: herramientas del chat completas
- **WHEN** the test collects every 'zero_*' tool name registered in src/mcp/server.ts
- **THEN** each name appears in README.md and in README.es.md

#### Scenario: nada en camino que ya existe
- **WHEN** the test reads the Spanish 'Próximas etapas' and 'Hacia dónde va' sections and their English counterparts
- **THEN** neither mentions 'Turno nocturno'/'Night shift' as an item nor 'Skills asignables'/'assignable skills'; README.es.md does not contain 'Turno nocturno (en camino)'

#### Scenario: clon en Empezar
- **WHEN** the test reads the first sh block after '## Empezar' and after '## Getting started'
- **THEN** both contain 'git clone https://github.com/kaelen-phoenix/zero' and 'npm install && npm run build'

#### Scenario: tests existentes en español
- **WHEN** the existing Spanish README assertions in test/night-shift.test.ts, test/night-shift-2c.test.ts, test/night-shift-2d.test.ts and test/site.test.ts run against README.es.md
- **THEN** they pass, and the language-neutral ones (config keys, 'zero proposals', 'zero:propuesta', 'zero:investigacion', 'squash', 'Revert', 'zerointheloop.com' with 'site/' and 'Vercel' in the same paragraph) also pass against README.md

### Requirement: El sitio enlaza al README de su idioma
Every README link on the site (header 'Docs', hero 'Leer la documentación', links 'Documentación (README)') MUST point to https://github.com/kaelen-phoenix/zero/blob/main/README.es.md in the Spanish markup. After applyLanguage(doc, 'en') it MUST point to https://github.com/kaelen-phoenix/zero#readme, and switching back to 'es' MUST restore the Spanish URL. These links are marked with a data-i18n-href key whose English value lives in EN in site/main.js.

#### Scenario: español por defecto
- **WHEN** the test reads site/index.html
- **THEN** the header, the hero and the links section each contain an <a> with href 'https://github.com/kaelen-phoenix/zero/blob/main/README.es.md' and a data-i18n-href attribute, and no README link uses '#readme' in the markup

#### Scenario: cambio a inglés y vuelta
- **WHEN** applyLanguage is called with 'en' on a fake document containing those links, then with 'es'
- **THEN** after 'en' every data-i18n-href element has href 'https://github.com/kaelen-phoenix/zero#readme'; after 'es' it has the README.es.md URL again

#### Scenario: paridad de claves
- **WHEN** the key-parity test collects data-i18n, data-i18n-label and data-i18n-href keys plus meta.title
- **THEN** Object.keys(EN) equals that set exactly

### Requirement: Regla de idiomas en AGENTS.md
AGENTS.md Conventions MUST state that the README is kept in English (README.md) and Spanish (README.es.md), that every documentation change is made in both, and that what zero shows the owner (CLI, panel, chat) stays in Spanish.

#### Scenario: regla presente
- **WHEN** the test reads AGENTS.md
- **THEN** it contains 'README.md', 'README.es.md' and the words 'both' and 'Spanish' in the same line or paragraph of the Conventions section

# Spec Delta

## Purpose

AGENTS.md pasa a ser un índice corto. Trae qué es zero, los comandos, las convenciones y una lista de enlaces a un archivo por área en docs/agents/: núcleo, daemon, línea de producción, fusión automática, turno nocturno, paquetes, motores, panel, informes, caja y egress, intake, autoactualización y sitio. Todo el texto actual se reparte entre esos archivos sin perder nada, en inglés y con el mismo tono. CLAUDE.md sigue diciendo `@AGENTS.md`. Las convenciones y las pruebas cambian: cada trabajo documenta en el archivo de su área, y el índice se toca solo cuando aparece un área nueva. Con eso, dos pull requests de áreas distintas ya no editan los mismos párrafos. En los dos README hay dos renglones que casi todo cambio edita: la lista de herramientas del chat y la de próximas etapas. Las dos pasan a ser listas con un elemento por renglón, así agregar o sacar algo toca una sola línea.

## ADDED Requirements

### Requirement: AGENTS.md es un índice corto
AGENTS.md SHALL contener solo la descripción de zero, la sección `## Commands`, la sección `## Conventions` y una sección `## Areas` con un enlace Markdown relativo por cada archivo `docs/agents/*.md`, y su tamaño MUST ser menor a 16000 bytes.

#### Scenario: tamaño y secciones
- **WHEN** una prueba lee AGENTS.md
- **THEN** pesa menos de 16000 bytes, sus títulos `## ` son exactamente Commands, Areas y Conventions, y no tiene la sección `## Layout`

#### Scenario: cada área enlazada una vez
- **WHEN** una prueba lista docs/agents/*.md y los enlaces `](docs/agents/<archivo>.md)` de AGENTS.md
- **THEN** cada archivo aparece enlazado exactamente una vez y cada enlace apunta a un archivo que existe

### Requirement: Un archivo por área sin perder información
El contenido de la antigua sección Layout de AGENTS.md MUST quedar repartido, sin perder información y en inglés, en archivos bajo docs/agents/: core.md, daemon.md, production-line.md, auto-merge.md, night-shift.md, packages.md, engines.md, panel.md, reports.md, box-and-egress.md, intake.md, self-update.md y site.md. Cada archivo SHALL tener un título `# ` y una entrada en viñeta por módulo o tema.

#### Scenario: archivos esperados
- **WHEN** una prueba lista docs/agents/
- **THEN** están los trece archivos nombrados, cada uno con un título `# ` en la primera línea y al menos una viñeta `- `

#### Scenario: nada se pierde
- **WHEN** se juntan todos los fragmentos entre comillas invertidas de AGENTS.md en el commit base de este trabajo y se busca cada uno en la unión del nuevo AGENTS.md y docs/agents/*.md
- **THEN** aparecen todos

#### Scenario: datos que las pruebas ya exigían
- **WHEN** una prueba lee la guía (AGENTS.md más docs/agents/*.md)
- **THEN** contiene scheduledPass, src/setup.ts, encryptedFileKeyring, ZERO_CONTAINER, panel.host, allowedArtifacts, operationArtifacts, saveReport y "(`idlePasses`: scout, then research, then the packages' stations)", y no contiene src/social/, src/line/community.ts ni communityPass

### Requirement: Regla de documentar por área
La sección Conventions de AGENTS.md MUST decir que cada cambio documenta su comportamiento en el archivo de su área bajo `docs/agents/`, y que AGENTS.md se edita solo para agregar el enlace de un área nueva o para cambiar comandos o convenciones.

#### Scenario: regla presente
- **WHEN** una prueba lee la parte de AGENTS.md que sigue a `## Conventions`
- **THEN** una línea contiene `docs/agents/` y la palabra `area`, y las reglas ya existentes de idiomas del README y de `stays only in ZERO_HOME` siguen ahí

### Requirement: CLAUDE.md apunta a AGENTS.md
CLAUDE.md MUST seguir conteniendo solamente `@AGENTS.md`.

#### Scenario: contenido de CLAUDE.md
- **WHEN** una prueba lee CLAUDE.md sin espacios al final
- **THEN** es exactamente `@AGENTS.md`

### Requirement: Herramientas del chat una por renglón en los README
En README.md y README.es.md, las herramientas del chat de la sección Getting started / Empezar SHALL estar en una lista con una viñeta por herramienta que empieza con `` - `zero_<nombre>` ``, y esas viñetas MUST nombrar exactamente las herramientas que define src/mcp/server.ts.

#### Scenario: una herramienta por viñeta
- **WHEN** una prueba toma de cada README las líneas que empiezan con "- `zero_" dentro de la sección de Empezar / Getting started
- **THEN** el conjunto de los primeros fragmentos entre comillas invertidas es igual al de los nombres `zero_*` de src/mcp/server.ts, sin repetidos, y ninguna línea fuera de esa lista enumera más de dos herramientas `zero_*`

### Requirement: Próximas etapas como lista
Las secciones `## Next steps` y `## Próximas etapas` MUST ser una lista con un elemento por línea que empieza con `- `, con los mismos ítems que tienen hoy.

#### Scenario: lista en los dos idiomas
- **WHEN** una prueba lee las dos secciones
- **THEN** cada línea no vacía empieza con `- `, las dos tienen la misma cantidad de ítems y ninguna línea contiene ` · `

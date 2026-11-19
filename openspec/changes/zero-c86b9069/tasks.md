# Tasks

## 1. Etapa 1: Catálogo: datos, revisión y listado

- [x] 1.1 src/catalog.ts pure helpers (license normalization, screenAgentText, catalogKey, acceptFindings) with tests
- [x] 1.2 agent_catalog table and store methods with tests
- [x] 1.3 agentCatalog in app.ts, formatCatalog in format.ts and `zero agent catalog` listing in cli.ts with tests

## 2. Etapa 2: Sumar y rechazar desde el catálogo

- [x] 2.1 addAgent `instructions` option (refuses an existing file); addFromCatalog with confirm, source/license header and THIRD-PARTY-NOTICES.md block once per source; rejectCatalogEntry
- [x] 2.2 `zero agent catalog add <id> --line <línea> [--yes]` and `reject <id> [--motivo]` in cli.ts and help
- [x] 2.3 Tests for confirmed, declined, no-terminal, existing-file, rejected and notices cases

## 3. Etapa 3: Catálogo en el panel

- [x] 3.1 Catalog section in agentsPage, confirmCatalogPage, POST /agents/catalog/add (confirm=1) and /agents/catalog/reject in server.ts through app.ts
- [x] 3.2 Panel tests: confirm page first, confirmed add, reject, escaped text

## 4. Etapa 4: Estación reclutadora nocturna

- [ ] 4.1 recruit fixed station wiring (agent.ts, config.ts, skills.ts, app.ts MONITOR_AGENTS, scout.ts IDLE_STATIONS) plus `recruit` config and agents/recruit.md
- [ ] 4.2 src/line/recruit.ts recruitPrompt, RecruitOutput and recruitPass; daemon idlePasses after research with DaemonOptions.recruit
- [ ] 4.3 Tests: gates, shared cap, prompt content, storing as proposed or listed, auto line never adds

## 5. Etapa 5: Documentación

- [ ] 5.1 AGENTS.md layout entry for the catalog and the recruiter
- [ ] 5.2 README.md and README.es.md sections with the same structure and code blocks
- [ ] 5.3 Run typecheck, tests and openspec validate

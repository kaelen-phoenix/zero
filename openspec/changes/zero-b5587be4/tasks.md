# Tasks

## 1. Etapa 1: Conflict agent type in configuration, packages, CLI and views

- [x] 1.1 CustomAgentSchema accepts `type: conflict` with write access and refuses after/files/blocking:false/non-write access
- [x] 1.2 packages.ts manifest accepts conflict; widening counts new conflict agents
- [x] 1.3 addAgent with conflictTemplate, agentList ordering, productionLine station mapping, CLI help
- [x] 1.4 format.ts and panel html labels for conflict agents
- [x] 1.5 Tests for schema, package loading and addAgent

## 2. Etapa 2: Runner hook, validation, fallback, spans and trace

- [ ] 2.1 ConflictSchema plus helpers for conflict blocks and base commits
- [ ] 2.2 runJob: save the fallback state, run conflict agents in order, validate (all resolved, no markers, base and head contained), commit and resume at verify, or discard and fall back
- [ ] 2.3 Spans `zero.station.<agent>` with zero.conflicts.* attributes and renderTrace description
- [ ] 2.4 test/conflict-agents.test.ts covering acceptance, every fallback, ordering, missing instructions, no-agent behaviour and trace

## 3. Etapa 3: Documentation and OpenSpec change

- [ ] 3.1 README.md and README.es.md custom agents section with type conflict, same structure
- [ ] 3.2 AGENTS.md custom agents paragraph
- [ ] 3.3 openspec/changes/<name>/ with proposal, tasks and production-line delta; openspec validate, typecheck and tests pass

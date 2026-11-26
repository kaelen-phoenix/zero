# Tasks

## 1. Etapa 1: Skill de rendimiento incluida en zero y regla de build

- [x] 1.1 OpenSpec change zero-e0131a74 with the full spec.
- [x] 1.2 skills/performance/SKILL.md with the checklist and official sources.
- [x] 1.3 Source `zero` in src/skills.ts: builtinSkills, availableSkills, stageSkills.
- [x] 1.4 Performance rule in agents/build.md.
- [x] 1.5 Tests in test/skills.test.ts; docs in docs/agents/engines.md.

## 2. Etapa 2: Revisor de rendimiento por línea

- [x] 2.1 `performance` option in LineSchema and refusal of the name clash.
- [x] 2.2 Origin `zero` in LineAgent, built-in agent in lineAgents, agentInstructionsPath for zero's folder, agents/performance.md.
- [x] 2.3 zero:performance for build on performance lines (assignedSkills).
- [x] 2.4 Tests in test/performance.test.ts for config, order and blocking or not in runJob; docs and both READMEs.

## 3. Etapa 3: Hallazgos no graves en el pull request

- [x] 3.1 Keep the performance reviewer's verified non-blocking findings of the passing run in kv and clear them on each attempt.
- [x] 3.2 `## Rendimiento` section in deliveryBody, cleaned with publicText.
- [x] 3.3 Tests of the PR body with and without findings; docs/agents/production-line.md.

## 4. Etapa 4: Auditoría a demanda con propuestas por impacto

- [ ] 4.1 Origin `performance` in proposals and jobs (store), and proposalAutonomy always `propose` for it.
- [ ] 4.2 src/line/performance.ts: request, schema, prompt, acceptAudit and performanceAuditPass; agents/performance-audit.md.
- [ ] 4.3 requestPerformanceAudit/waitPerformanceAudit in app.ts, the pass in daemon.ts, `zero rendimiento <línea>` in cli.ts.
- [ ] 4.4 Tests for the request, the pass, ordering, dedupe and waiting for approval; docs night-shift.md and both READMEs.

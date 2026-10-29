# Tasks

## 1. Implementación

- [ ] 1.1 Create the OpenSpec change openspec/changes/zero-cb5f0202 (proposal.md, tasks.md, specs/agent-skills/spec.md with ADDED requirements in Spanish/English like zero-a9818ce9) and check `npx openspec validate --all`.
- [ ] 1.2 src/skills.ts: add optional `description` to Skill; in discoverSkills read SKILL.md frontmatter with the `yaml` package (fail-safe: no description on any error), collapse whitespace and cut to 200 chars with an ellipsis. Export a pure helper for the short description.
- [ ] 1.3 src/skills.ts: add a pure `skillView(ref, available)` returning { name, fullName?, description?, missing?: reason } using resolveSkill.
- [ ] 1.4 src/app.ts: add one read-only operation (e.g. `agentSkills(ctx)`) that returns, per SKILL_STATIONS agent, { general: SkillView[], lines: { line, skills: SkillView[] }[] } from ctx.config and a single discoverSkills() call.
- [ ] 1.5 src/app.ts: add `skills` to AgentGuide in factoryGuide using that operation (whitelist of fields only).
- [ ] 1.6 src/panel/html.ts agentsPage: render a skills section in each agent card (general list, then one group per line naming it; name + escaped description; `faltante` badge with reason; 'sin skills' text when empty). No forms or buttons.
- [ ] 1.7 src/mcp/server.ts zero_lines: return JSON with each line's existing fields plus agent skills (general per agent and per-line additions) from the app.ts operation; keep readOnlyHint, add no new tool. Update the tool description to mention skills.
- [ ] 1.8 src/agent.ts: make resolvedSkills also return the unresolved refs; after resolving, call span.set({ 'zero.skills': names.join(', '), 'zero.skills.missing': missing.join(', ') }) only for non-empty lists (Attrs are scalars; undefined is dropped by clean()).
- [ ] 1.9 src/telemetry/tracer.ts describe(): append `skills: …` and `skills faltantes: …` when those attributes are present.
- [ ] 1.10 Tests: extend test/skills.test.ts (description parsing incl. invalid YAML/long text, skill view, agent span attributes and trace text with fake engines), test/panel-guide.test.ts (skills in agent cards, missing marked, escaping, still no forms/POST change), test/interface.test.ts (zero_lines shows skills, tool list unchanged). Use an injected/temp Claude home (CLAUDE_CONFIG_DIR) so the owner's real skills are never read.
- [ ] 1.11 Update AGENTS.md (skills line mentions panel/chat/trace views) and the README if it lists part 2 as pending; run npm run typecheck, npm test, npm run build.

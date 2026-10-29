# Tasks

## 1. Implementación

- [ ] 1.1 Create the OpenSpec change openspec/changes/<id>/ (proposal, tasks, specs/agent-skills/spec.md) with these requirements; run `npx openspec validate --all`.
- [ ] 1.2 src/skills.ts (pure where possible): discoverSkills(claudeHome) reading ~/.claude/skills/*/SKILL.md and plugins/installed_plugins.json → installPath/skills/*/SKILL.md; resolveSkill(ref, available) with ambiguity handling; assignedSkills(config, station, lineName?) = global ∪ line, deduped; skillProblems(config, available) for status; stageSkills(resolved, dir) copying each skill dir and stripping `allowed-tools` from SKILL.md frontmatter.
- [ ] 1.3 src/config.ts: add `skills: z.array(z.string()).default([])` to StationSchema; add optional `stations` to LineSchema with keys spec/build/review/security/reply each `{ skills: string[] }` (strict, so unknown agents fail).
- [ ] 1.4 src/engines/types.ts: add `skills?: { name: string; dir: string; text: string }[]` to EngineRequest and `nativeSkills?: boolean` to Engine.
- [ ] 1.5 src/agent.ts: add optional `line` to AgentRequest; in createAgentRunner resolve the station's skills for the line (missing ones logged and skipped), stage them into a temp dir removed in finally, pass them on the request; for engines without nativeSkills append each SKILL.md text to instructions under a heading with its full name.
- [ ] 1.6 src/engines/claude.ts: extract a pure claudeOptions(req, abort) builder; set nativeSkills: true; when skills exist add `plugins: [{ type: 'local', path }]` for the staged dir (with a minimal .claude-plugin/plugin.json written by stageSkills) and `skills` with exactly the assigned names (empty list when none); leave allowedTools as TOOLS[access].
- [ ] 1.7 src/box/run.ts + executor.ts: add optional `skills` host dir to BoxRunSpec, mounted `-v <dir>:/skills:ro`; executor rewrites request.skills dirs to /skills/... before sending the payload.
- [ ] 1.8 Pass `line: line.name` from runner.ts for spec, build, review and security calls, and from intake/comments.ts for reply when the issue's line is known.
- [ ] 1.9 src/app.ts: addSkill/removeSkill/skillList operations using editFactory (no duplicates, Spanish errors for unknown agent/line); add `skills` warnings to FactoryStatus; src/cli.ts: `zero skill add|remove|list` with --station/--line, help text, and status output of the warnings. Do not add any MCP tool.
- [ ] 1.10 Tests (temp dirs, fake engines): discovery and resolution, config union and invalid agent, CLI/app add-remove-list keeping comments, status warning, claude options builder (skills/plugins/allowedTools unchanged), cli engine instructions with SKILL.md text, frontmatter stripping, boxRunArgs mount, staging cleanup, MCP tool list has no skill tool.
- [ ] 1.11 Update AGENTS.md layout with src/skills.ts and README/config docs for `stations.<agent>.skills` and `lines[].stations.<agent>.skills`.

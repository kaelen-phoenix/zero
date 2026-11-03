# Tasks

## 1. Implementación

- [ ] 1.1 In src/engines/claude.ts `claudeOptions`, add `settings: { disableAllHooks: true, autoMemoryEnabled: false }`, `strictMcpConfig: true` and `env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }`, keep `settingSources: ['project']`, and update the comment so it says hooks, host memory and claude.ai connectors are never loaded (a zero guarantee, not one left to the engine).
- [ ] 1.2 Add tests in a new test/claude-options.test.ts, or in the existing 'claude options' describe block in test/skills.test.ts. For each Access ('read', 'web', 'write') and for a request with staged skills, assert the settings, strictMcpConfig, env values and settingSources. Also assert that a process.env variable set in the test is passed through to env, and restore it afterwards.
- [ ] 1.3 Run `npm run typecheck`, `npm test` and `npx openspec validate --all`. The README's isolation section does not describe the Claude engine's settings, so README.md and README.es.md need no change unless the build adds a line there. If it does, add the same line to both files.

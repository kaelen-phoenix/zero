# Spec Delta

## ADDED Requirements

### Requirement: Hooks del repositorio desactivados en el motor Claude
The Claude engine's SDK options MUST disable every hook for every station and access level, by passing `settings` with `disableAllHooks: true`.

#### Scenario: todas las formas de acceso
- **WHEN** claudeOptions is built for a request with access 'read', 'web' and 'write' in turn
- **THEN** each result has `settings` as an object with `disableAllHooks` equal to true

#### Scenario: con skills
- **WHEN** claudeOptions is built for a request with staged skills
- **THEN** the result's `settings.disableAllHooks` is true

### Requirement: Memoria automática del host desactivada
The Claude engine's SDK options MUST turn off the host's automatic memory for every station, through both `settings.autoMemoryEnabled: false` and the environment variable `CLAUDE_CODE_DISABLE_AUTO_MEMORY` set to '1'.

#### Scenario: memoria apagada
- **WHEN** claudeOptions is built for each access 'read', 'web' and 'write', and with staged skills
- **THEN** `settings.autoMemoryEnabled` is false and `env.CLAUDE_CODE_DISABLE_AUTO_MEMORY` is '1'

### Requirement: Solo los MCP que zero pasa
The Claude engine's SDK options MUST set `strictMcpConfig: true` and set the environment variable `ENABLE_CLAUDEAI_MCP_SERVERS` to 'false', so that the project's `.mcp.json`, the user's settings and the claude.ai connectors are not loaded.

#### Scenario: MCP estricto
- **WHEN** claudeOptions is built for each access 'read', 'web' and 'write', and with staged skills
- **THEN** `strictMcpConfig` is true and `env.ENABLE_CLAUDEAI_MCP_SERVERS` is 'false'

### Requirement: El entorno del proceso se conserva
The `env` passed to the SDK SHALL contain the current process environment (so engine credentials such as CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY keep working), with the two variables above added on top.

#### Scenario: variable heredada
- **WHEN** process.env has a test variable (e.g. ZERO_TEST_VAR='x') set before claudeOptions is built
- **THEN** the result's env.ZERO_TEST_VAR is 'x', and the two isolation variables have their fixed values

### Requirement: Instrucciones del proyecto y skills siguen cargando
The Claude engine's SDK options SHALL keep `settingSources: ['project']`, and SHALL keep the existing skill and tool behaviour: the assigned skills from zero's staged plugin, an empty list when there are none, and the same allowedTools for each access level.

#### Scenario: settingSources intacto
- **WHEN** claudeOptions is built for each access level, with and without skills
- **THEN** `settingSources` equals ['project'], and the existing skills and tools tests in test/skills.test.ts and test/research.test.ts still pass

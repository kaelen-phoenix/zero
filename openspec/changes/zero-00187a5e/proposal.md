# Proposal

## Why

Hoy, cuando una estación corre con el motor Claude, Claude Code ejecuta los hooks que encuentre en `.claude/settings.json` del repositorio. Eso vale también para las estaciones de solo lectura (review, security, scout, research, reply), así que podrían ejecutar un hook que haya escrito un build anterior. Además, cada agente recibe en su prompt tu memoria personal (MEMORY.md) y tus conectores de claude.ai, como Google Drive y Claude Docs. Con este cambio, zero le pide al motor Claude tres cosas en cada estación: - no ejecutar ningún hook; - no cargar la memoria automática; - usar solo los servidores MCP que zero le pase (hoy ninguno), así no aparecen tus conectores de claude.ai. Los agentes siguen leyendo el CLAUDE.md/AGENTS.md del proyecto y sus skills asignadas, igual que ahora. Un test verifica estas opciones en los tres tipos de acceso (lectura, web, escritura) y también con skills.

Pedido original: "Motor Claude: no ejecutar hooks del repo ni cargar la memoria del host ni los conectores de claude.ai Por qué: La nota 003d7a59 (https://code.claude.com/docs/en/agent-sdk/claude-code-features, https://code.claude.com/docs/en/agent-sdk/typescript) documenta que `settingSources: ['project']` carga también los hooks de `.claude/settings.json` del repo objetivo, y que la memoria automática del host y los conectores MCP de claude.ai se cargan siempre. `claudeOptions` en src/engines/claude.ts:21-37 solo pasa `settingSources: ['project']`, así que las estaciones de solo lectura (review, security, scout, research, reply) ejecutarían cualquier hook que un build haya escrito y reciben en el prompt la memoria personal del dueño. Lo comprobé: esta misma pasada de scout recibió el MEMORY.md del dueño y los conectores de Google Drive y Claude Docs. El SDK instalado ya tiene `settings`, `disableAllHooks`, `autoMemoryEnabled` y `strictMcpConfig` (sdk.d.ts:2264, 2365, 7530, 9472). Esto choca con la regla de AGENTS.md de que las garantías las impone zero y no el motor. Qué cambiaría: Empezar con un change de OpenSpec. En `claudeOptions` añadir `settings: { disableAllHooks: true, autoMemoryEnabled: false }`, `strictMcpConfig: true` y `env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }`, para todas las estaciones. Mantener `settingSources: ['project']` para que CLAUDE.md/AGENTS.md y las skills sigan cargando. Añadir un test que verifique estas opciones para cada `Access` (read, web, write) y para el caso con skills. Si el README describe el aislamiento del motor Claude, actualizar README.md y README.es.md en paralelo."

## What Changes

- Motor Claude: sin hooks del repo, sin memoria del host y sin conectores de claude.ai
- Supuesto: Assumption: the Settings type in the installed SDK has `disableAllHooks` (sdk.d.ts:7530) and `autoMemoryEnabled` (sdk.d.ts:9472). If either key is in a different interface, typecheck will fail. In that case the build must find the right type and must not cast it away.
- Supuesto: Managed (enterprise) hooks still run even when disableAllHooks is set, per the SDK documentation. That is acceptable on the owner's machine.
- Supuesto: `strictMcpConfig` also ignores MCP servers declared in the target repo's .mcp.json and in plugins, including zero's staged skills plugin. Skills keep working, because they are not MCP.
- Supuesto: Spreading process.env passes the daemon's whole environment to the SDK subprocess. That is already the SDK's default when env is omitted, so nothing new is exposed. Inside the box the environment is already minimal.
- Supuesto: These flags only exist in the Claude engine. Other engines (Codex, Antigravity, CLI) may load host memory or hooks their own way. That is out of scope here.

## Capabilities

### New Capabilities

### Modified Capabilities
- `isolation-box`: Motor Claude: sin hooks del repo, sin memoria del host y sin conectores de claude.ai

## Impact

Generado por zero para el trabajo 00187a5e.

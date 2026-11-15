# Proposal

## Why

Cuando la fábrica lance Codex, Codex ya no va a cargar los servidores MCP que tengas en tu `~/.codex/config.toml`. Eso incluye el servidor de chat de zero que `zero install` te pide registrar ahí. Así ningún agente de la fábrica tiene a mano herramientas como fundir, parar o decidir propuestas por fuera de los controles de zero. Vale con el sandbox de Codex prendido o apagado, en tu máquina y dentro de la caja. El ADR 0004 queda al día: Codex figura como resuelto, y opencode y agy siguen como pendientes sin verificar.

## What Changes

- Codex sin los servidores MCP de la configuración del usuario
- Supuesto: Not verified with a real Codex CLI: this assumes `-c mcp_servers={}` replaces the whole `mcp_servers` table from ~/.codex/config.toml rather than merging into it. The build cannot check this because tests use a fake codex, so the ADR must keep a pending item to confirm it with a real run.
- Supuesto: `pairAt` in test/codex-sandbox.test.ts returns the value after the first `-c`. Putting the MCP override before `approval_policy` would break the existing sandbox-off test, so the order matters.
- Supuesto: The argument is passed without a shell (spawnTarget), so `{}` needs no quoting on Windows or POSIX. A custom engine named codex keeps its own command and does not get the override.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Codex sin los servidores MCP de la configuración del usuario

## Impact

Generado por zero para el trabajo 77f3f537.

# Proposal

## Why

Desde ahora, la fábrica protege por defecto la carpeta `.claude/` y el archivo `.mcp.json` de cada repositorio, igual que ya protege `.github/**` y `.zero/**`. Esos archivos configuran agentes: hooks, servidores MCP y ajustes que las ejecuciones siguientes del repo cargan solas. Si un trabajo, o una propuesta autónoma del turno de noche, intenta cambiarlos, zero lo frena. En L3 el intento falla y se le pide al agente que no toque esos archivos. En L0–L2 el trabajo espera tu aprobación. Si tu `zero.factory.yaml` ya define su propia lista `protectedPaths`, se usa esa lista y no cambia nada. El ejemplo de configuración del README, en inglés y en español, muestra las dos rutas nuevas.

Pedido original: "Rutas protegidas por defecto: sumar .claude/** y .mcp.json Por qué: La nota 003d7a59 (https://code.claude.com/docs/en/agent-sdk/claude-code-features) señala que un intento de build o una propuesta autónoma del turno de noche puede escribir hooks o servidores MCP en `.claude/settings.json` o `.mcp.json`, y que las ejecuciones siguientes del repo los cargan. Los `protectedPaths` por defecto (src/config.ts:192) son `.github/**`, `.zero/**`, `.env`, `.env.*`, `**/*.pem` y `**/*.key`, sin `.claude/**` ni `.mcp.json`. Estos dos archivos configuran agentes y deberían estar protegidos igual que `.zero/**`. Qué cambiaría: Empezar con un change de OpenSpec. Agregar `.claude/**` y `.mcp.json` a la lista por defecto de `protectedPaths` en src/config.ts. Ajustar los tests que fijan la lista por defecto y añadir uno que compruebe que un diff que toca `.claude/settings.json` cae bajo ruta protegida. Si README.md y README.es.md enumeran las rutas protegidas por defecto, actualizar los dos igual."

## What Changes

- Rutas protegidas por defecto: .claude/** y .mcp.json
- Supuesto: Owners whose zero.factory.yaml already sets limits.protectedPaths keep their own list. The new protection reaches them only if they add the two paths themselves.
- Supuesto: `.mcp.json` only matches the repository root. A nested `pkg/.mcp.json` is not covered. Claude Code reads project MCP config from the root, so this was taken as enough.
- Supuesto: Jobs that legitimately edit .claude/ (for example a repo that versions its Claude Code settings) will now stop at verify: they fail at L3 and ask for approval at L0–L2.
- Supuesto: Night-shift proposals that list paths under .claude/ or .mcp.json will now be dropped by filterProposals, because it uses the same limits.protectedPaths.
- Supuesto: The README line is an example configuration, not the literal default list. It omits .zero/** because that path is always protected. The example keeps that omission and only adds the two new paths.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Rutas protegidas por defecto: .claude/** y .mcp.json

## Impact

Generado por zero para el trabajo 06e07515.

# Spec Delta

## ADDED Requirements

### Requirement: Codex se lanza sin servidores MCP del usuario
`codexInvocation` MUST incluir siempre en sus argumentos el par `-c` seguido de `mcp_servers={}`, en cualquier acceso (`read`, `web`, `write`) y con el sandbox de Codex prendido o apagado, para que Codex no cargue ningún servidor MCP de la configuración del usuario.

#### Scenario: Sandbox prendido, cada acceso
- **WHEN** se arma `codexInvocation` con acceso `read`, `web` y `write` y sandbox `on`
- **THEN** los argumentos de cada uno contienen `-c` seguido inmediatamente de `mcp_servers={}`, y `--sandbox` sigue siendo `read-only`, `read-only` y `workspace-write` respectivamente

#### Scenario: Sandbox apagado
- **WHEN** se arma `codexInvocation` con sandbox `off` en los accesos `read`, `web` y `write`
- **THEN** los argumentos contienen `-c` seguido de `mcp_servers={}` y también `-c` seguido de `approval_policy="never"` y `--sandbox danger-full-access`

#### Scenario: Motor sin sandbox ejecutado
- **WHEN** `resolveEngine('codex', config con codex.sandbox off)` corre un pedido con el codex falso
- **THEN** los argumentos que recibió el proceso falso contienen el par `-c` `mcp_servers={}`

#### Scenario: El prompt sigue al final
- **WHEN** se arma `codexInvocation` con cualquier acceso, con o sin esquema y modelo
- **THEN** el último argumento sigue siendo `-` y `--json` sigue presente

### Requirement: La caja usa la misma invocación
Dentro de la caja, codex se resuelve como `codexEngine`, y su invocación MUST llevar el mismo par `-c` `mcp_servers={}`.

#### Scenario: Invocación del motor de la caja
- **WHEN** se resuelve el motor a partir del payload que recibe la caja y se arma `codexInvocation` con acceso `read`
- **THEN** el motor es `codexEngine` y los argumentos contienen `-c` seguido de `mcp_servers={}`

### Requirement: El ADR registra a codex como resuelto
`docs/adr/0004-servidores-mcp.md` SHALL registrar en «Qué carga cada motor hoy» que codex se lanza con `-c mcp_servers={}` (`codexInvocation`). Opencode y agy SHALL quedar como pendientes no verificados, y el primer «Próximos pedidos» SHALL nombrar solo a opencode y agy.

#### Scenario: Contenido del ADR
- **WHEN** un test lee docs/adr/0004-servidores-mcp.md
- **THEN** el archivo contiene `mcp_servers={}`, sigue conteniendo `strictMcpConfig`, `mcpServers` y «no verificado», y la sección «Próximos pedidos» sigue con al menos tres ítems

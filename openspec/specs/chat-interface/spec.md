# chat-interface Specification

## Purpose
Permite usar la fábrica desde el chat del cliente de agentes del dueño (Claude Code, Codex, agy, OpenCode): pedir trabajos, seguirlos, decidir y detener, mientras el trabajo ocurre en segundo plano.

## Requirements

### Requirement: Servidor MCP de zero
zero SHALL ofrecer un servidor MCP por stdio con herramientas para:
- pedir un trabajo;
- consultar el estado de la fábrica o de un trabajo;
- responder una consulta;
- detener o reanudar (fábrica o trabajo);
- leer el informe;
- listar las líneas;
- ver las salidas a internet de la caja;
- bloquear un sitio.

#### Scenario: Pedido desde el chat
- **WHEN** el cliente llama a la herramienta de pedido con un texto
- **THEN** recibe el identificador del trabajo, la línea y qué ocurrirá según el nivel efectivo

#### Scenario: Consulta de estado
- **WHEN** el cliente pide el estado de un trabajo en `waiting`
- **THEN** recibe la pregunta pendiente en lenguaje simple y cómo responderla

#### Scenario: Salidas desde el chat
- **WHEN** el cliente pide las salidas de un trabajo
- **THEN** recibe el mismo informe que `zero egress <trabajo>`

### Requirement: El chat no ejecuta el trabajo
Las herramientas MCP MUST responder sin esperar a que el trabajo termine; la ejecución SHALL ocurrir en el daemon.

#### Scenario: Respuesta inmediata
- **WHEN** se pide un trabajo largo
- **THEN** la herramienta responde en segundos con el trabajo en `queued`

### Requirement: Registro en clientes de agentes
`zero install` SHALL registrar el servidor MCP en los clientes que pueda configurar de forma verificada y SHALL mostrar instrucciones para el resto. MUST NOT duplicar un registro existente.

#### Scenario: Claude Code instalado
- **WHEN** `claude` está disponible
- **THEN** zero queda registrado como servidor MCP de usuario en Claude Code

#### Scenario: Registro repetido
- **WHEN** se ejecuta `zero install` dos veces
- **THEN** el segundo intento informa que ya estaba registrado

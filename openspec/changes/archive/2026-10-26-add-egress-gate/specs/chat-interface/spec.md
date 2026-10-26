# Spec Delta

## MODIFIED Requirements

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

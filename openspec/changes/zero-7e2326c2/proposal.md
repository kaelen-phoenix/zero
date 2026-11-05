# Proposal

## Why

Una estación de un paquete va a poder detectar algo y pedirle un trabajo a la fábrica con `ctx.requestJob({ line, text })`, en vez de tocar repositorios por su cuenta. El cambio pasa por la línea normal: especificación, construcción, verify, revisión e integración, con la autonomía de esa línea. Vos decidís qué paquete puede pedir: el manifiesto de la estación tiene que declarar `requests: { perLinePerDay: N }`, y sin eso no puede. La fábrica respeta el cupo por línea y por día, el presupuesto y el andón; si no se puede, la estación recibe el motivo y no pasa nada más. El texto se recorta, se limpia de secretos y rutas locales, y los agentes lo reciben como datos de un tercero. Estos trabajos corren después de tus pedidos, como los del turno nocturno, y los vas a ver en el estado, el panel, el briefing y el informe mensual como "pedido por paquete <paquete>/<estación>". La documentación queda en los dos README y en AGENTS.md.

## What Changes

- Las estaciones de un paquete pueden pedirle trabajos a la fábrica
- Supuesto: Supuesto: el cupo se cuenta por estación y por línea, no por paquete, porque el pedido lo declara en el manifiesto de cada estación. Un paquete con varias estaciones puede sumar más trabajos que el N de una sola.
- Supuesto: Supuesto: el resultado de `requestJob` es `{ id }` o `{ reason }`, sin campo `ok`, para respetar lo que pide el pedido.
- Supuesto: Supuesto: el recorte es de 4000 caracteres, porque el pedido no da un número. Los issues de GitHub admiten 20000, pero acá el texto viene de código de terceros y conviene acotarlo más.
- Supuesto: Supuesto: 'sin secretos' se cumple con los valores que la estación declara, los patrones de `redact` y `publicText`, que además quita rutas locales y rompe @menciones. Es un filtro de mejor esfuerzo: un secreto que la estación leyó por su cuenta y no tiene forma reconocible puede pasar, porque el código de una estación corre con los permisos de tu usuario.
- Supuesto: Supuesto: 'tratar como datos' se aplica en el encabezado del prompt (`requestBlock`). Es una instrucción al agente y no una garantía técnica contra la manipulación por texto; las garantías reales siguen siendo verify, los caminos protegidos, la revisión y la caja de aislamiento.
- Supuesto: Como pidió el pedido, en una línea L2 o L3 un trabajo pedido por un tercero se integra sin preguntarte, y no pasa por `nightShiftHold`, que retiene licencias, textos legales y dependencias nacidas de investigación. `requests` en el manifiesto y `allowCode` son los únicos permisos previos.
- Supuesto: Un trabajo en cola hace que `packagesPass` corte: las demás estaciones esperan a que la fábrica vuelva a estar libre. Es el comportamiento actual de la pasada, no un error nuevo.
- Supuesto: Baja prioridad significa que un trabajo de paquete puede esperar sin límite mientras haya otros trabajos en cola o corriendo, igual que los autónomos del turno nocturno.

## Capabilities

### New Capabilities
- `agent-packages`: Las estaciones de un paquete pueden pedirle trabajos a la fábrica

### Modified Capabilities

## Impact

Generado por zero para el trabajo 7e2326c2.

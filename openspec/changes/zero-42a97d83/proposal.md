# Proposal

## Why

Vas a tener un informe por proyecto y por mes calendario, para vos y para compartir con el cliente de esa línea. Lista cada trabajo entregado con su título, fecha de pedido y de entrega, de dónde vino, qué cambió en palabras simples y el link a la solicitud de cambio o al commit. Trae también los totales: entregados, fallidos y detenidos (estos dos aparte, como información), intentos, tiempo y costo del mes, aclarando cuándo es un estimado de suscripción que no se cobró. Lo arma código a partir de state.db, nunca un modelo. Se ve con `zero informe [línea] [--mes AAAA-MM]`, en una pestaña nueva del panel donde elegís línea y mes, y desde el chat con una herramienta de solo lectura. Se exporta en Markdown o HTML, sin secretos, sin tus rutas locales y sin datos de otras líneas. Nada se envía a nadie: lo mandás vos si querés.

Pedido original: "Informe mensual por proyecto (línea), para el dueño y para poder compartirlo con el cliente de esa línea. Sin precios ni cobros por ahora: solo el resumen. Qué incluye, por línea y por mes calendario: - Cada trabajo entregado: título, fecha de pedido y de entrega, de dónde vino (pedido del dueño, issue de GitHub, propuesta aprobada del turno nocturno, investigación), qué cambió en palabras simples, y el link a la solicitud de cambio o el commit. - Totales: trabajos entregados, fallidos y detenidos (estos aparte, como información, no como trabajo hecho), intentos, tiempo, y el costo estimado del mes (aclarando cuándo es estimado con suscripción y no se cobró). - El texto lo arma código, nunca un modelo: los números y la lista salen exactos de state.db. Si se suma un resumen en palabras, que salga de los títulos y descripciones ya guardados. Dónde se ve: - Comando `zero informe [línea] [--mes AAAA-MM]` (por defecto el mes anterior, todas las líneas) y una pestaña en el panel para elegir línea y mes. - Exportable como Markdown (y HTML si es simple) para mandarlo al cliente, sin secretos, sin rutas locales del dueño y sin datos internos de otras líneas. - Vía app.ts para que el CLI, el panel y el chat (una herramienta MCP de solo lectura) usen la misma lógica. Nada se envía a nadie automáticamente. Lo que ve el dueño en español. Empieza como un change de OpenSpec, con tests sobre un state.db de prueba, y documentarlo en README.md y README.es.md."

## What Changes

- Informe mensual por línea
- Supuesto: Supuesto: un trabajo se atribuye al mes en que terminó (`finishedAt`), con todo su costo y sus intentos, aunque haya empezado el mes anterior. Los trabajos todavía abiertos al cerrar el mes no cuentan.
- Supuesto: Supuesto: para un trabajo con solicitud de cambio, la fecha de entrega es cuando la fábrica la abrió, no cuando se fusionó, porque así define `delivered` el runner.
- Supuesto: Supuesto: el tiempo es calendario (del pedido al cierre) e incluye cola y esperas del dueño; no es tiempo de trabajo de los agentes. El informe lo aclara.
- Supuesto: El costo del mes solo suma trabajos: el gasto de scout e investigación fuera de un trabajo no entra.
- Supuesto: El costo va también en el archivo exportado porque el pedido lo incluye en los totales; si el dueño no quiere mostrárselo al cliente, hoy tiene que editar el archivo.
- Supuesto: Un título o resumen que mencione por nombre a otra línea no se enmascara: se quitan sus rutas, pero enmascarar nombres comunes rompería texto legítimo. El dueño debe revisar lo que comparte.
- Supuesto: La limpieza de rutas se basa en patrones: una ruta relativa o con forma inusual podría pasar. Las rutas de las líneas configuradas y de la carpeta personal se tratan de forma explícita.
- Supuesto: Un trabajo entregado y revertido después sigue contando como entregado.
- Supuesto: `scrubLocal` deja `~/...` cuando la ruta está bajo la carpeta personal; por eso el informe agrega su propio paso de limpieza en vez de confiar solo en esa función.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-observability`: Informe mensual por línea

## Impact

Generado por zero para el trabajo 42a97d83.

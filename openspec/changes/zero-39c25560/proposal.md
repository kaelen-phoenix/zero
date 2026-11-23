# Proposal

## Why

Vas a poder pedir una investigación en el momento con `zero investigar "<tema>" [--line <línea>]`, desde el chat (`zero_investigate`) o con un formulario en la pestaña Investigación del panel. Corre enseguida sobre el tema que le das, aunque haya trabajos en cola o corriendo, fuera del horario nocturno y aunque la línea no tenga una skill de investigación. Con la fábrica detenida (andon), sin presupuesto o con `research: off`, el pedido se rechaza y te dice por qué. Si eso pasa después de pedirla, queda pendiente. Si frenás la fábrica mientras corre, se corta. Hay una sola pendiente por vez. Cada corrida tiene su propio tope de gasto, `research.usdPerRun` (2 dólares por defecto), y no le come el presupuesto al turno nocturno. Como en el resto de la fábrica, los topes en dólares valen para los motores que cobran por uso. El resultado son notas normales, hasta 5 por corrida, con la misma exigencia de fuentes que las de la noche. Las ves en `zero research`, el panel y el chat, y las convertís en trabajo con `zero research request <id>`. Cuando termina te enterás así: el chat te lo dice en la siguiente llamada a zero, el panel lo muestra en el resumen y en Investigación, y aparece en `zero status` y en el briefing. Con `--esperar`, la terminal se queda hasta el final y te muestra las notas. La investigación sobre reels para zero-plus se pide apenas esto esté instalado. El comando listo para copiar queda anotado entre los pendientes.

## What Changes

- Investigaciones express a demanda (zero investigar)
- Supuesto: Supuesto: el tope por corrida es research.usdPerRun, 2 dólares por defecto. Vale para los motores que cobran por uso y que respetan maxBudgetUsd, como los demás topes; con suscripción mandan las ventanas del plan y el tiempo límite de la estación.
- Supuesto: Supuesto: el gasto express cuenta en el presupuesto del día pero no en limits.usdPerNight, para no dejar sin presupuesto al turno nocturno y poder correr a la vez que él.
- Supuesto: Supuesto: 'me avisa cuando termina' es un aviso en la siguiente llamada del chat a zero, el resultado en el panel, zero status y el briefing, y --esperar en la terminal. zero no tiene notificaciones push y no se agregan. En las líneas con GitHub, cada nota además se publica como issue, igual que hoy.
- Supuesto: 'Fuentes verificadas como las de la noche' es la regla que existe hoy: cada nota necesita al menos una URL http(s), sin query ni fragmento, y sin rutas locales. zero no comprueba que la página diga lo que la nota afirma.
- Supuesto: Supuesto: con research: off se rechaza; con perLinePerDay: 0 se acepta, porque ese valor regula las notas nocturnas. Las líneas de un paquete se rechazan, igual que en la investigación nocturna; si zero-plus fuera una de ellas, el primer uso se rechazaría.
- Supuesto: Supuesto: las notas express no llevan skill y no se marcan como de negocio. scout las lee y puede proponer trabajo a partir de ellas dentro de research.autonomy.
- Supuesto: Solo Claude tiene búsqueda web en esta estación; con otro motor puede terminar sin notas.
- Supuesto: Con un motor sin sandbox propio y sin caja, passExecute espera a los trabajos que corren en la carpeta de la línea antes de llamar, así que la corrida puede figurar empezada mientras espera.
- Supuesto: Un apagado, incluido el cambio de versión de la autoactualización, corta la corrida. Queda como cortada, se avisa y hay que volver a pedirla.
- Supuesto: El aviso del chat se muestra una sola vez entre todos los chats abiertos que pueden actuar.

## Capabilities

### New Capabilities
- `night-shift`: Investigaciones express a demanda (zero investigar)

### Modified Capabilities

## Impact

Generado por zero para el trabajo 39c25560.

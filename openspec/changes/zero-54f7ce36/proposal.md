# Proposal

## Why

El menú del panel suma dos pestañas nuevas. Las dos son solo para mirar: no se cambia nada desde ahí. Todo el texto está en español y se ve bien en el celular. "Qué es zero" explica con palabras simples qué es la fábrica: un programa que trabaja solo en tu PC y convierte tus pedidos en cambios terminados. Muestra: - Un diagrama con el recorrido de cada pedido, con una línea por paso: especificación → construcción → verificación → revisión → seguridad → integración. - Cuándo la fábrica te consulta según tu nivel de autonomía, y qué pasa si no respondés a tiempo (cuántas horas espera y si aprueba o rechaza sola). - Por dónde le llegan los pedidos: chat, terminal, panel e issues de GitHub con la etiqueta. - Los datos reales de tu configuración: nivel de autonomía configurado y efectivo (con el motivo si son distintos), motor, límites de gasto por día y por trabajo, si la caja de aislamiento está activa y cuántas líneas hay. "Agentes" muestra una tarjeta por cada agente de la fábrica: especificación, construcción, revisión y seguridad. Cada tarjeta dice qué hace y qué no puede hacer, qué motor y modelo usa, el máximo de turnos y de minutos, y si puede modificar el código o es de solo lectura. Un botón "ver instrucciones completas" despliega sus instrucciones originales, en inglés y tal cual. Abajo, la sección "Líneas" tiene una tarjeta por proyecto: repositorio, rama base, comandos de verificación, forma de entrega (merge local, rama o pull request), si se funde sola, etiqueta de issues y rutas protegidas. Nunca se muestran secretos ni claves. Aclaración: pediste también un agente "reply", pero hoy la fábrica no tiene ese agente. La pestaña muestra los agentes que existen de verdad. Si algún día se agrega uno, va a aparecer solo.

Pedido original: "Agregar al panel dos pestañas nuevas en el menú, de solo lectura (no se edita nada desde ahí). Todo el texto en español y que se vea bien en el celular. 1. Pestaña "Qué es zero" - Explicación en lenguaje simple, para alguien que no es programador: qué es zero (una fábrica de software que trabaja sola en tu PC y convierte pedidos en cambios terminados). - Un diagrama del recorrido de un pedido: especificación → construcción → verificación → revisión → seguridad → integración, con una línea por paso que diga qué hace. - Cuándo la fábrica te consulta y qué pasa si no respondés a tiempo. - Cómo le llegan los pedidos: chat, terminal, panel y issues de GitHub con la etiqueta. - Con los datos reales de la configuración: nivel de autonomía (configurado y efectivo), motor, límites de gasto por día y por trabajo, si la caja de aislamiento está activa y cuántas líneas hay. 2. Pestaña "Agentes" - Una tarjeta por agente (spec, build, review, security, reply) con: qué hace y qué no puede hacer (resumen corto en español), motor y modelo, máximo de turnos y de minutos, si puede modificar el código o es de solo lectura, y un botón "ver instrucciones completas" que despliega el texto original de sus instrucciones (en inglés, tal cual). - Abajo, una sección "Líneas" con una tarjeta por proyecto: repositorio, rama base, comandos de verificación, cómo entrega (merge local, rama o pull request), si funde sola, etiqueta de issues y rutas protegidas. - Nunca mostrar secretos ni claves."

## What Changes

- Panel: pestañas "Qué es zero" y "Agentes" (solo lectura)
- Supuesto: The request asks for a 'reply' agent card, but the code has no reply station (AgentStation = spec|build|review|security and there is no agents/reply.md). The page lists only the stations in AGENT_STATIONS, so inventing one would show a fiction. If the owner meant something else (e.g. the issue replies), that is out of scope.
- Supuesto: Assumption: 'si la caja de aislamiento está activa' means isolation === 'container' AND the last box check says it is ready. When isolation is container but the box is not ready, the page shows it as configured but not ready, with the problems listed.
- Supuesto: Assumption: the URLs are /about and /agents and the nav labels are 'Qué es zero' and 'Agentes'. Six nav links may wrap to two rows on phones; the header already uses flex-wrap.
- Supuesto: The Spanish summaries of what each agent does and cannot do are hand-written constants, so they can drift from agents/*.md. Showing the original instructions next to them reduces the risk.
- Supuesto: Showing `line.repo` reveals local filesystem paths through the tunnel. These are not secrets (the config refuses credentials), but they are visible to anyone holding the panel key.
- Supuesto: Whether it 'looks good on the phone' can only be checked by tests through the CSS rules and the viewport meta. The real phone check stays manual, like task 3.1 of add-control-panel.

## Capabilities

### New Capabilities
- `control-panel`: Panel: pestañas "Qué es zero" y "Agentes" (solo lectura)

### Modified Capabilities

## Impact

Generado por zero para el trabajo 54f7ce36.

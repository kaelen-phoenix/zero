# Proposal

## Why

zero te va a hablar directo, con voseo, en el panel, la consola, el chat y el informe: "Te necesita" en lugar de "Necesita al dueño", "Lo detuviste vos" en lugar de "Detenido por el dueño". Donde el texto lo lee otra persona (issues y comentarios de GitHub, el informe mensual para un cliente, la documentación, partes del sitio) va a decir "la persona responsable" o "quien está a cargo". En inglés, "you" y "the person in charge". La figura del hero del sitio va a decir "vos" / "you". El código, la configuración (por ejemplo `commitAuthor: owner`) y las instrucciones de los agentes siguen diciendo owner, aunque los agentes que escriben textos que vas a leer reciben una regla para no usar esa palabra. Una prueba automática evita que la palabra vuelva a aparecer.

Pedido original: "Dejar de llamar "dueño" a la persona que usa la fábrica en todo lo que zero muestra. Elegimos "vos": hablarle directo. - Panel, CLI, chat (respuestas de las herramientas MCP), informe diario (briefing), mensajes de policy, preguntas que esperan respuesta, comentarios e issues que publica la fábrica, y el sitio (incluida la imagen del hero, donde dice "dueño"): reescribir en segunda persona con voseo. Ejemplos: "Necesita al dueño" → "Te necesita"; "Esperando al dueño" → "Esperando tu respuesta"; "Detenido por el dueño" → "Lo detuviste vos"; "decide el dueño" → "decidís vos". - Donde haga falta un sustantivo en tercera persona (documentación, sitio, textos que lee otra persona como un issue o el informe para un cliente), usar "la persona responsable" o "quien está a cargo", nunca "dueño". - En inglés lo mismo: "you", y como sustantivo "the person in charge" (en vez de "owner") en README.md y el sitio en inglés. - El código, los nombres internos, la configuración (`owner` en commitAuthor, etc.), las instrucciones de los agentes y los tests pueden seguir diciendo owner: solo cambia lo que ve una persona. - Cuidar que las frases queden naturales, no un reemplazo mecánico. Mantener README.md y README.es.md con la misma estructura. Actualizar los tests que comparan textos. - Si el trabajo de cambiar la imagen del hero o el arreglo del panel (94045c48) siguen en curso, hacerlo después para no chocar."

## What Changes

- Hablarte de vos: sacar "dueño" y "owner" de lo que zero muestra
- Supuesto: Pediste hacer esto después si el trabajo 94045c48 o el cambio de imagen del hero seguían en curso. No pude ejecutar git en esta estación. La lista de worktrees, obtenida antes de que se denegara el acceso, muestra solo main y este trabajo, así que 94045c48 no tiene copia de trabajo activa. Su rama existe y no hay openspec/changes/zero-94045c48 en esta base, de modo que probablemente sea un pull request sin fundir. Asumo que se puede avanzar: si se funde después, puede haber conflictos en src/panel/html.ts o en site/, y la prueba de barrido detectaría cualquier texto nuevo con la palabra. No pude identificar el trabajo de la imagen del hero; el build debería revisar si hay cambios en site/index.html al integrar.
- Supuesto: Los motivos, publicaciones de townhall y comentarios ya guardados o publicados conservan el texto viejo: trabajos antiguos en state.db pueden seguir mostrando "Detenido por el dueño." en el panel y la consola. No se migran datos en este cambio.
- Supuesto: reasonForOthers reconoce los motivos por su comienzo; una nota escrita por la persona se copia tal cual y podría contener cualquier palabra.
- Supuesto: Un rechazo hecho desde un comentario de issue por otra persona con permiso de escritura se guarda igual como "Lo rechazaste vos: Respondido en el issue por @x…", así que en el panel el "vos" puede ser inexacto. Antes pasaba lo mismo con el texto anterior.
- Supuesto: Las descripciones de herramientas MCP y los datos en inglés para la estación reply siguen diciendo owner porque los lee un modelo, no una persona; un modelo podría igual traducirlo mal, y por eso se agrega la regla en spec, scout, research y reply, sin garantía absoluta.
- Supuesto: Si la configuración de la línea protege agents/, el trabajo se detendrá a pedir aprobación antes de integrar por tocar esos archivos.
- Supuesto: Los documentos bajo openspec/ (specs y cambios archivados o abiertos) y AGENTS.md no se reescriben: se tratan como registros internos, y LICENSE no se toca por ser texto legal.

## Capabilities

### New Capabilities
- `direct-address-wording`: Hablarte de vos: sacar "dueño" y "owner" de lo que zero muestra

### Modified Capabilities

## Impact

Generado por zero para el trabajo 45dbb69a.

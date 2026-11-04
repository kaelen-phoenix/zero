# Spec Delta

## ADDED Requirements

### Requirement: Trabajos del mes por línea
`monthlyReport` en `src/app.ts` SHALL armar, para cada línea pedida, el informe de un mes calendario en hora local, con los trabajos de esa línea cuyo `finishedAt` cae dentro de ese mes y con ningún trabajo de otra línea ni de otro mes.

#### Scenario: Límites del mes
- **WHEN** la línea tiene un trabajo terminado en el último instante local de 2026-10, otro en el primer instante local de 2026-11 y otro terminado en 2026-10 en otra línea, y se pide esa línea con el mes 2026-10
- **THEN** el informe contiene solo el primero de esos trabajos

#### Scenario: Trabajos sin terminar
- **WHEN** la línea tiene trabajos en cola, en curso o esperando respuesta creados dentro del mes
- **THEN** ninguno aparece en la lista ni suma en los totales

### Requirement: Mes por defecto y mes inválido
Sin mes indicado, el informe SHALL usar el mes calendario anterior a la fecha actual de la fábrica, y un mes que no tenga la forma AAAA-MM con mes de 01 a 12 MUST rechazarse con un mensaje en español.

#### Scenario: Cruce de año
- **WHEN** se pide el informe sin mes y la fecha actual es 2026-01-15
- **THEN** el informe corresponde al mes 2025-12

#### Scenario: Mes mal escrito
- **WHEN** se pide el informe con el mes 2026-13 o 2026-1
- **THEN** la operación falla con un mensaje en español que menciona AAAA-MM

### Requirement: Elección de líneas
Sin línea indicada, el informe SHALL incluir cada línea configurada, más cualquier línea ya no configurada que tenga trabajos terminados ese mes, y una línea indicada que no cumpla ninguna de las dos condiciones MUST rechazarse con un mensaje en español.

#### Scenario: Todas las líneas
- **WHEN** hay dos líneas configuradas, una sin trabajos en el mes, y se pide el informe sin línea
- **THEN** el resultado trae las dos líneas y la que no tuvo actividad tiene totales en cero

#### Scenario: Línea desconocida
- **WHEN** se pide una línea que no está configurada y no tiene trabajos ese mes
- **THEN** la operación falla con un mensaje en español que nombra esa línea

### Requirement: Detalle de cada trabajo entregado
Cada trabajo con estado `delivered` SHALL aparecer con su título, su fecha de pedido (`createdAt`) y de entrega (`finishedAt`) como AAAA-MM-DD en hora local, y el `summary` de su spec guardada como texto de qué cambió; sin `summary` MUST mostrar `(sin descripción guardada)`.

#### Scenario: Trabajo con spec
- **WHEN** un trabajo entregado tiene título y `spec.summary` guardados
- **THEN** su fila contiene ese título, ese resumen y las dos fechas en formato AAAA-MM-DD

#### Scenario: Trabajo sin spec
- **WHEN** un trabajo entregado no tiene spec guardada
- **THEN** su fila muestra `(sin descripción guardada)`, y el informe se arma sin error

### Requirement: Origen del trabajo
Cada trabajo entregado SHALL indicar su origen en español a partir de `source`, distinguiendo pedido del dueño, issue de GitHub con su número, propuesta del turno nocturno aprobada por el dueño, propuesta que el turno nocturno tomó por su cuenta (`autonomy` presente) e investigación.

#### Scenario: Cada origen
- **WHEN** hay trabajos entregados sin `source`, con `github-issue` número 12, con `night-shift` sin `autonomy`, con `night-shift` con `autonomy: build` y con `research`
- **THEN** cada fila muestra una etiqueta distinta para su origen y la del issue incluye #12

### Requirement: Link de la entrega
Cada trabajo entregado SHALL mostrar el link a su solicitud de cambio cuando la entrega tiene `url` http(s), el link al commit en GitHub cuando tiene `commit` y el remoto de la línea es de GitHub, el hash corto como texto cuando tiene commit sin remoto de GitHub, y el nombre de la rama como texto en los demás casos; una `url` que no sea http(s) MUST mostrarse como texto, nunca como link.

#### Scenario: Solicitud de cambio
- **WHEN** la entrega es `pull-request` con url https://github.com/o/r/pull/3 y además con commit registrado
- **THEN** la fila enlaza a https://github.com/o/r/pull/3

#### Scenario: Commit con remoto de GitHub
- **WHEN** la entrega es `merge` con un commit y el remoto de la línea es https://github.com/o/r.git
- **THEN** la fila enlaza a https://github.com/o/r/commit/<sha>

#### Scenario: Commit sin remoto
- **WHEN** la entrega es `merge` con un commit y la línea no tiene remoto de GitHub
- **THEN** la fila muestra los primeros 8 caracteres del commit, sin link

#### Scenario: Solo rama
- **WHEN** la entrega es `branch` con la rama zero/x
- **THEN** la fila muestra zero/x como texto, sin link

#### Scenario: URL que no es web
- **WHEN** la entrega tiene url javascript:alert(1)
- **THEN** el HTML exportado no contiene un href con ese valor

### Requirement: Totales del mes
Cada informe SHALL traer la cantidad de trabajos entregados, y aparte, como información y no como trabajo hecho, los fallidos y los detenidos; también SHALL traer la suma de intentos (`attempt`), de tiempo (`finishedAt` menos `createdAt`) y de costo (`costUsd`) de todos los trabajos terminados en el mes, indicando que esas sumas incluyen a los fallidos y detenidos y que el tiempo incluye las esperas.

#### Scenario: Sumas exactas
- **WHEN** en el mes terminaron un trabajo entregado (2 intentos, $1.25, 2 horas), uno fallido (3 intentos, $0.50, 1 hora) y uno detenido (0 intentos, $0.25, 30 minutos)
- **THEN** los totales son 1 entregado, 1 fallido, 1 detenido, 5 intentos, 3 h 30 min y $2.00

#### Scenario: Fallidos fuera de la lista
- **WHEN** el informe de ese mes se renderiza
- **THEN** los títulos del trabajo fallido y del detenido no aparecen en la lista de entregas y sus motivos (`reason`) no aparecen en ninguna parte

#### Scenario: Mes sin trabajos
- **WHEN** la línea no terminó ningún trabajo en el mes
- **THEN** el Markdown dice que no hubo trabajos entregados y todos los totales están en cero

### Requirement: Costo estimado con suscripción
El informe SHALL separar del costo del mes la parte de suscripción, sumando `zero.cost.usd` de los spans de agente con `zero.billing` igual a `subscription` de esos trabajos, y MUST aclarar en español que esa parte es un estimado y no se cobró; un span sin dato de facturación MUST contarse como no suscripción.

#### Scenario: Todo con suscripción
- **WHEN** todo el costo del mes viene de spans con `zero.billing: subscription`
- **THEN** el texto dice que el costo es estimado con suscripción y que no se cobró

#### Scenario: Pago por uso
- **WHEN** todos los spans tienen `zero.billing: api`
- **THEN** el texto muestra el costo y no menciona suscripción

#### Scenario: Mezcla
- **WHEN** de $3.00 de costo, $2.00 vienen de spans de suscripción y $1.00 de spans `api`
- **THEN** el texto muestra $3.00 y aclara que $2.00 son estimados con suscripción y no se cobraron

#### Scenario: Facturación desconocida
- **WHEN** un span de $1.00 no tiene `zero.billing` y el resto del costo es de suscripción
- **THEN** ese $1.00 no se cuenta dentro de la parte estimada con suscripción

### Requirement: Texto armado solo con código
El informe MUST armarse solo con datos ya guardados en `state.db` y la configuración, sin invocar ningún agente ni modelo, sin escribir en el store y dando el mismo resultado para los mismos datos y el mismo mes.

#### Scenario: Resultado determinista y sin escrituras
- **WHEN** se pide dos veces el mismo informe con los mismos datos, usando un contexto de fábrica sin ejecutor de agentes
- **THEN** los dos Markdown son idénticos y las filas de `jobs`, `spans` y `kv` no cambian

### Requirement: Exportación sin datos privados
Todo texto guardado que entre al informe MUST salir sin secretos, sin rutas locales y sin las rutas de ninguna línea configurada: se aplican `scrub` por cada línea y `scrubLocal`, y además MUST quitarse las rutas que `scrub` deja escritas con `~` y las rutas con espacios del repositorio de otra línea; el informe de una línea MUST NOT incluir `worktree`, el texto del pedido cuando hay título, identificadores de trabajo, motores ni `reason`.

#### Scenario: Secreto en el resumen
- **WHEN** el `summary` contiene un token con forma de credencial reconocida por `redact`
- **THEN** el Markdown y el HTML exportados no contienen ese token

#### Scenario: Rutas del dueño
- **WHEN** el título o el resumen contienen la carpeta personal del dueño seguida de una subcarpeta, una ruta C:\otra\cosa y un /home/alguien/x
- **THEN** ninguna de esas rutas ni el `~/subcarpeta` resultante aparecen en el informe, y sí aparece `(ruta local)`

#### Scenario: Ruta de otra línea con espacios
- **WHEN** el resumen de un trabajo de la línea A menciona el repositorio de la línea B, cuya ruta tiene espacios
- **THEN** ninguna parte de esa ruta aparece en el informe de la línea A

#### Scenario: Datos internos
- **WHEN** el trabajo tiene `worktree`, un pedido distinto del título, y su línea tiene otras líneas vecinas con trabajos
- **THEN** el informe de esa línea no contiene el worktree, ni el texto del pedido, ni el id del trabajo, ni títulos de las líneas vecinas

### Requirement: Markdown y HTML
`src/report.ts` SHALL renderizar el informe de una línea como Markdown y como documento HTML autónomo sin scripts ni recursos externos, en español, escapando en HTML todo texto guardado y reduciendo a una línea en Markdown los títulos y resúmenes.

#### Scenario: Texto hostil en HTML
- **WHEN** el título es <script>alert(1)</script>
- **THEN** el HTML exportado lo muestra escapado y no contiene ninguna etiqueta <script>

#### Scenario: Resumen de varias líneas
- **WHEN** el resumen tiene saltos de línea y un encabezado Markdown
- **THEN** el Markdown lo muestra en una sola línea dentro de la fila de ese trabajo

#### Scenario: Título en español
- **WHEN** se renderiza el mes 2026-10 de la línea tienda
- **THEN** el encabezado nombra a la línea tienda y dice octubre de 2026

### Requirement: Comando zero informe
`zero informe [línea] [--mes AAAA-MM] [--html]` SHALL imprimir el informe en la salida estándar usando `monthlyReport`, en Markdown por defecto, y `--html` MUST exigir una línea; sin línea, un aviso en la salida de errores MUST recordar que el resultado junta todas las líneas y que para compartir se pide una sola.

#### Scenario: Una línea y un mes
- **WHEN** se corre `zero informe tienda --mes 2026-10` sobre un state.db de prueba
- **THEN** sale con código 0 e imprime el Markdown de tienda de ese mes, sin contenido de otras líneas

#### Scenario: Todas las líneas
- **WHEN** se corre `zero informe --mes 2026-10` con dos líneas
- **THEN** la salida estándar trae las dos secciones y la salida de errores trae el aviso

#### Scenario: HTML sin línea
- **WHEN** se corre `zero informe --html`
- **THEN** sale con código distinto de 0 y un mensaje en español que pide indicar la línea

#### Scenario: Ayuda
- **WHEN** se corre `zero help`
- **THEN** el texto de uso lista `zero informe`

### Requirement: Pestaña del panel
El panel SHALL ofrecer una pestaña `Informe mensual` en `/report` que, con sesión, permita elegir línea y mes por un formulario GET, por defecto todas las líneas y el mes anterior, mostrando cada línea con links de descarga a Markdown y HTML construidos con `monthlyReport`.

#### Scenario: Elegir línea y mes
- **WHEN** una sesión válida abre `/report?line=tienda&mes=2026-10`
- **THEN** la respuesta es 200 y muestra los trabajos de tienda de ese mes, y no los de otras líneas

#### Scenario: Navegación
- **WHEN** una sesión válida abre cualquier página del panel
- **THEN** la navegación tiene un link a `/report`

#### Scenario: Sin sesión
- **WHEN** se pide `/report` o `/report/export` sin sesión
- **THEN** la respuesta es 401 y no contiene datos del informe

#### Scenario: Mes inválido
- **WHEN** una sesión válida abre `/report?mes=2026-13`
- **THEN** la página muestra el mensaje en español sobre AAAA-MM y ningún informe

### Requirement: Descarga desde el panel
`/report/export` SHALL exigir una línea y un formato `md` o `html`, y responder el informe de esa sola línea como archivo adjunto con el tipo de contenido correspondiente y un nombre de archivo sin caracteres fuera de letras, números, punto, guion y guion bajo.

#### Scenario: Markdown
- **WHEN** una sesión válida pide `/report/export?line=tienda&mes=2026-10&format=md`
- **THEN** la respuesta es 200, de tipo text/markdown, con Content-Disposition attachment y nombre informe-tienda-2026-10.md

#### Scenario: HTML
- **WHEN** una sesión válida pide `/report/export?line=tienda&mes=2026-10&format=html`
- **THEN** la respuesta es 200, de tipo text/html, con Content-Disposition attachment y sin el encabezado de navegación del panel

#### Scenario: Sin línea
- **WHEN** una sesión válida pide `/report/export?format=md`
- **THEN** la respuesta no es 200 y no contiene ningún informe

### Requirement: Herramienta de chat de solo lectura
El servidor MCP SHALL exponer `zero_monthly_report`, con `line` y `month` opcionales y anotación `readOnlyHint`, que devuelva el Markdown de `monthlyReport` sin escribir en el store.

#### Scenario: Consulta desde el chat
- **WHEN** un cliente MCP llama a `zero_monthly_report` con line tienda y month 2026-10
- **THEN** recibe el mismo Markdown que imprime `zero informe tienda --mes 2026-10`

#### Scenario: Registro
- **WHEN** un cliente MCP lista las herramientas
- **THEN** `zero_monthly_report` aparece con `readOnlyHint` en true

### Requirement: Nada se envía solo
Ninguna parte del informe MUST enviar datos fuera de la máquina por su cuenta: ni el daemon ni otra pasada automática SHALL generarlo o publicarlo, y solo se genera cuando el dueño lo pide por CLI, panel o chat.

#### Scenario: Sin pasada del daemon
- **WHEN** se revisan `src/daemon.ts` y `src/report.ts` en un test de código fuente
- **THEN** el daemon no referencia `monthlyReport` y `src/report.ts` no usa `fetch` ni los adaptadores de GitHub

### Requirement: Documentación en los dos idiomas
`README.md` y `README.es.md` SHALL documentar `zero informe`, sus opciones, la pestaña del panel y `zero_monthly_report`, con la misma estructura y los mismos bloques de código, y dejar claro que nada se envía solo.

#### Scenario: Tests de documentación
- **WHEN** se corre `test/docs.test.ts`
- **THEN** pasa, con `zero_monthly_report` nombrada en los dos README y `zero informe` presente en los dos

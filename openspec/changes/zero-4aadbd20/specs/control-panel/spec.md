# Spec Delta

## Purpose

Vas a tener una pestaña nueva, "Monitor", en el menú del panel. Funciona como un tablero de instrumentos y muestra cómo viene trabajando la fábrica. Arriba están los totales: trabajos por día (y por semana cuando mirás 30 días), cuántos se entregaron, fallaron, esperan en cola o están en curso, la tasa de éxito con un medidor circular, el tiempo promedio por trabajo y por estación, los intentos por trabajo, cuánto llevás usado de cada plan de suscripción, el gasto del mes por motor y los tokens. Después hay una tarjeta por cada agente (spec, build, verify, review, security, scout, research, tus agentes propios y los de paquetes) con sus tokens, su costo, el tiempo trabajado, la cantidad de llamadas, las entregas en las que participó, su tasa de éxito, los motores y modelos que usó y las líneas donde trabajó. Al final hay una tarjeta por línea con sus trabajos, sus entregas, el último trabajo y los pull requests que siguen abiertos. Arriba podés elegir el período: hoy, 7 días o 30 días. Los gráficos se dibujan dentro de la página, sin librerías de afuera. La página se actualiza sola cada 15 segundos y se adapta al celular. Solo lee lo que la fábrica ya tiene guardado y no cambia nada. Los tokens se empiezan a registrar desde ahora y solo para el motor Claude. Lo que se hizo antes, o con otros motores, aparece como "sin dato". El menú lateral y los colores de marca de la parte 1 del rediseño todavía no están en main, así que la pestaña usa el encabezado y el estilo que tiene el panel hoy.

## ADDED Requirements

### Requirement: Pestaña Monitor en el menú
El panel SHALL mostrar en el menú de toda página con sesión un enlace `<a href="/monitor">Monitor</a>`, y GET `/monitor` con sesión MUST responder 200 con la página del monitor; sin sesión MUST responder 401 con la página de ingreso, sin datos de la fábrica.

#### Scenario: Enlace en el menú
- **WHEN** se pide `/` con una sesión válida
- **THEN** el HTML contiene `<a href="/monitor">Monitor</a>`

#### Scenario: Sin sesión
- **WHEN** se pide `/monitor` sin cookie de sesión
- **THEN** la respuesta es 401, contiene "Panel de tu fábrica" y no contiene el nombre de ninguna línea

### Requirement: Filtro por período
La página `/monitor` MUST aceptar el parámetro `periodo` con valores `hoy` (desde la medianoche local), `7` o `30` (días hacia atrás desde ahora), MUST usar `7` cuando falta o no es válido, MUST mostrar enlaces a los tres períodos marcando el elegido, y todas las cifras que dependen del tiempo SHALL contar solo trabajos y spans de ese período.

#### Scenario: Período hoy
- **WHEN** hay un trabajo entregado ayer y otro hoy, y se pide `/monitor?periodo=hoy`
- **THEN** la cifra de entregados es 1

#### Scenario: Período 7 días
- **WHEN** con los mismos trabajos se pide `/monitor?periodo=7`
- **THEN** la cifra de entregados es 2

#### Scenario: Valor inválido
- **WHEN** se pide `/monitor?periodo=xyz`
- **THEN** la respuesta es 200 y la página trata el período como 7 días

#### Scenario: Enlaces de período
- **WHEN** se pide `/monitor`
- **THEN** el HTML contiene enlaces a `/monitor?periodo=hoy`, `/monitor?periodo=7` y `/monitor?periodo=30`

### Requirement: Totales de la fábrica
El monitor SHALL mostrar, para el período elegido: trabajos creados por día (y por semana con período 30), entregados, fallidos y detenidos; en cola y en curso (estado actual, `queued` y `running` más `waiting` como en curso); tasa de éxito = entregados / (entregados + fallidos), o "sin dato" si no hay ninguno; tiempo promedio por trabajo (de `createdAt` a `finishedAt` de los terminados que no se detuvieron); tiempo promedio por estación (duración de los spans `zero.station.<estación>` terminados y no marcados `zero.skipped`); e intentos promedio por trabajo terminado (`job.attempt`).

#### Scenario: Tasa de éxito
- **WHEN** en el período hay 3 trabajos entregados y 1 fallido
- **THEN** la página muestra una tasa de éxito de 75 %

#### Scenario: Sin trabajos
- **WHEN** no hay trabajos terminados en el período
- **THEN** la tasa de éxito se muestra como "sin dato" y la página responde 200

#### Scenario: En cola y en curso
- **WHEN** hay 2 trabajos `queued` y 1 `running`
- **THEN** la página muestra 2 en cola y 1 en curso

#### Scenario: Promedio por estación
- **WHEN** hay dos spans `zero.station.build` terminados de 2 y 4 minutos dentro del período
- **THEN** el promedio de build se muestra como 3 min

#### Scenario: Intentos por trabajo
- **WHEN** dos trabajos terminados tienen `attempt` 1 y 3
- **THEN** los intentos promedio se muestran como 2

### Requirement: Uso de suscripción, gasto del mes y tokens
El monitor SHALL mostrar el porcentaje usado de cada ventana vigente de plan de suscripción (las `windows` de `budgetState`) como un medidor circular, el gasto del mes calendario local por motor (suma de `zero.cost.usd` de los spans `gen_ai.invoke_agent` de ese motor cuya facturación no es `subscription`, con el mismo criterio que `billedUsd`) y los tokens totales del período (suma de `gen_ai.usage.input_tokens` y `gen_ai.usage.output_tokens`), indicando "sin dato" cuando ningún span del período los tiene.

#### Scenario: Medidor de plan
- **WHEN** el último span de claude informa facturación `subscription` con una ventana usada al 40 %
- **THEN** la página contiene un medidor SVG de claude que muestra 40 %

#### Scenario: Gasto del mes por motor
- **WHEN** este mes hay spans de codex con facturación `api` que suman 1.50 USD y spans de claude `subscription` que suman 3 USD
- **THEN** el gasto del mes muestra $1.50 para codex y $0.00 para claude

#### Scenario: Tokens totales
- **WHEN** dos spans del período registran 100+50 y 200+25 tokens de entrada y salida
- **THEN** los tokens totales muestran 375

### Requirement: Registro de tokens del motor Claude
Cuando el motor Claude informa el uso de tokens en su mensaje de resultado, zero MUST guardarlo en `EngineResult.tokens` (`input`, `output`) desde `claudeResult`, y el corredor de agentes MUST registrarlo en el span `gen_ai.invoke_agent` como `gen_ai.usage.input_tokens` y `gen_ai.usage.output_tokens`; si no lo informa, no MUST escribir esos atributos.

#### Scenario: Resultado con uso
- **WHEN** `claudeResult` recibe un resultado con `usage.input_tokens` 120 y `usage.output_tokens` 30
- **THEN** el `EngineResult` devuelto tiene `tokens` igual a `{ input: 120, output: 30 }`

#### Scenario: Atributos del span
- **WHEN** un agente falso devuelve `tokens: { input: 10, output: 5 }`
- **THEN** el span del agente termina con `gen_ai.usage.input_tokens` 10 y `gen_ai.usage.output_tokens` 5

#### Scenario: Sin uso
- **WHEN** un agente falso no devuelve `tokens`
- **THEN** el span no tiene atributos `gen_ai.usage.*`

### Requirement: Tarjeta por agente (4aadbd20)
El monitor SHALL mostrar una tarjeta (`data-agent="<nombre>"`) por cada agente fijo (spec, build, verify, review, security, scout, research), por cada agente propio y de paquete que devuelve `lineAgents` en alguna línea, y por cada otro valor de `gen_ai.agent.name` que aparezca en el período. Cada tarjeta MUST mostrar: tokens, costo, tiempo trabajado (suma de duraciones), cantidad de llamadas, tasa de éxito (llamadas con estado `ok` sobre las terminadas), entregas en las que participó (trabajos distintos de sus spans con estado `delivered`), los motores (`zero.engine`) y modelos (`gen_ai.response.model`, o si no `gen_ai.request.model`) usados y las líneas (la línea de los trabajos de sus spans). Para `verify`, que no es un agente, las cifras MUST salir de los spans `zero.station.verify`. Un agente sin actividad muestra ceros.

#### Scenario: Cifras de un agente
- **WHEN** en el período hay 2 spans `gen_ai.invoke_agent` de `review` (uno ok y uno error), con costo 0.10 y 0.20, de un trabajo entregado de la línea `tienda`, con motor claude
- **THEN** la tarjeta `data-agent="review"` muestra 2 llamadas, $0.30, 50 % de éxito, 1 entrega, claude y tienda

#### Scenario: Agente sin actividad
- **WHEN** no hay spans de `security` en el período
- **THEN** la tarjeta `data-agent="security"` existe y muestra 0 llamadas

#### Scenario: Agente propio configurado
- **WHEN** la línea tiene un agente propio `estilo` sin llamadas
- **THEN** hay una tarjeta `data-agent="estilo"`

#### Scenario: Agente de paquete
- **WHEN** hay un span con `gen_ai.agent.name` `package:p/est`
- **THEN** hay una tarjeta para `package:p/est`, con el nombre escapado

#### Scenario: Verify
- **WHEN** hay un span `zero.station.verify` terminado ok de 1 minuto en el período
- **THEN** la tarjeta `data-agent="verify"` muestra 1 llamada y 100 % de éxito

### Requirement: Tarjeta por línea
El monitor SHALL mostrar una tarjeta (`data-line="<nombre>"`) por cada línea configurada con: trabajos creados en el período, entregas del período, el último trabajo de la línea (nombre, estado y enlace a `/job/<id>`) y la cantidad de pull requests abiertos, contando como abiertos los trabajos entregados con `delivery.mode` `pull-request` cuyo `MergeState` guardado no está en `merged`, `closed` ni `expired`. Esto MUST salir solo del estado guardado, sin consultar GitHub.

#### Scenario: Pull requests abiertos
- **WHEN** la línea tiene dos trabajos entregados con pull request, uno con `MergeState` `merged` y otro sin estado
- **THEN** la tarjeta de la línea muestra 1 pull request abierto

#### Scenario: Último trabajo
- **WHEN** la línea tiene trabajos creados en distintos momentos
- **THEN** la tarjeta enlaza a `/job/<id>` del más reciente

#### Scenario: Línea sin trabajos
- **WHEN** una línea configurada no tiene trabajos
- **THEN** su tarjeta existe y muestra 0 trabajos

### Requirement: Gráficos SVG propios, sin código externo
Los indicadores del monitor MUST dibujarse con elementos `<svg>` incrustados en el HTML: medidores circulares para tasas y planes, barras para totales por motor o por semana y un gráfico de línea para trabajos por día. La página MUST NOT cargar scripts, hojas de estilo, fuentes ni imágenes externas, y MUST NOT tener otro `<script>` que el de actualización automática del panel.

#### Scenario: SVG incrustado
- **WHEN** se pide `/monitor` con trabajos en el período
- **THEN** el HTML contiene al menos un `<svg` y una `<polyline` o un `<path` para la serie diaria

#### Scenario: Sin recursos externos
- **WHEN** se pide `/monitor`
- **THEN** el HTML no contiene `<script src`, `<link` ni `src="http`

### Requirement: Actualización automática y celular
La página `/monitor` SHALL incluir el script de recarga automática del panel (el mismo `REFRESH` cada 15 s), y sus tarjetas MUST ordenarse en una grilla que pasa a una sola columna en pantallas de hasta 600 px.

#### Scenario: Recarga
- **WHEN** se pide `/monitor`
- **THEN** el HTML contiene un `<script nonce=` con `location.reload()`

#### Scenario: Celular
- **WHEN** se lee el CSS del panel
- **THEN** hay una regla `@media (max-width: 600px)` que deja la grilla del monitor en una columna

### Requirement: Monitor solo lectura
El monitor MUST ser solo lectura: `/monitor` no MUST tener formularios POST, y armar la vista (`monitorView` en `src/app.ts`) MUST NOT escribir jobs, spans, kv ni archivos.

#### Scenario: Sin formularios
- **WHEN** se pide `/monitor`
- **THEN** el HTML no contiene `method="post"`

#### Scenario: Sin escrituras
- **WHEN** se llama a `monitorView` dos veces sobre un estado con trabajos y spans
- **THEN** la cantidad de jobs, spans y claves kv no cambia y ambas llamadas devuelven lo mismo

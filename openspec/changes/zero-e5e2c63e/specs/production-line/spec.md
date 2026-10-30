# Spec Delta

## ADDED Requirements

### Requirement: Configuración de reemplazos
zero.factory.yaml SHALL aceptar una lista opcional `fallback` global y una lista opcional `stations.<estación>.fallback`. Cada elemento puede ser el nombre de un motor o un objeto `{ engine, model? }`. Si una estación tiene su propia lista, esa lista SHALL usarse en lugar de la global. La configuración MUST ser rechazada con un error en español si un reemplazo nombra un motor que no es integrado ni está declarado en `engines`.

#### Scenario: Lista global como texto
- **WHEN** parseFactory lee `fallback: [codex]`
- **THEN** la cadena de motores de cada estación es [motor de la estación, codex] y la de codex no tiene modelo

#### Scenario: Lista por estación con modelo
- **WHEN** parseFactory lee `fallback: [codex]` y `stations: { review: { fallback: [{ engine: antigravity, model: m1 }] } }`
- **THEN** la cadena de review es [claude, antigravity con modelo m1] y la de build es [claude, codex]

#### Scenario: Motor desconocido
- **WHEN** parseFactory lee `fallback: [nadie]`
- **THEN** lanza ConfigError y el mensaje menciona `nadie`

#### Scenario: Sin reemplazo
- **WHEN** la configuración no tiene `fallback`
- **THEN** la cadena de cada estación es solo su motor y el comportamiento del presupuesto es el actual

### Requirement: Estado del presupuesto por motor
El cálculo del presupuesto (src/budget.ts) SHALL dar, para cada motor que aparezca en alguna cadena de estación, si está pausado, hasta cuándo y por qué. Un motor con suscripción SHALL quedar pausado si una ventana de su plan está agotada, si pasó la reserva del dueño o si rechazó una llamada. Un motor que se paga por uso SHALL quedar pausado solo si su propio gasto cobrado del día alcanza `usdPerDay`. El gasto de otros motores no cuenta.

#### Scenario: Plan agotado de un solo motor
- **WHEN** claude reportó una ventana de 5 horas agotada que se renueva a las 23:20 y codex no reportó nada
- **THEN** el estado por motor marca a claude pausado hasta las 23:20 y a codex disponible

#### Scenario: Tope diario por motor
- **WHEN** codex se paga por uso y gastó hoy $10 con `usdPerDay: 10`, y claude con suscripción no está agotado
- **THEN** codex está pausado y claude sigue disponible

#### Scenario: El gasto de otro motor no cuenta
- **WHEN** codex se paga por uso y gastó $2, otro motor que también se paga por uso gastó $9, y `usdPerDay` es 10
- **THEN** codex no está pausado

### Requirement: Pausa solo sin ningún motor
`budgetState(...).reached` SHALL ser verdadero solo si al menos una de las estaciones de la línea (spec, build, review, security) tiene todos los motores de su cadena pausados. En ese caso `until` SHALL ser el momento más cercano en que esa estación vuelve a tener un motor disponible. Sin reemplazos configurados, el resultado MUST coincidir con el comportamiento actual.

#### Scenario: Reemplazo disponible
- **WHEN** claude está agotado, `fallback: [codex]` y codex está disponible
- **THEN** budgetState devuelve reached=false y el daemon arranca trabajos de la cola

#### Scenario: Todos agotados
- **WHEN** claude está agotado hasta las 23:20 y codex (reemplazo) tiene su tope diario alcanzado
- **THEN** budgetState devuelve reached=true y el daemon no arranca trabajos nuevos

#### Scenario: Compatibilidad
- **WHEN** no hay fallback y claude está agotado hasta las 18:00
- **THEN** budgetState devuelve reached=true con until 18:00 y una razón que menciona el cupo, como hoy

### Requirement: Elección del motor de cada llamada
Cada llamada a un agente de una estación SHALL usar el primer motor de la cadena de esa estación que no esté pausado en ese momento, con el modelo de ese elemento de la cadena. Cuando el motor original de la estación se renueva, las llamadas siguientes SHALL volver a él. Si todos están pausados, SHALL usarse el motor original, como hoy.

#### Scenario: Usa el reemplazo
- **WHEN** claude (motor de review) está pausado, `fallback: [codex]`, y corre la estación review
- **THEN** el agente falso registra la llamada con engine codex

#### Scenario: Vuelve al original
- **WHEN** la ventana agotada de claude ya pasó su resetsAt y corre la estación review
- **THEN** el agente registra la llamada con engine claude

#### Scenario: Modelo del reemplazo
- **WHEN** la cadena de build es [claude, {engine: codex, model: m1}] y claude está pausado
- **THEN** la llamada de build lleva model m1

### Requirement: Corte a mitad de trabajo
Si el plan rechaza una llamada de una estación (quota.limited) y otro motor de la cadena de esa estación está disponible, el trabajo SHALL repetir esa estación con ese motor, sin volver a la cola y sin gastar un intento. En build, los cambios a medio hacer de la llamada cortada MUST descartarse antes de repetir. Si ningún motor está disponible, el trabajo SHALL volver a la cola sin gastar un intento, como hoy.

#### Scenario: Build cortado sigue con el reemplazo
- **WHEN** la primera llamada de build con claude devuelve quota.limited y `fallback: [codex]` está disponible
- **THEN** build se repite con codex en el mismo intento (job.attempt sigue en 1), el trabajo no vuelve a status queued y termina entregado

#### Scenario: Review cortado sigue con el reemplazo
- **WHEN** review con claude devuelve quota.limited y hay reemplazo disponible
- **THEN** review se repite con el reemplazo y el número de intento no cambia

#### Scenario: Sin reemplazo disponible
- **WHEN** build devuelve quota.limited y no hay fallback configurado
- **THEN** el trabajo queda en status queued con attempt sin incrementar

### Requirement: Topes en dólares por motor
El tope por llamada (`maxBudgetUsd`) SHALL decidirse según el motor elegido para esa llamada: ninguno si ese motor usa una suscripción, y lo que queda del presupuesto del trabajo si se paga por uso. El control de `usdPerJob` del trabajo SHALL contar solo el costo de las llamadas del trabajo cobradas por uso, y SHALL aplicarse solo cuando el próximo motor elegido se paga por uso.

#### Scenario: Reemplazo pago con tope
- **WHEN** claude con suscripción está pausado y build corre con codex, que se reportó como `api`
- **THEN** la llamada a codex lleva maxBudgetUsd igual a lo que queda del presupuesto del trabajo

#### Scenario: Original con suscripción sin tope
- **WHEN** build corre con claude con suscripción disponible
- **THEN** la llamada no lleva maxBudgetUsd

#### Scenario: Costo estimado de suscripción no consume el presupuesto
- **WHEN** el trabajo acumuló $5 estimados en llamadas de suscripción y el próximo motor elegido se paga por uso con `usdPerJob: 3`
- **THEN** el trabajo no se para ni pregunta por presupuesto

### Requirement: Garantías de los reemplazos
Un reemplazo SHALL ser siempre un motor de la cadena configurada por el dueño; zero MUST NOT elegir un motor que no esté en ella. Las llamadas con un reemplazo SHALL pasar por el mismo ejecutor (la caja y la puerta de salida cuando el trabajo corre en la caja) con el acceso de la estación (solo lectura salvo build). Los motores de reemplazo SHALL contar como motores de las estaciones para las credenciales de la caja y para los sitios que la puerta de salida permite.

#### Scenario: Solo lectura con reemplazo
- **WHEN** review corre con el reemplazo codex
- **THEN** el EngineRequest que recibe el ejecutor tiene access "read"

#### Scenario: Sitios del reemplazo permitidos
- **WHEN** un motor propio `alt` con `hosts: [api.alt.dev]` aparece solo en `fallback`
- **THEN** egressPolicy incluye api.alt.dev en allow y stationEngines incluye alt

### Requirement: Visibilidad en la traza y el panel
El span del agente SHALL registrar el motor usado (`zero.engine`) y, cuando es un reemplazo, el motor original (`zero.engine.replaces`) y el motivo (`zero.engine.reason`, por ejemplo «claude pausado hasta 23:20»). La traza y el detalle de la estación en el panel SHALL mostrar ese motivo junto al motor.

#### Scenario: Traza con reemplazo
- **WHEN** review corrió con codex porque claude estaba pausado hasta las 23:20 y se pide la traza del trabajo
- **THEN** el texto de renderTrace contiene «review vía codex» y «claude pausado hasta 23:20»

#### Scenario: Sin reemplazo no hay motivo
- **WHEN** review corrió con su motor original
- **THEN** el span del agente no tiene la propiedad zero.engine.reason

#### Scenario: Panel
- **WHEN** se pide la vista de la línea de un trabajo cuya review usó un reemplazo
- **THEN** el detalle de la estación review muestra el motor codex y el motivo

### Requirement: Visibilidad en el estado
Cuando un motor de alguna cadena está pausado y su estación tiene un reemplazo disponible, la línea del presupuesto (estado de la fábrica y panel) SHALL decirlo con el formato «<motor> pausado hasta <hora> · trabajando con <reemplazo>», y MUST NOT mostrar la fábrica como PAUSADA.

#### Scenario: Estado con reemplazo activo
- **WHEN** claude está agotado hasta las 23:20, `fallback: [codex]` y codex está disponible
- **THEN** formatStatus contiene «claude pausado hasta 23:20 · trabajando con codex» y no contiene «PAUSADA»

# Spec Delta

## ADDED Requirements

### Requirement: Facturación de Codex según su sesión
Cada llamada del motor codex SHALL informar `EngineResult.quota.billing`: `api` si `CODEX_API_KEY` u `OPENAI_API_KEY` tienen valor no vacío en el entorno del proceso o en `EngineRequest.env`, sin consultar `codex login status`; en otro caso, `subscription` si la salida de `codex login status` (stdout o stderr, con código 0) dice que la sesión es de ChatGPT, y `api` si dice que es con una API key.

#### Scenario: Sesión de ChatGPT
- **WHEN** no hay claves en el entorno y el `codex login status` falso escribe `Logged in using ChatGPT` en stderr y sale con 0
- **THEN** el resultado tiene `quota.billing` igual a `subscription`

#### Scenario: Clave en el entorno de la llamada
- **WHEN** `EngineRequest.env` trae `CODEX_API_KEY` y `codex login status` diría ChatGPT
- **THEN** el resultado tiene `quota.billing` igual a `api` y el proceso falso no recibió ninguna llamada a `login status`

#### Scenario: OPENAI_API_KEY en el proceso
- **WHEN** `process.env.OPENAI_API_KEY` tiene valor y `EngineRequest.env` no trae claves
- **THEN** el resultado tiene `quota.billing` igual a `api`

#### Scenario: Clave vacía
- **WHEN** `CODEX_API_KEY` y `OPENAI_API_KEY` son cadenas vacías y `codex login status` dice ChatGPT
- **THEN** el resultado tiene `quota.billing` igual a `subscription`

#### Scenario: API key guardada en la sesión
- **WHEN** no hay claves en el entorno y `codex login status` escribe `Logged in using an API key` y sale con 0
- **THEN** el resultado tiene `quota.billing` igual a `api`

### Requirement: Consulta de sesión que no molesta
Una falla de `codex login status` (programa ausente, código distinto de 0, salida no reconocida o más de 10 segundos) MUST NOT cambiar `ok` ni `text` de la llamada; sin clave en el entorno, sin esa respuesta y sin ventanas de uso, el resultado SHALL no traer `quota`.

#### Scenario: Sin sesión
- **WHEN** `codex login status` sale con 1 y `codex exec` responde `listo` sin límites de uso
- **THEN** el resultado es exactamente `{ ok: true, text: "listo" }`

#### Scenario: Consulta colgada
- **WHEN** `codex login status` no termina y `codex exec` ya respondió
- **THEN** la llamada termina con la respuesta de `codex exec` y sin `quota`, en no más de unos 10 segundos adicionales

#### Scenario: Binario que desaparece
- **WHEN** lanzar `codex login status` rechaza con error de inicio y `codex exec` ya respondió
- **THEN** la llamada devuelve la respuesta de `codex exec` y no lanza una excepción

### Requirement: Salida JSON de codex exec
El motor codex MUST invocar `codex exec` con `--json` y la respuesta SHALL seguir saliendo del archivo de `--output-last-message`; sin ese archivo, SHALL salir del último mensaje del agente en los eventos de stdout (`item.completed` con item de tipo `agent_message`) o, si stdout no trae eventos JSON, del texto tal cual, y los eventos crudos MUST NOT devolverse como respuesta.

#### Scenario: Argumento presente
- **WHEN** se arma `codexInvocation` para cualquier pedido
- **THEN** sus argumentos incluyen `--json` y el último sigue siendo `-`

#### Scenario: Sin archivo, con mensaje en eventos
- **WHEN** el proceso falso no escribe el archivo e imprime eventos JSONL con un `item.completed` de tipo `agent_message` y texto `hola`
- **THEN** el resultado tiene `ok: true` y `text: "hola"`

#### Scenario: Sin archivo, solo eventos sin mensaje
- **WHEN** el proceso falso no escribe el archivo e imprime solo `{"type":"turn.started"}`
- **THEN** el resultado tiene `ok: false` y su texto empieza con `codex devolvió salida vacía`

#### Scenario: Sin archivo, texto plano
- **WHEN** el proceso falso no escribe el archivo e imprime `hola` sin JSON
- **THEN** el resultado tiene `ok: true` y `text: "hola"`

### Requirement: Errores de Codex legibles con --json
Cuando `codex exec` sale con error, el texto SHALL ser `codex exited with <código>: ` seguido de stderr si tiene contenido; si no, del mensaje del último evento de error de stdout (`error` o `turn.failed`), y MUST NOT ser JSONL crudo cuando ese mensaje existe.

#### Scenario: Error solo en eventos
- **WHEN** el proceso falso sale con 1, con stderr vacío, e imprime `{"type":"error","message":"sin permiso"}`
- **THEN** el texto es `codex exited with 1: sin permiso`

#### Scenario: Fallo de turno en eventos
- **WHEN** el proceso falso sale con 1, con stderr vacío, e imprime `{"type":"turn.failed","error":{"message":"sin permiso"}}`
- **THEN** el texto es `codex exited with 1: sin permiso`

#### Scenario: Stderr manda
- **WHEN** el proceso falso escribe `roto` en stderr, sale con 3 e imprime eventos en stdout
- **THEN** el texto es `codex exited with 3: roto`

### Requirement: Ventanas de uso de Codex
Con facturación de suscripción, el motor codex SHALL convertir el último `rate_limits` válido de los eventos de `codex exec --json`, en cualquier nivel del evento, en `quota.windows`: una ventana por `primary` y `secondary` con `used_percent` numérico, `utilization` igual a `used_percent`/100 limitado a 1, `status` `exhausted` al llegar a 1 y `ok` por debajo, y `resetsAt` ISO tomado de `resets_at` (segundos Unix) o de `resets_in_seconds`.

#### Scenario: Dos ventanas
- **WHEN** la sesión es de ChatGPT y un evento trae `rate_limits` con primary `{used_percent: 25, window_minutes: 300, resets_at: 1790000000}` y secondary `{used_percent: 100, window_minutes: 10080, resets_in_seconds: 3600}`
- **THEN** `quota.windows` tiene `name` primary con label `5 horas`, utilization 0.25, status `ok` y resetsAt igual a ese instante, y `name` secondary con label `semana`, utilization 1, status `exhausted` y resetsAt una hora después del momento de la lectura

#### Scenario: Gana la última lectura válida
- **WHEN** hay dos eventos con `rate_limits` válidos seguidos de uno con `rate_limits: null` y una línea que no es JSON
- **THEN** las ventanas son las del segundo evento válido

#### Scenario: Anidado en el evento
- **WHEN** el `rate_limits` llega dentro de `payload` de un evento `event_msg`
- **THEN** se convierte igual que uno de primer nivel

#### Scenario: Sin límites de uso
- **WHEN** la sesión es de ChatGPT y ningún evento trae `rate_limits`
- **THEN** `quota` es `{ billing: "subscription", windows: [] }`

#### Scenario: Datos inválidos
- **WHEN** primary no tiene `used_percent` numérico y secondary es válido
- **THEN** `quota.windows` solo contiene secondary

#### Scenario: Duración sin etiqueta fija
- **WHEN** una ventana trae `window_minutes` 120 y otra no trae `window_minutes`
- **THEN** la primera tiene label `2 horas` y la segunda usa su nombre como label

#### Scenario: Pago por uso sin ventanas
- **WHEN** la facturación resulta `api` y un evento trae `rate_limits`
- **THEN** `quota` es `{ billing: "api", windows: [] }`

#### Scenario: Límites sin dato de sesión
- **WHEN** `codex login status` falla, no hay claves en el entorno y un evento trae `rate_limits` válidos
- **THEN** `quota.billing` es `subscription` y las ventanas son las reportadas

### Requirement: El presupuesto pausa Codex por su cupo
Las lecturas de cupo de Codex MUST llegar al span de agente también en llamadas fallidas, y `budget.ts` SHALL pausar el motor al llegar a `limits.reservePercent` o a una ventana agotada hasta que renueve; si la llamada falló con una ventana reportada agotada, el reporte SHALL llevar `limited: true`.

#### Scenario: Llega a la reserva
- **WHEN** un reporte de `codexEngine` con la ventana primary en 85% y reset futuro se registra con `quotaAttrs` para el motor codex y `limits.reservePercent` es 20
- **THEN** `budgetState` lista codex con `paused: true`, `billing: "subscription"` y `until` igual a ese reset

#### Scenario: Debajo de la reserva
- **WHEN** la misma lectura trae la ventana en 50%
- **THEN** `budgetState` lista codex con `paused: false`

#### Scenario: Llamada rechazada
- **WHEN** el proceso falso imprime `rate_limits` con primary en 100, sale con 1 y la sesión es de ChatGPT
- **THEN** el resultado tiene `ok: false`, `quota.limited: true` y la ventana `exhausted`

#### Scenario: Falla con cupo disponible
- **WHEN** el proceso falso imprime `rate_limits` con primary en 40, sale con 1 y la sesión es de ChatGPT
- **THEN** el resultado tiene `ok: false`, la ventana en el reporte y `quota.limited` no es `true`

#### Scenario: Cancelación
- **WHEN** la señal de la llamada se aborta durante `codex exec`
- **THEN** el texto sigue siendo `codex cancelled` y no se lanza `codex login status`

### Requirement: usdPerNight cuenta solo lo cobrado
`scoutSpent` MUST sumar solo el costo de los spans de scout, research y `package:*` cuya facturación no sea `subscription`, con el mismo criterio que `jobBilledUsd`: el dato del span, si no el de la última lectura de su motor, y una llamada de facturación desconocida cuenta.

#### Scenario: Mezcla
- **WHEN** en el período hay un span de scout `api` de 0.4, uno de research `subscription` de 5 y uno de `package:p/s` `subscription` de 3
- **THEN** `scoutSpent` devuelve 0.4

#### Scenario: Span viejo con motor de suscripción
- **WHEN** un span de scout sin `zero.billing` de 2 dólares tiene un motor cuya última lectura es `subscription`
- **THEN** `scoutSpent` no suma esos 2

#### Scenario: Span viejo con motor de pago por uso
- **WHEN** un span de scout sin `zero.billing` de 2 dólares tiene un motor cuya última lectura es `api`
- **THEN** `scoutSpent` suma esos 2

#### Scenario: Facturación desconocida
- **WHEN** un span de scout sin `zero.billing` de 2 dólares tiene un motor sin lecturas
- **THEN** `scoutSpent` suma esos 2

#### Scenario: Las otras estaciones no cuentan
- **WHEN** hay un span de `build` `api` de 7 en el período
- **THEN** `scoutSpent` no suma esos 7

#### Scenario: Scout con otro motor de pago por uso
- **WHEN** scout usa codex con facturación `api`, `usdPerNight` es 1 y hay spans de scout en claude `subscription` que suman 5
- **THEN** `scoutPass` llama al agente con `maxBudgetUsd` 1

#### Scenario: Investigación y paquetes
- **WHEN** research y la estación de un paquete eligen un motor sin facturación de suscripción, `usdPerNight` es 1 y lo gastado por suscripción en el período suma 5
- **THEN** cada uno llama al agente con un tope de 1 en lugar de omitir la corrida

#### Scenario: El tope sigue vigente
- **WHEN** los spans `api` de scout en el período suman `usdPerNight`
- **THEN** `scoutPass` no llama al agente

### Requirement: Documentación del plan de Codex
`README.md` y `README.es.md` MUST explicar, con la misma estructura, que Codex con sesión de ChatGPT se limita por el cupo del plan y `limits.reservePercent`, que con `CODEX_API_KEY` u `OPENAI_API_KEY` es pago por uso, y que `limits.usdPerNight` solo cuenta lo que se cobra.

#### Scenario: Ambos idiomas
- **WHEN** corre la prueba de documentación
- **THEN** `README.md` y `README.es.md` contienen `ChatGPT`, `CODEX_API_KEY`, `OPENAI_API_KEY` y `usdPerNight`, y `test/docs.test.ts` y `test/wording.test.ts` pasan

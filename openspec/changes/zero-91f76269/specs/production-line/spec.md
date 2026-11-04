# Spec Delta

## ADDED Requirements

### Requirement: Corte de red pasajero vuelve a la cola
Cuando una excepción que llega al catch final de `runJob` es un error de red pasajero (ECONNRESET, ETIMEDOUT, EAI_AGAIN, ECONNREFUSED o EPIPE en el `code` o en el mensaje del error o de su cadena de `cause`), el trabajo SHALL quedar en `queued` con su checkpoint intacto, sin pasar por `finalizeJob`, y el reintento SHALL registrarse en el log.

#### Scenario: ECONNRESET en revisión reanuda sin repetir lo completado
- **WHEN** el agente falso de `review` lanza un error con mensaje `read ECONNRESET` en su primera llamada y se vuelve a llamar a `runJob`
- **THEN** la primera llamada devuelve el trabajo en `queued` con checkpoint `spec`, y la segunda lo deja `delivered` con `spec` y `build` llamados una sola vez cada uno

#### Scenario: Reconocido por el código
- **WHEN** un agente falso lanza un error de mensaje genérico con `code` igual a cualquiera de ETIMEDOUT, EAI_AGAIN, ECONNREFUSED o EPIPE
- **THEN** el trabajo queda en `queued`

#### Scenario: Reconocido en la causa
- **WHEN** un agente falso lanza `fetch failed` con `cause.code` igual a ECONNRESET
- **THEN** el trabajo queda en `queued`

### Requirement: Tope de reintentos persistente
Cada trabajo MUST tener como máximo 2 reintentos por corte de red, contados en una clave kv propia del trabajo que sobrevive entre llamadas a `runJob`; el siguiente corte SHALL terminar el trabajo con `finalizeJob` en `failed`, con el motivo `Error inesperado: <mensaje>` de hoy.

#### Scenario: Falla tras el tope
- **WHEN** el agente de `review` lanza ECONNRESET en todas sus llamadas y se llama a `runJob` tres veces
- **THEN** las dos primeras llamadas devuelven `queued`, y la tercera devuelve `failed` con un motivo que contiene `Error inesperado: read ECONNRESET`, sin una cuarta llamada al agente

### Requirement: Otros errores fallan en el acto
Una excepción que no sea un corte de red pasajero MUST terminar el trabajo en `failed` en esa misma llamada, como hoy, sin consumir reintentos.

#### Scenario: Error común
- **WHEN** un agente falso lanza `new Error("boom")`
- **THEN** `runJob` devuelve `failed` con el motivo `Error inesperado: boom` y la clave kv de reintentos del trabajo no existe

### Requirement: Un fallo de setup no se reintenta
Un fallo de un comando de `setup` de la línea MUST terminar el trabajo en `failed` aunque su salida nombre un código de red, porque reanudar con la copia ya creada saltearía `setup`.

#### Scenario: Setup con ECONNRESET en la salida
- **WHEN** un comando de `setup` imprime `npm ERR! code ECONNRESET` y termina con código 1
- **THEN** `runJob` devuelve `failed` en esa llamada, con un motivo que nombra el setup, y no se llama a ningún agente

### Requirement: Detener tiene prioridad sobre reintentar
Si la señal del trabajo ya está abortada cuando llega la excepción, la rama de interrupción existente SHALL decidir el resultado y el corte de red MUST NOT consumir un reintento.

#### Scenario: Detenido durante un corte
- **WHEN** el agente de `build` aborta la señal con `stop` y lanza ECONNRESET
- **THEN** el trabajo termina `stopped` con el motivo `Lo detuviste vos.` y la clave kv de reintentos no existe

### Requirement: El corte no gasta un intento de build
Un corte de red durante `build` o durante un agente propio que escribe MUST descartar los cambios sin commit; durante `build` tampoco MUST contar como intento de la línea.

#### Scenario: Corte en el último intento
- **WHEN** con `maxAttempts` de la línea en 1, el agente de `build` escribe un archivo y lanza ECONNRESET en su primera llamada, y escribe el cambio correcto en la segunda
- **THEN** el trabajo termina `delivered` con `attempt` 1 y el archivo de la primera llamada no está en la rama base

### Requirement: Solicitud de cambio ya existente termina en pregunta
Si GitHub rechaza abrir la solicitud de cambio porque ya existe una para esa rama (estado 422 con `already exists` en el mensaje), `integrate` MUST devolver `{ ok: false }`, de modo que el trabajo SHALL pasar a `waiting` con la pregunta `integration-blocked`, sin crear un duplicado ni fallar.

#### Scenario: Corte y luego choque
- **WHEN** en una línea `pull-request`, el adaptador falso lanza `read ECONNRESET` en la primera llamada y un error 422 `A pull request already exists` en la segunda
- **THEN** la primera `runJob` devuelve `queued`, la segunda devuelve `waiting` con pregunta `integration-blocked` y el adaptador no registró ninguna solicitud creada

#### Scenario: Aprobar reintenta la integración
- **WHEN** se aprueba esa pregunta y el adaptador falso devuelve una URL en la llamada siguiente
- **THEN** el trabajo termina `delivered` con esa URL y los agentes no se vuelven a llamar

### Requirement: El reintento reutiliza la solicitud abierta
Al reintentar la integración, si GitHub ya lista una solicitud de cambio abierta para la rama, zero SHALL actualizarla y devolver su URL, y MUST NOT pedir la creación de otra.

#### Scenario: Solicitud abierta en la lista
- **WHEN** se llama a `createGitHubTracker(...).openPullRequest` con `fetch` simulado y el listado devuelve una solicitud abierta con su `html_url`
- **THEN** devuelve esa `html_url`, hace un PATCH y ningún POST de creación

# Spec Delta

## ADDED Requirements

### Requirement: Duración conocida de un comando de verify
`src/line/pace.ts` SHALL exportar una función que devuelva, en milisegundos, cuánto tardó la más lenta de las últimas 5 corridas aprobadas de un comando en una línea, con el mismo historial que hoy usa `verifyTimeoutMs` (30 días, `zero.run_ms` cuando existe), o `undefined` cuando no hay ninguna.

#### Scenario: Con historial
- **WHEN** el historial de `npm test` en la línea tiene corridas aprobadas de 15, 19 y 12 minutos
- **THEN** la función devuelve 19 minutos en milisegundos

#### Scenario: Solo cuentan las corridas pertinentes
- **WHEN** el historial tiene, además de cinco corridas aprobadas recientes de 11 minutos, una aprobada anterior de 100 minutos y otras de 90 minutos que fallaron, son de otro comando, son de otra línea o no terminaron
- **THEN** la función devuelve 11 minutos en milisegundos

#### Scenario: Sin historial
- **WHEN** no hay corridas aprobadas de ese comando en esa línea
- **THEN** la función devuelve `undefined`

#### Scenario: Tiempo de corrida y no de espera
- **WHEN** una corrida aprobada tiene un span de 50 minutos y `zero.run_ms` de 15 minutos
- **THEN** la función devuelve 15 minutos en milisegundos

### Requirement: El límite de verify no cambia
`verifyTimeoutMs` SHALL usar esa función y MUST devolver los mismos límites que antes: el de la línea (20 minutos por omisión), nunca menos que el doble de la corrida más lenta y nunca más de 4 horas solo por historial.

#### Scenario: Mismos límites
- **WHEN** se corren los tests existentes de `verifyTimeoutMs` en `test/pace.test.ts`, sin modificarlos
- **THEN** pasan todos, incluidos el doble de la más lenta (38 minutos para 19), el límite propio de la línea y el tope de 4 horas

### Requirement: Duración de cada comando en el prompt de build
El prompt de la estación build SHALL indicar, junto a cada comando de verify de la línea con duración conocida, esa duración en minutos, redondeada hacia arriba.

#### Scenario: Comando con historial
- **WHEN** la línea tiene corridas aprobadas de un comando de verify y la más lenta tardó 3 minutos
- **THEN** el prompt de build contiene ese comando acompañado de su duración de 3 minutos

#### Scenario: Unos con historial y otros sin
- **WHEN** la línea tiene dos comandos de verify y solo uno tiene corridas aprobadas
- **THEN** el prompt nombra los dos, con duración solo en el que tiene historial

### Requirement: Sin historial el prompt queda igual
Cuando ningún comando de verify de la línea tiene duración conocida, la línea del prompt de build sobre los comandos de verificación MUST quedar exactamente como hoy.

#### Scenario: Línea sin corridas aprobadas
- **WHEN** un trabajo corre en una línea sin corridas aprobadas de sus comandos de verify
- **THEN** el prompt de build contiene `Implement the specification. Verification commands that must pass: <comandos separados por coma>.` sin duraciones ni avisos

#### Scenario: Línea sin comandos de verify
- **WHEN** la línea no tiene comandos de verify
- **THEN** el prompt de build contiene `Verification commands that must pass: none configured.`

### Requirement: Comandos largos no se corren enteros en build
Cuando la duración conocida de un comando de verify supera un tercio de `stations.build.timeoutMinutes`, el prompt de build SHALL decir que no se corra entero, que se usen solo los tests de los archivos tocados y que zero corre el comando completo en verify.

#### Scenario: Comando largo
- **WHEN** `stations.build.timeoutMinutes` es 45 y la corrida aprobada más lenta del comando tardó 20 minutos
- **THEN** el prompt de build dice, para ese comando, que no se corra entero, que se corran solo los tests de los archivos que se tocan y que zero lo corre completo en verify

#### Scenario: Comando corto
- **WHEN** `stations.build.timeoutMinutes` es 45 y la corrida aprobada más lenta del comando tardó 3 minutos
- **THEN** el prompt de build indica la duración y no contiene el aviso de no correrlo entero

#### Scenario: Justo un tercio
- **WHEN** `stations.build.timeoutMinutes` es 45 y la corrida aprobada más lenta tardó exactamente 15 minutos
- **THEN** el prompt de build no contiene el aviso de no correrlo entero

#### Scenario: El tiempo configurado decide
- **WHEN** `stations.build.timeoutMinutes` es 120 y la corrida aprobada más lenta tardó 20 minutos
- **THEN** el prompt de build no contiene el aviso de no correrlo entero

### Requirement: Instrucciones de build acordes
`agents/build.md` SHALL decir que se corran los comandos de verificación salvo los que el prompt indique no correr enteros, y que para esos se usen solo los tests de los archivos tocados, porque zero corre todo en verify.

#### Scenario: Excepción escrita
- **WHEN** se leen las instrucciones de la estación build
- **THEN** contienen la excepción para los comandos que el prompt indica no correr enteros y mantienen la prohibición de borrar, saltear o debilitar tests

### Requirement: Verify corre todos los comandos
La estación verify MUST seguir corriendo todos los comandos de verify de la línea, también los que build recibió el aviso de no correr enteros.

#### Scenario: Comando largo en verify
- **WHEN** un trabajo corre en una línea cuyo comando de verify tiene un historial que supera un tercio del tiempo de build
- **THEN** el trabajo tiene un span `zero.verify.command` de ese comando y su resultado decide si el intento pasa

### Requirement: El motor Claude marca el corte por tiempo
El motor Claude SHALL devolver `ok: false` con `timedOut: true` cuando corta la llamada por su límite de tiempo, y MUST NOT ponerlo en una cancelación ni en otro error.

#### Scenario: Límite de tiempo
- **WHEN** el SDK no termina antes de `timeoutMs` y el motor aborta la llamada
- **THEN** el resultado tiene `ok: false`, `timedOut: true` y un texto que dice que se agotó el tiempo

#### Scenario: Cancelación
- **WHEN** se aborta `req.signal` antes del límite de tiempo
- **THEN** el resultado tiene el texto `cancelled` y no tiene `timedOut`

#### Scenario: Otro error
- **WHEN** el SDK lanza un error antes del límite de tiempo
- **THEN** el resultado tiene `ok: false` y no tiene `timedOut`

### Requirement: Los motores CLI marcan el corte por tiempo
Los motores CLI SHALL devolver `ok: false` con `timedOut: true` cuando cortan el proceso por su límite de tiempo, y MUST NOT ponerlo en una cancelación ni en una salida con error.

#### Scenario: Límite de tiempo
- **WHEN** un motor CLI llega a `timeoutMs` sin terminar
- **THEN** el resultado es `ok: false` con el texto actual `<motor> timed out after <n> min` y `timedOut: true`

#### Scenario: Cancelación o salida con error
- **WHEN** la llamada se cancela, o el proceso sale con un código distinto de 0
- **THEN** el resultado no tiene `timedOut`

### Requirement: El motor ACP marca el corte por tiempo
El motor ACP SHALL devolver `ok: false` con `timedOut: true` cuando termina la conversación por su límite de tiempo, y MUST NOT ponerlo en una cancelación, una salida del agente ni un rechazo.

#### Scenario: Límite de tiempo
- **WHEN** el agente ACP no responde antes de `timeoutMs`
- **THEN** el resultado tiene `ok: false`, `timedOut: true` y un texto con `timed out after`, y el agente queda terminado

#### Scenario: Cancelación o salida del agente
- **WHEN** la llamada se cancela, o el agente sale antes de responder
- **THEN** el resultado no tiene `timedOut`

### Requirement: La corrida del agente lleva la marca
El ejecutor de agentes (`createAgentRunner`) SHALL pasar `timedOut: true` del resultado del motor a `AgentRun`, y MUST omitir el campo cuando el motor no lo puso.

#### Scenario: Motor cortado por tiempo
- **WHEN** el motor devuelve `ok: false` con `timedOut: true`
- **THEN** el `AgentRun` tiene `ok: false` y `timedOut: true`

#### Scenario: Otro fallo
- **WHEN** el motor devuelve `ok: false` sin `timedOut`
- **THEN** el `AgentRun` no tiene la propiedad `timedOut`

### Requirement: Feedback de un build cortado por tiempo
Cuando la corrida de build termina con `timedOut`, el feedback del intento SHALL decir que se llegó al límite de N minutos (`stations.build.timeoutMinutes`), que lo hecho sigue sin commitear en la copia de trabajo y que hay que continuar desde ahí, en lugar del texto de terminación anormal.

#### Scenario: Corte por tiempo
- **WHEN** el primer build de un trabajo escribe un archivo y devuelve `ok: false` con `timedOut: true`, con `stations.build.timeoutMinutes` en 45
- **THEN** el prompt del segundo build nombra el límite de 45 minutos, dice que lo hecho sigue sin commitear y que se continúe desde ahí, no contiene `terminó de forma anormal` ni `Hacé cambios más chicos y enfocados`, y el archivo sigue en la copia de trabajo

#### Scenario: Otro error
- **WHEN** el primer build devuelve `ok: false` sin `timedOut`
- **THEN** el prompt del segundo build contiene `terminó de forma anormal` como hoy y no nombra el límite de minutos

#### Scenario: Corte durante una mezcla con conflictos
- **WHEN** el build que resuelve los conflictos de mezclar la base devuelve `timedOut: true`
- **THEN** el feedback nombra el límite de minutos e incluye la lista de archivos en conflicto como hoy, y no dice que lo hecho sigue en la copia, porque zero vuelve a empezar la mezcla

### Requirement: El corte por tiempo cuenta como intento
Un build cortado por tiempo MUST contar como un intento, igual que hoy.

#### Scenario: Todos los intentos cortados
- **WHEN** una línea con `maxAttempts` 2 recibe `timedOut: true` en los dos builds
- **THEN** el trabajo termina `failed` después de 2 llamadas a build, con `Se agotaron los 2 intentos` y el límite de tiempo en el motivo

#### Scenario: Reintento que termina
- **WHEN** el primer build se corta por tiempo y el segundo termina bien
- **THEN** el trabajo termina entregado con `attempt` 2

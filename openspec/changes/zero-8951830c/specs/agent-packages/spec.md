# Spec Delta

## Purpose

Una estación de paquete va a poder declarar en su manifiesto horarios locales, por ejemplo `schedule: ["08:00", "12:00", "18:00"]`. En cada horario el daemon llama a `scheduled(ctx, { at })` de la estación, aunque la fábrica tenga trabajos en curso. Esas pasadas no pueden llamar a un modelo: `ctx.runAgent` tira un error claro, así no gastan ni compiten con la línea. Sí tienen secretos, estado, registro y líneas. Cada horario corre como máximo una vez por día. Si el daemon estaba apagado o el andón estaba activado a esa hora, corre después solo si no pasaron más de 2 horas. Con el andón activado no arranca ninguna pasada. `pass` sigue igual, en los momentos libres. Queda documentado en los dos README y en AGENTS.md, con pruebas que usan estaciones falsas.

## ADDED Requirements

### Requirement: Horarios validados en el manifiesto
ManifestSchema MUST aceptar en una estación un `schedule` opcional, una lista de horas locales `HH:MM` entre 00:00 y 23:59 sin repetidas, y MUST rechazar cualquier otro valor; el paquete rechazado queda afuera entero con un problema que nombra `schedule`.

#### Scenario: Horarios válidos
- **WHEN** una estación declara `schedule: ["08:00", "12:00", "18:00"]`
- **THEN** el paquete carga sin problemas y `loadedPackages.stations[0].schedule` tiene esos tres valores

#### Scenario: Sin horarios
- **WHEN** una estación no declara `schedule`
- **THEN** el paquete carga y su `schedule` es una lista vacía

#### Scenario: Horarios inválidos
- **WHEN** una estación declara `schedule` con `["24:00"]`, `["8:00"]`, `["08:60"]`, `[800]`, `"08:00"` o `["08:00", "08:00"]`
- **THEN** `loadedPackages.stations` queda vacío y `problems[0].reason` contiene `schedule`

### Requirement: Pasada con horario
Cuando llega un horario de `schedule`, el daemon MUST llamar a la función exportada `scheduled(ctx, { at })` de la estación, con `at` igual al texto del horario en el manifiesto, y MUST NOT llamar a `pass` en esa pasada.

#### Scenario: Llega el horario
- **WHEN** una estación con `schedule: ["08:00"]` exporta `scheduled` y `pass`, y `scheduledPass` corre a las 08:00 locales
- **THEN** `scheduled` recibe `{ at: "08:00" }` y `pass` no se llama

#### Scenario: Antes del horario
- **WHEN** `scheduledPass` corre a las 07:59 locales
- **THEN** `scheduled` no se llama

#### Scenario: Estación sin horarios
- **WHEN** una estación sin `schedule` exporta `scheduled` y `scheduledPass` corre
- **THEN** `scheduled` no se llama

#### Scenario: Falta la función
- **WHEN** una estación con horario vigente no exporta `scheduled`
- **THEN** no se lanza ningún error, el registro avisa una sola vez que el módulo no exporta `scheduled` y la estación siguiente corre igual

### Requirement: Corre con la fábrica ocupada
Las pasadas con horario MUST correr aunque haya trabajos en cola o en curso o se haya alcanzado el presupuesto, y el bucle del daemon MUST NOT esperarlas para arrancar trabajos.

#### Scenario: Trabajo en curso
- **WHEN** el daemon tiene un trabajo corriendo cuyo agente falso espera a que aparezca lo que escribe `scheduled`
- **THEN** `scheduled` corre, el agente deja de esperar y el trabajo termina

#### Scenario: Presupuesto alcanzado
- **WHEN** se alcanzó el presupuesto y llega un horario
- **THEN** `scheduled` corre igual

### Requirement: Sin modelo
En una pasada con horario, `ctx.runAgent` MUST lanzar de forma síncrona un error que nombre `scheduled` y MUST NOT llamar a ningún motor.

#### Scenario: La estación intenta llamar a un agente
- **WHEN** `scheduled` llama a `ctx.runAgent({ prompt })` dentro de un try/catch
- **THEN** el error capturado nombra `scheduled`, el ejecutor de agentes no recibe llamadas y no se registra ningún span de agente

#### Scenario: El error no se captura
- **WHEN** `scheduled` llama a `ctx.runAgent` sin capturar el error
- **THEN** el fallo queda en el registro, el daemon sigue en pie y la estación siguiente corre

### Requirement: Contexto disponible
Una pasada con horario MUST recibir `ctx.secrets`, `ctx.state`, `ctx.log` y `ctx.lines` con el mismo comportamiento que en `pass`, y `ctx.state` MUST compartir los valores guardados de la estación con `pass`.

#### Scenario: Lee y guarda
- **WHEN** `scheduled` lee un secreto declarado, escribe `ctx.state.set("x", 1)`, usa `ctx.log.info` y lee `ctx.lines`
- **THEN** recibe el valor del secreto y los nombres de las líneas, y una `pass` posterior lee `ctx.state.get("x") === 1`

#### Scenario: Secreto no declarado
- **WHEN** `scheduled` pide un secreto que su manifiesto no declara
- **THEN** `ctx.secrets.get` devuelve undefined

#### Scenario: Faltan secretos declarados
- **WHEN** llega un horario y falta un secreto declarado por la estación
- **THEN** `scheduled` no se llama, el horario no queda marcado y corre si el secreto aparece dentro de las 2 horas

### Requirement: Una vez por día
Cada horario de cada estación MUST correr a lo sumo una vez por día local, registrado en el kv en una clave que `ctx.state` no alcanza; el registro MUST hacerse antes de ejecutar `scheduled`, de modo que una pasada que falla o se pasa de tiempo no se repita ese día.

#### Scenario: Dos vueltas seguidas
- **WHEN** `scheduledPass` corre a las 08:00 y otra vez a las 08:01
- **THEN** `scheduled` se llama una sola vez

#### Scenario: Día siguiente
- **WHEN** `scheduledPass` corre a las 08:00 de un día y a las 08:00 del siguiente
- **THEN** `scheduled` se llama una vez cada día

#### Scenario: Falla
- **WHEN** `scheduled` lanza un error a las 08:00 y `scheduledPass` vuelve a correr a las 08:01
- **THEN** no se reintenta

#### Scenario: Se pasa de tiempo
- **WHEN** `scheduled` no termina dentro de `timeoutMinutes`
- **THEN** se aborta `ctx.signal`, el registro lo avisa, la estación siguiente corre y ese horario no se repite ese día

#### Scenario: Horarios independientes
- **WHEN** una estación con `["08:00", "12:00"]` pasa por las 08:00 y por las 12:00
- **THEN** `scheduled` se llama una vez con cada `at`

### Requirement: Recuperación de hasta 2 horas
Un horario sin correr MUST correr cuando el daemon pueda hacerlo solo si no pasaron más de 2 horas desde ese horario, incluido el que quedó en el día anterior, y MUST quedar sin correr ese día si pasaron más.

#### Scenario: Exactamente 2 horas
- **WHEN** el horario es 08:00 y el daemon arranca a las 10:00
- **THEN** `scheduled` se llama con `at: "08:00"`

#### Scenario: Más de 2 horas
- **WHEN** el horario es 08:00 y el daemon arranca a las 10:01
- **THEN** `scheduled` no se llama

#### Scenario: Cruza la medianoche
- **WHEN** el horario es 23:30 y el daemon arranca a las 00:30 del día siguiente
- **THEN** `scheduled` se llama con `at: "23:30"` y una vuelta posterior no la repite

#### Scenario: Varios atrasados
- **WHEN** una estación con `["08:00", "09:00"]` arranca a las 09:30 sin haber corrido
- **THEN** `scheduled` se llama una vez con `08:00` y luego una vez con `09:00`

### Requirement: Respeta el andón
Con el andón activado MUST NOT arrancar ninguna pasada con horario, y el horario MUST quedar sin marcar para que pueda correr si el andón se apaga dentro de las 2 horas.

#### Scenario: Andón activado
- **WHEN** el andón está activado a las 08:00
- **THEN** `scheduled` no se llama y el horario no queda marcado

#### Scenario: Se apaga a tiempo
- **WHEN** el andón estaba activado a las 08:00 y se apaga antes de una pasada a las 09:00
- **THEN** `scheduled` se llama con `at: "08:00"`

### Requirement: pass sin cambios
`packagesPass` MUST seguir corriendo `pass` solo en las pasadas libres y con su propio `everyMinutes`, sin que las pasadas con horario lo alteren, y una estación con horarios que no exporta `pass` MUST NOT generar el aviso de `pass` faltante.

#### Scenario: Períodos independientes
- **WHEN** `scheduled` corre a las 08:00 y luego `packagesPass` corre con la fábrica libre
- **THEN** `pass` corre porque la clave `:last` no cambió, y `scheduled` no se llama desde `packagesPass`

#### Scenario: Fábrica ocupada
- **WHEN** hay un trabajo en cola y corre `packagesPass`
- **THEN** `pass` no se llama

#### Scenario: Estación solo con horarios
- **WHEN** una estación con `schedule` exporta solo `scheduled` y corre `packagesPass`
- **THEN** no se registra aviso de `pass` faltante y no se lanza ningún error

#### Scenario: Estación sin horarios ni pass
- **WHEN** una estación sin `schedule` no exporta `pass` y corre `packagesPass`
- **THEN** el registro sigue avisando que falta `pass`

### Requirement: Documentación
README.md y README.es.md MUST documentar `schedule` y `scheduled(ctx, { at })` en la misma sección de paquetes, con el mismo bloque de código, y AGENTS.md MUST describir `scheduledPass`.

#### Scenario: Los dos idiomas
- **WHEN** corre `test/docs.test.ts`
- **THEN** la sección de paquetes de cada README contiene `schedule:` y `export async function scheduled`

#### Scenario: El ejemplo funciona
- **WHEN** se copia el ejemplo del README con su `schedule` y corre `scheduledPass` en un horario del ejemplo
- **THEN** el paquete carga sin problemas y `scheduled` se ejecuta sin error

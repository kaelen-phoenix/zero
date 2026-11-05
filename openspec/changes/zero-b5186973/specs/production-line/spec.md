# Spec Delta

## ADDED Requirements

### Requirement: Salida vacía con código 0 en motores que responden por stdout
Cuando un motor CLI que responde por stdout (antigravity o un motor personalizado) termina con código 0 y `finalText(stdout)` queda vacío después de trim, su `run` MUST devolver `ok: false` con el texto `<motor> devolvió salida vacía`, donde `<motor>` es el nombre del motor.

#### Scenario: Antigravity sin salida
- **WHEN** un proceso falso que reemplaza a `agy` sale con código 0 sin escribir nada
- **THEN** `antigravityEngine.run` devuelve `{ ok: false, text: 'antigravity devolvió salida vacía' }`

#### Scenario: Motor personalizado sin salida
- **WHEN** un `customEngine` llamado `mudo` ejecuta un proceso que sale con código 0 sin escribir nada
- **THEN** `run` devuelve `{ ok: false, text: 'mudo devolvió salida vacía' }`

#### Scenario: Solo espacios en stdout
- **WHEN** un motor personalizado sale con código 0 y escribe solo espacios y saltos de línea en stdout
- **THEN** `run` devuelve `ok: false` y el texto empieza con `<motor> devolvió salida vacía`

#### Scenario: Envoltura JSON vacía
- **WHEN** un motor sale con código 0 y escribe en stdout `{"result":" "}`
- **THEN** `run` devuelve `ok: false` y el texto empieza con `<motor> devolvió salida vacía`

#### Scenario: Respuesta normal sin cambios
- **WHEN** un motor personalizado sale con código 0 y escribe `{"response":"hola"}` en stdout
- **THEN** `run` devuelve `{ ok: true, text: 'hola' }`

### Requirement: El error incluye el final de stderr
Cuando un motor CLI falla por salida vacía y stderr tiene contenido después de trim, el texto del error MUST ser `<motor> devolvió salida vacía: <final de stderr>`, con como máximo los últimos 2000 caracteres de stderr; sin contenido en stderr, MUST ser solo `<motor> devolvió salida vacía`.

#### Scenario: Con stderr
- **WHEN** un motor personalizado llamado `mudo` sale con código 0, sin stdout, y escribe `sin TTY` en stderr
- **THEN** el texto es exactamente `mudo devolvió salida vacía: sin TTY`

#### Scenario: Stderr largo
- **WHEN** un motor personalizado sale con código 0, sin stdout, y escribe 3000 caracteres en stderr
- **THEN** el texto termina con los últimos 2000 caracteres de stderr y no contiene el comienzo descartado

#### Scenario: Stderr solo con espacios
- **WHEN** un motor personalizado llamado `mudo` sale con código 0, sin stdout, y escribe solo espacios y saltos de línea en stderr
- **THEN** el texto es exactamente `mudo devolvió salida vacía`

### Requirement: Codex evalúa su último mensaje
Cuando codex termina con código 0, `codexEngine.run` MUST decidir según el último mensaje leído de `--output-last-message` (o, si ese archivo no se puede leer, según `finalText(stdout)`): si queda vacío después de trim MUST devolver `ok: false` con el error de salida vacía y el final de stderr, y si tiene texto MUST devolver `ok: true` con ese texto recortado, aunque stdout esté vacío.

#### Scenario: Archivo vacío
- **WHEN** un `codex` falso sale con código 0 dejando vacío el archivo del último mensaje y sin escribir en stdout
- **THEN** `run` devuelve `{ ok: false, text: 'codex devolvió salida vacía' }`

#### Scenario: Archivo vacío con stderr
- **WHEN** un `codex` falso sale con código 0, deja vacío el archivo y escribe `sin sesión` en stderr
- **THEN** el texto es exactamente `codex devolvió salida vacía: sin sesión`

#### Scenario: Archivo vacío aunque stdout tenga texto
- **WHEN** un `codex` falso sale con código 0, deja vacío el archivo y escribe `progreso` en stdout
- **THEN** `run` devuelve `ok: false` y el texto empieza con `codex devolvió salida vacía`

#### Scenario: Respuesta en el archivo con stdout vacío
- **WHEN** un `codex` falso sale con código 0, escribe `listo` en el archivo y no escribe nada en stdout
- **THEN** `run` devuelve `{ ok: true, text: 'listo' }`

#### Scenario: Sin archivo y sin stdout
- **WHEN** un `codex` falso sale con código 0 sin crear el archivo y sin escribir en stdout
- **THEN** `run` devuelve `{ ok: false, text: 'codex devolvió salida vacía' }`

#### Scenario: Sin archivo pero con stdout
- **WHEN** un `codex` falso sale con código 0 sin crear el archivo y escribe `hola` en stdout
- **THEN** `run` devuelve `{ ok: true, text: 'hola' }`

### Requirement: Los demás fallos conservan su mensaje
La regla de salida vacía MUST aplicarse solo cuando el proceso termina con código 0 sin cancelarse ni vencer su tiempo; los mensajes de cancelación, tiempo vencido y código distinto de 0 MUST NOT cambiar.

#### Scenario: Código distinto de 0 sin salida
- **WHEN** un motor personalizado llamado `mudo` sale con código 3 sin escribir nada
- **THEN** el texto es `mudo exited with 3: ` y no menciona salida vacía

#### Scenario: Cancelación
- **WHEN** la señal de un motor personalizado llamado `sleeper` se aborta mientras corre
- **THEN** `run` sigue devolviendo `{ ok: false, text: 'sleeper cancelled' }`

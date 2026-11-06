# Spec Delta

## ADDED Requirements

### Requirement: Antigravity envía por stdin los prompts de más de 30.000 caracteres
Cuando `fullPrompt(req).length` supera 30.000, `antigravityInvocation` MUST poner `fullPrompt(req)` completo en `stdin` y MUST pasar en `-p` exactamente el texto `Follow the instructions received on stdin.`, sin ninguna parte del prompt en sus argumentos.

#### Scenario: Un carácter por encima del umbral
- **WHEN** `antigravityInvocation` recibe un pedido cuyo `fullPrompt` mide exactamente 30.001 caracteres
- **THEN** `stdin` es igual a `fullPrompt(req)`, el argumento siguiente a `-p` es `Follow the instructions received on stdin.` y ningún argumento contiene el texto del prompt ni el de las instrucciones

#### Scenario: El prompt largo llega completo al proceso
- **WHEN** `antigravityEngine.run` ejecuta un proceso falso en lugar de `agy`, con un `fullPrompt` de 40.000 caracteres, y ese proceso lee todo stdin y escribe en stdout cuántos caracteres recibió y su valor de `-p`
- **THEN** `run` devuelve `ok: true`, el proceso recibió por stdin los 40.000 caracteres y el valor de `-p` es `Follow the instructions received on stdin.`

### Requirement: Antigravity no cambia con prompts de hasta 30.000 caracteres
Cuando `fullPrompt(req).length` es menor o igual a 30.000, `antigravityInvocation` MUST pasar `fullPrompt(req)` completo como valor de `-p` y MUST dejar `stdin` sin definir.

#### Scenario: Exactamente en el umbral
- **WHEN** `antigravityInvocation` recibe un pedido cuyo `fullPrompt` mide exactamente 30.000 caracteres
- **THEN** el argumento siguiente a `-p` es igual a `fullPrompt(req)` y `stdin` es `undefined`

#### Scenario: Prompt corto
- **WHEN** `antigravityInvocation` recibe un pedido con `model` `m` y access `write`, y un prompt corto
- **THEN** `args` es exactamente `["-p", fullPrompt(req), "--output-format", "json", "--dangerously-skip-permissions", "--model", "m"]` y `stdin` es `undefined`

### Requirement: El envío por stdin de Antigravity conserva las demás flags
Con un prompt de más de 30.000 caracteres, `antigravityInvocation` MUST generar las mismas flags y en el mismo orden que con un prompt corto, cambiando solo el valor de `-p`, y `antigravityEngine.nativeSchema` MUST seguir siendo `false`.

#### Scenario: Escritura con modelo
- **WHEN** `antigravityInvocation` recibe un prompt de más de 30.000 caracteres, access `write` y `model` `m`
- **THEN** `args` es exactamente `["-p", "Follow the instructions received on stdin.", "--output-format", "json", "--dangerously-skip-permissions", "--model", "m"]`

#### Scenario: Lectura sin modelo
- **WHEN** `antigravityInvocation` recibe un prompt de más de 30.000 caracteres y access `read`, sin `model`
- **THEN** `args` es exactamente `["-p", "Follow the instructions received on stdin.", "--output-format", "json"]`

#### Scenario: Sin esquema nativo
- **WHEN** se consulta `antigravityEngine.nativeSchema`
- **THEN** su valor es `false`

### Requirement: Los motores personalizados conservan su forma de recibir el prompt largo
`customInvocation` MUST seguir sustituyendo `{prompt}` en sus argumentos y MUST dejar `stdin` sin definir cuando su comando incluye `{prompt}`, sea cual sea el largo del prompt.

#### Scenario: Motor personalizado con un prompt largo
- **WHEN** `customInvocation` recibe un motor con `command` `["gemini", "-p", "{prompt}"]` y un `fullPrompt` de más de 30.000 caracteres
- **THEN** `args` contiene `fullPrompt(req)` completo y `stdin` es `undefined`

### Requirement: Un fallo al escribir en stdin no tumba el proceso de zero
Cuando el proceso de un motor CLI termina sin leer stdin o no llega a arrancar, un error de escritura en su stdin MUST NOT convertirse en una excepción no capturada, y `runProcess` MUST seguir resolviendo o rechazando según el cierre o el error de arranque del proceso.

#### Scenario: El proceso responde sin leer stdin
- **WHEN** `antigravityEngine.run` ejecuta un proceso falso que no lee stdin, escribe `{"response":"hola"}` en stdout y sale con código 0, con un prompt de 5.000.000 de caracteres
- **THEN** `run` devuelve `{ ok: true, text: 'hola' }` y la corrida de pruebas no registra ninguna excepción no capturada

#### Scenario: El proceso falla sin leer stdin
- **WHEN** `antigravityEngine.run` ejecuta un proceso falso que no lee stdin, escribe `roto` en stderr y sale con código 3, con un prompt de 5.000.000 de caracteres
- **THEN** `run` devuelve `{ ok: false, text: 'antigravity exited with 3: roto' }`

#### Scenario: El binario no existe
- **WHEN** `runProcess` recibe un `bin` inexistente y un `stdin` de 5.000.000 de caracteres
- **THEN** la promesa se rechaza con un error que contiene `cannot start` y la corrida de pruebas no registra ninguna excepción no capturada

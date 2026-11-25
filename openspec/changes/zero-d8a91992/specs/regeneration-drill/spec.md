# Spec Delta

## Purpose

El simulacro de regeneración va a darles a los comandos de verify el mismo tiempo que les da un trabajo: lo que diga `verifyTimeoutMinutes` de la línea, o más si las corridas aprobadas recientes tardaron más. El setup conserva sus 20 minutos. Si lo único que falla es que algún comando de verify se quedó sin tiempo, el resultado va a ser «sin medir» en lugar de «no alcanzan». Así un corte deja de leerse como un problema de las especificaciones. Un test que falla de verdad sigue dando «no alcanzan», y tocar tests o especificaciones sigue dando «inválido». El informe va a decir a los cuántos minutos se cortó cada comando y, en los de verify, que ese límite se cambia con `verifyTimeoutMinutes`. La terminal también va a explicar el resultado nuevo, y la documentación queda al día.

## ADDED Requirements

### Requirement: Límite aprendido para los comandos de verify del simulacro
El simulacro MUST correr cada comando de verify de la línea con el límite que da `verifyTimeoutMs` para esa línea y ese comando, con el store y el reloj de la fábrica (`deps.now`, o la hora actual si no hay). Reemplaza el límite fijo de 20 minutos para verify.

#### Scenario: Límite aprendido de las corridas aprobadas
- **WHEN** el store tiene un span `zero.verify.command` aprobado y reciente, de un trabajo de esa línea y con ese mismo comando, con `zero.run_ms` de 1.668.000, y se corre el simulacro con un `sh` inyectado
- **THEN** el `sh` inyectado recibe para ese comando de verify `timeoutMs` igual a 3.336.000

#### Scenario: Límite propio de la línea
- **WHEN** la línea declara `verifyTimeoutMinutes: 45`, no hay historial y se corre el simulacro con un `sh` inyectado
- **THEN** el `sh` inyectado recibe `timeoutMs` igual a 2.700.000 para cada comando de verify

#### Scenario: Sin historial ni límite propio
- **WHEN** la línea no declara `verifyTimeoutMinutes` y no hay historial
- **THEN** el `sh` inyectado recibe `timeoutMs` igual a 1.200.000 para cada comando de verify

### Requirement: El setup del simulacro conserva 20 minutos
El simulacro MUST correr cada comando de setup con un límite de 20 minutos, aunque la línea declare `verifyTimeoutMinutes`.

#### Scenario: Setup con verifyTimeoutMinutes declarado
- **WHEN** la línea declara un comando de setup y `verifyTimeoutMinutes: 45`, y se corre el simulacro con un `sh` inyectado
- **THEN** el `sh` inyectado recibe `timeoutMs` igual a 1.200.000 para el comando de setup y 2.700.000 para el de verify

### Requirement: Cada comando del simulacro guarda su límite
Cada comando de setup y de verify del resultado MUST guardar en `timeoutMs` el límite en milisegundos con el que corrió, también en `resultado.json`.

#### Scenario: Límite en el resultado y en su JSON
- **WHEN** se corre el simulacro de una línea con un comando de setup, uno de verify y `verifyTimeoutMinutes: 45`
- **THEN** el resultado devuelto y `resultado.json` tienen `timeoutMs` 1.200.000 en el comando de setup y 2.700.000 en el de verify

### Requirement: El informe dice el límite real de un corte
Cuando un comando se cortó por tiempo, `informe.md` MUST decir «cortado a los N minutos» con los minutos reales de ese comando (hasta dos decimales, nunca 0). Solo en los comandos de verify MUST decir además que ese límite se cambia con `verifyTimeoutMinutes` de la línea.

#### Scenario: Verify cortado
- **WHEN** la línea declara `verifyTimeoutMinutes: 45` y el `sh` inyectado devuelve para su comando de verify `code` 1 y `timedOut` true
- **THEN** `informe.md` contiene «cortado a los 45 minutos» y `verifyTimeoutMinutes`, y no contiene «cortado a los 20 minutos»

#### Scenario: Límite con fracción de minuto
- **WHEN** la línea declara `verifyTimeoutMinutes: 0.05` y su comando de verify se corta por tiempo
- **THEN** `informe.md` no contiene «cortado a los 0 minutos» y muestra 0,05 minutos como límite

#### Scenario: Setup cortado
- **WHEN** el `sh` inyectado devuelve para un comando de setup `code` 1 y `timedOut` true
- **THEN** `informe.md` contiene «cortado a los 20 minutos», no contiene `verifyTimeoutMinutes` y el resultado es `no alcanzan`

#### Scenario: Comando sin corte
- **WHEN** un comando de verify termina con código 3 sin corte por tiempo
- **THEN** `informe.md` contiene «Código de salida: 3» y no contiene «cortado a los»

### Requirement: Resultado sin medir
El resultado del simulacro MUST ser `sin medir` cuando ningún test ni especificación fue tocado, el setup pasó, el agente terminó bien y sin llegar a su tope, se reconstruyeron todos los archivos, falló al menos un comando de verify y todos los que fallaron (código distinto de 0) se cortaron por tiempo.

#### Scenario: El único fallo es un corte
- **WHEN** el agente falso reconstruye el archivo, un comando de verify termina con 0 y otro devuelve `code` 1 con `timedOut` true
- **THEN** el resultado es `sin medir` y `resultado.json` tiene `outcome` igual a `sin medir`

#### Scenario: Corte real de un comando
- **WHEN** la línea declara un comando de verify que no termina nunca y `verifyTimeoutMinutes` de pocos segundos, sin `sh` inyectado
- **THEN** el simulacro termina, el resultado es `sin medir` y el comando tiene `timedOut` true

#### Scenario: Texto del resultado en el informe
- **WHEN** el resultado es `sin medir`
- **THEN** la línea «Resultado» de `informe.md` contiene `**sin medir**` y una explicación en español de que verify se cortó por tiempo y de que eso no dice nada de las especificaciones

### Requirement: Un corte no tapa una falla
El simulacro MUST seguir dando `no alcanzan` cuando algún comando de verify termina con código distinto de 0 sin corte por tiempo, cuando falla el setup, cuando el agente no termina bien o llega a su tope, o cuando queda algún archivo sin reconstruir, aunque además algún comando de verify se haya cortado por tiempo.

#### Scenario: Falla real junto a un corte
- **WHEN** el archivo se reconstruye, un comando de verify se corta por tiempo y otro termina con código 3 sin corte
- **THEN** el resultado es `no alcanzan`

#### Scenario: Falla real sola
- **WHEN** el archivo se reconstruye y el único comando de verify termina con código 3 sin corte
- **THEN** el resultado es `no alcanzan`

#### Scenario: Archivo sin reconstruir con un corte
- **WHEN** el agente falso no escribe el archivo quitado y el comando de verify se corta por tiempo
- **THEN** el resultado es `no alcanzan`

#### Scenario: Agente que no termina bien con un corte
- **WHEN** el agente falso reconstruye el archivo pero devuelve `ok: false` o `budgetLimited: true`, y el comando de verify se corta por tiempo
- **THEN** el resultado es `no alcanzan`

### Requirement: Inválido tiene prioridad sobre sin medir
El resultado MUST ser `inválido` cuando se tocó un test o una especificación, aunque los únicos comandos de verify que fallaron se hayan cortado por tiempo.

#### Scenario: Test tocado y verify cortado
- **WHEN** el agente falso reconstruye el archivo y modifica un test, y el comando de verify se corta por tiempo
- **THEN** el resultado es `inválido` y `tampered` nombra el test

### Requirement: La terminal explica sin medir
`zero simulacro` MUST mostrar «Resultado: sin medir» con una explicación en español que nombra el corte por tiempo y `verifyTimeoutMinutes`, junto a la ruta del informe. Para los demás resultados MUST mostrar las mismas dos líneas que hoy.

#### Scenario: Salida de sin medir
- **WHEN** se arma el texto de la terminal de un simulacro con resultado `sin medir`
- **THEN** contiene «Resultado: sin medir», `verifyTimeoutMinutes` e «Informe: » con la ruta

#### Scenario: Salida de los demás resultados
- **WHEN** se arma el texto de la terminal de un simulacro con resultado `alcanzan`, `no alcanzan` o `inválido`
- **THEN** es exactamente «Resultado: <resultado>» y, en la línea siguiente, «Informe: <ruta>»

### Requirement: Documentación del límite y del resultado
`docs/agents/production-line.md` y la sección del simulacro de los dos README MUST describir el resultado `sin medir` y que el límite de cada comando de verify es el mismo que en un trabajo, y MUST NOT decir que verify tiene 20 minutos fijos en el simulacro.

#### Scenario: Documentos al día
- **WHEN** se leen `docs/agents/production-line.md`, `README.md` y `README.es.md`
- **THEN** los tres contienen `sin medir`; `README.md` ya no contiene «up to 20 minutes each», `README.es.md` ya no contiene «hasta 20 minutos cada uno» y `docs/agents/production-line.md` ya no contiene «runs `verify` (20 minutes each)»

# Spec Delta

## ADDED Requirements

### Requirement: Tiempo límite de la verificación según la línea
Cada comando de verify de una línea SHALL tener como tiempo límite los minutos de `verifyTimeoutMinutes` de esa línea, o 20 si no los declara, y MUST NOT ser menor que el doble de lo que tardó la más lenta de las últimas 5 corridas aprobadas de ese mismo comando en esa línea en los últimos 30 días. Por historial solo, el límite MUST NOT pasar de 4 horas. El tiempo que un comando espera su turno MUST NOT contar.

#### Scenario: Sin historial
- **WHEN** una línea sin `verifyTimeoutMinutes` corre un comando de verify por primera vez
- **THEN** el límite es de 20 minutos

#### Scenario: La suite tarda más que el límite por defecto
- **WHEN** las últimas corridas aprobadas de `npm test` en la línea tardaron 15, 19 y 12 minutos
- **THEN** el límite de `npm test` en esa línea es de 38 minutos

#### Scenario: Límite propio mayor
- **WHEN** la línea declara `verifyTimeoutMinutes: 60` y su corrida aprobada más lenta tardó 19 minutos
- **THEN** el límite es de 60 minutos

#### Scenario: Se supera el límite
- **WHEN** un comando de verify supera su límite
- **THEN** el intento falla y el motivo dice de cuántos minutos era el límite y que se cambia con `verifyTimeoutMinutes` en la línea

### Requirement: Una falla de la máquina se corre una vez más
Cuando un comando de verify falla y su salida muestra un problema de la máquina y no del cambio (un test que superó su propio tiempo, falta de memoria, un archivo trabado, un proceso que murió, un corte de red), la fábrica SHALL correrlo una vez más antes de dar el intento por fallado. MUST NOT correrlo más de dos veces por intento.

#### Scenario: Test que supera su tiempo con la máquina ocupada
- **WHEN** `npm test` falla con `Test timed out in 5000ms` y en la segunda corrida pasa
- **THEN** la verificación sigue y el intento no se gasta

#### Scenario: Falla del cambio
- **WHEN** `npm test` falla con una aserción
- **THEN** el intento falla sin correr el comando otra vez

### Requirement: Los comandos de los trabajos se turnan en la máquina
Fuera de la caja, los comandos de setup y de verify de todos los trabajos SHALL correr de a `commandConcurrency` a la vez (1 por defecto), en orden de llegada. Un comando cuyo trabajo se detiene mientras espera MUST NOT llegar a correr.

#### Scenario: Dos trabajos verifican a la vez
- **WHEN** dos trabajos de líneas distintas llegan a verify al mismo tiempo con `commandConcurrency: 1`
- **THEN** el comando del segundo empieza cuando termina el del primero, y su tiempo límite cuenta desde que empieza

### Requirement: Un setup que falla se prueba una vez más
Cuando la primera preparación de la copia de trabajo falla, la fábrica SHALL borrar esa copia y prepararla una vez más desde cero antes de fallar el trabajo.

#### Scenario: Falla pasajera
- **WHEN** `npm ci` termina con código 134 la primera vez y bien la segunda
- **THEN** el trabajo sigue su camino y el span de cada intento de setup queda registrado

#### Scenario: Falla dos veces
- **WHEN** el setup falla también la segunda vez
- **THEN** el trabajo falla con el motivo del setup

### Requirement: Nada queda corriendo de un comando cortado
Cuando un comando de la línea o un motor por CLI se corta por tiempo, por una parada o por el apagado, la fábrica SHALL terminar también todo lo que ese comando había arrancado. Si una copia de trabajo no se puede borrar, la fábrica SHALL terminar los procesos cuya línea de comandos, ejecutable o carpeta de trabajo está dentro de esa copia y volver a intentar; MUST NOT tocar su propio proceso ni los que lo arrancaron.

#### Scenario: Tests cortados por tiempo en Windows
- **WHEN** `npm test` supera su límite
- **THEN** terminan la shell, npm, el corredor de tests y sus procesos hijos

#### Scenario: Un servidor que dejó un agente
- **WHEN** un trabajo termina y un `next dev` arrancado desde su copia sigue vivo, y la copia no se puede borrar
- **THEN** la fábrica termina ese proceso y borra la copia

### Requirement: Checks fallidos contra una base vieja
En una línea con `autoMerge`, cuando los checks de un pull request de la fábrica fallaron y su rama quedó atrás de la base, la fábrica SHALL fundir la base en la rama desde GitHub, sin rebase ni force-push, y esperar los checks nuevos antes de darlo por trabado. SHALL hacerlo con un pull request por repositorio a la vez y MUST NOT hacerlo más de 3 veces por pull request.

#### Scenario: El arreglo llegó a la base después
- **WHEN** los checks de un pull request fallaron y la base tiene commits que la rama no tiene
- **THEN** la fábrica actualiza la rama, el pull request queda esperando sus checks y no recibe el aviso de trabado

#### Scenario: Varios pull requests del mismo repositorio
- **WHEN** dos pull requests del mismo repositorio tienen checks fallidos y están atrás de la base
- **THEN** la fábrica actualiza uno, y el otro espera su turno hasta que terminan los checks del primero

#### Scenario: Sigue fallando
- **WHEN** un pull request ya fue actualizado 3 veces y sus checks vuelven a fallar
- **THEN** la fábrica lo avisa una vez en el pull request y lo deja abierto

### Requirement: Checks fallidos una vez sobre la base actual
Cuando los checks de un pull request de la fábrica fallaron y su rama está al día con la base, la fábrica SHALL volver a correr las corridas fallidas de GitHub Actions una vez por commit antes de darlo por trabado. Si GitHub rechaza la actualización o la nueva corrida, el pull request SHALL quedar como hasta ahora: abierto y avisado.

#### Scenario: Corrida cancelada
- **WHEN** un check de GitHub Actions quedó cancelado y la rama está al día
- **THEN** la fábrica vuelve a correr esa corrida y funde el pull request si esta vez pasa

#### Scenario: Falla dos veces
- **WHEN** la corrida vuelve a fallar sobre el mismo commit
- **THEN** la fábrica no la corre otra vez, lo avisa en el pull request y lo deja abierto

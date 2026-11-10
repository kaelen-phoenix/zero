# Spec Delta

## ADDED Requirements

### Requirement: Caída del entorno por el mismo check fallido en varios pull requests
La pasada de fusión MUST marcar un repositorio como «entorno caído» cuando el mismo check (por nombre) terminó fallado en las cabezas de al menos dos pull requests vigilados distintos de ese repositorio, con horas de finalización a 2 horas o menos entre sí. Las fallas observadas se recuerdan entre pasadas durante 24 horas.

#### Scenario: Dos pull requests fallan el mismo check
- **WHEN** los pull requests #10 y #11 de kaelen/demo tienen `e2e` fallado, con horas de finalización separadas por 30 minutos, y la pasada los mira en pasadas distintas
- **THEN** queda guardado un registro de caída para kaelen/demo con los checks ["e2e"] y `since` igual a la falla más temprana

#### Scenario: Fallas lejanas en el tiempo
- **WHEN** `e2e` falla en #10 y en #11 con horas de finalización separadas por 3 horas
- **THEN** no se registra ninguna caída y cada pull request sigue el camino de siempre (actualización o re-corrida)

#### Scenario: Un solo pull request
- **WHEN** solo #10 tiene `e2e` fallado
- **THEN** no se registra ninguna caída

### Requirement: Caída del entorno por falla en la rama base
Antes de actualizar con la base o re-correr los checks fallidos de un pull request, la pasada de fusión MUST leer los checks de la punta de su rama base. Si uno de esos checks fallidos también terminó fallado ahí, MUST marcar el repositorio como «entorno caído» en lugar de gastar nada.

#### Scenario: La base también falla
- **WHEN** #10 tiene `db-tests` fallado con una corrida re-ejecutable y los checks de la rama `main` muestran `db-tests` fallado
- **THEN** no se llama a `rerun` ni a `updateBranch` y queda registrada una caída para el repositorio con los checks ["db-tests"]

#### Scenario: La base está bien
- **WHEN** #10 tiene `e2e` fallado y en `main` `e2e` pasó
- **THEN** la fábrica re-corre la corrida fallida de #10 como antes

### Requirement: Nada se gasta durante la caída
Mientras un repositorio tenga una caída del entorno activa, la fábrica MUST NOT actualizar con la base ni re-correr los checks de un pull request de ese repositorio con algún check fallido de la caída. Tampoco MUST comentar en él. Lo MUST dejar `blocked` con el motivo de la caída y marcado como afectado, y MUST NOT tocar `refreshes` ni `rerun`.

#### Scenario: Un tercer pull request falla durante la caída
- **WHEN** hay una caída activa por `e2e` en kaelen/demo y #12, al día con su base, falla `e2e` con una corrida re-ejecutable
- **THEN** no se llama a `rerun` ni a `updateBranch` ni a `comment` para #12, su estado queda `blocked`, `rerun` y `refreshes` no se modifican y queda marcado como afectado por la caída

#### Scenario: Los pull requests que detectaron la caída
- **WHEN** se registra la caída a partir de #10 y #11
- **THEN** los dos quedan marcados como afectados y ninguno recibe un comentario de «fallaron los checks»

### Requirement: Recuperación por una corrida que pasa
La pasada de fusión MUST dar por recuperado el entorno cuando ve uno de los checks de la caída terminado bien, con hora de finalización posterior a la última falla registrada de ese check, en la cabeza de cualquier pull request vigilado del repositorio o en la punta de su rama base. Mientras dure la caída, la base se mira como mucho una vez cada 5 minutos por repositorio.

#### Scenario: Pasa en otro pull request
- **WHEN** durante una caída por `e2e`, un pull request vigilado del repositorio muestra `e2e` pasado con hora posterior a la última falla
- **THEN** el registro de la caída se borra y los pull requests afectados se vuelven a mirar en la pasada siguiente, sin esperar su `backoff`

#### Scenario: Pasa en la rama base
- **WHEN** durante una caída por `e2e`, los checks de `main` muestran `e2e` pasado después de la última falla
- **THEN** el registro de la caída se borra

#### Scenario: Una corrida vieja que pasó no cuenta
- **WHEN** `e2e` pasado en `main` terminó antes de la última falla registrada
- **THEN** la caída sigue activa

### Requirement: Prueba espaciada cuando no aparece ninguna corrida que pase
Sin una corrida que pase, la fábrica MUST probar la recuperación re-corriendo los checks fallidos de un solo pull request afectado, solo cuando el repositorio está libre de otras corridas (la misma regla de turno de hoy). La primera prueba MUST hacerse 30 minutos después de la última falla registrada, y cada prueba que vuelve a fallar MUST duplicar la espera, hasta 240 minutos. La prueba MUST NOT contar como la re-corrida del pull request (`rerun`).

#### Scenario: Primera prueba
- **WHEN** hay una caída activa, pasaron 30 minutos desde la última falla, no hay corridas en marcha en el repositorio y #10 está afectado con una corrida re-ejecutable
- **THEN** se re-corren solo las corridas fallidas de #10, no las de otros pull requests, y `rerun` de #10 no cambia

#### Scenario: Fallas antiguas
- **WHEN** se registra una caída cuyas fallas terminaron hace más de 30 minutos
- **THEN** la primera prueba sale en esa misma pasada o en la siguiente, sin esperar otros 30 minutos

#### Scenario: La prueba falla de nuevo
- **WHEN** terminan todos los checks del pull request de prueba y el check de la caída volvió a fallar
- **THEN** la próxima prueba queda para 60 minutos después; tras otra falla, 120; y nunca más de 240

#### Scenario: Una prueba a la vez
- **WHEN** la prueba de #10 está corriendo
- **THEN** ningún otro pull request del repositorio se actualiza ni se re-corre hasta que terminen sus checks

#### Scenario: La prueba pasa
- **WHEN** en el pull request de prueba el check de la caída terminó bien
- **THEN** el entorno se da por recuperado

### Requirement: Una re-corrida extra después de la recuperación
Una vez recuperado el entorno, cada pull request marcado como afectado que siga con checks fallidos MUST recibir una re-corrida de sus corridas fallidas, de a un pull request por repositorio a la vez, aunque su `rerun` ya sea su cabeza actual. Esa re-corrida consume la marca de afectado, así que se da una sola vez por caída.

#### Scenario: Re-corridas de a una tras la recuperación
- **WHEN** el entorno se recuperó y #10 y #11 están afectados, con `rerun` igual a su cabeza
- **THEN** en una pasada se re-corre #10 y #11 espera su turno; cuando terminan los checks de #10, se re-corre #11

#### Scenario: Vuelve a fallar después de la re-corrida
- **WHEN** la re-corrida posterior a la recuperación de #10 vuelve a fallar sin una caída nueva
- **THEN** #10 queda `blocked` con «fallaron los checks …» y no se vuelve a re-correr

### Requirement: Una caída sin pull requests pendientes se olvida
La fábrica MUST borrar el registro de caída de un repositorio cuando ningún pull request vigilado de ese repositorio sigue marcado como afectado.

#### Scenario: Los afectados se cerraron
- **WHEN** todos los pull requests afectados por una caída se fundieron o se cerraron
- **THEN** el registro de caída del repositorio ya no existe después de la pasada

### Requirement: Una sola línea por caída en el estado, el panel y el resumen
`factoryStatus` MUST informar cada caída activa (repositorio, desde, checks, pull requests afectados), y `formatStatus`, el resumen del panel y el briefing MUST mostrar una línea «Entorno caído en <repo> desde HH:MM (checks: a, b)» por caída. Los pull requests retenidos por la caída MUST NOT aparecer además como líneas de fusión automática ni como «Sin fundir».

#### Scenario: zero status
- **WHEN** hay una caída activa en kaelen/demo por `e2e` y #10 y #11 están retenidos
- **THEN** `formatStatus(factoryStatus(ctx))` contiene «Entorno caído en kaelen/demo desde HH:MM (checks: e2e)», con HH:MM igual a la hora local de `since`, y no contiene «NO SE FUNDE: fallaron los checks e2e»

#### Scenario: Panel
- **WHEN** se renderiza `overviewPage` con esa caída
- **THEN** el HTML contiene «Entorno caído en kaelen/demo desde» y ninguna línea «Fusión automática» de #10 ni de #11

#### Scenario: Resumen
- **WHEN** se arma `briefing(ctx)` con esa caída
- **THEN** el cuerpo contiene «Entorno caído en kaelen/demo desde» y no contiene «**Sin fundir**» para #10 ni para #11

### Requirement: Los pull requests trabados de antes se destraban solos
Los pull requests que ya gastaron su re-corrida antes de este cambio (`rerun` igual a su cabeza, `blocked` con `backoff`) MUST destrabarse por este mismo camino: detección, prueba de recuperación y una re-corrida de a uno, sin ninguna intervención de quien está a cargo.

#### Scenario: Seis pull requests trabados
- **WHEN** seis pull requests de un repositorio están `blocked` con `rerun` igual a su cabeza y `e2e` fallado entre las 10:00 y las 13:00 de un mismo día, y la pasada corre al día siguiente, cuando `e2e` ya pasa
- **THEN** después de las pasadas necesarias (con el reloj avanzando más que los `backoff`), cada uno recibe exactamente una re-corrida más, de a uno, y los que pasan se funden

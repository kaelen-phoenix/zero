# Spec Delta

## ADDED Requirements

### Requirement: Pull request con conflictos vuelve a la línea
Cuando un pull request vigilado de una línea con `autoMerge` está abierto y GitHub informa `mergeable: false`, el pase de fusión SHALL devolver su trabajo a la cola para actualizarlo, sin comentar "no funde", si el trabajo tiene spec, le quedan intentos (`attempt` menor que `maxAttempts`), la rama local coincide con la punta del pull request, esa punta no se intentó antes y el fetch de la base funcionó.

#### Scenario: Conflicto con intentos disponibles
- **WHEN** `pollMerges` ve un pull request con `mergeable: false`, `headSha` igual a `refs/heads/<rama>` en el repositorio de la línea y `attempt` menor que `maxAttempts`
- **THEN** el trabajo queda `queued` sin `finishedAt`, conserva su `delivery`, no se llama a `comment` ni a `merge`, y el `MergeState` guarda esa punta en `resolving`

#### Scenario: Conflicto con checks fallidos o pendientes
- **WHEN** el pull request tiene `mergeable: false` y además un check fallido o sin terminar
- **THEN** el trabajo igual vuelve a la cola

#### Scenario: Fetch de la base fallido
- **WHEN** se cumplen las demás condiciones pero falla `git fetch` de la rama base
- **THEN** el trabajo sigue `delivered`, `resolving` queda sin valor y el pull request se informa como bloqueado, como hoy

### Requirement: No se toca un pull request ajeno
La fábrica MUST NOT modificar un pull request cuya punta difiere de la rama local del trabajo: en ese caso SHALL informarlo como hoy y dejar el trabajo `delivered`.

#### Scenario: Una persona subió un commit
- **WHEN** `pollMerges` ve `mergeable: false` y `headSha` distinto de la punta local
- **THEN** el trabajo sigue `delivered`, se comenta una sola vez que no se funde por conflictos con la base y la rama remota no cambia

#### Scenario: La rama local ya no existe
- **WHEN** `pollMerges` ve `mergeable: false` y la rama local del trabajo no existe
- **THEN** el trabajo sigue `delivered` y se comenta una sola vez, como hoy

### Requirement: Punta remota comprobada antes de subir
Antes de subir la actualización, la fábrica MUST comprobar con `git ls-remote` que la rama remota sigue en la punta registrada al retomar el trabajo, y si no coincide MUST NOT subir nada.

#### Scenario: La rama remota se movió durante el trabajo
- **WHEN** mientras corre la actualización, otro commit llega a la rama en un remoto bare real
- **THEN** la rama remota conserva ese commit, nada de la fábrica se sube y el trabajo termina `delivered` con su `delivery` original

### Requirement: Solo merge, nunca rebase ni force-push
La actualización SHALL mezclar la rama base remota en la rama del trabajo con un commit de merge y SHALL subirla sin forzar al mismo pull request; MUST NOT reescribir historia ni abrir otro pull request.

#### Scenario: Actualización contra un remoto bare real
- **WHEN** el trabajo retomado termina bien contra un remoto bare
- **THEN** la nueva punta remota desciende de la punta anterior y de la base (`merge-base --is-ancestor` da ambas), hay un commit de merge con dos padres, `openPullRequest` no se llama y `delivery.url` sigue igual

### Requirement: Conflicto resuelto como un intento más
Si la mezcla de la base da conflictos, el trabajo SHALL volver a build como un intento nuevo contado dentro de `maxAttempts`, con la mezcla en curso en la copia de trabajo y los archivos en conflicto nombrados en su feedback.

#### Scenario: Conflicto resuelto
- **WHEN** el build falso reemplaza los marcadores del archivo por contenido resuelto
- **THEN** su prompt nombra el archivo, `attempt` sube en uno, el commit concluye la mezcla y el trabajo vuelve a `delivered`

#### Scenario: Resolución sin diferencias
- **WHEN** la resolución deja el árbol igual a HEAD
- **THEN** `commitAll` igual concluye la mezcla con un commit de dos padres

#### Scenario: Reemplazo de motor por límite del plan
- **WHEN** el plan corta el build a mitad de un intento de conflicto y sigue otro motor del mismo intento
- **THEN** el motor de reemplazo encuentra la mezcla en curso con los mismos archivos en conflicto

### Requirement: Mezcla limpia sin gastar intento
Si la mezcla de la base no da conflictos, la fábrica MUST NOT llamar a build ni contar un intento, y SHALL pasar la verificación y las revisiones antes de subir.

#### Scenario: GitHub informó conflicto pero la mezcla local es limpia
- **WHEN** la mezcla local termina sin conflictos y la verificación pasa
- **THEN** la cantidad de llamadas a build no cambia, `attempt` no cambia, los comandos de verificación corren de nuevo y la rama remota avanza

### Requirement: Se vuelve a verificar antes de subir
Una actualización MUST NOT subirse hasta que pasen de nuevo la verificación y las revisiones sobre el resultado de la mezcla.

#### Scenario: La verificación falla después de resolver
- **WHEN** la resolución deja un comando de verificación fallando y no quedan intentos
- **THEN** la rama remota no cambia y el trabajo termina `delivered` con su `delivery` original

### Requirement: Nunca se commitean marcadores de conflicto
La fábrica MUST revisar los archivos que estuvieron en conflicto antes de commitear y antes de subir: si alguno tiene marcadores de conflicto, MUST NOT commitearlo ni subirlo.

#### Scenario: Build deja marcadores
- **WHEN** el build falso deja `<<<<<<<` en el archivo y en el intento siguiente lo resuelve
- **THEN** el primer intento falla sin crear commit, el feedback nombra el archivo, el segundo intento encuentra la mezcla empezada de nuevo y ningún commit de la rama tiene marcadores

#### Scenario: Build deja marcadores en todos los intentos
- **WHEN** build deja marcadores hasta agotar `maxAttempts`
- **THEN** la rama remota no cambia y el trabajo termina `delivered` con su `delivery` original

#### Scenario: El agente commitea por su cuenta
- **WHEN** el build falso commitea el archivo con marcadores
- **THEN** el intento falla, ese commit no sobrevive al intento siguiente y nada con marcadores se sube

### Requirement: Si no se resuelve, se informa como hoy
Cuando la actualización termina sin subirse, por cualquier motivo, el trabajo SHALL volver a `delivered` con su `delivery` original y la rama local en la punta registrada, y SHALL seguir vigilado, de modo que el pull request reciba el aviso de hoy una sola vez.

#### Scenario: Intentos agotados
- **WHEN** se agotan los intentos de la actualización
- **THEN** `finalizeJob` deja `status: delivered` con la misma `delivery`, `refs/heads/<rama>` vuelve a la punta registrada, el trabajo sigue en `watchedJobs` y la pasada siguiente comenta una vez que tiene conflictos con la rama base

#### Scenario: Trabajo detenido o rechazado
- **WHEN** la persona detiene el trabajo durante la actualización
- **THEN** el trabajo vuelve a `delivered` con la misma `delivery` y sigue vigilado

#### Scenario: Se arregla después con un push
- **WHEN** tras rendirse, el pull request pasa a `mergeable: true` con checks bien
- **THEN** la pasada siguiente lo funde

### Requirement: Un solo intento por punta
La fábrica MUST NOT retomar más de una vez un trabajo por la misma punta de pull request, y el valor de `resolving` SHALL conservarse en todas las escrituras de `MergeState`.

#### Scenario: Pasadas repetidas sobre la misma punta
- **WHEN** después de rendirse, siguen las pasadas con el mismo `headSha` y `mergeable: false`, incluidas las que guardan `waiting` o `blocked`
- **THEN** el trabajo no vuelve a la cola y no se repite el comentario

#### Scenario: La base se mueve otra vez después de una actualización buena
- **WHEN** tras subir la actualización, el pull request vuelve a tener conflictos en la punta nueva y quedan intentos
- **THEN** el trabajo vuelve a la cola una vez más

### Requirement: Aprobación de integración otra vez
Al retomar un trabajo por conflictos, la fábrica MUST borrar `approvals.integrate`, de modo que una aprobación previa no cubra código que la persona no vio.

#### Scenario: Línea en L1
- **WHEN** un trabajo aprobado antes de integrar se retoma por conflictos en L1
- **THEN** antes de subir pasa a `waiting` con una pregunta `before-integrate`, y al aprobarla sube la actualización

### Requirement: Documentado en ambos idiomas
`README.md` y `README.es.md` SHALL explicar en la sección de fusión automática qué hace la fábrica con un pull request con conflictos, con la misma estructura y los mismos bloques de código.

#### Scenario: Sección de fusión automática
- **WHEN** se leen ambos README
- **THEN** ambos mencionan la mezcla de la base sin force-push, el límite de `maxAttempts` y que no se toca un pull request con commits ajenos, y `test/docs.test.ts` pasa

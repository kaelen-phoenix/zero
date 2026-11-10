# Spec Delta

## Purpose

La fábrica deja de preguntarle a GitHub en cada vuelta por los pull requests cerrados sin fundir, y vuelve a mirar cada uno una sola vez cada 24 horas. La fecha de la próxima consulta queda guardada, así que reiniciar el daemon no la adelanta. Si un pull request se reabre y se funde, la fábrica lo nota en la siguiente consulta y registra su commit, con hasta 24 horas de demora, y puede reconocer una reversión posterior. Los pull requests abiertos se siguen consultando como hoy. Si la fecha guardada no se puede leer, la fábrica consulta como siempre.

## ADDED Requirements

### Requirement: Espera tras un PR cerrado sin fundir
Cuando `gh.pullRequest` informe un PR con `open: false` y `merged: false`, `detectReverts` MUST guardar en la clave kv `reverts:closed:<job>` la fecha ISO de 24 horas después del reloj de la fábrica (`ctx.now`), y SHALL NOT llamar a `pullRequest` por ese trabajo mientras el reloj sea anterior a esa fecha.

#### Scenario: Una sola consulta dentro de las 24 horas
- **WHEN** Un trabajo autónomo entregado como PR sin commit recibe de una `MergeApi` falsa `{open: false, merged: false}` y `detectReverts` corre varias veces, con el reloj avanzando hasta 23 horas y 59 minutos después de la primera pasada
- **THEN** `pullRequest` se llamó exactamente una vez, `reverts:closed:<job>` contiene la fecha de la primera pasada más 24 horas, y la propuesta sigue `approved`

#### Scenario: La espera sobrevive a un reinicio
- **WHEN** Tras guardarse la fecha, `detectReverts` corre con una `MergeApi` nueva, sin estado en memoria, sobre el mismo store y dentro de las 24 horas
- **THEN** La `MergeApi` nueva no recibe ninguna llamada a `pullRequest`

#### Scenario: La espera es por trabajo
- **WHEN** Hay dos trabajos autónomos con PRs distintos; uno ya tiene una fecha futura en `reverts:closed:<job>` y el otro no tiene clave
- **THEN** En la pasada, `pullRequest` se llama solo con el número del PR del segundo trabajo

### Requirement: Nueva consulta al vencer la espera
Cuando el reloj alcance la fecha guardada, `detectReverts` MUST volver a llamar a `pullRequest` por ese trabajo, y si el PR sigue cerrado sin fundir SHALL guardar una fecha nueva a 24 horas de ese momento.

#### Scenario: Sigue cerrado al vencer
- **WHEN** El reloj llega exactamente a la fecha guardada y la `MergeApi` falsa sigue informando `{open: false, merged: false}`
- **THEN** `pullRequest` se llamó una vez más, y `reverts:closed:<job>` contiene el nuevo momento más 24 horas

### Requirement: PR reabierto y fundido después
Cuando una consulta posterior a la espera informe el PR como fundido con `mergeCommitSha`, `detectReverts` MUST registrar ese commit en `delivery.commit` del trabajo y SHALL reconocer una reversión de ese commit en la misma pasada.

#### Scenario: Se registra el commit y se ve la reversión
- **WHEN** Un PR informado primero como cerrado sin fundir pasa a `{open: false, merged: true, mergeCommitSha: S}`, la rama base tiene un `git revert` de S y el reloj superó la fecha guardada
- **THEN** `detectReverts` devuelve 1, `delivery.commit` del trabajo es S y la propuesta queda `reverted`

#### Scenario: Sin consultas después de registrar
- **WHEN** El commit ya quedó registrado y `detectReverts` corre de nuevo
- **THEN** `pullRequest` no recibe más llamadas por ese trabajo

### Requirement: Los PRs abiertos no esperan
`detectReverts` SHALL NOT guardar una fecha en `reverts:closed:<job>` cuando `gh.pullRequest` informe un PR con `open: true`, y MUST seguir llamando a `pullRequest` por él en cada pasada.

#### Scenario: Abierto
- **WHEN** La `MergeApi` falsa informa `{open: true, merged: false}` y `detectReverts` corre dos veces con el mismo reloj
- **THEN** `pullRequest` se llamó dos veces y no existe la clave `reverts:closed:<job>`

### Requirement: Fundido sin commit todavía no espera
`detectReverts` SHALL NOT guardar una fecha en `reverts:closed:<job>` cuando GitHub informe el PR como fundido sin `mergeCommitSha`, y MUST volver a llamar a `pullRequest` en la siguiente pasada.

#### Scenario: Fundido sin sha
- **WHEN** La `MergeApi` falsa informa `{open: false, merged: true}` sin `mergeCommitSha` y `detectReverts` corre dos veces
- **THEN** `pullRequest` se llamó dos veces y no existe la clave `reverts:closed:<job>`

### Requirement: Limpieza de la fecha cuando el PR ya no está cerrado
Cuando una consulta informe el PR abierto, o fundido con `mergeCommitSha`, `detectReverts` MUST borrar la clave `reverts:closed:<job>` si existe.

#### Scenario: Reabierto y todavía abierto
- **WHEN** La fecha guardada venció y la `MergeApi` falsa informa `{open: true, merged: false}`
- **THEN** La clave `reverts:closed:<job>` deja de existir y la pasada siguiente vuelve a llamar a `pullRequest`

#### Scenario: Fundido
- **WHEN** La fecha guardada venció y la `MergeApi` falsa informa `{open: false, merged: true, mergeCommitSha: S}`
- **THEN** La clave `reverts:closed:<job>` deja de existir y `delivery.commit` es S

### Requirement: Si no se puede leer la fecha se consulta
Si leer `reverts:closed:<job>` lanza un error, o el valor no es una fecha válida, `detectReverts` MUST llamar a `pullRequest` como si no hubiera fecha y SHALL NOT lanzar un error.

#### Scenario: El kv falla al leer
- **WHEN** `ctx.store.getKv` lanza un error para `reverts:closed:<job>` y la `MergeApi` falsa informa `{open: true, merged: false}`
- **THEN** `detectReverts` se resuelve sin error y `pullRequest` se llamó una vez

#### Scenario: Valor inválido
- **WHEN** `reverts:closed:<job>` contiene `no-es-fecha` y la `MergeApi` falsa informa `{open: false, merged: false}`
- **THEN** `pullRequest` se llamó una vez y la clave pasa a contener la fecha del reloj más 24 horas

### Requirement: Un fallo al guardar no corta la pasada
Si escribir o borrar `reverts:closed:<job>` lanza un error, `detectReverts` SHALL NOT lanzar un error y MUST conservar el commit obtenido en esa consulta.

#### Scenario: El kv falla al guardar la fecha
- **WHEN** `ctx.store.setKv` lanza un error para `reverts:closed:<job>` y la `MergeApi` falsa informa `{open: false, merged: false}`
- **THEN** `detectReverts` se resuelve sin error y la pasada siguiente vuelve a llamar a `pullRequest`

#### Scenario: El kv falla al borrar la fecha
- **WHEN** Hay una fecha vencida, `ctx.store.deleteKv` lanza un error para `reverts:closed:<job>`, la rama base tiene un `git revert` de S y la `MergeApi` falsa informa `{open: false, merged: true, mergeCommitSha: S}`
- **THEN** `detectReverts` devuelve 1, `delivery.commit` es S y la propuesta queda `reverted`

### Requirement: Un error de GitHub no abre una espera
Si `gh.pullRequest` lanza un error, incluido `GithubHalted`, `detectReverts` SHALL NOT guardar una fecha en `reverts:closed:<job>`, porque ese error no dice nada sobre el estado del PR.

#### Scenario: GitHub no responde
- **WHEN** La `MergeApi` falsa lanza un error en `pullRequest` y `detectReverts` corre dos veces
- **THEN** `detectReverts` se resuelve sin error ambas veces, `pullRequest` se llamó dos veces y no existe la clave `reverts:closed:<job>`

### Requirement: Las demás detecciones siguen igual
Un trabajo en espera por `reverts:closed:<job>` SHALL NOT impedir que `detectReverts` reconozca, en la misma pasada y la misma línea, la reversión de otra integración.

#### Scenario: Entrega por merge junto a un PR en espera
- **WHEN** Una línea tiene un trabajo con una fecha futura en `reverts:closed:<job>` y otra propuesta autónoma entregada por merge cuyo commit fue revertido en la rama base
- **THEN** `detectReverts` devuelve 1, la propuesta entregada por merge queda `reverted`, la otra sigue `approved` y `pullRequest` no recibe llamadas

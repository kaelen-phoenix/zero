# Spec Delta

## Purpose

Vas a tener un comando nuevo: `zero simulacro <línea> <capacidad> --archivos <patrón>`. Mide si las especificaciones de una parte del proyecto alcanzan para reconstruirla. Cómo trabaja: - Arma una copia aparte dentro de ZERO_HOME, sin historial de git. El repositorio de la línea no se toca: ni ramas, ni worktrees, ni archivos. - En esa copia borra los archivos de código que indicaste. Los tests y las especificaciones quedan. - Le pide al agente de build que los vuelva a escribir leyendo solo `openspec/specs/<capacidad>/spec.md`, con un tope de gasto. Por defecto el tope es `limits.usdPerJob`; con `--usd` se puede bajar. - Corre los comandos de verificación de la línea sobre lo regenerado. Al final guarda un informe en `ZERO_HOME/drills/<id>/informe.md` y muestra la ruta. El resultado es uno de tres: - «alcanzan»: los tests pasan y se reconstruyó todo; - «no alcanzan»: falló algún comando o quedaron archivos sin reconstruir; - «inválido»: el agente tocó tests o especificaciones. El informe también dice qué archivos se reconstruyeron, cuánto costó, la salida de cada comando y qué le faltaba a la especificación según el agente. En esta primera versión el simulacro corre en tu máquina. En líneas configuradas para trabajar dentro de la caja de aislamiento (`isolation: container`) se niega con un aviso claro. Además, en la web el ítem pasa de «en camino» a «disponible», y el comando queda documentado en README.md y README.es.md.

## ADDED Requirements

### Requirement: Copia aparte sin tocar el repositorio de la línea
`zero simulacro <línea> <capacidad> --archivos <patrón>...` MUST trabajar en una copia independiente en `<ZERO_HOME>/drills/<id>/copy`, hecha desde la rama base de la línea (`git clone --no-hardlinks` o equivalente). Después de quitar los archivos MUST reemplazar el `.git` por un repositorio nuevo con un único commit, para que la copia no guarde en su historial el contenido de los archivos quitados. El repositorio de la línea MUST quedar igual: mismas referencias, mismos worktrees, mismo HEAD y mismo estado de trabajo.

#### Scenario: El repositorio de la línea no cambia
- **WHEN** se corre el simulacro sobre una línea de un repositorio temporal con un agente falso
- **THEN** `git for-each-ref`, `git worktree list --porcelain`, `git rev-parse HEAD` y `git status --porcelain` del repositorio de la línea devuelven lo mismo que antes del simulacro

#### Scenario: La copia no tiene historial con lo quitado
- **WHEN** el agente falso de build mira la copia durante la llamada
- **THEN** los archivos quitados no existen, `git rev-list --all --count` en la copia da 1 y `git log --all -p` no contiene el texto original de esos archivos

### Requirement: Qué se quita y qué queda
El simulacro MUST quitar de la copia solo los archivos versionados de la rama base que coinciden con algún patrón de `--archivos`. Quedan fuera los tests (`isTestFile` de `src/line/verify.ts`) y todo lo que está bajo `openspec/`. Si después de esos filtros no queda ningún archivo para quitar, MUST negarse sin crear nada.

#### Scenario: Los tests y las specs se conservan
- **WHEN** el patrón coincide con `src/mod.ts`, `test/mod.test.ts` y `openspec/specs/cap/spec.md`
- **THEN** solo falta `src/mod.ts` en la copia cuando el agente es llamado; el test y la spec siguen ahí

#### Scenario: Patrón sin archivos de código
- **WHEN** el patrón solo coincide con tests o con ningún archivo
- **THEN** el comando falla con un mensaje en español y no se crea `<ZERO_HOME>/drills`

### Requirement: Regeneración solo desde la especificación y con presupuesto acotado
El simulacro MUST hacer una sola llamada al agente de la estación `build` (acceso de escritura, `cwd` en la copia), con un motor elegido por `pickEngine` para `build` y con `maxBudgetUsd` igual a `--usd`, o a `limits.usdPerJob` si no se pasa. El prompt MUST nombrar `openspec/specs/<capacidad>/spec.md` y cada archivo quitado, y pedir que se reconstruyan desde la especificación sin modificar tests ni especificaciones. La salida estructurada MUST validarse con un esquema que tenga `missing: string[]`, con lo que la especificación no decía y hubo que adivinar.

#### Scenario: Una llamada con el tope
- **WHEN** se corre el simulacro con `--usd 0.5` y `limits.usdPerJob` 3
- **THEN** el agente falso recibe exactamente una llamada con station `build`, maxBudgetUsd 0.5, cwd dentro de `<ZERO_HOME>/drills/<id>/copy` y un prompt que contiene la ruta de la spec y la del archivo quitado

#### Scenario: Tope por defecto
- **WHEN** se corre sin `--usd`
- **THEN** maxBudgetUsd es `limits.usdPerJob`

### Requirement: Tests de la línea contra lo regenerado
Después de la llamada al agente, el simulacro MUST correr en la copia cada comando de `verify` de la línea, en orden y con un límite de 20 minutos por comando, y guardar para cada uno el código de salida y el final de su salida. Los comandos de `setup` de la línea MUST correr en la copia antes de llamar al agente.

#### Scenario: Los comandos corren en la copia
- **WHEN** la línea tiene `setup` y `verify` que escriben un archivo marcador en el directorio actual
- **THEN** los marcadores aparecen dentro de la copia y no en el repositorio de la línea, y el de setup ya existe cuando el agente es llamado

### Requirement: Resultado del simulacro
El simulacro MUST tener un resultado. `inválido`: algún archivo de test o bajo `openspec/` cambió o desapareció respecto del commit de la copia. `alcanzan`: todos los archivos quitados volvieron a existir, todos los comandos de verify terminaron con 0 y el agente terminó ok. `no alcanzan`: cualquier otro caso. Un agente que termina con `ok: false` o que corta por presupuesto MUST dar `no alcanzan`, y el informe se escribe igual.

#### Scenario: Las especificaciones alcanzan
- **WHEN** el agente falso vuelve a escribir el archivo y el comando de verify termina con 0
- **THEN** el resultado es `alcanzan`

#### Scenario: Las especificaciones no alcanzan
- **WHEN** el agente falso escribe una versión que hace fallar el comando de verify
- **THEN** el resultado es `no alcanzan` y el informe incluye el comando, su código de salida y el final de su salida

#### Scenario: Archivo no reconstruido
- **WHEN** el agente falso no escribe el archivo quitado y verify pasa
- **THEN** el resultado es `no alcanzan` y el informe nombra el archivo como no reconstruido

#### Scenario: Tests tocados
- **WHEN** el agente falso modifica un archivo de test
- **THEN** el resultado es `inválido` y el informe nombra ese archivo

### Requirement: Informe solo en ZERO_HOME
El simulacro MUST escribir su informe en Markdown, en español, en `<ZERO_HOME>/drills/<id>/informe.md`, junto a un `resultado.json` con los mismos datos. El informe incluye línea, capacidad, commit base, archivos quitados, cuáles se reconstruyeron, resultado, costo de la llamada, cada comando con su código de salida, y una sección «Qué faltaba en las especificaciones» con la lista `missing` del agente. El comando MUST mostrar la ruta del informe y el resultado. MUST negarse antes de crear nada cuando `<ZERO_HOME>/drills` cae dentro del repositorio de alguna línea o del repositorio de la carpeta actual, con la misma regla que `saveReport`. Nada del simulacro se escribe en el repositorio de la línea.

#### Scenario: Informe con lo que faltaba
- **WHEN** el agente falso devuelve `missing: ["el formato de fecha"]`
- **THEN** `<ZERO_HOME>/drills/<id>/informe.md` existe, contiene «Qué faltaba en las especificaciones» y «el formato de fecha», y `resultado.json` se puede leer como JSON con el resultado

#### Scenario: ZERO_HOME dentro del repositorio
- **WHEN** ZERO_HOME está dentro del repositorio de la línea
- **THEN** el comando falla con un mensaje que lo explica y el agente no es llamado

### Requirement: Negativas antes de gastar
El simulacro MUST negarse, sin llamar al agente y sin crear la copia, en estos casos: la línea no existe; `openspec/specs/<capacidad>/spec.md` no existe en la rama base; la línea no tiene comandos de `verify`; la fábrica tiene `isolation: container` (en esta versión solo corre en la máquina); el andon está encendido; `budgetState` indica que se llegó al límite; o `--usd` no es un número positivo o supera `limits.usdPerJob`. Cada negativa MUST explicar el motivo en español.

#### Scenario: Capacidad inexistente
- **WHEN** se pide una capacidad sin `openspec/specs/<capacidad>/spec.md`
- **THEN** el comando falla nombrando la capacidad y el agente falso no recibe llamadas

#### Scenario: Caja de aislamiento
- **WHEN** la fábrica tiene `isolation: container`
- **THEN** el comando falla con un mensaje que menciona `isolation` y no se crea la copia

#### Scenario: Sin verify
- **WHEN** la línea no tiene comandos de verify
- **THEN** el comando falla y el agente falso no recibe llamadas

#### Scenario: Tope excedido
- **WHEN** `--usd` es mayor que `limits.usdPerJob`
- **THEN** el comando falla y el agente falso no recibe llamadas

#### Scenario: Andon
- **WHEN** el andon está encendido
- **THEN** el comando falla y el agente falso no recibe llamadas

### Requirement: Disponible en la web
En `site/index.html`, el ítem `next.regen` de «Próximas etapas» MUST mostrar `<span class="ready" data-i18n="ready">disponible</span>` en lugar de la marca «en camino». `test/site.test.ts` MUST verificarlo y ya no exigir que `next.regen` esté en una línea `soon`.

#### Scenario: Regeneración disponible
- **WHEN** se lee `site/index.html`
- **THEN** la única línea con `data-i18n="next.regen"` contiene `class="ready"` y ninguna línea con `class="soon"` contiene `next.regen`

### Requirement: Documentado en los dos README
README.md y README.es.md MUST documentar `zero simulacro` en una sección propia, con el mismo bloque de código en ambos. La sección explica que trabaja en una copia aparte en ZERO_HOME sin tocar el repositorio, cuál es el tope de gasto, qué resultados puede dar, dónde queda el informe y que en esta versión no corre con `isolation: container`. «Regeneration drill» / «Simulacro de regeneración» MUST salir de la lista «Next steps» / «Próximos pasos», y el uso del comando MUST figurar en el texto de ayuda del CLI.

#### Scenario: Los README coinciden
- **WHEN** corre `test/docs.test.ts`
- **THEN** pasa, y los dos README contienen `zero simulacro`

#### Scenario: Fuera de próximos pasos
- **WHEN** se lee la línea que sigue a «## Next steps» en README.md y la equivalente en README.es.md
- **THEN** no contienen «Regeneration drill» ni «Simulacro de regeneración»

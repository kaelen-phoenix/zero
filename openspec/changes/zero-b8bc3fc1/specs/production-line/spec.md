# Spec Delta

## ADDED Requirements

### Requirement: Tipo de agente en la configuración
CustomAgentSchema MUST aceptar `type` con los valores `review` (predeterminado, solo lectura, como hoy) y `build` (escribe en la copia de trabajo). El resultado del parseo MUST quedar con access `write` y after `build` para un agente `build`, y con access `read` y after `review` para un agente `review`. Una configuración sin `type` MUST seguir parseando como `review`.

#### Scenario: Sin type sigue siendo revisor
- **WHEN** se parsea un agente `{ name: a11y }`
- **THEN** queda con type `review`, access `read`, after `review`, blocking true y files vacío

#### Scenario: Agente que escribe
- **WHEN** se parsea un agente `{ name: docs, type: build }`
- **THEN** queda con type `build`, access `write` y after `build`

#### Scenario: Tipo desconocido
- **WHEN** se parsea un agente con `type: deploy`
- **THEN** parseFactory lanza un error en español

### Requirement: Un agente que escribe nunca va después de verify
La configuración MUST rechazar, con un mensaje en español, un agente `type: build` que declare `after` o `access: read`, o `blocking: false`. MUST rechazar también un agente de revisión con `access: write` o con `after` distinto de `review`. Ningún campo MUST permitir que un agente que escribe corra después de verify.

#### Scenario: Después de review
- **WHEN** se parsea `{ name: docs, type: build, after: review }`
- **THEN** parseFactory lanza un error que dice que un agente que escribe corre entre build y verify

#### Scenario: Después de verify
- **WHEN** se parsea `{ name: docs, type: build, after: verify }`
- **THEN** parseFactory lanza un error

#### Scenario: Acceso contradictorio
- **WHEN** se parsea `{ name: docs, type: build, access: read }`
- **THEN** parseFactory lanza un error

#### Scenario: Informativo que escribe
- **WHEN** se parsea `{ name: docs, type: build, blocking: false }`
- **THEN** parseFactory lanza un error

#### Scenario: Revisor con escritura
- **WHEN** se parsea `{ name: docs, access: write }` o `{ name: docs, after: build }`
- **THEN** parseFactory lanza un error que coincide con /solo puede ser de lectura/ o /después de review/ respectivamente

### Requirement: Orden en la línea
Los agentes `type: build` MUST correr después de la estación build y antes de verify en cada intento, en el orden de lineAgents (globales, luego los de la línea, cada uno en orden de archivo). Los agentes `review` MUST seguir corriendo después de review y security, sin que los `build` aparezcan entre ellos.

#### Scenario: Orden completo
- **WHEN** una línea tiene un agente global `docs` de tipo build, y en la línea `i18n` de tipo build y `a11y` de tipo review, y corre un trabajo
- **THEN** las llamadas por agentName son spec, build, docs, i18n, review, security, a11y, y el trabajo se entrega

#### Scenario: Verify corre después de los agentes
- **WHEN** el verificador de la línea exige un archivo que solo escribe el agente `docs`
- **THEN** verify pasa en el primer intento

#### Scenario: Build sin cambios
- **WHEN** build no cambia código en un intento
- **THEN** el intento falla como hoy y los agentes que escriben no corren en ese intento

### Requirement: Lo que escribe queda en un commit propio
Cuando un agente que escribe termina bien con cambios, zero MUST commitearlos con commitAll y withTrailer, con un mensaje que nombra el agente y el intento, antes de pasar al siguiente agente o a verify. Un agente que termina bien sin cambios MUST NOT fallar el intento.

#### Scenario: Commit con su nombre
- **WHEN** el agente `docs` escribe `docs/x.md`
- **THEN** la rama entregada contiene ese archivo y un commit cuyo mensaje contiene `docs`

#### Scenario: El siguiente ve lo anterior
- **WHEN** `docs` escribe un archivo y luego corre `i18n`
- **THEN** cuando corre `i18n`, el archivo de `docs` está commiteado y hasChanges es false

#### Scenario: Sin cambios
- **WHEN** el agente que escribe no modifica nada
- **THEN** el trabajo sigue a verify y se entrega en el intento 1

### Requirement: Pasa por todas las verificaciones
Lo que escribe un agente MUST pasar por verify, rutas protegidas (incluida `.zero/**`), review, security y los agentes revisores, igual que lo que escribe build.

#### Scenario: Ruta protegida en L3
- **WHEN** en L3 un agente que escribe modifica `.github/workflows/ci.yml` o `.zero/agents/security.md` en todos los intentos
- **THEN** el trabajo no se entrega, el feedback a build contiene `rutas protegidas` y review no corre

#### Scenario: Ruta protegida en L2
- **WHEN** en L2 un agente que escribe modifica una ruta protegida
- **THEN** el trabajo queda esperando con pregunta `protected-path` que lista esa ruta

#### Scenario: Revisión ve su trabajo
- **WHEN** review bloquea con un hallazgo verificado en un archivo escrito por el agente
- **THEN** el intento se rechaza y en el intento siguiente corren build y el agente otra vez

#### Scenario: Verify falla
- **WHEN** verify falla por lo que escribió el agente
- **THEN** el intento falla y el prompt de la siguiente corrida de build contiene ese feedback

### Requirement: Mismas garantías de ejecución que build
Un agente que escribe MUST correr con access `write` (en la caja, montaje `rw`), con su propio maxTurns y timeoutMinutes, con el motor elegido por pickAgentEngine sobre customAgentChain y sus propias skills. MUST registrar un span `zero.station.<nombre>` bajo el intento, con el span del agente debajo, y `job.station` MUST tener su nombre mientras corre. Un agente `review` MUST seguir recibiendo access `read`.

#### Scenario: Acceso de escritura
- **WHEN** createAgentRunner ejecuta un agente con custom de access `write`, con un execute falso
- **THEN** el EngineRequest tiene access `write`, las instrucciones del agente y timeoutMs igual a su timeoutMinutes en milisegundos

#### Scenario: El revisor sigue de lectura
- **WHEN** createAgentRunner ejecuta un agente `review`
- **THEN** el EngineRequest tiene access `read`

#### Scenario: Motor propio y traza
- **WHEN** un agente que escribe tiene `engine: codex, model: gpt-x`
- **THEN** su llamada lleva ese motor y modelo, existe el span `zero.station.<nombre>` padre de su span de agente y job.station es su nombre durante la llamada

#### Scenario: Aislamiento
- **WHEN** el trabajo corre con la caja simulada
- **THEN** el agente corre por el runner de la caja sobre la copia clonada y su cambio llega a la rama publicada

### Requirement: Instrucciones desde fuera de la copia
Las instrucciones de un agente que escribe MUST leerse de line.repo (agentes de línea) o de la carpeta de la fábrica (globales), nunca de la copia de trabajo. Si el archivo no existe, el trabajo MUST fallar nombrando la ruta, sin llamar al agente.

#### Scenario: Build intenta cambiarlas
- **WHEN** build escribe otra versión de `.zero/agents/docs.md` en la copia
- **THEN** el agente `docs` recibe el texto del repositorio del dueño

#### Scenario: Falta el archivo
- **WHEN** el agente `type: build` no tiene archivo de instrucciones
- **THEN** el trabajo termina `failed`, el motivo contiene la ruta y el agente no fue llamado

### Requirement: Activación por archivos
Un agente `type: build` MAY declarar `files`, una lista de patrones glob. Con patrones, zero MUST llamarlo solo si algún archivo de copy.changedFiles coincide con posix.matchesGlob, sin contar los archivos de la especificación del trabajo (`openspec/changes/<cambio>/`). Si no coincide, MUST registrar su span con `zero.skipped: true` sin llamar al agente. Sin `files`, MUST correr siempre. `files` en un agente `review` MUST rechazarse en la configuración.

#### Scenario: Coincide
- **WHEN** un agente con `files: ['site/**']` corre y build cambió `site/index.html`
- **THEN** el agente es llamado

#### Scenario: No coincide
- **WHEN** build solo cambió `src/a.ts`
- **THEN** el agente no es llamado, el costo no aumenta por él y su span tiene `zero.skipped: true`

#### Scenario: Los archivos de la especificación no cuentan
- **WHEN** un agente con `files: ['**/*.md']` corre, en un repo con carpeta `openspec`, y build solo cambió `src/a.ts`
- **THEN** el agente no es llamado

#### Scenario: Incluye lo del agente anterior
- **WHEN** un agente anterior escribió `docs/x.md` y el siguiente tiene `files: ['docs/**']`
- **THEN** el siguiente es llamado

#### Scenario: Revisor con files
- **WHEN** se parsea `{ name: a11y, files: ['x'] }`
- **THEN** parseFactory lanza un error en español

### Requirement: Si falla, falla el intento
Si la llamada de un agente que escribe termina con ok false, zero MUST descartar sus cambios sin commitear y fallar el intento como cuando falla build: feedback que nombra al agente y vuelta a build, consumiendo el intento. Los agentes siguientes MUST NOT correr en ese intento.

#### Scenario: Falla y reintenta
- **WHEN** el agente `docs` devuelve ok false en su primera llamada, tras escribir `basura.txt`, y `i18n` va después
- **THEN** la siguiente llamada de build tiene un prompt que contiene `docs`, `i18n` no corrió en el intento 1, el trabajo se entrega en el intento 2 y la rama no contiene `basura.txt`

#### Scenario: Se agotan los intentos
- **WHEN** el agente falla en todos los intentos
- **THEN** el trabajo termina `failed` con el motivo de intentos agotados

### Requirement: Plan y presupuesto
Si el plan corta la llamada de un agente que escribe, zero MUST descartar sus cambios sin commitear y seguir con un reemplazo de su cadena si lo hay. Si no lo hay, el trabajo MUST volver a la cola con la misma cuenta de intentos y, al retomar, MUST seguir en ese agente sin rehacer build ni los agentes que ya terminaron. Si se agota el presupuesto del trabajo durante la llamada, MUST descartar sus cambios sin commitear y aplicar budgetStop, y al retomar MUST seguir en ese agente.

#### Scenario: Cuota sin reemplazo
- **WHEN** la llamada del agente `docs` vuelve con quota.limited y no hay reemplazo, y luego se corre otra vez runJob
- **THEN** la primera corrida deja el trabajo `queued`, con attempt 1 y station `docs`; la segunda lo entrega con build llamado 1 vez y docs 2 veces

#### Scenario: Cuota con reemplazo
- **WHEN** la llamada vuelve con quota.limited y fallback tiene otro motor disponible
- **THEN** el agente corre de nuevo con ese motor en el mismo intento

#### Scenario: Presupuesto
- **WHEN** la llamada del agente vuelve con budgetLimited en L2
- **THEN** el trabajo queda esperando con pregunta `budget-exceeded`; al aprobar, retoma en ese agente con build llamado 1 vez

### Requirement: zero agent muestra y elige el tipo
`zero agent add` MUST aceptar `--tipo review|build` (predeterminado review) y `--archivos <patrón>` repetible. Para `build` MUST escribir `type: build` y `files` en el archivo de la fábrica y crear una plantilla de instrucciones para un agente que escribe. MUST rechazar sin tocar nada un tipo desconocido, `--informativo` con `build` y `--archivos` con `review`. `agentList` y `zero agent list` MUST mostrar el tipo, los patrones y el orden real de la línea.

#### Scenario: Agregar uno que escribe
- **WHEN** se llama addAgent con name `docs`, line `web`, type `build` y files `['**/*.md']`
- **THEN** la fábrica recargada tiene el agente con type `build` y esos files, la plantilla no dice que es de solo lectura y el mensaje nombra el tipo

#### Scenario: Sin tipo
- **WHEN** se llama addAgent sin type
- **THEN** se comporta como hoy y el agente queda de tipo `review`

#### Scenario: Combinación inválida
- **WHEN** se llama addAgent con type `build` y blocking false, o con type `review` y files
- **THEN** la promesa se rechaza en español, y el archivo de la fábrica y la carpeta de instrucciones quedan igual

#### Scenario: Listado
- **WHEN** formatAgents recibe una línea con `docs` de tipo build y `a11y` de tipo review
- **THEN** el texto contiene `spec → build → docs → verify → review → security → a11y → integrate` y distingue el tipo de cada uno

#### Scenario: agentList
- **WHEN** se llama agentList
- **THEN** cada entrada trae `type` y `files`

### Requirement: El panel muestra el tipo
La página /agents del panel MUST listar, en la tarjeta de cada línea y en orden de ejecución, sus agentes a medida con su nombre y su tipo: los `build` marcados como que modifican el código y los `review` como de solo lectura, junto con sus patrones `files`. La vista /line MUST ubicar en la estación build a un trabajo que está en un agente que escribe, y en security a uno que está en un agente revisor.

#### Scenario: Guía del panel
- **WHEN** se pide /agents con una línea que tiene `docs` de tipo build con files y `a11y` de tipo review
- **THEN** la tarjeta de esa línea contiene ambos nombres, en orden, con su tipo y los patrones escapados

#### Scenario: Sin agentes
- **WHEN** la línea no tiene agentes a medida
- **THEN** la tarjeta lo dice y la página sigue pasando los tests existentes

#### Scenario: Vista de línea
- **WHEN** un trabajo tiene station `docs` y `docs` es de tipo build
- **THEN** productionLine lo ubica en la estación `build`

#### Scenario: Revisor en la vista
- **WHEN** un trabajo tiene station `a11y` y `a11y` es de tipo review
- **THEN** productionLine lo ubica en `security`, como hoy

### Requirement: Documentación
README.md y README.es.md MUST documentar los agentes que escriben, con la misma estructura y los mismos bloques de código: `type`, `files`, el lugar en la línea, qué pasa si fallan, los comandos y las garantías. La frase que hoy dice que los agentes a medida son de solo lectura MUST corregirse. AGENTS.md MUST reflejar el nuevo comportamiento.

#### Scenario: Dos idiomas
- **WHEN** corre test/docs.test.ts con los READMEs actualizados
- **THEN** pasa, y ambos READMEs contienen `type: build`, `files:` y `--tipo build` en sus bloques de código

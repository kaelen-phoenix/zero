# Spec Delta

## ADDED Requirements

### Requirement: Definición de agentes a medida
zero.factory.yaml SHALL aceptar una lista `agents` global y una lista `lines[].agents` por línea. Cada agente tiene `name` (minúsculas, dígitos y guiones), `instructions` (ruta relativa a un archivo .md; por defecto `.zero/agents/<name>.md`), `after` (solo `review` en esta parte, por defecto `review`), `access` (solo `read`), `blocking` (por defecto true), `engine`, `model`, `maxTurns` (40), `timeoutMinutes` (15) y `skills` (lista vacía). La carga MUST rechazar con un error en español: los nombres de estaciones fijas (spec, build, verify, review, security, integrate, reply, scout, research), los nombres repetidos dentro de las listas que valen para una misma línea, las rutas absolutas o con `..`, las rutas que no terminan en .md y los motores que no existen.

#### Scenario: Agente válido con valores por defecto
- **WHEN** se parsea una fábrica con lines[0].agents = [{name: 'a11y'}]
- **THEN** el agente queda con instructions '.zero/agents/a11y.md', after 'review', access 'read', blocking true, maxTurns 40, timeoutMinutes 15 y skills []

#### Scenario: Nombre de estación fija
- **WHEN** una línea define un agente llamado 'review'
- **THEN** parseFactory lanza ConfigError cuyo mensaje nombra el agente

#### Scenario: Ruta que sale del repo
- **WHEN** un agente tiene instructions '../fuera.md' o una ruta absoluta
- **THEN** parseFactory lanza ConfigError

#### Scenario: Nombre repetido entre global y línea
- **WHEN** agents global y lines[0].agents definen ambos 'docs'
- **THEN** parseFactory lanza ConfigError

#### Scenario: Acceso de escritura todavía no soportado
- **WHEN** un agente tiene access 'write'
- **THEN** parseFactory lanza ConfigError

### Requirement: Agentes a medida revisan después de review y security
Después de que review y security aprueban un intento, el runner MUST correr los agentes a medida de la línea (primero los globales y después los de la línea, cada grupo en el orden del archivo). Cada uno recibe el pedido, la especificación y la instrucción de revisar `git diff <base>...HEAD`, y MUST responder con el mismo esquema de review (resumen, hallazgos, aprendizajes). Sus citas se verifican con checkCitations y sus aprendizajes van al townhall.

#### Scenario: Orden de ejecución
- **WHEN** una línea tiene un agente global 'docs' y un agente de línea 'a11y', y un trabajo pasa review y security
- **THEN** los agentes registrados por el agente falso son, en este orden: build, review, security, docs, a11y, y el trabajo se entrega

#### Scenario: Línea sin agentes a medida
- **WHEN** no hay agentes configurados
- **THEN** la secuencia de estaciones es la de hoy (build, review, security) y el trabajo se entrega igual que antes

### Requirement: Agente bloqueante frena el trabajo
Si un agente a medida con blocking true devuelve hallazgos high o critical con citas válidas, el runner MUST tratar el intento como rechazado: guarda un feedback que nombra al agente y lista los hallazgos, y vuelve a build. Los agentes que siguen en la lista no corren en ese intento. Si el agente no completa la revisión (respuesta inválida dos veces), el intento MUST fallar como cuando review no puede completarse.

#### Scenario: Hallazgo grave verificado
- **WHEN** el agente bloqueante 'a11y' devuelve un hallazgo critical que cita un archivo y una línea existentes en la copia
- **THEN** el intento falla, el feedback del trabajo contiene 'a11y' y el problema, y build corre otra vez con ese feedback

#### Scenario: Cita inventada no bloquea
- **WHEN** el agente bloqueante solo devuelve un hallazgo critical que cita un archivo inexistente
- **THEN** el trabajo se entrega sin otro intento

### Requirement: Agente informativo no frena
Un agente a medida con blocking false MUST NOT rechazar el intento, sean cuales sean sus hallazgos. Sus hallazgos válidos se cuentan en su span y sus aprendizajes van al townhall.

#### Scenario: Hallazgo crítico informativo
- **WHEN** un agente con blocking false devuelve un hallazgo critical con cita válida
- **THEN** el trabajo se entrega en el primer intento y el span del agente tiene zero.findings = 1

### Requirement: Los agentes a medida son de solo lectura
Zero MUST correr los agentes a medida con acceso de lectura (en la caja, con montaje ro) y MUST descartar cualquier cambio que dejen en la copia de trabajo antes de seguir, igual que con review.

#### Scenario: Agente que escribe
- **WHEN** el agente falso de un agente a medida escribe un archivo en la copia de trabajo
- **THEN** el archivo no está en la rama entregada y el agente recibió access 'read'

### Requirement: Instrucciones del repo de la línea o de la fábrica
Las instrucciones de un agente de línea MUST leerse de `instructions` dentro de la copia del dueño (`line.repo`). Las de un agente global MUST leerse relativas a la carpeta de zero.factory.yaml. Nunca se leen de la copia de trabajo del trabajo ni de la web. Si falta el archivo de un agente bloqueante, el trabajo MUST terminar fallido (por finalizeJob) con un motivo que nombra la ruta, sin gastar intentos. Si falta el de un agente informativo, ese agente se saltea con una advertencia en el log y en su span.

#### Scenario: El trabajo no puede escribir sus propias instrucciones
- **WHEN** build escribe .zero/agents/a11y.md en la copia de trabajo con otro texto
- **THEN** el agente a11y recibe las instrucciones del archivo en line.repo, no las de la copia

#### Scenario: Falta el archivo de un bloqueante
- **WHEN** un agente bloqueante apunta a un archivo que no existe en line.repo
- **THEN** el trabajo termina failed y su motivo contiene la ruta

#### Scenario: Falta el archivo de un informativo
- **WHEN** un agente informativo apunta a un archivo que no existe
- **THEN** el trabajo se entrega y el agente no se llamó

### Requirement: Instrucciones extra por línea para las estaciones fijas
Cuando una estación fija (spec, build, review, security, reply, scout, research) corre para una línea cuya copia del dueño tiene `.zero/agents/<estación>.md`, el agente MUST recibir las instrucciones de zero (agents/<estación>.md) seguidas de una sección que marca el texto como adiciones del proyecto que no pueden contradecir ni relajar las reglas de arriba. El archivo MUST leerse de line.repo y nunca de la copia de trabajo. Sin archivo, las instrucciones quedan idénticas a las de hoy.

#### Scenario: Adición a build
- **WHEN** line.repo tiene .zero/agents/build.md con 'Usá siempre pnpm'
- **THEN** las instrucciones que recibe el motor en build empiezan con el texto de agents/build.md y contienen 'Usá siempre pnpm' después

#### Scenario: Sin adición
- **WHEN** line.repo no tiene .zero/agents/review.md
- **THEN** las instrucciones de review son exactamente las de agents/review.md

#### Scenario: Adición escrita por el trabajo
- **WHEN** solo la copia de trabajo tiene .zero/agents/review.md
- **THEN** review recibe exactamente agents/review.md

### Requirement: Las garantías fijas no se pueden apagar
Los agentes a medida MUST sumarse a la línea sin reemplazar ni saltear spec, build, verify, review, security, las rutas protegidas ni la puerta de salida. El esquema MUST NOT ofrecer ningún campo que deshabilite una estación fija.

#### Scenario: Rutas protegidas siguen vigentes
- **WHEN** una línea con agentes a medida tiene un cambio que toca .github/workflows en L3
- **THEN** verify rechaza el intento por ruta protegida como hoy y los agentes a medida no corren en ese intento

### Requirement: Motor, presupuesto, trazas y estado de los agentes a medida
Cada agente a medida MUST correr con su `engine` (o el de la fábrica), `model`, `maxTurns`, `timeoutMinutes` y skills, con la cola global `fallback` como reemplazos, con el tope de dinero del trabajo como las demás estaciones. Su llamada MUST registrar un span `zero.station.<name>` con `zero.station` = nombre y un span de agente con `gen_ai.agent.name` = nombre, y el trabajo MUST mostrar `station` = nombre mientras corre. Un trabajo interrumpido en un agente a medida MUST retomar en los agentes a medida sin volver a construir. Las credenciales de la caja MUST incluir los motores de los agentes a medida.

#### Scenario: Traza con el nombre
- **WHEN** corre el agente a medida 'seo'
- **THEN** el store tiene un span de agente con gen_ai.agent.name 'seo' bajo un span zero.station.seo

#### Scenario: Motor propio
- **WHEN** un agente a medida tiene engine 'codex'
- **THEN** el runner de agentes recibe engine.name 'codex' para ese agente, y el conjunto de motores que necesita la caja incluye codex

#### Scenario: Plan agotado
- **WHEN** la llamada de un agente a medida vuelve con quota.limited y no hay reemplazo
- **THEN** el trabajo vuelve a la cola sin gastar el intento

### Requirement: Comandos zero agent
La CLI SHALL ofrecer `zero agent list [--line <línea>]`, `zero agent add <nombre> --line <línea> [--informativo]` y `zero agent remove <nombre> --line <línea>`, implementados en app.ts y editando zero.factory.yaml con editFactory (sin perder comentarios). `add` MUST crear `.zero/agents/<nombre>.md` en line.repo con una plantilla en inglés si no existe (y nunca pisarlo si existe), y agregar el agente a lines[].agents. `remove` MUST quitarlo de la configuración sin borrar el archivo. `list` MUST mostrar, en español y en orden, los agentes que valen para cada línea, con su modo (bloqueante o informativo) y si falta su archivo.

#### Scenario: Agregar
- **WHEN** se llama addAgent con name 'a11y' y line 'web' sobre una fábrica de prueba
- **THEN** existe line.repo/.zero/agents/a11y.md, la fábrica recargada tiene lines[web].agents con 'a11y' blocking true y los comentarios del yaml se conservan

#### Scenario: No pisa un archivo existente
- **WHEN** ya existe .zero/agents/a11y.md con contenido propio y se agrega el agente
- **THEN** el archivo conserva su contenido

#### Scenario: Nombre reservado
- **WHEN** se llama addAgent con name 'build'
- **THEN** lanza un error en español y el yaml no cambia

#### Scenario: Quitar
- **WHEN** se llama removeAgent para 'a11y' en 'web'
- **THEN** la fábrica ya no lo tiene y el archivo de instrucciones sigue existiendo

#### Scenario: Listar
- **WHEN** se llama agentList para una línea con un agente global y uno de línea
- **THEN** el resultado tiene los dos en orden global y después de línea, con blocking y missing

### Requirement: Documentación
README.md (inglés) y README.es.md (español) MUST incluir una sección sobre agentes a medida con un ejemplo completo idéntico en ambos (un bloque yaml con lines[].agents y el contenido de un .zero/agents/<nombre>.md), y explicar las instrucciones extra para estaciones fijas y las garantías. test/docs.test.ts MUST seguir pasando.

#### Scenario: Paridad
- **WHEN** corre npm test
- **THEN** test/docs.test.ts pasa y los dos READMEs contienen 'lines' con 'agents:' en el mismo bloque yaml

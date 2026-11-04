# Spec Delta

## Purpose

zero te va a hablar directo, con voseo, en el panel, la consola, el chat y el informe: "Te necesita" en lugar de "Necesita al dueño", "Lo detuviste vos" en lugar de "Detenido por el dueño". Donde el texto lo lee otra persona (issues y comentarios de GitHub, el informe mensual para un cliente, la documentación, partes del sitio) va a decir "la persona responsable" o "quien está a cargo". En inglés, "you" y "the person in charge". La figura del hero del sitio va a decir "vos" / "you". El código, la configuración (por ejemplo `commitAuthor: owner`) y las instrucciones de los agentes siguen diciendo owner, aunque los agentes que escriben textos que vas a leer reciben una regla para no usar esa palabra. Una prueba automática evita que la palabra vuelva a aparecer.

## ADDED Requirements

### Requirement: Sin la palabra en lo que se muestra
El código de src/, site/index.html, site/main.js, README.es.md y los archivos de docs/ MUST NOT contener la palabra "dueño" ni "dueña" en ninguna forma.

#### Scenario: Barrido de textos
- **WHEN** una prueba recorre src/**/*.ts, site/index.html, site/main.js, README.es.md y docs/**/*.md buscando /dueñ/i
- **THEN** no encuentra ninguna coincidencia

### Requirement: Sin owner en la prosa en inglés
README.md y los textos en inglés del sitio (los valores del diccionario EN de site/main.js) MUST NOT usar la palabra "owner" como prosa; solo puede quedar dentro de bloques de código, código en línea o nombres internos como la clave fig.owner y las clases CSS owner y owner-label.

#### Scenario: README en inglés
- **WHEN** una prueba quita de README.md los bloques de código cercados y el código en línea y busca /\bowner/i
- **THEN** no encuentra ninguna coincidencia

#### Scenario: Sitio en inglés
- **WHEN** una prueba carga el diccionario EN del sitio y busca /\bowner/i en sus valores
- **THEN** no encuentra ninguna coincidencia y fig.owner vale "you"

### Requirement: Figura del hero
La figura del hero SHALL rotular a la persona como "vos" en español y "you" en inglés, y su descripción accesible SHALL hablarle en segunda persona.

#### Scenario: Rótulo en español
- **WHEN** se lee el texto con data-i18n="fig.owner" en site/index.html
- **THEN** su contenido es "vos", y conserva la clase owner-label

#### Scenario: Descripción
- **WHEN** se leen la descripción fig.desc en español y en inglés
- **THEN** la española contiene "vos" y "decidís", la inglesa contiene "you" y ambas siguen nombrando las seis estaciones

### Requirement: Motivo de detención en segunda persona
Un trabajo detenido por la persona desde el panel, la consola, el chat o el daemon SHALL guardar el motivo "Lo detuviste vos.".

#### Scenario: Parada durante una ejecución
- **WHEN** se aborta un trabajo en curso con la señal stop
- **THEN** runJob devuelve status stopped y reason "Lo detuviste vos."

### Requirement: Motivo de rechazo en segunda persona
Un trabajo rechazado por la persona SHALL guardar el motivo "Lo rechazaste vos" seguido de su nota cuando la hay.

#### Scenario: Rechazo con nota
- **WHEN** se responde reject con la nota "no era esto" a un trabajo que espera
- **THEN** el trabajo queda stopped con reason "Lo rechazaste vos: no era esto"

### Requirement: Motivos en tercera persona hacia afuera
Cuando un motivo guardado se publica o llega a otros lectores (comentario de issue, datos para la estación reply, pedido de seguimiento, publicación en el townhall), zero MUST reescribir "Lo detuviste vos" como "Lo detuvo la persona responsable" y "Lo rechazaste vos" como "Lo rechazó la persona responsable", sin dejar el trato de vos.

#### Scenario: Comentario de issue de un trabajo detenido
- **WHEN** un trabajo de un issue termina stopped con reason "Lo detuviste vos." y se calcula su comentario
- **THEN** el cuerpo dice "Lo detuvo la persona responsable" y no contiene "detuviste" ni termina en dos puntos seguidos

#### Scenario: Función de reescritura
- **WHEN** se aplica a "Lo rechazaste vos: no era esto" y a un motivo ajeno como "La rama está en conflicto"
- **THEN** devuelve "Lo rechazó la persona responsable: no era esto" y deja el motivo ajeno igual

#### Scenario: Townhall
- **WHEN** finaliza un trabajo con reason "Lo detuviste vos."
- **THEN** la publicación del townhall usa "Lo detuvo la persona responsable."

### Requirement: Informe diario
La sección del briefing con lo que requiere atención SHALL titularse "Te necesita".

#### Scenario: Encabezado
- **WHEN** se genera el briefing
- **THEN** contiene "## Te necesita"

### Requirement: Issues de propuestas en tercera persona
Los issues y comentarios de propuestas que publica la fábrica SHALL nombrar a quien decide como "la persona responsable" o "quien está a cargo".

#### Scenario: Aprobación
- **WHEN** se aprueba una propuesta desde la fábrica y se publica el comentario
- **THEN** contiene "La persona responsable aprobó esta propuesta"

#### Scenario: Aprobación del turno nocturno
- **WHEN** el turno nocturno toma una propuesta por su cuenta
- **THEN** el comentario no dice "La persona responsable aprobó" y, en autonomía build, dice "hasta que la persona responsable la apruebe"

#### Scenario: Rechazo
- **WHEN** se rechaza una propuesta y se publica el comentario
- **THEN** contiene "La persona responsable rechazó esta propuesta"

#### Scenario: Issue de registro
- **WHEN** se genera el cuerpo de un issue con autonomía build o auto
- **THEN** contiene "Quien está a cargo puede rechazarla"

### Requirement: Informe mensual en tercera persona
El origen de cada trabajo en el informe mensual SHALL nombrar a la persona en tercera persona, porque lo lee un cliente.

#### Scenario: Orígenes
- **WHEN** el informe lista un pedido directo y una propuesta aprobada
- **THEN** los orígenes son "Pedido de la persona responsable" y "Propuesta del turno nocturno aprobada por la persona responsable"

### Requirement: Lección de reversión
La lección que deja detectReverts en el townhall SHALL decir que quien está a cargo revirtió el cambio.

#### Scenario: Texto de la lección
- **WHEN** se detecta la reversión de una integración del turno nocturno
- **THEN** la publicación "propuesta revertida" contiene "quien está a cargo la revirtió"

### Requirement: READMEs paralelos
README.md y README.es.md MUST conservar la misma estructura y usar el lema con "you decide where to step back in" y "vos decidís dónde volver a entrar".

#### Scenario: Lema
- **WHEN** se ejecuta test/docs.test.ts
- **THEN** los dos READMEs contienen su versión del lema y las pruebas de estructura siguen pasando

### Requirement: Agentes que escriben para personas
Las instrucciones de spec, scout, research y reply SHALL pedir que "owner" se traduzca como "vos" al dirigirse al lector, o como "la persona responsable" o "quien está a cargo" en tercera persona, y como "you" o "the person in charge" en inglés, sin nombrar la palabra prohibida.

#### Scenario: Regla presente
- **WHEN** una prueba lee agents/spec.md, agents/scout.md, agents/research.md y agents/reply.md
- **THEN** cada archivo contiene "la persona responsable" y "the person in charge" y ninguno contiene /dueñ/i

### Requirement: Nombres internos intactos
El valor de configuración commitAuthor owner, decidedBy owner, las clases CSS, las claves i18n y los identificadores de código MUST seguir funcionando sin cambios.

#### Scenario: Pruebas existentes
- **WHEN** se ejecutan npm run typecheck y npm test
- **THEN** pasan, incluidas test/commit-author.test.ts y la comprobación class="owner" de test/site.test.ts

# Spec Delta

## Purpose

Se quita de zero la prueba de concepto de publicación en redes sociales, que no era parte del núcleo de la fábrica: su estación, sus comandos, su configuración, sus dependencias, sus pruebas y su documentación. Si tu archivo de la fábrica todavía tiene esa configuración, sigue cargando y zero solo avisa que la ignora. Tus datos no se tocan: lo ya guardado en state.db queda donde está. Los paquetes de agentes funcionan igual que antes.

## ADDED Requirements

### Requirement: La estación community ya no existe
zero MUST NOT define ni ejecutar la estación `community`: no figura en `FIXED_STATIONS`, `AGENT_STATIONS`, `SKILL_STATIONS`, `AGENT_ACCESS` ni `IDLE_STATIONS`, y el daemon no la corre en `idlePasses`.

#### Scenario: Lista de estaciones
- **WHEN** se leen `AGENT_STATIONS` y `SKILL_STATIONS`
- **THEN** son exactamente spec, build, review, security, reply, scout y research, en ese orden

#### Scenario: Vuelta ociosa del daemon
- **WHEN** el daemon corre sus pasadas con la fábrica libre usando un agente falso
- **THEN** ninguna llamada de agente tiene la estación `community`, y scout, research y las estaciones de paquetes corren como antes

#### Scenario: Nombre libre
- **WHEN** el archivo de la fábrica define un agente propio llamado `community`
- **THEN** el archivo carga sin error, porque el nombre ya no está reservado

### Requirement: Archivo con configuración vieja
`parseFactory` SHALL aceptar un archivo que todavía tenga `social`, `lines[].social`, `stations.community` o `lines[].stations.community`, ignorar esas claves y registrar un aviso una sola vez por proceso, sin importar cuántas veces se cargue el archivo.

#### Scenario: Clave global
- **WHEN** se parsea un archivo con `social: off` o con `social: { postsPerDay: 2 }`
- **THEN** no lanza error, el resultado no tiene la clave `social` y `log.warn` se llamó con un aviso que nombra la clave ignorada

#### Scenario: Clave por línea
- **WHEN** se parsea un archivo cuya línea tiene `social: { enabled: true }` y `stations: { community: { skills: [x] } }`
- **THEN** no lanza error, aunque `lines[].stations` siga siendo estricto, y la línea no conserva esas claves

#### Scenario: Otra estación de línea desconocida
- **WHEN** se parsea un archivo cuya línea tiene `stations: { noexiste: {} }`
- **THEN** sigue lanzando `ConfigError`

#### Scenario: Aviso único
- **WHEN** se parsea dos veces en el mismo proceso un archivo con `social`
- **THEN** el aviso se registra una sola vez

#### Scenario: Credencial en la clave vieja
- **WHEN** se parsea un archivo con una forma de credencial dentro de `social`
- **THEN** sigue lanzando `ConfigError`, como con cualquier otra parte del archivo

#### Scenario: Edición conservando el archivo
- **WHEN** `editFactory` edita otra clave de un archivo que tiene `social`
- **THEN** la edición funciona y la clave `social` queda escrita tal cual en el archivo

### Requirement: Comandos quitados
La CLI MUST NOT ofrecer `zero social`: el comando se trata como cualquier otro comando desconocido y no aparece en la ayuda.

#### Scenario: Comando viejo
- **WHEN** se corre `zero social status`
- **THEN** termina como un comando desconocido, con código distinto de 0 y sin tocar el estado

#### Scenario: Ayuda
- **WHEN** se imprime la ayuda de la CLI
- **THEN** no contiene `zero social` ni nombra `community` entre los agentes

### Requirement: Panel, chat y estado sin publicaciones
El panel, el chat y `zero status` MUST NOT mostrar la estación `community` ni datos de publicaciones.

#### Scenario: Guía de agentes
- **WHEN** se arma `factoryGuide` y se renderiza la página `/agents` del panel
- **THEN** las estaciones son las siete que quedan y la página no contiene `community`

### Requirement: Los datos existentes no se tocan
zero MUST NOT borrar ni modificar la tabla `social_posts` de un `state.db` existente, y ningún código SHALL leerla, escribirla ni crearla.

#### Scenario: Base existente
- **WHEN** se abre con `Store` un `state.db` que ya tiene `social_posts` con filas, y se cierra
- **THEN** la tabla y sus filas siguen iguales

#### Scenario: Base nueva
- **WHEN** se crea un `state.db` nuevo con `Store`
- **THEN** la base no tiene la tabla `social_posts`

#### Scenario: Sin código que la use
- **WHEN** se busca `social_posts` en `src/`
- **THEN** no hay ninguna coincidencia

### Requirement: Los paquetes de agentes no cambian
Las estaciones de paquetes SHALL seguir recibiendo en `ctx.deliveredJobs` el mismo texto filtrado que antes, sin secretos, rutas locales, ids ni ramas, aunque `src/social/` ya no exista.

#### Scenario: Filtro conservado
- **WHEN** se corren las pruebas de `test/packages.test.ts` y las del filtro de texto, movidas junto con la función
- **THEN** pasan sin cambiar sus expectativas

#### Scenario: Patrones de credenciales
- **WHEN** `findSecret` recibe un texto con la forma `IGAA…` o `EAA…`
- **THEN** lo sigue reconociendo como credencial

#### Scenario: Carpeta quitada
- **WHEN** se busca `social/` en los imports de `src/` y `test/`
- **THEN** no hay ninguna coincidencia

### Requirement: Dependencias quitadas
`package.json` y `package-lock.json` MUST NOT incluir como dependencias directas `@resvg/resvg-js`, `@expo-google-fonts/anton`, `dejavu-fonts-ttf` ni `jpeg-js`.

#### Scenario: Manifiesto
- **WHEN** se leen `dependencies` en `package.json` y el paquete raíz en `package-lock.json`
- **THEN** ninguno de los cuatro aparece, y `npm run build` y `npm test` pasan

### Requirement: Documentación sin la prueba de concepto
`README.md`, `README.es.md`, `AGENTS.md`, `agents/` y `docs/revision-linea-produccion.md` MUST NOT describir la estación, sus comandos ni su configuración, y los dos README SHALL conservar la misma estructura.

#### Scenario: README
- **WHEN** `test/docs.test.ts` lee los dos README
- **THEN** no tienen las secciones `## Social media` ni `## Redes sociales`, ni los textos `zero social` o `INSTAGRAM_ACCESS_TOKEN`, y las comparaciones de estructura entre ambos pasan

#### Scenario: Instrucciones de agentes
- **WHEN** se leen los archivos de `agents/`
- **THEN** no existen `community.md` ni `community-style.md`, y `research.md` no nombra `community`

#### Scenario: Guía del repositorio
- **WHEN** se lee `AGENTS.md`
- **THEN** no nombra `src/social/`, `src/line/community.ts` ni `communityPass`, y describe el orden real de `idlePasses`

# Spec Delta

## Purpose

Memoria colectiva de la red de agentes de una fábrica: lo que cada trabajo aprende queda disponible para los siguientes, y el dueño recibe un informe de producción, aprendizajes y decisiones pendientes.

## ADDED Requirements

### Requirement: Publicación de notas por línea
Cada trabajo SHALL publicar en el townhall su resultado, los hallazgos y lecciones de sus agentes, las propuestas de trabajo nuevo y, si falla, un bloqueo. Cada nota SHALL indicar la línea y el trabajo de origen.

#### Scenario: Trabajo con aprendizajes
- **WHEN** la estación `spec` devuelve un hallazgo sobre el repositorio
- **THEN** el townhall contiene una nota `finding` con la línea y el trabajo

### Requirement: Memoria en los prompts
Las estaciones `spec` y `build` SHALL recibir las notas recientes `lesson`, `finding` y `blocker` de su misma línea.

#### Scenario: Línea distinta
- **WHEN** existen lecciones de la línea `web` y el trabajo es de la línea `api`
- **THEN** el prompt del trabajo no incluye las lecciones de `web`

### Requirement: Notas limpias
Antes de guardarse, las notas SHALL tener los secretos reconocibles reemplazados por `[REDACTED]`, y MUST NOT guardarse dos notas iguales (mismo tipo, línea, tema y texto).

#### Scenario: Secreto en una nota
- **WHEN** una lección contiene un token `ghp_…`
- **THEN** la nota guardada muestra `[REDACTED]` en su lugar

### Requirement: El townhall no detiene la producción
Un fallo al leer o escribir el townhall MUST NOT hacer fallar un trabajo.

#### Scenario: Almacenamiento no disponible
- **WHEN** el townhall no puede escribirse
- **THEN** el trabajo termina con su resultado normal y el fallo queda registrado

### Requirement: Informe para el dueño
zero SHALL generar sin usar modelos un informe de un período con producción, costo, lo que necesita al dueño y lo aprendido.

#### Scenario: Sin pendientes
- **WHEN** en el período no hubo bloqueos ni consultas
- **THEN** el informe indica que la fábrica funcionó sola

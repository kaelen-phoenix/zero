# Spec Delta

## Purpose

La descripción de package.json va a dejar de decir "Kaelen Global Defence… Zero human intervention required" y va a contar lo mismo que el README: una fábrica de software de código abierto que corre en tu máquina, convierte pedidos en cambios entregados y donde vos decidís dónde volver a entrar. Además, las pruebas de documentación van a revisar ese campo, así que el lema viejo no puede volver sin que falle una prueba. No se tocan dependencias ni el lockfile.

## ADDED Requirements

### Requirement: Descripción de package.json alineada con el README
The `description` field of package.json MUST be exactly "An open source software factory that runs on your machine: it turns requests into delivered changes, and you decide where to step back in."

#### Scenario: descripción nueva
- **WHEN** package.json is parsed as JSON
- **THEN** its `description` equals "An open source software factory that runs on your machine: it turns requests into delivered changes, and you decide where to step back in."

### Requirement: Descripción de package.json sin términos prohibidos
test/docs.test.ts SHALL fail when the `description` field of package.json contains 'Kaelen' (case-insensitive) or 'Zero human intervention required', while the package `name` `@kaelen/zero` stays allowed because it is an identifier.

#### Scenario: la descripción actual pasa la comprobación
- **WHEN** the test suite in test/docs.test.ts runs against the updated package.json
- **THEN** the test parses package.json, asserts its `description` does not match /kaelen/i and does not contain 'Zero human intervention required', and passes, with `name` still `@kaelen/zero`

#### Scenario: el lema viejo no pasaría
- **WHEN** the same assertions are applied to the old text 'Kaelen Global Defence: autonomous agent network. Continuous execution. Zero human intervention required.'
- **THEN** they do not hold: the text matches /kaelen/i and contains 'Zero human intervention required'

### Requirement: Cambio limitado a la descripción de package.json
The change MUST leave every package.json field other than `description` unchanged, and MUST NOT modify package-lock.json.

#### Scenario: sin otros cambios
- **WHEN** the diff of the job is inspected against its base
- **THEN** the only changed line in package.json is the `description` line and package-lock.json has no changes

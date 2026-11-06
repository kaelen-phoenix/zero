# Proposal

## Why

La descripción de package.json va a dejar de decir "Kaelen Global Defence… Zero human intervention required" y va a contar lo mismo que el README: una fábrica de software de código abierto que corre en tu máquina, convierte pedidos en cambios entregados y donde vos decidís dónde volver a entrar. Además, las pruebas de documentación van a revisar ese campo, así que el lema viejo no puede volver sin que falle una prueba. No se tocan dependencias ni el lockfile.

## What Changes

- Descripción de package.json sin el lema viejo ni el nombre Kaelen
- Supuesto: Assumption: the request's sentence was given as an example and says 'the owner decides'. The spec uses 'you decide where to step back in' instead, because AGENTS.md requires 'you' or 'the person in charge' in what a person reads, and it matches the README's motto.
- Supuesto: package.json has `private: true`, so the package is not published to npm, and GitHub takes a repository's About text from its own settings, not from package.json. This change alone may not change what is shown there.
- Supuesto: The `@kaelen/zero` package name stays, as an earlier change (zero-3e948e4d) decided it is a real identifier, so the word Kaelen remains in package.json and the check must apply only to `description`.

## Capabilities

### New Capabilities
- `project-docs`: Descripción de package.json sin el lema viejo ni el nombre Kaelen

### Modified Capabilities

## Impact

Generado por zero para el trabajo 5b932851.

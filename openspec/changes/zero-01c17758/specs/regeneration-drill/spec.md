# Spec Delta

## Purpose

Hoy cada `zero simulacro` deja para siempre una copia completa del proyecto en `ZERO_HOME/drills/<id>/copy`, a veces con `node_modules` incluido, y el disco se va llenando sin aviso. Con este cambio, cuando termina el simulacro se borra esa copia y queda solo lo que importa: `informe.md` y `resultado.json`. El informe dice si la copia se borró o dónde quedó. Si querés revisar la copia, agregá `--conservar` (`zero simulacro <línea> <capacidad> --archivos ... --conservar`) y no se borra. Si el borrado falla, el resultado del simulacro no cambia: el problema solo queda anotado en el log, con la carpeta que no se pudo borrar.

## ADDED Requirements

### Requirement: La copia de trabajo se borra al terminar
Por defecto, `runDrill` MUST borrar `<ZERO_HOME>/drills/<id>/copy` cuando termina, después de escribir `informe.md` y `resultado.json`. El borrado MUST ir en un `finally`, así también corre cuando el simulacro falla después de crear la copia. `informe.md` y `resultado.json` MUST quedar en `<ZERO_HOME>/drills/<id>/`.

#### Scenario: Solo queda el informe
- **WHEN** se corre `regenerationDrill` con un agente falso que reconstruye el archivo, sin la opción de conservar
- **THEN** `<ZERO_HOME>/drills/<id>/copy` ya no existe, `informe.md` existe y tiene el resultado (`alcanzan`), y `resultado.json` se puede leer como JSON con `outcome` `alcanzan`

#### Scenario: La copia se borra aunque el agente falle
- **WHEN** el agente falso devuelve `ok: false`
- **THEN** el resultado es `no alcanzan`, el informe existe y la carpeta `copy` ya no existe

### Requirement: Un fallo al borrar no tapa el resultado
Si falla el borrado de la copia, `runDrill` MUST devolver el mismo `DrillResult` que sin el fallo y no lanzar ningún error. El fallo MUST registrarse solo con `log.warn` de `src/log.ts`, nombrando la carpeta y el mensaje de error. El borrado MUST poder inyectarse en los tests (`DrillDeps.removeCopy`, pasado también por los deps de `regenerationDrill`).

#### Scenario: Borrado que falla
- **WHEN** se corre el simulacro con un `removeCopy` falso que lanza `Error('EBUSY')`
- **THEN** `regenerationDrill` resuelve con `outcome` `alcanzan`, `informe.md` y `resultado.json` existen, y el log (console.error espiado) tiene una línea `warn` que contiene la ruta de la copia y `EBUSY`

### Requirement: El informe dice qué pasó con la copia
`DrillResult` MUST incluir si la copia se conserva (`copyKept: boolean`). `drillMarkdown` MUST tener una línea `Copia de trabajo:` que diga que se borra al terminar el simulacro o, si se conservó, en qué ruta está.

#### Scenario: Copia borrada
- **WHEN** se corre el simulacro sin la opción de conservar
- **THEN** `informe.md` contiene `Copia de trabajo:` y la palabra `borr`, y `resultado.json` tiene `copyKept: false`

#### Scenario: Copia conservada
- **WHEN** se corre el simulacro con `keep: true`
- **THEN** `informe.md` contiene `Copia de trabajo:` y la ruta `<ZERO_HOME>/drills/<id>/copy`, y `resultado.json` tiene `copyKept: true`

### Requirement: Opción --conservar
`zero simulacro` MUST aceptar el flag booleano `--conservar`, que pasa `keep: true` a `regenerationDrill` (`DrillRequest.keep`) y de ahí a `runDrill` (`DrillInput.keep`). Con `keep: true`, la copia MUST quedar entera en `<ZERO_HOME>/drills/<id>/copy`. La línea de uso del CLI MUST ser ` zero simulacro <línea> <capacidad> --archivos <patrón>... [--usd N] [--conservar]`.

#### Scenario: Se conserva la copia
- **WHEN** se corre `regenerationDrill` con `keep: true` y la línea tiene un verify que escribe `verify.mark`
- **THEN** `<ZERO_HOME>/drills/<id>/copy` existe y contiene `verify.mark` y el archivo reconstruido

#### Scenario: Ayuda del CLI
- **WHEN** se lee src/cli.ts
- **THEN** contiene una línea igual a ` zero simulacro <línea> <capacidad> --archivos <patrón>... [--usd N] [--conservar]`

### Requirement: Documentado en los dos README (01c17758)
README.md y README.es.md MUST explicar en su sección del simulacro que la copia se borra al terminar y que `--conservar` la mantiene. El bloque de código MUST ser el mismo en los dos e incluir un ejemplo con `--conservar`.

#### Scenario: Los README coinciden
- **WHEN** corren test/docs.test.ts y test/drill.test.ts
- **THEN** pasan, y los dos README contienen `--conservar`

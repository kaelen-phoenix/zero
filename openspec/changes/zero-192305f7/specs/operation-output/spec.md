# Spec Delta

## Purpose

El simulacro de regeneración (`zero simulacro`) deja en ZERO_HOME una carpeta `drills/<id>/` con una copia del repositorio, un `informe.md` y un `resultado.json`. Hoy, si un trabajo mete eso en el repositorio de una línea, la verificación lo deja pasar. Con este cambio, la verificación rechaza el intento y nombra cada archivo con el motivo «simulacro de regeneración» (o «carpeta de ZERO_HOME» si está bajo `.zero/drills/`). Se rechaza en tres casos: cuando aparece una carpeta `drills/<id>/` con el informe o el resultado (incluida la copia del repositorio que va con ellos), cuando aparecen juntos `informe.md` y `resultado.json` en la misma carpeta, y cuando algo está bajo `.zero/drills/`. Un `informe.md` suelto sigue pasando, igual que el código que se llame parecido. Si una línea versiona esos archivos a propósito, se pueden permitir con `allowedArtifacts`.

## ADDED Requirements

### Requirement: Carpeta de simulacros de ZERO_HOME
zero MUST treat any added file under `.zero/drills/` (at any depth, case-insensitive) as factory operation output with the reason `carpeta de ZERO_HOME`, like the other ZERO_HOME folders.

#### Scenario: Archivo bajo .zero/drills
- **WHEN** `operationArtifacts` evaluates the added files `.zero/drills/abc/informe.md` and `x/.ZERO/Drills/abc/copy/src/a.ts`
- **THEN** both are flagged and the reason of each is `carpeta de ZERO_HOME`

### Requirement: Carpeta de un simulacro
When the added files include `informe.md` or `resultado.json` (case-insensitive) directly inside a folder whose path ends in `drills/<id>` (any depth, any `<id>` without `/`), zero MUST flag every added file under that `drills/<id>/` folder, including the repository copy, with the reason `simulacro de regeneración`, unless an earlier shape already gives a reason.

#### Scenario: Simulacro copiado entero
- **WHEN** a change adds `drills/a1b2/informe.md`, `drills/a1b2/resultado.json`, `drills/a1b2/copy/src/app.ts` and `drills/a1b2/copy/package.json`
- **THEN** `operationArtifacts` flags all four and the reason of `drills/a1b2/copy/src/app.ts` is `simulacro de regeneración`

#### Scenario: Solo el resultado
- **WHEN** a change adds `ops/drills/x9/resultado.json` and `ops/drills/x9/copy/README.md`
- **THEN** both are flagged with the reason `simulacro de regeneración`

#### Scenario: Código en una carpeta drills
- **WHEN** a change adds `src/drills/index.ts` and `drills/a1b2/notes.md`, with no `informe.md` or `resultado.json` directly inside `drills/a1b2/`
- **THEN** neither is flagged

### Requirement: Par informe y resultado
When a change adds both `informe.md` and `resultado.json` (case-insensitive) directly inside the same folder, at any depth or at the root, zero MUST flag both with the reason `simulacro de regeneración`.

#### Scenario: Par fuera de drills
- **WHEN** a change adds `docs/Informe.md` and `docs/resultado.json`
- **THEN** `operationArtifacts` flags both and the reason of each is `simulacro de regeneración`

#### Scenario: Par en carpetas distintas
- **WHEN** a change adds `a/informe.md` and `b/resultado.json`
- **THEN** neither is flagged

### Requirement: Informe suelto y archivos permitidos
An `informe.md` or `resultado.json` added on its own, outside a `drills/<id>/` folder and without its pair in the same folder, MUST NOT be flagged by these rules, and the line's `allowedArtifacts` MUST exclude matching paths from the simulation rules as it does for every other shape.

#### Scenario: Informe suelto
- **WHEN** a change adds only `informe.md` and `docs/resultado.json`
- **THEN** `operationArtifacts` flags nothing

#### Scenario: Par permitido por la línea
- **WHEN** a change adds `docs/informe.md` and `docs/resultado.json` with `allowedArtifacts: ["docs/*"]`
- **THEN** `operationArtifacts` flags nothing

#### Scenario: Simulacro permitido en parte
- **WHEN** a change adds `drills/a1b2/informe.md` and `drills/a1b2/copy/a.ts` with `allowedArtifacts: ["drills/*/informe.md"]`
- **THEN** only `drills/a1b2/copy/a.ts` is flagged

### Requirement: Verificación rechaza el simulacro
`verifyChange` MUST fail the attempt with `kind: failed`, before running the line's commands, when the change adds the output of a regeneration drill, and the feedback MUST name each file with `simulacro de regeneración`.

#### Scenario: Simulacro en el cambio
- **WHEN** verifyChange runs on a copy whose branch adds `drills/a1b2/informe.md` and `drills/a1b2/resultado.json`, with a verify command that leaves a mark
- **THEN** the result is `kind: failed`, the feedback contains `drills/a1b2/resultado.json` and `simulacro de regeneración`, and the command never ran

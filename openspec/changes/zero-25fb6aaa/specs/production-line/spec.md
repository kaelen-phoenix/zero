# Spec Delta

## ADDED Requirements

### Requirement: Rutas protegidas configurables sin distinguir mayúsculas
`protectedTouched` MUST compare each changed path and each pattern of `limits.protectedPaths` in lower case, so a path that differs from a pattern only in upper or lower case counts as protected, and it MUST return the path with its original spelling.

#### Scenario: Carpeta .Claude con los patrones por defecto
- **WHEN** protectedTouched receives .Claude/settings.json (M) with the default protectedPaths from parseFactory
- **THEN** it returns [".Claude/settings.json"]

#### Scenario: Archivo .MCP.json con los patrones por defecto
- **WHEN** protectedTouched receives .MCP.json (A) with the default protectedPaths from parseFactory
- **THEN** it returns [".MCP.json"]

#### Scenario: Carpeta .Github con los patrones por defecto
- **WHEN** protectedTouched receives .Github/workflows/ci.yml (M) with the default protectedPaths from parseFactory
- **THEN** it returns [".Github/workflows/ci.yml"]

#### Scenario: Patrón escrito con mayúsculas
- **WHEN** protectedTouched receives secrets/a.txt (A) with patterns ["Secrets/**"]
- **THEN** it returns ["secrets/a.txt"]

### Requirement: Ruta sin relación no coincide al ignorar mayúsculas
`protectedTouched` MUST NOT flag a path that does not match any pattern once both are in lower case.

#### Scenario: Ruta sin relación con los patrones por defecto
- **WHEN** protectedTouched receives src/Claude/settings.json (M) and SRC/mcp.JSON (A) with the default protectedPaths from parseFactory
- **THEN** it returns []

### Requirement: Ruta aprobada sigue siendo exacta al ignorar mayúsculas
The approved paths passed to `protectedTouched` (`allowedProtected`) MUST still be compared exactly: only a path with the same spelling as an approved one SHALL pass.

#### Scenario: Aprobación con la misma escritura
- **WHEN** protectedTouched receives .Claude/settings.json with the default protectedPaths and allowed [".Claude/settings.json"]
- **THEN** it returns []

#### Scenario: Aprobación con otra escritura
- **WHEN** protectedTouched receives .Claude/settings.json with the default protectedPaths and allowed [".claude/settings.json"]
- **THEN** it returns [".Claude/settings.json"]

### Requirement: Turno noche rechaza rutas protegidas con otra escritura
`filterProposals` MUST drop a proposal whose paths match a pattern of `limits.protectedPaths` when ignoring upper and lower case, and it MUST keep proposals with unrelated paths.

#### Scenario: Propuesta sobre .Claude
- **WHEN** filterProposals receives one idea with paths [".Claude/settings.json"] and one idea with paths ["src/x.ts"], with protected paths [".claude/**"]
- **THEN** it returns only the idea with paths ["src/x.ts"]

### Requirement: La lista fija de rutas protegidas no cambia
`ALWAYS_PROTECTED` MUST remain exactly [".zero/**"], and a path of `limits.protectedPaths` SHALL stop being protected when the person in charge removes it from the list.

#### Scenario: Lista fija intacta
- **WHEN** ALWAYS_PROTECTED is read from src/line/verify.ts
- **THEN** it equals [".zero/**"]

#### Scenario: Ruta fuera de la lista configurada
- **WHEN** protectedTouched receives .Claude/settings.json (M) with patterns ["docs/**"]
- **THEN** it returns []

#### Scenario: La variante .Zero sigue protegida
- **WHEN** protectedTouched receives .Zero/agents/a11y.md (A) with patterns []
- **THEN** it returns [".Zero/agents/a11y.md"]

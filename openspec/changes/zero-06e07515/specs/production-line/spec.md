# Spec Delta

## ADDED Requirements

### Requirement: Rutas protegidas por defecto incluyen la configuración de agentes
When the factory file does not set `limits.protectedPaths`, the default list SHALL be exactly `.github/**`, `.zero/**`, `.claude/**`, `.mcp.json`, `.env`, `.env.*`, `**/*.pem` and `**/*.key`.

#### Scenario: Defaults without protectedPaths
- **WHEN** parseFactory reads a factory file with one line and no limits.protectedPaths
- **THEN** cfg.limits.protectedPaths equals [".github/**", ".zero/**", ".claude/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]

#### Scenario: Owner list replaces defaults
- **WHEN** parseFactory reads a factory file whose limits.protectedPaths is ["docs/**"]
- **THEN** cfg.limits.protectedPaths equals ["docs/**"] and does not contain ".claude/**" or ".mcp.json"

### Requirement: Un cambio en la configuración de agentes cae bajo ruta protegida
With the default protected paths, a change that adds or modifies `.claude/settings.json` (or any file under `.claude/`) or the root `.mcp.json` MUST be reported as touching a protected path, and the attempt MUST stop at verify like any other protected path.

#### Scenario: protectedTouched flags .claude and .mcp.json
- **WHEN** protectedTouched receives changed files .claude/settings.json (M), .mcp.json (A) and src/x.ts (A) with the default protectedPaths from parseFactory
- **THEN** it returns [".claude/settings.json", ".mcp.json"]

#### Scenario: Approved path is let through
- **WHEN** protectedTouched receives .claude/settings.json with the default patterns and allowed [".claude/settings.json"]
- **THEN** it returns []

#### Scenario: verifyChange stops the diff
- **WHEN** verifyChange runs on a work copy whose commit adds .claude/settings.json, with the default protectedPaths
- **THEN** the result is { ok: false, kind: "protected" } and paths contains ".claude/settings.json"

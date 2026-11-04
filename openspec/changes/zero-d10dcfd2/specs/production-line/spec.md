# Spec Delta

## ADDED Requirements

### Requirement: Lista por defecto con .agents/**
When the factory file does not set `limits.protectedPaths`, the default list SHALL be exactly `.github/**`, `.zero/**`, `.claude/**`, `.agents/**`, `.mcp.json`, `.env`, `.env.*`, `**/*.pem` and `**/*.key`, in that order.

#### Scenario: Defaults without protectedPaths
- **WHEN** parseFactory reads a factory file with one line and no limits.protectedPaths
- **THEN** cfg.limits.protectedPaths equals [".github/**", ".zero/**", ".claude/**", ".agents/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]

#### Scenario: The owner's list still replaces the defaults
- **WHEN** parseFactory reads a factory file whose limits.protectedPaths is ["docs/**"]
- **THEN** cfg.limits.protectedPaths equals ["docs/**"] and does not contain ".agents/**"

### Requirement: Skills de Codex bajo ruta protegida
With the default protected paths, `protectedTouched` MUST flag any changed file under `.agents/` at the repository root, unless that path was approved.

#### Scenario: protectedTouched flags a Codex skill
- **WHEN** protectedTouched receives .agents/skills/x/SKILL.md (A) and src/x.ts (A) with the default protectedPaths from parseFactory
- **THEN** it returns [".agents/skills/x/SKILL.md"]

#### Scenario: An approved path passes
- **WHEN** protectedTouched receives .agents/skills/x/SKILL.md with the default patterns and allowed [".agents/skills/x/SKILL.md"]
- **THEN** it returns []

### Requirement: Ejemplo de los README con .agents/**
The `protectedPaths` example line in README.md and README.es.md MUST include `.agents/**` right after `.claude/**`, and the line MUST be identical in both files.

#### Scenario: Both READMEs show the path
- **WHEN** README.md and README.es.md are read
- **THEN** each contains the line ` protectedPaths: [".github/**", ".claude/**", ".agents/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]` and test/docs.test.ts passes

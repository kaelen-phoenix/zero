# Spec Delta

## ADDED Requirements

### Requirement: Opción autostart en el archivo
The factory file SHALL accept a top-level boolean `autostart` (default false). No chat tool MUST change it; it SHALL be changed only by `zero autostart on|off`, by `zero setup` or by editing the file.

#### Scenario: Valor por defecto
- **WHEN** a factory file without `autostart` is parsed
- **THEN** `config.autostart` is false

#### Scenario: Valor inválido
- **WHEN** a factory file has `autostart: "si"`
- **THEN** parsing fails with a validation error

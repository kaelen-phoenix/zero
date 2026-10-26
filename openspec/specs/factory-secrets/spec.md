# factory-secrets Specification

## Purpose
Guarda las credenciales que los motores necesitan dentro de la caja en el llavero del sistema operativo, nunca en archivos de la fábrica ni en la línea de comandos.

## Requirements

### Requirement: Secretos en el llavero del sistema
`zero secret set <NOMBRE>` SHALL leer el valor desde la entrada estándar y guardarlo en el llavero del sistema operativo. `zero secret list` SHALL mostrar solo los nombres, y `zero secret remove <NOMBRE>` SHALL borrarlo. El valor MUST NOT aceptarse como argumento de la línea de comandos.

#### Scenario: Guardar y listar
- **WHEN** el dueño guarda `CLAUDE_CODE_OAUTH_TOKEN`
- **THEN** `zero secret list` muestra `CLAUDE_CODE_OAUTH_TOKEN` y no muestra su valor

#### Scenario: Valor en la línea de comandos
- **WHEN** el dueño ejecuta `zero secret set NOMBRE valor`
- **THEN** zero rechaza el comando e indica que el valor se ingresa por la entrada estándar

### Requirement: Origen de una credencial
Al buscar una credencial, zero SHALL usar primero la variable de entorno del mismo nombre y, si no existe, el llavero de la fábrica.

#### Scenario: Variable de entorno presente
- **WHEN** `ANTHROPIC_API_KEY` existe en el entorno y también en el llavero
- **THEN** se usa el valor del entorno

# Spec Delta

## Purpose

Define la fábrica de un dueño: qué líneas (repositorios) atiende, con qué nivel de autonomía, con qué límites y con qué motores trabaja, en un archivo legible que el dueño, el panel o un agente pueden editar.

## ADDED Requirements

### Requirement: Definición de la fábrica en un archivo
La fábrica SHALL leer su configuración de `zero.factory.yaml` dentro del directorio de la fábrica (`ZERO_HOME`, por defecto `~/.zero`). El archivo SHALL validarse al cargarse y los valores omitidos SHALL tomar valores por defecto seguros.

#### Scenario: Archivo mínimo
- **WHEN** el archivo solo declara una línea con su ruta
- **THEN** la fábrica carga nivel `L3`, motor `claude`, límites de costo por día y por trabajo, e integración `merge` para esa línea

#### Scenario: Archivo inválido
- **WHEN** el archivo contiene un nivel inexistente como `L9`
- **THEN** la carga falla con un mensaje que nombra el campo inválido y la fábrica no ejecuta trabajos

### Requirement: Secretos fuera del archivo
La definición de la fábrica MUST NOT contener credenciales. Los motores SHALL obtener sus credenciales del entorno o de la sesión propia de cada cliente de agentes.

#### Scenario: Clave pegada en el archivo
- **WHEN** el archivo contiene un valor con forma de clave de API (por ejemplo `sk-ant-…` o `ghp_…`)
- **THEN** la carga falla indicando que los secretos no se guardan en la definición de la fábrica

### Requirement: Creación inicial con valores recomendados
`zero init` SHALL crear la definición de la fábrica con valores recomendados, detectar los clientes de agentes instalados y, si se ejecuta dentro de un repositorio git, añadirlo como línea. MUST NOT sobrescribir una definición existente.

#### Scenario: Inicio dentro de un repositorio
- **WHEN** el dueño ejecuta `zero init` dentro de un repositorio git y no existe definición previa
- **THEN** se crea `zero.factory.yaml` con ese repositorio como línea y el motor elegido entre los clientes detectados

#### Scenario: Definición existente
- **WHEN** ya existe `zero.factory.yaml`
- **THEN** `zero init` no lo modifica y lo informa

### Requirement: Nivel efectivo según la protección disponible
La fábrica SHALL calcular un nivel efectivo a partir del nivel configurado. El nivel `L3` MUST exigir aislamiento en caja; si el aislamiento configurado o disponible no es una caja, el nivel efectivo SHALL ser `L2` y la fábrica SHALL informar el motivo en su estado.

#### Scenario: L3 sin caja
- **WHEN** el nivel configurado es `L3` y el aislamiento es `worktree`
- **THEN** el nivel efectivo es `L2` y el estado de la fábrica explica que L3 requiere caja de aislamiento

#### Scenario: Niveles inferiores
- **WHEN** el nivel configurado es `L1`
- **THEN** el nivel efectivo es `L1`

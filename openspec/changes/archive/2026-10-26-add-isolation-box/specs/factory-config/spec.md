# Spec Delta

## MODIFIED Requirements

### Requirement: Secretos fuera del archivo
La definición de la fábrica MUST NOT contener credenciales. Los motores SHALL obtener sus credenciales del entorno, de la sesión propia de cada cliente de agentes o del llavero de la fábrica.

#### Scenario: Clave pegada en el archivo
- **WHEN** el archivo contiene un valor con forma de clave de API (por ejemplo `sk-ant-…` o `ghp_…`)
- **THEN** la carga falla indicando que los secretos no se guardan en la definición de la fábrica

### Requirement: Creación inicial con valores recomendados
`zero init` SHALL crear la definición de la fábrica con valores recomendados, incluido el aislamiento en caja, detectar los clientes de agentes instalados y, si se ejecuta dentro de un repositorio git, añadirlo como línea. MUST NOT sobrescribir una definición existente.

#### Scenario: Inicio dentro de un repositorio
- **WHEN** el dueño ejecuta `zero init` dentro de un repositorio git y no existe definición previa
- **THEN** se crea `zero.factory.yaml` con ese repositorio como línea, `isolation: container` y el motor elegido entre los clientes detectados

#### Scenario: Definición existente
- **WHEN** ya existe `zero.factory.yaml`
- **THEN** `zero init` no lo modifica y lo informa

### Requirement: Nivel efectivo según la protección disponible
La fábrica SHALL calcular un nivel efectivo a partir del nivel configurado. El nivel `L3` MUST exigir aislamiento `container`, la caja lista y la credencial de cada motor configurado disponible para la caja; si falta algo, el nivel efectivo SHALL ser `L2` y la fábrica SHALL informar qué falta y cómo resolverlo. Sin la caja lista, los trabajos SHALL ejecutarse en copias locales.

#### Scenario: L3 sin caja
- **WHEN** el nivel configurado es `L3` y el aislamiento es `worktree`
- **THEN** el nivel efectivo es `L2` y el estado de la fábrica explica que L3 requiere caja de aislamiento

#### Scenario: Caja configurada pero no lista
- **WHEN** el nivel es `L3`, el aislamiento es `container` y no hay runtime de contenedores
- **THEN** el nivel efectivo es `L2`, los trabajos corren en copias locales y el estado indica que se ejecute `zero box setup`

#### Scenario: Falta la credencial de un motor
- **WHEN** la caja está lista pero no existe ninguna credencial para el motor `claude`
- **THEN** el nivel efectivo es `L2` y el estado indica cómo obtener y guardar la credencial

#### Scenario: Todo listo
- **WHEN** el nivel es `L3`, el aislamiento es `container`, la caja está lista y los motores tienen su credencial
- **THEN** el nivel efectivo es `L3`

#### Scenario: Niveles inferiores
- **WHEN** el nivel configurado es `L1`
- **THEN** el nivel efectivo es `L1`

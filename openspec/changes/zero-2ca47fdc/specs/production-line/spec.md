# Spec Delta

## ADDED Requirements

### Requirement: Recolección de nombres de requisito de una capacidad
zero SHALL juntar los nombres de requisito de una capacidad desde `openspec/specs/<cap>/spec.md` y `openspec/changes/*/specs/<cap>/spec.md`, y MUST excluir `openspec/changes/archive` y el change del propio trabajo.

#### Scenario: Fuentes incluidas
- **WHEN** la capacidad tiene un requisito «A» en su spec principal y otro «B» en el delta de otro change sin archivar
- **THEN** los nombres recolectados incluyen «A» y «B»

#### Scenario: Archivo y change propio excluidos
- **WHEN** un nombre aparece solo en `openspec/changes/archive/<x>/specs/<cap>/spec.md` o en `openspec/changes/zero-<id del trabajo>/specs/<cap>/spec.md`
- **THEN** ese nombre no se recolecta y un requisito del trabajo con ese nombre conserva su nombre

#### Scenario: Otra capacidad
- **WHEN** un nombre aparece solo en el delta de otra capacidad
- **THEN** ese nombre no se recolecta

### Requirement: Comparación de nombres de requisito como openspec
La comparación de nombres de requisito MUST ignorar mayúsculas, tratar cualquier secuencia de espacios como un solo espacio e ignorar los espacios de los extremos y el cierre de `#` del encabezado, igual que `foldRequirementName` de openspec.

#### Scenario: Variante de mayúsculas y espacios
- **WHEN** el pedido trae «ÍCONO monocromo» y la capacidad ya tiene «Ícono monocromo»
- **THEN** el requisito del pedido se trata como repetido y recibe el sufijo

#### Scenario: Cierre de encabezado
- **WHEN** un delta existente tiene el encabezado `### Requirement: Foo ###` y el pedido trae «foo»
- **THEN** el requisito del pedido se trata como repetido y recibe el sufijo

### Requirement: Sufijo de trabajo en nombres repetidos
Un requisito cuyo nombre ya existe en la capacidad o repite el de un requisito anterior del mismo pedido SHALL recibir el sufijo ` (<id del trabajo>)`; si ese nombre también está tomado, SHALL recibir ` (<id del trabajo>-<n>)` con n desde 2, de modo que todos los nombres resultantes MUST ser distintos entre sí y respecto de los existentes.

#### Scenario: Choque con la capacidad
- **WHEN** el trabajo abc123 trae el requisito «A» y la capacidad ya tiene «A»
- **THEN** el requisito pasa a llamarse «A (abc123)»

#### Scenario: Repetido dentro del pedido
- **WHEN** el trabajo abc123 trae «A» y «a», y la capacidad no tiene ninguno
- **THEN** los nombres quedan «A» y «a (abc123)»

#### Scenario: Tres iguales
- **WHEN** el trabajo abc123 trae tres requisitos «A» y la capacidad ya tiene «A»
- **THEN** los nombres quedan «A (abc123)», «A (abc123-2)» y «A (abc123-3)»

#### Scenario: Sin choque
- **WHEN** ningún nombre del pedido coincide con otro
- **THEN** la especificación devuelta conserva todos los nombres sin cambios

### Requirement: Nombres únicos antes de escribir la especificación
La estación `spec` SHALL aplicar los nombres únicos después de validar la especificación y antes de escribir archivos, guardar el trabajo o armar el contrato de build, y MUST NOT hacer otra llamada al modelo por esto.

#### Scenario: Mismo nombre en todas las salidas
- **WHEN** el repositorio de la línea tiene otro change con «Health check» en la capacidad `health-check` y corre un trabajo cuya especificación trae ese nombre
- **THEN** `job.spec`, el delta del change y el del directorio del trabajo y el prompt de la estación build usan «Health check (<id del trabajo>)»

#### Scenario: Sin llamadas extra
- **WHEN** una especificación válida trae nombres repetidos
- **THEN** la estación spec se llama una sola vez

#### Scenario: Trabajo retomado
- **WHEN** el trabajo se vuelve a ejecutar desde la estación spec y su propio change ya está escrito en la copia de trabajo con ese nombre
- **THEN** el requisito no recibe sufijo por chocar con su propio change

### Requirement: La recolección de nombres no hace fallar el trabajo
Un problema al leer las carpetas o los archivos de OpenSpec MUST NOT hacer fallar el trabajo: lo que no se puede leer SHALL ignorarse.

#### Scenario: Sin OpenSpec
- **WHEN** el repositorio no tiene carpeta `openspec`
- **THEN** la recolección no devuelve nombres y el trabajo sigue

#### Scenario: Entrada ilegible
- **WHEN** `openspec/changes/<x>/specs/<cap>/spec.md` es una carpeta o `openspec/changes` contiene un archivo suelto
- **THEN** esa entrada se ignora y se recolectan los nombres de las demás

### Requirement: Archivo real de dos changes con nombres repetidos
Dos changes de una misma capacidad generados por zero con un requisito de igual nombre y distinto contenido SHALL poder archivarse uno tras otro con `openspec archive --yes` una vez aplicados los nombres únicos.

#### Scenario: Control sin nombres únicos
- **WHEN** en un repositorio temporal se archivan con el binario real de openspec dos changes con el mismo nombre de requisito y distinto contenido, sin aplicar la función
- **THEN** el segundo archivo falla y su salida contiene `already exists`

#### Scenario: Con nombres únicos
- **WHEN** se repite lo anterior con el segundo change pasado antes por la función de nombres únicos
- **THEN** los dos comandos terminan con estado 0 y `openspec/specs/<cap>/spec.md` contiene los dos requisitos

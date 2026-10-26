# Spec Delta

## Purpose

Aísla el trabajo de cada estación en una caja (contenedor) para que un agente equivocado o manipulado no pueda leer ni modificar nada fuera del proyecto en el que trabaja. Es la condición para que la fábrica trabaje a oscuras (L3).

## ADDED Requirements

### Requirement: Estado de la caja
zero SHALL determinar si la caja está lista: un runtime de contenedores (Podman o Docker) que responde y la imagen de la caja construida para la versión instalada de zero. Si no está lista, SHALL informar qué falta y el siguiente paso.

#### Scenario: Sin runtime
- **WHEN** no hay Podman ni Docker disponibles
- **THEN** el estado de la caja es "no lista" e indica cómo instalar un runtime en ese sistema operativo

#### Scenario: Runtime e imagen presentes
- **WHEN** el runtime responde y la imagen de la versión actual existe
- **THEN** el estado de la caja es "lista" e indica el runtime y la imagen

### Requirement: Preparación con consentimiento
`zero box setup` SHALL ejecutar los pasos que falten para dejar la caja lista. MUST pedir confirmación explícita antes de cada paso que instale software o requiera permisos de administrador, salvo que el dueño lo autorice de antemano con `--yes`. Sin terminal interactiva y sin `--yes` SHALL mostrar el plan sin ejecutarlo.

#### Scenario: Windows sin WSL
- **WHEN** se ejecuta en Windows sin WSL ni runtime
- **THEN** el plan incluye habilitar WSL2 (requiere administrador y reinicio), instalar Podman e iniciar su máquina, y no ejecuta nada sin confirmación

#### Scenario: Solo falta la imagen
- **WHEN** el runtime responde pero no existe la imagen
- **THEN** `zero box setup` construye la imagen sin pedir permisos de administrador

### Requirement: Qué corre dentro de la caja
Con aislamiento `container` y la caja lista, los comandos de preparación, las ejecuciones de agentes y los comandos de verificación de cada trabajo SHALL ejecutarse dentro de la caja. La integración SHALL ejecutarse fuera de la caja, por zero.

#### Scenario: Verificación dentro de la caja
- **WHEN** la línea verifica con un comando que lista el directorio de trabajo
- **THEN** el comando ve la copia del proyecto en `/work` y no ve el directorio del usuario

### Requirement: Copia propia del proyecto
Cada trabajo en caja SHALL usar una copia independiente del repositorio, sin enlaces a los objetos del repositorio del dueño. La caja MUST NOT montar el repositorio del dueño, su directorio personal ni otra ruta del equipo. Antes de integrar, zero SHALL traer la rama del trabajo desde esa copia.

#### Scenario: Entrega desde la caja
- **WHEN** un trabajo en caja pasa la revisión
- **THEN** la rama `zero/<trabajo>` existe en el repositorio del dueño con los commits del trabajo y se integra según el modo de la línea

### Requirement: Solo lectura reforzada
En las estaciones `spec` y `review` la copia SHALL montarse en modo solo lectura dentro de la caja.

#### Scenario: Escritura en review
- **WHEN** el agente de `review` intenta crear un archivo en `/work`
- **THEN** la escritura falla y la copia no cambia

### Requirement: Credenciales mínimas
Cada ejecución en la caja SHALL recibir solo las credenciales que necesita el motor de esa estación, por variables de entorno que no aparecen en la línea de comandos. MUST NOT recibir tokens de GitHub, claves SSH ni otros secretos de la fábrica.

#### Scenario: Build con Claude
- **WHEN** la estación `build` usa el motor `claude` y existen `CLAUDE_CODE_OAUTH_TOKEN` y `GH_TOKEN`
- **THEN** la caja recibe `CLAUDE_CODE_OAUTH_TOKEN` y no recibe `GH_TOKEN`

### Requirement: Privilegios y recursos limitados
La caja SHALL ejecutarse sin privilegios: usuario no root, sin capacidades adicionales, sin escalada de privilegios, con el sistema de archivos raíz en solo lectura y con límites de CPU, memoria y cantidad de procesos configurables.

#### Scenario: Valores por defecto
- **WHEN** la línea no configura límites
- **THEN** la caja se inicia con 2 CPU, 4 GB de memoria y 512 procesos como máximo

### Requirement: Cancelación de la caja
Al detener un trabajo, al tirar del cordón andon o al vencer el tiempo límite, zero SHALL detener la caja en ejecución.

#### Scenario: Andon durante build
- **WHEN** el dueño detiene la fábrica mientras un agente trabaja en la caja
- **THEN** el contenedor se detiene y el trabajo vuelve a la cola

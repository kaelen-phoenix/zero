# Spec Delta

## Purpose

Define cómo el dueño le pide trabajo a su fábrica, cómo avanza cada trabajo hasta un estado final, cuándo y cómo se le consulta, y cómo puede detener la fábrica en cualquier momento.

## ADDED Requirements

### Requirement: Pedidos en lenguaje natural o como especificación
La fábrica SHALL aceptar pedidos como texto en lenguaje natural o como especificación escrita por el dueño, dirigidos a una línea. Si la fábrica tiene una sola línea, la línea SHALL poder omitirse.

#### Scenario: Pedido en lenguaje natural
- **WHEN** el dueño pide "agregar un endpoint de salud" sin indicar línea y la fábrica tiene una sola línea
- **THEN** se crea un trabajo en estado `queued` para esa línea con el texto del pedido

#### Scenario: Línea ambigua
- **WHEN** la fábrica tiene varias líneas y el pedido no indica cuál
- **THEN** el pedido se rechaza indicando las líneas disponibles

### Requirement: Ciclo de vida del trabajo
Cada trabajo SHALL estar en exactamente uno de estos estados: `queued`, `running`, `waiting`, `delivered`, `failed`, `stopped`. `delivered`, `failed` y `stopped` SHALL ser finales. Cada trabajo SHALL registrar la estación en la que está y el motivo de su estado final.

#### Scenario: Trabajo entregado
- **WHEN** un trabajo supera todas las estaciones
- **THEN** su estado es `delivered` y registra cómo se integró

#### Scenario: Trabajo fallido
- **WHEN** un trabajo agota sus intentos
- **THEN** su estado es `failed` con el motivo y la última retroalimentación

### Requirement: Aprobaciones según el nivel efectivo
Las aprobaciones SHALL depender del nivel efectivo: `L0` aprueba especificación e integración; `L1` aprueba la especificación; `L2` solo aprueba lo que dispare una política (ruta protegida, presupuesto agotado); `L3` no pide aprobaciones y aplica las políticas como límites duros.

#### Scenario: L1 pide aprobar la especificación
- **WHEN** un trabajo en una fábrica `L1` termina la estación `spec`
- **THEN** el trabajo pasa a `waiting` con un resumen en lenguaje simple de lo que se va a obtener

#### Scenario: L2 no pide aprobar la especificación
- **WHEN** un trabajo en una fábrica `L2` termina la estación `spec`
- **THEN** el trabajo continúa a `build` sin consultar

### Requirement: Esperar no bloquea la fábrica
Un trabajo en `waiting` MUST NOT impedir que otros trabajos avancen. Al aprobarse SHALL continuar desde la estación siguiente; al rechazarse SHALL terminar en `stopped`.

#### Scenario: Aprobación
- **WHEN** el dueño aprueba un trabajo en `waiting`
- **THEN** el trabajo vuelve a `queued` y continúa desde la estación siguiente a la aprobada

#### Scenario: Rechazo
- **WHEN** el dueño rechaza un trabajo en `waiting`
- **THEN** el trabajo termina en `stopped` con la nota del dueño como motivo

### Requirement: Tiempo límite de las consultas
Cada consulta SHALL tener un tiempo límite configurable y una acción por defecto (`approve` o `reject`) que se aplica al vencer.

#### Scenario: Consulta vencida
- **WHEN** una consulta supera el tiempo límite y la acción por defecto es `reject`
- **THEN** el trabajo termina en `stopped` indicando que venció sin respuesta

### Requirement: Cordón andon
El dueño SHALL poder detener toda la fábrica o un trabajo concreto en cualquier momento. Al detener la fábrica no SHALL iniciarse ninguna estación nueva y los agentes en curso SHALL cancelarse; al reanudarla, los trabajos pendientes SHALL continuar.

#### Scenario: Parar un trabajo
- **WHEN** el dueño detiene un trabajo en curso
- **THEN** su agente se cancela y el trabajo termina en `stopped`

#### Scenario: Parar la fábrica
- **WHEN** el dueño detiene la fábrica
- **THEN** ningún trabajo inicia estaciones nuevas hasta que el dueño la reanude

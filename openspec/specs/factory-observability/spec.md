# factory-observability Specification

## Purpose
Hace visible todo lo que ocurre en la fábrica: cada trabajo deja una traza con duración, estado y costo de cada paso, y las métricas se calculan de una sola forma para todas las vistas.

## Requirements

### Requirement: Traza por trabajo
Cada trabajo SHALL registrar una traza jerárquica: trabajo → estación → intento → llamada a agente o comando, cada elemento con inicio, fin, estado y atributos (motor, modelo, costo, código de salida).

#### Scenario: Traza de un trabajo entregado
- **WHEN** un trabajo se entrega en el primer intento
- **THEN** `zero trace <trabajo>` muestra las cinco estaciones con su duración y el costo de cada agente

### Requirement: Costo con origen
Cada llamada a un agente SHALL registrar su costo y el origen del dato: `reported` si lo informó el motor, `unknown` si no.

#### Scenario: Motor sin costo
- **WHEN** un motor no informa costo
- **THEN** la llamada registra costo 0 con origen `unknown` y las métricas lo distinguen

### Requirement: Métricas con una sola definición
Las métricas SHALL calcularse con una única definición usada por el estado, el informe y el chat:
- trabajos entregados y fallidos;
- tasa de éxito;
- costo total y costo por entrega;
- duración media;
- consultas pendientes y tiempo de espera humano;
- conexiones de la caja, bloqueadas y sospechosas.

#### Scenario: Mismos números en todas las vistas
- **WHEN** se consultan las métricas del día por CLI y por la herramienta MCP
- **THEN** ambas devuelven los mismos valores

### Requirement: Salidas en la traza y en el informe
`zero trace <trabajo>` SHALL incluir las salidas a internet del trabajo, agrupadas por sitio, con sus bloqueos. El informe del dueño SHALL resumir las salidas del período y listar los sitios bloqueados por sospechosos en "Necesita al dueño".

#### Scenario: Informe con un bloqueo
- **WHEN** en el período la puerta bloqueó `webhook.site` por sospechoso
- **THEN** el informe muestra ese sitio con su trabajo y el motivo en "Necesita al dueño"

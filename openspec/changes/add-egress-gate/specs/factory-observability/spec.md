# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Salidas en la traza y en el informe
`zero trace <trabajo>` SHALL incluir las salidas a internet del trabajo, agrupadas por sitio, con sus bloqueos. El informe del dueño SHALL resumir las salidas del período y listar los sitios bloqueados por sospechosos en "Necesita al dueño".

#### Scenario: Informe con un bloqueo
- **WHEN** en el período la puerta bloqueó `webhook.site` por sospechoso
- **THEN** el informe muestra ese sitio con su trabajo y el motivo en "Necesita al dueño"

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
Las métricas (trabajos entregados y fallidos, tasa de éxito, costo total, costo por entrega, duración media, consultas pendientes y tiempo de espera humano) SHALL calcularse con una única definición usada por el estado, el informe y el chat.

#### Scenario: Mismos números en todas las vistas
- **WHEN** se consultan las métricas del día por CLI y por la herramienta MCP
- **THEN** ambas devuelven los mismos valores

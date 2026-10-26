# Spec Delta

## ADDED Requirements

### Requirement: Salidas sospechosas
Si la puerta bloqueó una salida sospechosa de un trabajo, el trabajo MUST NOT integrarse sin el dueño:
- en `L3` SHALL terminar en `failed`, explicando qué sitios se bloquearon y cómo permitirlos si son legítimos;
- en `L0`–`L2` SHALL pasar a `waiting` con la lista de sitios.

zero SHALL revisarlo después de `spec`, al comienzo de cada intento de `build` y antes de integrar.

#### Scenario: Sospecha en L3
- **WHEN** en L3 un agente de `build` intentó conectarse a `pastebin.com` y la revisión pasó
- **THEN** el trabajo termina en `failed` sin integrarse y el motivo nombra `pastebin.com` y `zero egress allow`

#### Scenario: Sospecha en L2
- **WHEN** en L2 el setup de un trabajo intentó conectarse a una dirección IP sin nombre
- **THEN** el trabajo pasa a `waiting` con la lista de sitios y, al aprobarse, continúa y se integra

### Requirement: Qué sospechas cuentan
Aprobar SHALL aceptar las sospechas registradas hasta ese momento; una sospecha posterior SHALL volver a preguntar. Los bloqueos por la lista del dueño o por el modo `allowlist` MUST NOT afectar al trabajo.

#### Scenario: Bloqueo por la lista del dueño
- **WHEN** el dueño bloqueó `example.com` y un agente intentó conectarse a ese sitio
- **THEN** el trabajo sigue su curso normal

# Spec Delta

## ADDED Requirements

### Requirement: La propuesta generada no copia el pedido
La propuesta que zero genera en formato OpenSpec MUST describir el cambio con el resumen y los requisitos de la especificación y MUST NOT copiar el texto del pedido.

#### Scenario: Propuesta sin el pedido
- **WHEN** zero genera el cambio de OpenSpec de un trabajo
- **THEN** `proposal.md` tiene el resumen de la especificación y no contiene el texto del pedido

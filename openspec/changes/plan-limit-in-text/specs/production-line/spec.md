# Spec Delta

## ADDED Requirements

### Requirement: Plan agotado que solo se anuncia en el texto
Cuando una llamada al motor Claude falla y el texto del error dice que el plan llegó a su límite (`You've hit your session limit`, `You've hit your limit`, `usage limit reached`), el motor MUST devolver la llamada como rechazada por el plan (`quota.limited` con cobro `subscription`), aunque no haya llegado un evento de límite. El texto de una respuesta que no falló MUST NOT leerse así.

#### Scenario: Plan usado fuera de la fábrica
- **WHEN** el SDK lanza `Claude Code returned an error result: You've hit your session limit · resets 5am`
- **THEN** el trabajo vuelve a la cola sin gastar un intento y el motor queda en pausa hasta que el plan acepte pedidos

#### Scenario: Otro error
- **WHEN** el SDK lanza `socket hang up`
- **THEN** la llamada falla como hasta ahora, sin marcar el plan

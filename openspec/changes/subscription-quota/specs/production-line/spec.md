# Spec Delta

## MODIFIED Requirements

### Requirement: Límites de costo
Cuando el motor se paga por uso, cada trabajo SHALL tener un presupuesto. Si el costo acumulado lo supera, en `L3` el trabajo SHALL terminar en `failed` y en `L0`–`L2` SHALL pasar a `waiting` pidiendo ampliar el presupuesto. La fábrica MUST NOT iniciar trabajos nuevos cuando el gasto cobrado del día alcanza el límite diario. Cuando el motor usa una suscripción, el límite SHALL ser el cupo real del plan: los topes en dólares MUST NOT aplicarse, la fábrica MUST NOT iniciar trabajos nuevos mientras una ventana del plan está agotada o pasó la reserva del dueño, y SHALL retomar sola cuando la ventana se renueva. Un trabajo cortado porque el plan se agotó SHALL volver a la cola sin gastar un intento.

#### Scenario: Presupuesto diario agotado
- **WHEN** el motor se paga por uso y el gasto del día alcanza el límite diario
- **THEN** los trabajos en cola esperan y el estado de la fábrica lo indica

#### Scenario: Suscripción con estimación alta
- **WHEN** el motor usa una suscripción y la estimación del día supera `usdPerDay` con el plan sin agotar
- **THEN** la fábrica sigue trabajando y el estado muestra el uso del plan y la estimación como no cobrada

#### Scenario: Plan agotado
- **WHEN** el plan rechaza una llamada en medio de un trabajo porque la ventana de 5 horas se agotó
- **THEN** el trabajo vuelve a la cola sin gastar el intento, los trabajos nuevos esperan y la fábrica retoma cuando la ventana se renueva

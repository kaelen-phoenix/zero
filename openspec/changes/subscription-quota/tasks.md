# Tasks

## 1. Plan de la suscripción

- [x] 1.1 El motor informa cómo se paga y el uso de cada ventana del plan; Claude lo lee de `rate_limit_event` y `apiKeySource`
- [x] 1.2 Un solo cálculo del presupuesto (`src/budget.ts`): con suscripción, pausa por ventana agotada o reserva y retoma al renovarse; con pago por uso, el tope diario sobre lo que se cobra
- [x] 1.3 Sin topes en dólares por trabajo con suscripción; un trabajo cortado por el plan vuelve a la cola sin gastar un intento
- [x] 1.4 Estado, panel e informe muestran el plan; pruebas con agentes falsos

## 2. Prueba real

- [ ] 2.1 Ver el plan en el estado con la fábrica corriendo con la suscripción del dueño

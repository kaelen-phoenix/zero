# Proposal

## Why

El 10 de noviembre de 2026, con ocho pull requests de una línea trabados por checks fallidos, la fábrica actualizó y volvió a correr varios en pocos minutos. Esa línea corre sus pruebas de punta a punta contra un ambiente compartido, con un grupo de concurrencia que deja una sola corrida en espera y cancela las demás: la fábrica canceló su propia corrida de un pull request con la de otro, y la de la rama base después de fundir. Pasó por tres huecos de la regla «un pull request por repositorio a la vez»:

- Solo valía para actualizar con la rama base, no para volver a correr checks.
- El turno se liberaba apenas fallaba un check rápido, con el lento todavía corriendo.
- No miraba los pull requests recién entregados, que todavía esperaban sus primeros checks.

## What Changes

- Con un check fallido y otros todavía corriendo, la fábrica espera a que terminen todos antes de actualizar, volver a correr o avisar.
- Volver a correr los checks fallidos también toma el turno del repositorio, y lo suelta cuando terminan todos los checks de ese commit.
- Mientras otro pull request del repositorio entregado en las últimas 2 horas espera sus primeros checks, no se empieza nada.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: la fábrica no empieza corridas de checks encima de otras del mismo repositorio

## Impact

`src/line/automerge.ts` y `test/automerge-unblock.test.ts`. Un pull request con un check fallido y otros corriendo se avisa cuando terminan todos, no antes.

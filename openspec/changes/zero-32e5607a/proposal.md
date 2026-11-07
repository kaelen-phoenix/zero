# Proposal

## Why

Cuando el turno nocturno construye por su cuenta una propuesta y la deja esperando antes de integrarla, la pregunta que recibís va a dar el motivo real. Si la línea tiene autonomía `build`, lo sigue diciendo así. Si la línea tiene `auto` pero la propuesta nace de una nota de investigación y `research.autonomy` la limita a `build`, lo dice, para que sepas qué ajuste mirar. Lo mismo pasa con el comentario que la fábrica deja en el issue de la propuesta cuando el turno nocturno la toma: habla de la autonomía de la propuesta y, si no coincide con la de la línea, explica de dónde viene el límite. Nada cambia en lo que la fábrica decide: solo cambia lo que te muestra.

## What Changes

- Turno nocturno: decir el motivo real de la espera cuando el límite no viene de la línea
- Supuesto: Assumption: the comparison uses the line's autonomy at the time the text is built (`lineAutonomy` now), not when the proposal was taken; if the setting changed in between, the text names the line's current autonomy.
- Supuesto: Assumption: a research-born proposal whose autonomy differs from the line's is limited by `research.autonomy` (that is what `proposalAutonomy` does today). For any other difference (no research note) the text only names both autonomies and gives no cause.
- Supuesto: `testFactory`'s default `nightShift` setting may not give `build` for a line, so the new tests must set `nightShift.autonomy` explicitly or the 'line has build' case may not hold.
- Supuesto: `approvalText` gets its autonomy from the job's `source`; with no job or no autonomy it shows `?`, and a comparison against the line must not crash then.

## Capabilities

### New Capabilities
- `night-shift`: Turno nocturno: decir el motivo real de la espera cuando el límite no viene de la línea

### Modified Capabilities

## Impact

Generado por zero para el trabajo 32e5607a.

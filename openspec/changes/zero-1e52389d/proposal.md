# Proposal

## Why

Cuando pedís `zero destrabar`, la fábrica a veces cierra antes trabajos fallidos cuyo trabajo ya está en la rama principal. Hoy ese cierre no queda anotado, y el resultado solo dice que la línea no tiene trabas. Con este cambio, el resultado de la corrida dice cuántos trabajos cerró y cuáles, con la línea de cada uno. Por ejemplo: «cerró 2 trabajos que ya estaban resueltos (demo: a1b2c3d4, e5f6a7b8)». Lo vas a ver en `zero status`, en el panel y en el resumen diario. También queda anotado si la corrida se corta después de cerrarlos. Si no cerró nada, el texto queda igual que hoy, y los registros viejos se siguen leyendo.

## What Changes

- Destrabar a demanda: decir qué trabajos cerró porque ya estaban resueltos
- Supuesto: The request's example lists ids without line names, but it also asks to show each line's closures with its name. The spec always prefixes the ids with their line ('demo: a1b2c3d4'). If the person in charge wanted bare ids for a single line, the text format would need to change.
- Supuesto: The record is only rewritten at the run's end, so a daemon crash after `discardResolved` loses `closed`: `closeInterruptedUnjam` keeps the start record. The request did not ask for anything more.
- Supuesto: 'At most 5 ids' is an assumed bound; the request only asks for a bounded number.
- Supuesto: To cut a run after closing in a test, a line must still have jams after the closures (for example a second failed job that is not resolved) with the budget reached, or the abort signal must fire. Otherwise the run ends ok.
- Supuesto: The job id is the store's short id (8 characters in the examples); the text shows it as stored, without shortening it.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Destrabar a demanda: decir qué trabajos cerró porque ya estaban resueltos

## Impact

Generado por zero para el trabajo 1e52389d.

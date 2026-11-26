# Proposal

## Why

Cuando pedís `zero destrabar` (o usás el botón «Destrabar ahora» del panel, o el chat), la fábrica primero cierra sola los trabajos fallidos cuyo trabajo ya está en main. Hoy esos cierres no quedan en el registro de la corrida: solo ves «la línea demo no tiene trabas» y no sabés qué hizo la fábrica. Con este cambio, el registro de la corrida guarda la línea y el id de cada trabajo que cerró. `zero status`, el panel y el briefing van a decir, por ejemplo, «cerró 2 trabajos que ya estaban resueltos (demo: a1b2c3d4, e5f6a7b8)». Eso queda anotado aunque la corrida se corte después. Si no cerró ninguno, el texto queda igual que hoy. Los registros viejos se siguen leyendo.

## What Changes

- Destrabar a demanda: informar los trabajos que cerró porque ya estaban resueltos
- Supuesto: Assumption: the closures are also shown for a run still under way (describeUnjamRun's early return for runs without endedAt must add the segment too). If verification wants them only for ended runs, this is a one-line difference.
- Supuesto: Assumption: the ids are grouped by line in the text ('demo: a, b; blog: c'), since the request asks for each line's closures with its name. The request's example without line names was only an illustration.
- Supuesto: Rewriting the record on every closure adds kv writes. It is negligible, but the test 'while it runs, it has no end' must keep passing, because the in-progress record keeps startedAt without endedAt.
- Supuesto: Existing tests that compare whole records with toEqual (for example 'the record of a run') must not get `closed: []`. The field must be left out when it is empty.
- Supuesto: The daemon's own discardResolved (src/daemon.ts:388) may close a resolved job before the on-demand run starts. That job will not appear in the run's record, which is correct but may surprise a test that runs the daemon.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Destrabar a demanda: informar los trabajos que cerró porque ya estaban resueltos

## Impact

Generado por zero para el trabajo 8041abf7.

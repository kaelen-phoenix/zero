# Proposal

## Why

Sometimes the self-update can't switch to a new version because of a problem with the machine, such as a file held by another program on Windows. When that happens, zero tries again on its own later. Today you only see «no pudo pasar a X» and don't learn that another try is planned. After this change, `zero status`, the panel summary and the daily briefing show a calm line: «Autoactualización: vuelve a intentar pasar a <commit> a las HH:MM (intento N)». It goes away once no retry is pending.

## What Changes

- Autoactualización: mostrar el reintento pendiente por falla de la máquina
- Supuesto: Assumption: «intento N» means the number of the coming attempt, `tries + 1`, where `tries` is the count of consecutive machine failures. Using `tries` instead would read as the attempt that already failed.
- Supuesto: `resetTime` may render a time on another day with a weekday prefix (for example `lun 09:00`), so «a las lun 09:00» could read awkwardly for waits of up to 24 hours. Tests should check the stable text around the time, not the exact hour format.
- Supuesto: A pending retry can be shown together with the `no pudo pasar a X` history line. That is intended: one tells the past failure, the other the planned retry.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Autoactualización: mostrar el reintento pendiente por falla de la máquina

## Impact

Generado por zero para el trabajo 1130a7a1.

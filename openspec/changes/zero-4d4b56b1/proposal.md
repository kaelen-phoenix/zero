# Proposal

## Why

Ya no van a poder quedar dos daemons sobre la misma fábrica. El daemon toma un candado del sistema operativo sobre `daemon.lock` en ZERO_HOME, y el sistema lo libera solo si el proceso muere. `zero start` se niega mientras el candado esté tomado, aunque el proceso no responda, y te dice qué pid lo tiene. `zero shutdown` ahora espera a que el daemon se apague de verdad; si no lo hace en 60 segundos, te avisa con el pid y termina con error, así un ciclo de reintentos se entera. `zero status` te avisa si hay más de un proceso daemon en la máquina, y deja de decir "apagada" cuando hay un daemon colgado.

## What Changes

- Un único daemon garantizado por un candado del sistema operativo
- Supuesto: Supuesto: el candado se implementa con `BEGIN EXCLUSIVE` de `node:sqlite` (LockFileEx en Windows, fcntl en POSIX), porque Node no trae una API de candado y zero evita las dependencias nativas nuevas. No pude probarlo en esta estación porque el shell estaba denegado. Hay que confirmar con procesos reales que un `daemon.lock` de 0 bytes queda bloqueado para la lectura de otro proceso. Si la lectura no da SQLITE_BUSY, `daemonLockHeld` debe probar con un `BEGIN EXCLUSIVE` y ROLLBACK inmediatos con `busy_timeout` 0; el `busy_timeout` de 1000 ms de `acquireDaemonLock` tolera esa consulta breve.
- Supuesto: Supuesto: el tiempo máximo de `zero shutdown` es de 60 segundos, fijo, sin opción nueva en la CLI. Un apagado puede tardar más, porque el daemon espera a que termine la pasada de scout, que el apagado no corta. En ese caso `shutdown` termina con código 1 y el pid aunque el daemon se apague poco después, y `SHUTDOWN_KEY` queda puesta para que lo haga.
- Supuesto: `zero shutdown` antes salía enseguida con código 0, y ahora puede tardar hasta 60 segundos y salir con código 1. Un script que lo use tiene que contemplarlo.
- Supuesto: La línea de comandos de un proceso no dice su ZERO_HOME, así que un daemon de otra fábrica en la misma máquina cuenta en el aviso de `zero status`. Por eso el aviso solo informa, aclara ese caso y no afecta a la fábrica.
- Supuesto: Mientras un daemon colgado tenga el candado, `zero request` deja el trabajo en cola y no enciende otro daemon, así que ese trabajo no avanza hasta terminar ese proceso. Es el comportamiento pedido; `zero status` lo muestra como "no responde".
- Supuesto: Un daemon de la versión anterior, ya corriendo durante la actualización, no tiene candado. Por eso se mantiene la comprobación de la señal de vida, pero esa protección sigue siendo la débil hasta que ese daemon se reinicie.
- Supuesto: Los candados sobre un ZERO_HOME en una carpeta de red pueden no ser confiables, como cualquier SQLite en esas carpetas; `state.db` ya tiene esa misma limitación.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Un único daemon garantizado por un candado del sistema operativo

## Impact

Generado por zero para el trabajo 4d4b56b1.

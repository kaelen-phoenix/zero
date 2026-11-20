# Proposal

## Why

Encontré por qué la versión preparada se quedaba sin `dist`. Salió de leer `~/.zero/daemon.log`. En esta máquina, cuando un cambio de versión intenta borrar la carpeta `.zero-switch`, tarda unas 4 horas: adentro queda trabado el módulo de keyring, que el chat tiene abierto. Mientras tanto pasa esto: 1. A los 30 minutos la fábrica da ese cambio por muerto («switch left no result») y marca el commit como fallado, aunque el cambio sigue corriendo y a veces termina bien. Por eso 5507369 y 39e6130 figuran como fallados aunque se instalaron. 2. Prepara el commit siguiente y lanza otro cambio de versión. Así quedan dos o tres corriendo a la vez. 3. Cuando llega el resultado viejo y atrasado, la fábrica lo aplica al estado de ese momento y borra la carpeta preparada del commit nuevo (la de 5f03f2f), no la del commit al que pertenece el resultado. Ese otro cambio, al llegar su turno, encuentra «falta dist en la versión preparada». Con este cambio: - **Cada resultado se aplica solo a su propio cambio.** Un resultado atrasado queda en el historial. Si dice que la versión se instaló, ese commit deja de figurar como fallado. Pero no toca el estado actual ni la carpeta preparada de otro commit. - **Un solo cambio de versión a la vez.** El cambio tiene un candado propio. Mientras ese candado está tomado, la fábrica no lo da por muerto, no prepara otra versión y no lanza otro cambio. - **El cambio deja su resultado antes de limpiar.** Ya no borra al empezar lo que dejó un cambio anterior, y lo que no puede borrar no lo hace esperar horas. - **Los problemas de la máquina se reintentan más tarde.** Un archivo trabado (EPERM, EBUSY, EACCES, ENOTEMPTY), una versión preparada incompleta, una fábrica que no se apagó a tiempo o un cambio que no dejó resultado ya no marcan el commit como fallado para siempre. Se vuelve a intentar a la hora, con esperas que se duplican hasta un día. Un error real del commit, como un build que no compila o una versión que no arranca, sigue quedando como fallado. - **Si instalaste a mano la última versión**, es decir, si el HEAD de la instalación es igual a la punta del remoto, `self-update:state` queda limpio: sin fallados, sin problema y sin reintentos pendientes. Pasa en la revisión siguiente a que cambie el HEAD, sin esperar un día. Todo con pruebas.

## What Changes

- Self-update: results matched to their own switch, machine failures retried, hand installs cleaned up
- Supuesto: The diagnosis comes from ~/.zero/daemon.log. At 09:04 a daemon started by the 39e6130 switch imported the 08:26 result for 5507369, and `importSwitchResult` removed the current state's `dir`, which was 5f03f2f's prepared folder, so 5f03f2f's switch found 'falta dist' at 10:22. Why removing `.zero-switch` with the locked keyring .node takes about 4 hours on this machine is not explained by the code. Writing the result before cleanup and never removing the root avoid the wait, but leftover `old*` folders (each with its own node_modules) can pile up under `.zero-switch` while the chat's MCP server keeps the file open.
- Supuesto: The switch lock assumes the switch process ends (and its lock with it) when it hangs or is killed. A switch that hangs forever without dying would keep the factory from preparing new versions; zero status still shows the `switching`/`ready` state.
- Supuesto: Telling machine failures from real ones by EPERM/EBUSY/EACCES/ENOTEMPTY can mistake a real npm EPERM for the machine. The growing wait (up to 24 h) keeps that from burning resources, but such a commit is retried instead of being marked failed.
- Supuesto: The existing `failed` entries on this machine (6e78608, f81c7bf, 5507369, 39e6130, 5f03f2f) are cleared only when the check finds HEAD equal to the tip, which needs `selfUpdate.enabled`. They are not removed by a migration.
- Supuesto: `due` becoming async with a `git rev-parse HEAD` call adds one local git call per self-update pass, on the intake interval.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Self-update: results matched to their own switch, machine failures retried, hand installs cleaned up

## Impact

Generado por zero para el trabajo ae9aca29.

# Proposal

## Why

Vas a poder poner `codex: { sandbox: off }` en el archivo de la fábrica para que zero lance Codex sin su sandbox, que en esta máquina Windows no anda. Si no ponés nada, todo sigue como hoy, y el chat no puede cambiar esta opción. Con el sandbox apagado, zero controla el solo lectura por su cuenta. Saca una foto de la carpeta y del repositorio antes de cada llamada de lectura y los compara después. Si algo cambió, deshace solo lo que cambió esa llamada, sin tocar el trabajo sin guardar que ya tenías, y marca la llamada como fallida con un aviso que nombra los archivos. Si la caja de aislamiento está lista, Codex corre dentro de ella como cualquier motor, también en las pasadas de fondo (scout, research, reply y estaciones de paquetes). `zero status` avisa cuando Codex corre sin su sandbox. Las pruebas y los dos README quedan actualizados. Tené en cuenta un límite: fuera de la caja, Codex sin sandbox puede tocar cualquier cosa de tu máquina y salir a internet. Zero solo controla la carpeta de trabajo y su repositorio, y no revisa los archivos ignorados por git.

## What Changes

- Codex sin su sandbox, con la garantía de solo lectura a cargo de zero
- Supuesto: Fuera de la caja, `danger-full-access` deja a codex leer y escribir en toda la máquina y salir a internet. La comprobación solo cubre la carpeta de trabajo y su repositorio, así que no detecta cambios en otras carpetas, incluido `ZERO_HOME` con `zero.factory.yaml`, ni la lectura de secretos. Esto tiene que quedar dicho en los README y en el aviso de `zero status`.
- Supuesto: Supuesto: 'archivos fuera de git' significa archivos sin seguimiento no ignorados, como en el `git status` que pide el pedido. Los archivos ignorados (`.env`, `node_modules`) no se comparan, porque recorrerlos sería caro y `discardChanges` tampoco los toca. Un cambio ahí pasa sin aviso, y `verify` podría ejecutar después lo que quedó en `node_modules`.
- Supuesto: Scout y research corren con la carpeta de trabajo en `line.repo`, tu copia real. Si editás un archivo o se integra algo mientras dura la llamada (hasta 15 minutos), zero lo ve como un cambio de la llamada, lo revierte y marca la llamada como fallida. El árbol posterior queda en el log para recuperarlo, pero sus objetos sueltos se pueden perder con `git gc`. En cuanto a concurrencia, esta es la debilidad principal del diseño.
- Supuesto: No pude ejecutar `codex exec --help` ni buscar en la web, porque esos permisos están denegados en esta estación. La forma `-c approval_policy="never"` sale de lo que recuerdo de la CLI: se eligió porque `--ask-for-approval` no fue aceptada por `exec` en algunas versiones, y falta confirmarla con una corrida real en esta máquina. Las pruebas usan un codex falso, así que no lo detectarían.
- Supuesto: Supuesto: `spec` también queda cubierta aunque el pedido no la nombra, porque también es de lectura y la comprobación está en un único punto. Antes, una spec que escribía se descartaba y seguía; con la opción en `off`, esa llamada falla y se reintenta. Con la opción en `on` nada cambia.
- Supuesto: Supuesto: alcanza con el archivo de la fábrica para tomar la decisión, y no se agrega un comando ni una pregunta en `zero setup`.
- Supuesto: Supuesto: dentro de la caja codex usa las mismas banderas que con la opción en `on`, porque el pedido dice 'como cualquier motor'. Si el sandbox de Codex tampoco funcionara dentro de la caja, habría que tratarlo aparte.
- Supuesto: Con caja lista, las pasadas de fondo de codex pasan a necesitar una clave dentro de la caja, porque Codex solo admite claves ahí (`src/box/credentials.ts`). Sin credencial, la caja no se considera lista y codex corre en la máquina con la comprobación.
- Supuesto: El trabajo debbc57f no está integrado en esta rama y toca `codexEngine.run`, `codexInvocation` y `test/engines.test.ts`, así que puede haber conflictos al integrar los dos. Este cambio no depende de aquel.
- Supuesto: Un proceso nieto de codex que sobreviva a un corte por tiempo o cancelación puede escribir después de la comprobación. Ese cambio no se detecta.
- Supuesto: La foto usa `git` síncrono y escribe objetos sueltos en el repositorio de la línea. En repositorios grandes puede frenar un momento el bucle del daemon y deja objetos que limpia `git gc`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Codex sin su sandbox, con la garantía de solo lectura a cargo de zero

## Impact

Generado por zero para el trabajo 8f1281e0.

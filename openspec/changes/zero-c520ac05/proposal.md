# Proposal

## Why

En Windows, zero va a buscar `git`, `codex`, `agy` y los motores propios solo en las carpetas absolutas del PATH, y los va a lanzar por su ruta completa. Si una build deja un `git.exe` en la copia de trabajo o en el repositorio, zero lo ignora y usa el git verdadero, así ese archivo no corre en tu máquina, fuera de la caja. Si el programa no está en el PATH, falla como hoy y tampoco ejecuta lo que encuentre en esa carpeta. En otros sistemas no cambia nada. `sh` queda afuera, como pediste.

## What Changes

- Windows: no ejecutar binarios plantados en la copia de trabajo
- Supuesto: Supuesto: cuando el binario no está, se usa la primera opción que permitís, lanzar el nombre desde `dirname(process.execPath)`. Si esa carpeta tuviera un `git.exe` fuera del PATH, correría con el cwd equivocado. Es una carpeta de la persona a cargo, no de terceros, y `package-install.ts` ya la trata como confiable.
- Supuesto: El error de `git()` sin binario es hoy un TypeError (`r.stderr` nulo al llamar `.trim()`), según la documentación de Node y sin haberlo ejecutado. Se mantiene por pedido, así que las pruebas no fijan su texto, solo que lance.
- Supuesto: Un motor propio declarado con ruta relativa (`./x.exe`) sigue resolviéndose contra el cwd, que puede ser la copia de trabajo. Se deja igual porque lo declaró la persona a cargo y cambiarlo rompería esa forma de declarar motores.
- Supuesto: Una entrada de caché no se revalida: si git cambia de carpeta sin que cambie PATH, el daemon falla con ENOENT hasta reiniciarse. Falla sin ejecutar nada ajeno.
- Supuesto: Git sigue corriendo con cwd en la copia de trabajo, así que lee su configuración y sus hooks. Este cambio cubre qué binario se lanza, no lo que ese git haga después.
- Supuesto: La vulnerabilidad sale de leer el código y de cómo busca libuv, no de una reproducción. Las pruebas del binario plantado deben fallar antes del arreglo para confirmarla; si pasan antes, hay que decirlo en el informe. Solo corren en Windows, así que un CI en Linux no las ejercita.

## Capabilities

### New Capabilities

### Modified Capabilities
- `isolation-box`: Windows: no ejecutar binarios plantados en la copia de trabajo

## Impact

Generado por zero para el trabajo c520ac05.

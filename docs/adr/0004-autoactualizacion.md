# ADR 0004 — La fábrica se actualiza sola

- **Estado:** aceptado
- **Fecha:** 2026-11-11

## Contexto

Cuando se fusiona un pull request de la línea de zero, la instalación que corre (el daemon arranca de `dist/cli.js` en la carpeta de instalación) sigue con la versión vieja hasta que quien está a cargo hace pull, `npm ci`, compila y reinicia. La actualización toca el ciclo de vida del daemon: hay que apagarlo con trabajos en la cola y arrancar otro desde un código que todavía no corrió nunca en esta máquina.

## Decisión

### Apagada por defecto y solo desde el archivo

`selfUpdate` es un objeto estricto del archivo de la fábrica (`enabled`, `remote`, `branch`, `startTimeoutSeconds`) y viene apagado. Ninguna herramienta del chat lo escribe: cambiar qué código corre la fábrica es una decisión de quien está a cargo, en la terminal o en el archivo.

### Solo avances rápidos, preparados aparte

El daemon mira la rama de la instalación una vez por día y después de que se fusiona un trabajo de una línea cuyo repositorio es la carpeta de instalación. Solo toma un avance rápido desde el remoto configurado, con la carpeta en su rama, como raíz de su propio repositorio y sin cambios locales en archivos seguidos: si no, registra el problema, avisa una vez y no toca nada. La versión nueva se prepara en `<ZERO_HOME>/self-update/<commit>`, nunca en la carpeta que corre: un clon del commit, las mismas reglas de lock que los paquetes (npm ejecuta código de una dependencia de git aunque se pida `--ignore-scripts`), `npm ci --ignore-scripts`, `npm run build`, `node dist/cli.js --version` y una carga del archivo de la fábrica.

### Un commit que falló no se vuelve a intentar

Si la preparación falla, o la versión nueva no arranca, ese commit queda entre los fallidos y no se prepara de nuevo: reintentar un build roto cada día gastaría tiempo y llenaría el registro de avisos iguales. El commit siguiente del remoto sí se intenta.

### El cambio lo hace un proceso aparte, con módulos propios de Node

El daemon no puede reemplazarse a sí mismo mientras corre, y un `dist` a medio cambiar no puede cargar módulos del propio zero. Con la versión lista, el daemon deja de empezar trabajos; cuando no corre ninguno, copia el programa de cambio a `self-update/switch.mjs`, escribe `plan.json`, lo lanza desprendido como `zero start --detach` y se apaga por el camino normal, así los trabajos de la cola e interrumpidos siguen desde su punto de control en el daemon siguiente. Ese programa usa solo módulos propios de Node (`node:sqlite` para mirar el candado), no depende de nada de `node_modules` ni de `dist`, que son justo lo que mueve.

### El candado como prueba de arranque, y la vuelta atrás

Que el proceso exista no prueba que la fábrica funcione; que el daemon nuevo tome el candado del daemon sí, porque lo toma antes de tocar estado y solo después de cargar el archivo de la fábrica. Si no lo toma dentro de `startTimeoutSeconds`, el cambio mata el árbol de procesos que arrancó, vuelve a poner el `dist` y los `node_modules` anteriores (guardados en `self-update/previous`), lleva la rama al commit anterior con `git reset --keep` y arranca la versión anterior. El resultado (de qué commit a cuál, cuándo y cómo terminó) queda en `result.json`, que el daemon siguiente pasa al historial; `zero status`, el panel y el resumen avisan de una vuelta atrás o una falla.

## Consecuencias

- Una actualización que no se puede tomar sola (historia divergente, cambios locales) sigue pidiendo intervención, pero se avisa en lugar de quedar en silencio.
- Mientras una versión lista espera, la fábrica no empieza trabajos nuevos; los que corren terminan primero.
- Los paquetes de agentes no se actualizan por este camino: siguen con `zero package update`.

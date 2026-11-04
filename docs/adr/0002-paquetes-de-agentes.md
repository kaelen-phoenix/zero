# ADR 0002 — Paquetes de agentes

- **Estado:** aceptado
- **Fecha:** 2026-11-04

## Contexto

Quien está a cargo de una fábrica puede sumar agentes a medida en `zero.factory.yaml`, pero no tiene una forma de instalar de una sola vez agentes, instrucciones y skills, ni de compartirlos, ni de sumar trabajo propio mientras la fábrica está libre. Hace falta una forma genérica y gratuita de extender zero con agentes propios o de terceros, sin cambiar zero para cada uno.

## Decisión

Un paquete es una carpeta local o un paquete npm con un `zero-package.yaml` en su raíz. La lista `packages` del archivo de la fábrica declara lo instalado; lo que cada paquete trae se carga en memoria y nunca se escribe en ese archivo.

1. **Interfaz versionada.** El manifiesto dice `interface`, y zero acepta solo la versión que conoce. Así un paquete viejo o nuevo queda afuera con un motivo claro, en lugar de fallar a mitad de un trabajo. El `ctx` que recibe una estación es parte de esa interfaz.
2. **El código corre en el proceso de la fábrica, con permiso explícito.** Una estación es un módulo ES que se importa solo con `allowCode: true` en su entrada y con su carpeta real fuera de los repositorios de las líneas y de `worktrees` y `jobs`, donde escriben los agentes. Corre con los permisos del usuario: `allowCode` es un permiso y `ctx.secrets` un contrato, no un aislamiento. Se prefirió a un proceso o una caja aparte porque una estación necesita la base de estado, el presupuesto y el registro de la fábrica, y un sandbox a medias daría una seguridad que no tiene. La documentación lo dice sin rodeos.
3. **Un paquete roto queda afuera sin frenar la fábrica.** El cargador nunca lanza: el paquete con problemas queda afuera entero y se ve en `zero status`, en `zero package list` y una vez en el registro. La contracara es que, si queda afuera, sus revisores bloqueantes también se van y los trabajos siguen sin esa revisión. Se eligió así porque la línea nunca se bloquea sola, y el problema queda a la vista.
4. **El motor lo elige quien instala.** `engine` y `model` están en la entrada del archivo y no en el manifiesto, para que un tercero no pueda decidir dónde corre ni cuánto cuesta.
5. **Los agentes de una estación son de solo lectura en la interfaz 1**, en una carpeta vacía y sobre el tope compartido `limits.usdPerNight`. Corren en el host, como el resto del tiempo libre, así que su salida no se debe publicar sin filtrarla: eso queda a cargo del paquete.

## Consecuencias

- Los cambios al `ctx` que rompan paquetes existentes piden una interfaz nueva.
- La primera instalación real desde npm es la prueba verdadera del instalador: los tests usan uno falso. `--ignore-scripts` evita los scripts de instalación, así que un paquete que los necesite no queda completo.
- Node guarda en caché los módulos importados: un cambio en el código de una estación pide reiniciar la fábrica.

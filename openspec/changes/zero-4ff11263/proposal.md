# Proposal

## Why

Quien construye los cambios va a saber cuánto tarda cada comando de verificación de la línea, según las últimas corridas aprobadas. Si un comando ocupa más de un tercio del tiempo de build, zero le pide que no lo corra entero y que use solo los tests de los archivos que toca. zero sigue corriendo todos los comandos después, en verify. Además, cuando build se corta por tiempo, el intento siguiente recibe el motivo real: se llegó al límite de N minutos, lo hecho sigue en la copia de trabajo y hay que continuar desde ahí. No cambian los límites de verify, los comandos que corre ni la forma de contar los intentos.

## What Changes

- Decirle a build cuánto tarda cada comando de verify y explicarle cuándo lo cortó el reloj
- Supuesto: Supuesto: la duración se redondea hacia arriba al minuto, y un comando sin historial aparece como hoy aunque otro de la misma línea sí lo tenga.
- Supuesto: Supuesto: `openspec/changes/zero-4ff11263`, que zero escribe desde esta especificación, cumple el pedido de empezar con un cambio de OpenSpec.
- Supuesto: En un intento que resuelve conflictos, `startMerge` reinicia la copia antes de cada llamada. Por eso el feedback de tiempo no puede prometer ahí que lo hecho se conserva, y la especificación lo exceptúa.
- Supuesto: Lo no commiteado puede perderse antes del intento siguiente si el plan corta esa llamada, si el trabajo sigue en otra máquina o si la copia se vuelve a crear. El feedback describe la copia al momento del corte, y build.md ya pide empezar con `git status`.
- Supuesto: El historial es el de esta máquina y mezcla corridas dentro y fuera de la caja, igual que hoy para el límite de verify.
- Supuesto: El aviso es una instrucción al motor: zero no puede impedir que build corra la suite completa.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Decirle a build cuánto tarda cada comando de verify y explicarle cuándo lo cortó el reloj

## Impact

Generado por zero para el trabajo 4ff11263.

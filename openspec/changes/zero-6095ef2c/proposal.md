# Proposal

## Why

Con este cambio, los prompts de más de 30.000 caracteres ya no van a fallar seguro en Windows al arrancar Antigravity: zero los envía por la entrada estándar (stdin) y en `-p` deja solo una instrucción corta. Si usás Antigravity con prompts más cortos, no vas a notar ninguna diferencia, porque la llamada sigue igual. También se agrega una protección: si `agy` termina sin leer un prompt largo, o no está instalado, la llamada termina con su resultado o su error normal y el proceso de zero no se cae. Falta confirmar con `agy` real que lea el prompt por stdin, así que el caso largo pasa a ser un intento posible, no un éxito garantizado.

## What Changes

- Antigravity: enviar por stdin los prompts que no entran en la línea de comandos
- Supuesto: Nadie comprobó con `agy` real cómo combina `-p` con stdin: el dato viene de la nota 902e4190 y no se ejecutó `agy --help`. Si `agy` ignora stdin, el prompt largo sigue fallando o puede dar una respuesta sin contexto. Si esa respuesta sale con código 0, zero la trata como buena; las estaciones con esquema igual validan su formato. Las pruebas usan un proceso falso, así que no cubren esto.
- Supuesto: El umbral se aplica en todas las plataformas, como dice el pedido. En Linux y macOS, los prompts de más de 30.000 caracteres que hoy pueden entrar como argumento pasan también a la vía de stdin sin comprobar, así que ahí un caso que funciona podría dejar de funcionar.
- Supuesto: Supuesto: se agregó el listener de `error` en stdin aunque el pedido no lo menciona. `runProcess` no escucha errores de `child.stdin` y `src/` no tiene un manejador de `uncaughtException`. Por cómo funciona Node, escribir un prompt grande a un proceso que termina sin leerlo debería emitir EPIPE sin que nadie lo atienda y tumbar el daemon. No se pudo ejecutar para confirmarlo, porque esta estación no tuvo acceso a la consola. El listener también cubre a codex y a los motores personalizados que reciben el prompt por stdin, sin cambiar su resultado normal.
- Supuesto: Supuesto: el umbral se mide con `.length` de JavaScript (unidades UTF-16), la misma unidad del límite de Windows, y el pedido no define otra. Los 2.767 caracteres de margen hasta 32.767 alcanzan para las flags, salvo con un valor de `--model` o una ruta de binario desmesurados.
- Supuesto: Supuesto: el texto exacto de la instrucción corta lo fijó esta especificación, porque el pedido solo la describe, para que las pruebas puedan verificarlo.
- Supuesto: Los motores personalizados con `{prompt}` siguen con la misma limitación de línea de comandos, por decisión expresa del pedido.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Antigravity: enviar por stdin los prompts que no entran en la línea de comandos

## Impact

Generado por zero para el trabajo 6095ef2c.

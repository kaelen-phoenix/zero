# Proposal

## Why

Hoy, si antigravity, codex o un motor personalizado termina con código 0 sin devolver nada, el trabajo recibe una respuesta vacía como si fuera buena. Con este cambio, ese caso pasa a ser un error claro del motor: "<motor> devolvió salida vacía", seguido del final de lo que el motor haya escrito en stderr, si escribió algo. Codex sigue funcionando normalmente cuando deja su respuesta en el archivo del último mensaje, aunque no escriba nada en stdout. No cambian las flags ni las versiones de agy. Una consecuencia a tener en cuenta: un motor personalizado que escribe archivos y termina sin imprimir nada ahora va a fallar, y tiene que imprimir al menos una línea.

## What Changes

- Motores CLI: una salida vacía con código 0 cuenta como fallo
- Supuesto: Cambio de comportamiento: un motor personalizado de escritura que hace su trabajo en archivos y termina sin imprimir nada hoy pasa como bueno, y con esto falla el intento. El pedido incluye a los motores personalizados sin excepción, así que se aplica igual.
- Supuesto: Supuesto: si el archivo de codex existe pero está vacío, el resultado es fallo aunque stdout tenga texto, porque el pedido dice 'cuando el último mensaje leído queda vacío'. Si el archivo no se puede leer, se mantiene el respaldo actual a stdout.
- Supuesto: Supuesto: una envoltura JSON con la clave de texto vacía, como `{"result":""}`, cuenta como salida vacía porque la regla se aplica sobre `finalText`. Una envoltura sin claves de texto reconocidas, como `{"foo":1}`, sigue siendo éxito con el JSON crudo como texto.
- Supuesto: Supuesto: el mensaje queda en español tal como lo pide el pedido, aunque los otros errores de `execute` estén en inglés.
- Supuesto: En estaciones con schema, el error visible pasa de `invalid structured output` al de salida vacía; es la mejora buscada, pero una prueba o un texto que dependa del mensaje anterior tendría que ajustarse.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Motores CLI: una salida vacía con código 0 cuenta como fallo

## Impact

Generado por zero para el trabajo b5186973.

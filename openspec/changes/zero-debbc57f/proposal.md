# Proposal

## Why

Las estaciones que piden una respuesta estructurada con campos opcionales ya no van a fallar con el error 400 de `codex exec`. Antes de llamar a codex, zero traduce el esquema al formato estricto de OpenAI: todos los campos pasan a ser obligatorios y los opcionales aceptan null. Al recibir la respuesta, saca esos null para que la validación siga igual que con Claude. Claude, Antigravity y los motores propios no cambian. Con esto, scout y la estación community deberían poder correr con `engine: codex`; las pruebas lo comprueban con un codex simulado, así que falta confirmarlo una vez con el codex real. Si un esquema no se puede expresar en modo estricto (por ejemplo, un diccionario de claves libres), vas a recibir un error claro que dice dónde está el problema, sin llegar a llamar a codex.

## What Changes

- Salida estructurada de codex compatible con el modo estricto de OpenAI
- Supuesto: No se probó contra OpenAI: las pruebas usan un codex falso y un verificador escrito según las reglas documentadas. Si el backend de una sesión de ChatGPT es más exigente que la documentación (límites de profundidad o de cantidad de propiedades, palabras clave), puede aparecer otro 400. El pedido dice que scout y el CM 'deberían' poder correr: eso queda sin confirmar hasta una corrida real.
- Supuesto: Supuesto no pedido explícitamente: un esquema sin equivalente estricto (record, allOf, unknown, tuple) se rechaza con un error claro antes de llamar a codex. Forzar additionalProperties false en un diccionario haría que el modelo solo pudiera responder `{}`, y esa respuesta validaría sin datos. Hoy esos esquemas ya fallan con 400, así que no se pierde nada que funcione.
- Supuesto: Supuesto: se quita `pattern` aunque OpenAI lo documenta, porque zod genera regex con lookahead (por ejemplo, en email) que el modo estricto podría rechazar. Las restricciones quitadas (pattern, minLength, etc.) ya no guían al modelo: sigue validando el esquema zod, y una respuesta que no cumpla termina como `invalid structured output`, no como dato malo.
- Supuesto: Un campo con `.default()` figura en required en el JSON Schema de zod (modo `output`), así que en el esquema estricto el modelo debe dar un valor y no puede mandar null. Es correcto y está cubierto por scout (`thirdParty`, `commercial`), pero un null ahí fallaría la validación.
- Supuesto: En un campo opcional y nullable a la vez, un null intencional se convierte en ausencia. Es válido para el esquema original, aunque una estación que distinga entre null y ausente perdería esa diferencia.
- Supuesto: Si la elección de rama de una unión ambigua toma una rama que no es la que el modelo quiso, los null se quitan según esa rama; el resultado lo valida igual el esquema zod, que puede rechazarlo.
- Supuesto: `text` conserva el mensaje original con null: solo `output` queda limpio. El runner usa `result.output` primero, así que no afecta la validación.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Salida estructurada de codex compatible con el modo estricto de OpenAI

## Impact

Generado por zero para el trabajo debbc57f.

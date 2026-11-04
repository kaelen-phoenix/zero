# Proposal

## Why

Si un trabajo se topa con un corte de red pasajero (ECONNRESET, ETIMEDOUT, EAI_AGAIN, ECONNREFUSED o EPIPE), ya no termina en fallo: vuelve a la cola y sigue desde su último punto de control, sin repetir el gasto de las estaciones ya completadas. Cada trabajo tiene hasta 2 reintentos de este tipo. Si se agotan, o si el error es de otra clase, falla como hasta ahora. Si al reintentar la integración GitHub responde que la solicitud de cambio ya existe, el trabajo no crea un duplicado ni falla: queda esperando tu respuesta con la pregunta de integración bloqueada que ya conocés.

## What Changes

- Reintentar desde el punto de control tras un corte de red pasajero
- Supuesto: Supuesto: revisar también la cadena de `cause` amplía apenas el pedido (`code` o mensaje), porque los errores de `fetch` suelen traer el código en la causa y el mensaje queda en `fetch failed`.
- Supuesto: Supuesto: descartar cambios y no contar el intento amplía la frase 'igual que la rama de Interrupted'. Sin eso, un corte en el último intento agotaría los intentos con un mensaje engañoso y un archivo a medio escribir podría entrar en el commit siguiente.
- Supuesto: Supuesto: el contador no se reinicia; son 2 reintentos por trabajo en toda su vida, también después de una aprobación.
- Supuesto: No hay espera entre reintentos: el daemon retoma el trabajo en la vuelta siguiente (unos 2 segundos). Un corte largo puede agotar los 2 reintentos enseguida, sobre todo si falla en la integración, donde no hay un agente que demore.
- Supuesto: Coincidir por mensaje puede dar falsos positivos si un error ajeno cita uno de esos códigos; el costo está acotado a 2 reintentos, y el caso conocido (la salida de setup) queda excluido.
- Supuesto: Si los reintentos se agotan justo después de que GitHub creó la solicitud de cambio, el trabajo termina `failed` aunque esa solicitud exista. Es lo que el pedido indica al agotar el tope.
- Supuesto: Una solicitud de cambio cerrada no aparece en el listado (`state: open`), así que un reintento podría abrir otra junto a la cerrada; solo pasaría si alguien la cierra entre el corte y el reintento.
- Supuesto: Una excepción dentro de `buildLoop` deja abierto el span `zero.attempt`, como ya pasa hoy con los fallos. Con reintentos, un mismo trabajo puede mostrar en su traza un intento sin cerrar.
- Supuesto: No se identificó qué llamada produjo el fallo del trabajo 26897dc6, así que no hay garantía de que ese caso concreto llegue a este catch. Los motores que devuelven `ok: false` siguen por el camino normal de intentos.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Reintentar desde el punto de control tras un corte de red pasajero

## Impact

Generado por zero para el trabajo 91f76269.

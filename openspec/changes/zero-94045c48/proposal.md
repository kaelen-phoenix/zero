# Proposal

## Why

Los botones del panel (aprobar o rechazar propuestas, pedir trabajo, detener y demás) vuelven a funcionar, tanto en local como desde el celular por el túnel, sin el cartel "Pedido de otro sitio rechazado". Los pedidos que vienen de otros sitios se siguen rechazando, y el panel sigue sin mandar el Referer a otros sitios.

Pedido original: "Bug del panel: al aprobar o rechazar propuestas (y probablemente en toda acción por formulario POST) sale "Pedido de otro sitio rechazado", desde el celular por el túnel y también en local. Causa: el panel manda `Referrer-Policy: no-referrer` (src/panel/server.ts:101 y el meta en html.ts:99). Con esa política, por el estándar Fetch, el navegador envía `Origin: null` en los POST de formularios aunque sean del mismo sitio, y `sameOrigin` (server.ts:43) hace `new URL("null")`, falla y rechaza. Arreglo: cambiar la política a `same-origin` (no manda Referer a otros sitios, que es lo que se buscaba; la clave va en el fragmento y nunca viaja en el Referer) en el encabezado y en el meta, y en `sameOrigin` aceptar `Origin: null` solo cuando `Sec-Fetch-Site` es `same-origin`. Seguir rechazando pedidos de otros sitios. Tests del servidor del panel para: POST con Origin igual al Host (pasa), Origin null + Sec-Fetch-Site same-origin (pasa), Origin null sin Sec-Fetch-Site (rechaza), Origin de otro sitio (rechaza), Sec-Fetch-Site cross-site (rechaza). Es urgente: hacerlo antes que los otros pedidos de zero en cola."

## What Changes

- Panel: aceptar los formularios propios con Origin null y usar Referrer-Policy same-origin
- Supuesto: Los tests simulan los encabezados con `fetch` de Node, así que no prueban un navegador real. Conviene que el dueño apruebe una propuesta de verdad, en local y por el túnel, después de la entrega.
- Supuesto: Un `Sec-Fetch-Site` lo manda el navegador y no se puede falsificar desde una página web, pero sí desde un cliente que no sea navegador. Ese cliente igual necesita la cookie de sesión, así que no abre un camino nuevo.
- Supuesto: Supuesto: se mantiene sin cambios el comportamiento actual de aceptar un POST sin `Origin` (los tests existentes dependen de eso) y `POST /login` sigue sin pasar por `sameOrigin`; el pedido no pide cambiar ninguno de los dos.
- Supuesto: Con `same-origin`, el Referer ahora viaja dentro del panel, con ruta y parámetros como `msg`. La clave no se expone: va en el fragmento, que nunca forma parte del Referer.
- Supuesto: El pedido dice que es urgente y debe hacerse antes que otros en cola. Eso es orden de la cola y esta especificación no lo cambia; este trabajo ya está en curso.

## Capabilities

### New Capabilities
- `control-panel`: Panel: aceptar los formularios propios con Origin null y usar Referrer-Policy same-origin

### Modified Capabilities

## Impact

Generado por zero para el trabajo 94045c48.

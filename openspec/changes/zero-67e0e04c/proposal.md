# Proposal

## Why

Vas a poder darle a otra persona (un cliente, alguien de tu equipo) un link propio al panel que solo le muestra lo que le corresponde. Lo creás con `zero panel invitar <nombre> --solo <paquete o paquete/pestaña>` o desde la nueva sección "Invitados" de tu panel. La lista, el registro de lo que hizo cada invitado y la revocación están en los dos lugares. El invitado entra con su clave, distinta de la tuya, también desde el celular por el túnel. Ve un panel aparte, con un menú que solo tiene sus pestañas y sus formularios. No puede ver las líneas, el estado de la fábrica, los ajustes ni los secretos, y no puede fusionar, detener, aprobar ni cambiar las salidas a internet. Lo que no esté en su lista le responde "esa página no existe". Cada paquete declara qué pestañas y acciones se pueden ofrecer a invitados y si se reparten por un alcance (por ejemplo, una marca). Quién ve y pide qué lo controla zero en el servidor: un invitado limitado a un valor solo ve los elementos y archivos marcados con ese valor, y solo puede pedir trabajo para ese valor. Revocarlo corta su acceso desde el pedido siguiente. El link se muestra una sola vez, porque zero guarda solo una huella de la clave. Si se pierde, revocás y volvés a invitar.

## What Changes

- Accesos limitados al panel para invitados
- Supuesto: Assumption: the link is shown once and only a hash is kept. If it is lost, the person in charge revokes and invites again. With a quick tunnel the address changes on each restart, so the guest pastes the same key at the new address; panel.tunnel.hostname avoids it.
- Supuesto: Assumption: revoking does not undo a run already accepted, and a download already being sent may finish; everything requested afterwards is cut.
- Supuesto: zero enforces which scope value reaches the station, but the station's own code decides what it does with it. That is why only stations the manifest offers to guests can be asked.
- Supuesto: A guest's runs spend the same caps as any on-demand run, and a pending run of theirs blocks another one of that station until it starts. There is no daily limit per guest in this change.
- Supuesto: Older zero versions refuse a manifest with `guests` as an unknown key, as with previous manifest additions.
- Supuesto: `paquete/nombre` grants both the tab and the station when they share a name; the invitation prints exactly what it allows.
- Supuesto: Other unmerged work touches src/panel/server.ts, src/panel/html.ts, src/cli.ts and the READMEs (the new-project form, distributed third part), so merge conflicts are likely. New files keep the overlap small.

## Capabilities

### New Capabilities
- `control-panel`: Accesos limitados al panel para invitados

### Modified Capabilities

## Impact

Generado por zero para el trabajo 67e0e04c.

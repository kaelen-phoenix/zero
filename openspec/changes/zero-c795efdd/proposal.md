# Proposal

## Why

Vas a poder decidir qué versión de zero corre cada instalación. - **Liberar una versión.** Desde la terminal de la fábrica principal, `zero liberar <commit o versión>` publica una etiqueta `vX.Y.Z` en GitHub. Antes te muestra qué va a publicar y te pide confirmación. Con `--line` libera otro proyecto, por ejemplo el de un paquete. Nunca mueve una versión ya liberada ni libera algo que no esté en la rama principal. - **Elegir el canal.** En el archivo de la fábrica, `selfUpdate: { channel: estable }` hace que esa instalación solo pase a versiones liberadas. `channel: ultimo` es lo de hoy. - Con `enabled: true` la instalación se actualiza sola dentro de su canal. - Con `enabled: false` solo avisa que hay una versión nueva y espera tu pedido. - **Actualizar cuando quieras.** `zero actualizar`, un botón en el panel y una herramienta del chat pasan a la última versión del canal. Usan el mismo cambio seguro de hoy: esperan a que no haya trabajos corriendo y vuelven atrás si algo falla. Desde el chat remoto, el pedido espera tu confirmación. - **Paquetes instalados desde git.** Pueden seguir el canal estable (`zero package add <fuente> --canal estable`) o quedar fijos en una etiqueta, que cambiás con `zero package update <nombre> --etiqueta <etiqueta>`. Los del canal estable se actualizan solos al liberarse una versión solo si la autoactualización está encendida. Si la versión nueva pide más permisos, te espera. - **Verlo.** `zero status` y el panel muestran el canal, la versión actual y si hay una nueva. Lo mismo se ve por paquete en `zero package list` y en la pestaña Paquetes. Si no ponés `channel`, nada cambia: ni lo que se hace solo ni lo que se muestra.

## What Changes

- Canales de actualización: versiones liberadas y actualización a pedido
- Supuesto: Supuesto: `enabled` decide si la instalación se actualiza sola y `channel` decide hacia dónde. Para quedarte en estable y actualizar solo a pedido: `selfUpdate: { channel: estable }`, sin `enabled`.
- Supuesto: Supuesto: con `channel` ausente, `zero actualizar` existe y funciona como `ultimo` (es un pedido explícito); nada automático ni visible cambia.
- Supuesto: Supuesto: liberar es publicar solo una etiqueta `vX.Y.Z` con git push y las credenciales de git de la persona, sin crear una página de release en GitHub. Las demás instalaciones la leen con git, sin token de la API.
- Supuesto: Las instalaciones solo avanzan: no se puede volver a una versión liberada anterior. Una instalación que hoy está adelante de la última liberada espera a una liberada que la contenga.
- Supuesto: Supuesto: las etiquetas `vX.Y.Z` que ya existan en un repositorio, aunque no las haya publicado `zero liberar`, cuentan como versiones liberadas.
- Supuesto: El cambio de versión espera solo a los trabajos, como hoy: los turnos de las estaciones de paquetes en curso se cortan. En una instalación que solo corre el CM conviene pedir la actualización cuando no esté publicando (ver followUps).
- Supuesto: Los paquetes estables se revisan una vez por día, así que una versión nueva puede tardar hasta un día en aplicarse sola; `zero package update` la toma en el momento.
- Supuesto: La actualización de paquetes sigue siendo por terminal (pide confirmación si el paquete pide más); no se agrega al chat ni al panel.
- Supuesto: En Docker la instalación no es un repositorio de git, así que `zero actualizar` responde con ese motivo y no hace nada.
- Supuesto: La especificación previa dice que el daemon no comprueba nada con `enabled` falso; este cambio agrega dos excepciones: `channel` definido (solo mirar) y un pedido explícito.

## Capabilities

### New Capabilities

### Modified Capabilities
- `factory-daemon`: Canales de actualización: versiones liberadas y actualización a pedido

## Impact

Generado por zero para el trabajo c795efdd.

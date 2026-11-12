# Proposal

## Why

El panel suma una sección nueva, "Pedidos" (/requests), en el menú. Arriba hay un formulario para pedir un trabajo con línea, tipo de pedido (función nueva, arreglo, seguridad, diseño, documentación, otro), título y descripción. El tipo viaja dentro del texto del pedido, así que la fábrica lo ve. Debajo aparece la lista de pedidos, del más nuevo al más viejo, con su estado, línea y antigüedad ("hace 3 h"). Se puede filtrar por línea y por estado. Cada pedido tiene sus acciones: ver detalle y traza, responder la pregunta pendiente si te está esperando, y frenarlo. Frenar primero te pide confirmación. Todo pasa por app.ts, igual que la terminal y el chat. Las prioridades (baja, media, alta, urgente, con el aviso para urgente) y el menú lateral con los colores de marca todavía no están en main. Por eso esta parte no los incluye y usa el diseño actual del panel; se suman cuando lleguen.

## What Changes

- Panel: sección Pedidos con formulario por tipo, lista filtrable y acciones por pedido
- Supuesto: Priorities (baja/media/alta/urgente, the warning before urgente, changing the priority, the priority column) are left out because no priority exists in main as of 2fe68ab. If another branch adds them first, this page must be extended to include them.
- Supuesto: The sidebar and brand colours (redesign part 1) are not in main, so the page uses the current flat header. Whichever part merges second may conflict with `page()`.
- Supuesto: The type is stored only inside the request text (`Tipo de pedido: …`), not as its own column, so the list cannot filter by type. Adding that later means a store migration.
- Supuesto: Assumption: answering from the list needs no confirmation step, consistent with the existing answer forms; only stop gets one. Rejecting also stops a job, so this could be read as needing confirmation too.
- Supuesto: The page reloads every 15 s through REFRESH. Typing in the title input or the textarea pauses it, but a line or type chosen in the selects without typing anything can be lost on reload.
- Supuesto: test/docs.test.ts requires README.md and README.es.md to keep the same structure and code blocks, and test/wording.test.ts checks the vos/you wording on new Spanish text.

## Capabilities

### New Capabilities
- `control-panel`: Panel: sección Pedidos con formulario por tipo, lista filtrable y acciones por pedido

### Modified Capabilities

## Impact

Generado por zero para el trabajo 35346a5c.

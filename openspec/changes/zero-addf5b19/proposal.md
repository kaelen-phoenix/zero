# Proposal

## Why

El panel va a verse como un panel profesional moderno. A la izquierda va a haber un menú con un ícono para cada sección: resumen y pedidos, línea de producción, salidas, propuestas, investigación, informe, informe mensual, qué es zero y agentes. El menú se puede contraer para dejar solo los íconos, y en el celular se convierte en un menú desplegable que se abre con un botón. Va a tener los colores, el logo y las tipografías de la web de zero, y cambia solo entre modo claro y oscuro según cómo tengas configurado el equipo. La línea de producción pasa a ser un tablero: cada estación es una columna, más una columna final de salida, y cada trabajo es una tarjeta compacta en la columna donde está. Todo entra en el ancho de la pantalla sin desplazarse hacia los costados, y en el celular las columnas se apilan. Los estados usan siempre los mismos colores en todo el panel: en curso, esperándote, entregado, con error, detenido y en cola. No cambia nada de la seguridad: el panel sigue pidiendo la clave, rechaza pedidos de otros sitios, toda acción pasa por la fábrica igual que hoy, las confirmaciones siguen y no se carga nada de internet.

## What Changes

- Panel de control profesional: menú lateral, marca de zero y línea de producción como tablero
- Supuesto: Assumption: the site loads no web fonts (site/styles.css uses only system stacks), so 'las fuentes de la web' means those same system and mono stacks. No font files are embedded.
- Supuesto: Assumption: light and dark follow the system setting (prefers-color-scheme). A manual theme switch would need a second script on every page, and the current tests require every `<script>` on `/line` to be the line refresh, so it is a follow-up.
- Supuesto: Packages cannot add panel tabs today (src/packages.ts has no panel extension point), so the menu holds only the existing sections, built from a `NAV` table that a later change can extend. 'Pedidos' maps to the existing overview `/` (Resumen), which already has the lists and the 'Pedir un trabajo' form. 'Informe' covers both `/briefing` and `/report`.
- Supuesto: The redesign replaces the belt/piece markup that many tests in test/panel-line.test.ts pin (`piece out ok`, `--pos:2`, `card row final`, the `rowOf` helper), so the build must update those tests to the new contract without weakening what they check.
- Supuesto: The live-update script runs in the browser and the test suite has no DOM, so in-page patching (moving cards, keeping details open) is checked only through the fragment contents and the script's text.
- Supuesto: An earlier run's `npm test` took about 20 minutes and hit the time limit, and the stream test in panel-line.test.ts was flaky. New tests should render HTML directly instead of starting more servers and should not add timing-based stream tests.
- Supuesto: 'Without scrolling' holds horizontally. With many finished jobs the `out` lane scrolls inside its own height, and on a phone the stacked lanes scroll the page vertically, which is unavoidable on a small screen.

## Capabilities

### New Capabilities
- `control-panel`: Panel de control profesional: menú lateral, marca de zero y línea de producción como tablero

### Modified Capabilities

## Impact

Generado por zero para el trabajo addf5b19.

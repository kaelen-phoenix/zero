# Proposal

## Why

La imagen principal del sitio pasa a parecerse a la línea de montaje del panel: una cinta con las seis estaciones en fila (spec, build, verify, review, security, integrate) y varios trabajos avanzando entre ellas. Sigue siendo minimalista, con los mismos colores en modo claro y oscuro, y se puede leer con lector de pantalla. Los textos cuentan el nombre de otra manera: «zero in the loop» no saca a la persona del circuito, suma a zero a su lado. La persona sigue teniendo trabajo, delega más o menos según lo que sabe y la confianza que tenga, y sigue decidiendo qué se hace y dónde entra. Ese relato se conecta con los niveles L0 a L3: cuanto más delegás, más hace sola la fábrica. Se cambian el lema del hero, la descripción de la página y el texto de la sección de CI que decía que zero «hace el trabajo de las personas», en español y en inglés, y se actualizan los tests del sitio.

Pedido original: "Sitio web (site/): mejorar la imagen principal del hero y el texto. 1) Imagen: que se parezca más a la línea de montaje del panel (la vista /line: estaciones en fila — spec, código, verificación, revisión, seguridad, integración — con los trabajos avanzando entre ellas), pero manteniendo el minimalismo y la paleta de colores actual de la web, en claro y oscuro. Sigue siendo un SVG liviano, accesible (título y descripción), sin librerías nuevas. 2) Texto, a partir del nombre: "zero in the loop" no reemplaza a "human in the loop": suma a zero al circuito, al lado de la persona, que no sale del circuito. De ahí seguir el relato: la persona no se queda sin trabajo; tiene muchas tareas y, según lo que sabe y la confianza que tenga, delega más o menos en la fábrica, y sigue decidiendo qué se hace y dónde entra ella. Conectarlo con los niveles de autonomía (L0 a L3): cuanto más delegás, más hace sola la fábrica. Reescribir el lema del hero ("La fábrica ocupa el lugar del humano en el circuito...") y los textos que digan que zero hace "el trabajo de las personas" o que ocupa su lugar, para que queden en ese tono. Humano y cercano, sin prometer de más. Hacerlo en español y en inglés (las dos versiones del sitio) y actualizar los tests del sitio si hace falta."

## What Changes

- Sitio: hero con la línea de montaje y relato de «zero in the loop» (zero se suma, la persona sigue)
- Supuesto: Las etiquetas de las estaciones en la figura quedan con los nombres de código (spec, build, verify…), como en el resto del sitio, y no en castellano como en el panel (especificación, construcción…). Traducirlas obligaría a sumar claves data-i18n por estación. Es una decisión de alcance.
- Supuesto: og.png (la imagen para redes) sigue mostrando la figura vieja, y og:image:alt habla de 'el dueño como un punto que vuelve a entrar'. Se deja así porque describe esa imagen; regenerarla queda como seguimiento.
- Supuesto: README.md:5 y README.es.md:5 siguen con el lema viejo ('takes the human's place' / 'ocupa el lugar del humano'), y la línea 101 de los dos con 'does the work of the people' / 'hace el trabajo de las personas'. El pedido es solo del sitio, así que el sitio y el README quedan desalineados hasta un cambio aparte.
- Supuesto: El texto exacto queda a criterio de build. Los tests solo verifican frases prohibidas y conceptos clave, no la calidad del tono.
- Supuesto: El markup tiene una sección de capacitaciones (data-lang-only) con su propio conteo de marcadores. Agregar párrafos no debe tocar los marcadores ni el orden de las secciones.

## Capabilities

### New Capabilities
- `project-site`: Sitio: hero con la línea de montaje y relato de «zero in the loop» (zero se suma, la persona sigue)

### Modified Capabilities

## Impact

Generado por zero para el trabajo 943e22bf.

# Proposal

## Why

El pie de zerointheloop.com va a tener un ícono simple y de un solo color que abre el WhatsApp de zero in the loop (+54 9 11 5981-3335) en una pestaña nueva, con el mensaje inicial ya escrito. Los lectores de pantalla lo anuncian como "WhatsApp de zero in the loop". En inglés, tanto ese texto como el mensaje inicial aparecen en inglés. La sección de Capacitaciones, que es el único lugar del sitio que invita a escribir, suma una línea con el número. Esa sección solo se ve en español. No se agrega el teléfono a datos estructurados porque el sitio no tiene JSON-LD, y vos lo pediste solo si existía.

Pedido original: "Agregar el WhatsApp empresarial de zero in the loop al sitio zerointheloop.com (carpeta site/): +54 9 11 5981-3335, link https://wa.me/5491159813335 con un mensaje inicial prellenado corto ("Hola, quiero saber más sobre zero in the loop"). Ponerlo en el pie de todas las páginas junto a los demás links (GitHub, Instagram), con un ícono de WhatsApp simple y monocromo acorde al estilo minimalista, texto accesible "WhatsApp de zero in the loop", abriendo en pestaña nueva con rel="noopener". Si hay una sección o llamado de contacto, sumarlo ahí también como forma de escribir. Agregar el teléfono (contactPoint/telephone) al JSON-LD de la organización si existe. En los dos idiomas del sitio si los hay. Si el link de Instagram del pie (trabajo 9b033ab7) ya está integrado, mantener el mismo estilo de íconos."

## What Changes

- WhatsApp de zero in the loop en el sitio
- Supuesto: Supuesto: el sitio tiene una sola página (`site/index.html`), así que 'todas las páginas' es ese único pie.
- Supuesto: Supuesto: no se agrega JSON-LD. Hoy no hay ningún bloque `application/ld+json` en `site/`, y el pedido decía sumar el teléfono solo si existía.
- Supuesto: Supuesto: no hay una sección de contacto. El único llamado a escribir es Capacitaciones (los botones abren el correo), así que la línea de WhatsApp va ahí. Esa sección se oculta en inglés, de modo que en inglés WhatsApp aparece solo en el pie.
- Supuesto: Supuesto: el trabajo de Instagram (9b033ab7) no está en esta base: `site/` no menciona Instagram. Este cambio replica lo que ese trabajo especificó (clase `social`, SVG con `currentColor`, solo ícono, `data-i18n-label`). Si los dos se entregan por separado, pueden chocar en el pie y en `styles.css`, y el segundo tendrá que resolver el conflicto dejando WhatsApp después de Instagram.
- Supuesto: Supuesto: el pedido dio el mensaje inicial y el texto accesible solo en español. Las versiones en inglés ("Hi, I want to know more about zero in the loop" y "zero in the loop on WhatsApp") son traducciones elegidas para este cambio.
- Supuesto: Supuesto: se usa `rel="noopener"` tal como se pidió, sin `noreferrer`, así que WhatsApp puede recibir el sitio de origen como referente.
- Supuesto: Una prueba existente prohíbe /empresa/ en los archivos del sitio, así que el texto público dice solo "WhatsApp", sin "empresarial". Otra prohíbe "ars" en la sección de Capacitaciones, sin distinguir mayúsculas: palabras como "contactarse" la harían fallar.
- Supuesto: El número queda público en el sitio, en texto y en el enlace, y puede recibir mensajes automáticos. El correo, en cambio, se arma por partes para evitar a los recolectores; acá se pidió publicar el número.
- Supuesto: El sitio se publica en Vercel desde `site/`, así que el enlace se ve en producción recién cuando el cambio llega a la rama publicada.

## Capabilities

### New Capabilities
- `project-site`: WhatsApp de zero in the loop en el sitio

### Modified Capabilities

## Impact

Generado por zero para el trabajo 658a04c5.

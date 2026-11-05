# Proposal

## Why

El pie de zerointheloop.com va a mostrar, junto a GitHub, un ícono simple y de un solo color que lleva a la cuenta de Instagram de zero in the loop. El enlace se abre en una pestaña nueva y los lectores de pantalla lo anuncian como "Instagram de zero in the loop", o en inglés cuando el sitio está en inglés. El sitio tiene una sola página, así que el cambio queda en ese único pie. El sitio no tiene datos estructurados JSON-LD, por lo que no hay ninguna lista sameAs que actualizar.

Pedido original: "Agregar el link de Instagram en el sitio zerointheloop.com (carpeta site/): https://www.instagram.com/zerointheloop/ en el pie de todas las páginas, junto a los otros links (GitHub, etc.), con un ícono de Instagram simple y monocromo acorde al estilo minimalista del sitio, que abra en una pestaña nueva con rel="noopener" y texto accesible "Instagram de zero in the loop". Sumarlo también a sameAs del JSON-LD de la organización si existe. En los dos idiomas del sitio si los hay."

## What Changes

- Link de Instagram en el pie del sitio
- Supuesto: Supuesto: el sitio tiene una sola página (`site/index.html`), así que 'todas las páginas' es ese único pie.
- Supuesto: Supuesto: no se agrega JSON-LD. Hoy no hay ningún bloque `application/ld+json` en `site/`, y el pedido decía sumarlo a sameAs solo si existía.
- Supuesto: Supuesto: el pedido dio el texto solo en español; la versión en inglés "zero in the loop on Instagram" es una traducción elegida para este cambio.
- Supuesto: Supuesto: se agrega `rel="noopener"` tal como se pidió, sin `noreferrer`, así que Instagram puede recibir el sitio de origen como referente.
- Supuesto: El sitio se publica en Vercel desde `site/`; el enlace se ve en producción recién cuando el cambio llega a la rama publicada.

## Capabilities

### New Capabilities
- `project-site`: Link de Instagram en el pie del sitio

### Modified Capabilities

## Impact

Generado por zero para el trabajo 9b033ab7.

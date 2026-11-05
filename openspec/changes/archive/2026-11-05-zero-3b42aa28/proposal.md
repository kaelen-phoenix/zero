# Proposal

## Why

En zerointheloop.com, la sección Capacitaciones (con sus cuatro formatos y sus botones «La quiero») y su entrada «Capacitaciones» en el menú de arriba se ven solo cuando el sitio está en español. Al pasar a inglés desaparecen, y al volver a español reaparecen. Los números de las secciones siguen sin saltos en los dos idiomas: en español van del 01 al 11 (Capacitaciones 10, Enlaces 11) y en inglés del 01 al 10 (Enlaces pasa a ser 10). Los tests del sitio se actualizan para comprobarlo, y el README aclara en los dos idiomas que esa sección está solo en la versión en español.

Pedido original: "Sitio (site/): la sección Capacitaciones (section#training, su entrada en el menú y sus botones «La quiero») queda solo en la versión en español. Cuando el sitio está en inglés, la sección y su entrada del menú no se muestran, y la numeración de las secciones sigue siendo correlativa en los dos idiomas. Actualizar test/site.test.ts."

## What Changes

- Sitio: Capacitaciones solo en la versión en español
- Supuesto: Assumption: English translations of the training texts (training.*, nav.training) and the English mailto messages stay in EN, because the completeness test requires EN keys to equal the markup's keys and keeping them avoids churn; they are simply not visible in English.
- Supuesto: Assumption: hiding is client-side via the hidden attribute; with JavaScript off the page is in Spanish, so the section shows, which matches the request. A visitor following /#training in English lands nowhere.
- Supuesto: The fake DOM in test/site.test.ts has no tree, so the training marker must carry data-lang-only itself for renumbering to skip it; the build must not rely on closest() or parentNode.
- Supuesto: Renumbering writes textContent; if the build uses innerHTML instead, the fake element tests must read the same property.

## Capabilities

### New Capabilities
- `project-site`: Sitio: Capacitaciones solo en la versión en español

### Modified Capabilities

## Impact

Generado por zero para el trabajo 3b42aa28.

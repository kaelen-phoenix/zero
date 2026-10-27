# Proposal

## Why

El panel de la fábrica en el navegador se va a ver más prolijo y profesional, sin cambiar lo que hace. Vas a tener: - un encabezado con la marca de zero y un menú que marca en qué sección estás; - el estado de cada trabajo como una etiqueta de color (en cola, trabajando, esperando, entregado, fallido, detenido); - los números del día en tarjetas más claras; - botones, formularios y tablas con un estilo parejo; - mejor lectura en el celular, con modo oscuro; - foco visible al navegar con el teclado. Todo sigue en español. No se carga nada de internet (ni fuentes ni íconos externos) y se mantienen la seguridad y las acciones de ahora.

Pedido original: "Issue #2 de GitHub: Mejora front Mejora la interfaz de usuario del panel de control para que se vea más profesional."

## What Changes

- Panel de control con aspecto más profesional
- Supuesto: 'Más profesional' is subjective. This spec turns it into checkable structure: badges, active nav, accessibility, visual consistency and no external resources. The owner's own visual judgement still has to happen by looking at the panel, which no automated test can do.
- Supuesto: The CSP is `default-src 'none'` with `style-src 'unsafe-inline'`, so web fonts, external icon sets and `<img>` with `data:` URLs are blocked. Branding must use system fonts and inline `<svg>` elements. Loosening the CSP is out of scope.
- Supuesto: The `add-control-panel` change is not archived yet (task 3.1 is still pending), so `openspec/specs/control-panel` does not exist. The new delta must use ADDED requirements, or the archive order has to be coordinated.
- Supuesto: Existing tests match literal Spanish strings (e.g. 'Bloqueados: pastebin.com', 'fuera de la caja', 'nivel L2'). Wrapping these in extra markup, such as `<b>` around a value, could break those `toContain` checks.

## Capabilities

### New Capabilities
- `control-panel`: Panel de control con aspecto más profesional

### Modified Capabilities

## Impact

Generado por zero para el trabajo f3de3a79.

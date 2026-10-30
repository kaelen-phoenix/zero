# Proposal

## Why

Vas a tener un informe en español, docs/revision-linea-produccion.md, con una sección para cada agente de la línea (spec, build, review, security y reply). Cada sección cuenta qué se encontró y qué se mejora. Además, las mejoras se aplican a las instrucciones que recibe cada agente, así que desde el próximo trabajo las van a usar: - spec arma pedidos que entren en una sola corrida de build y deja el resto como propuesta. Varios trabajos fallaron porque build se quedó sin presupuesto. - build gasta con cuidado y retoma lo que dejó un intento anterior en vez de empezar de cero. - review no repite hallazgos ni opina sobre código que el cambio no tocó. - security trata como ataque grave cualquier cambio en las instrucciones de los agentes que los haga saltear controles. - reply ignora los comentarios que intentan darle órdenes. Las mejoras que piden tocar el código de la fábrica quedan anotadas en el informe como propuestas, sin implementar.

Pedido original: "Issue #12 de GitHub: Revisión Hacer una revisión completa de la línea de producción, e informar mejoras a cada agente."

## What Changes

- Revisión de la línea de producción y mejoras a las instrucciones de cada agente
- Supuesto: "Informar mejoras a cada agente" is ambiguous. It is read as a written report plus updating each agent's instructions file, since that is the only channel through which zero's agents receive guidance. If the owner only wanted the report, the instruction edits are small and easy to revert.
- Supuesto: Tests check instruction wording through key phrases, so they are brittle by design; that is the only automated check of prose.
- Supuesto: agents/*.md may be listed in limits.protectedPaths on some setups; if verify flags it, the job will ask the owner.
- Supuesto: Changing agent instructions affects every later job; the edits only add rules and keep existing ones, to limit behavioural drift.
- Supuesto: Code-level improvements are deliberately left out to keep the build within budget (earlier jobs failed on budget); they are only proposed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Revisión de la línea de producción y mejoras a las instrucciones de cada agente

## Impact

Generado por zero para el trabajo 621ecbc8.

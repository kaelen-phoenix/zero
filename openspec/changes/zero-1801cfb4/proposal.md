# Proposal

## Why

Una línea va a poder tomar issues de Linear como pedidos, igual que hoy toma issues de GitHub. Indicás en el archivo de la fábrica el equipo de Linear y la etiqueta (por defecto `zero`). La fábrica revisa Linear cada minuto y toma un issue solo si lo creó y lo etiquetó una persona con permiso, es decir, un miembro activo del equipo que no sea invitado. A los demás les deja un comentario explicando por qué no lo toma. En el issue va contando cómo va el trabajo: cuando lo toma, cuando necesita tu respuesta, cuando falla o se detiene y cuando lo entrega. Al entregar, lo pasa a un estado de completado del equipo. La clave de Linear se guarda con `zero secret set LINEAR_API_KEY` y el archivo de la fábrica no acepta claves. `zero status` y el panel muestran qué líneas toman issues de Linear y cualquier problema que haya. Se documenta en README.md y README.es.md. En la web, Linear figura como disponible y Jira sigue en camino.

## What Changes

- Pedidos desde Linear: issues de Linear como trabajos de una línea
- Supuesto: Linear has no per-repository write permission. 'Personas con permiso' is read here as active, non-guest members of the configured team. In a large workspace, more people may be able to give the agents instructions than on GitHub.
- Supuesto: The GraphQL queries (issue history with addedLabelIds, team members, workflow states of type completed) are written from Linear's public schema and checked only against a fake adapter. The real adapter is not exercised end to end against Linear.
- Supuesto: 'Cerrarlo al entregar' is read as completing the issue when zero's job reaches `delivered`. On pull-request lines that happens when the pull request opens, before anyone accepts it, unlike GitHub's 'Closes #N'.
- Supuesto: Linear requests are shown to the agents the same way GitHub issue requests are (the default 'The owner sent' header in requestBlock), since both come from trusted people.
- Supuesto: This run does not cover answering later comments on Linear issues (GitHub's `reply` station), or a CLI command like `zero issues on`. The block is configured by editing zero.factory.yaml.
- Supuesto: The Linear API key is personal, so comments appear under that person's name. Since later comments are not read in this part, no FACTORY_MARK is needed to avoid self-replies.

## Capabilities

### New Capabilities

### Modified Capabilities
- `work-intake`: Pedidos desde Linear: issues de Linear como trabajos de una línea

## Impact

Generado por zero para el trabajo 1801cfb4.

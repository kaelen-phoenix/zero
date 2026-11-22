# Proposal

## Why

Vas a poder arrancar un proyecto desde cero con `zero repo crear <nombre>`. Zero crea el repositorio en GitHub, privado salvo que pidas `--publico`. Después lo clona dentro de la carpeta de la fábrica, lo suma como línea nueva con sus comandos de preparación y verificación, y si le pasás `--pedido "..."` abre el primer trabajo con eso (por ejemplo, la demo para un cliente). Ese trabajo se construye como cualquier otro. Antes de crear nada, zero te muestra qué va a hacer y espera tu confirmación. Ningún agente ni estación puede crear un repositorio por su cuenta. Desde el chat, el pedido queda en espera hasta que lo confirmes con `zero mcp confirmar <id>` o con el botón Confirmar del panel. Desde el panel hay un formulario "Proyecto nuevo" con una página de confirmación. Si el token de GitHub no tiene permiso para crear repositorios, zero lo dice con claridad y explica qué permiso falta. Con `--coordinacion` crea el repositorio privado de coordinación de la fábrica distribuida y une esta máquina a esa fábrica. Publicar la demo en una URL (Vercel) queda para un paso posterior.

## What Changes

- Crear proyectos nuevos en GitHub y sumarlos como línea
- Supuesto: Assumption: the new line uses integrate: pull-request, so the job's work reaches GitHub (and a future deploy). If the person in charge prefers merge, they can change it in the file.
- Supuesto: Cloning uses git over https with the machine's git credentials. If the owner's git has no GitHub credential helper, the clone of a private repository can fail. The result then says the repository was created and gives its URL, without deleting anything.
- Supuesto: The local chat (for example Claude Code) has a shell and could, in theory, run `zero mcp confirmar` itself. Code can't fully prevent that. The panel's Confirmar, which needs a session, is the safer path.
- Supuesto: A brand-new repository has no verify commands until the first job creates the project. Unless the person in charge passes --verify, the line starts with verify empty and only gets detected commands if the clone already has files (the auto_init README doesn't count).
- Supuesto: Vercel blocks deploys whose commit author is zero. A future deploy will need commitAuthor: owner on that line (it already exists in src/config.ts).
- Supuesto: Repositories created under an organization (`cuenta/nombre`) need the token to have permission in that organization. That case is mapped to the 403/404 message.

## Capabilities

### New Capabilities
- `project-creation`: Crear proyectos nuevos en GitHub y sumarlos como línea

### Modified Capabilities

## Impact

Generado por zero para el trabajo 76fac21a.

# Proposal

## Why

Una línea va a poder tomar issues de un proyecto de Jira como pedidos, igual que ya hace con los issues de GitHub. Se configura en el archivo de la fábrica con el sitio, el proyecto y la etiqueta (por defecto "zero"). El correo y el token de Jira se guardan con `zero secret set JIRA_EMAIL` y `zero secret set JIRA_API_TOKEN`, nunca en el archivo, y la fábrica rechaza el archivo si alguien intenta poner ahí una credencial. La fábrica revisa Jira cada minuto. Solo toma un issue si lo creó y lo etiquetó una persona con permiso para editar issues en el proyecto, y si nadie sin ese permiso cambió su título o descripción. Si no se cumple, lo explica con un comentario en el issue. Mientras trabaja, comenta en el issue cuándo lo toma, cuándo necesita una respuesta tuya y cómo terminó. Al entregar, lo pasa a un estado terminado. `zero status` y el panel muestran qué líneas toman issues de Jira y cualquier problema, por ejemplo credenciales faltantes. Los README en inglés y en español lo documentan. En la web, Jira figura como disponible y en "en camino" queda solo Linear.

## What Changes

- Pedidos desde issues de Jira
- Supuesto: The request says to reuse Linear's structure if it exists. No Linear intake is in this code (the townhall mentions src/intake/linear.ts, but no such file exists), so Jira follows the GitHub intake. A Linear job integrated in parallel could conflict in store.ts, report.ts, format.ts, daemon.ts and the site's next.intake line.
- Supuesto: Assumption: 'personas con permiso' means the EDIT_ISSUES project permission. Looking it up for another account needs the calling account to have 'Browse users and groups'. Without it, every check fails and the line shows a problem instead of refusing issues. A project that grants EDIT_ISSUES to anyone would make everyone trusted.
- Supuesto: Assumption: 'cerrar al entregar' means at the job's delivered status for every integration mode. On pull-request lines, the Jira issue moves to done when the PR is opened, not when it is merged.
- Supuesto: Assumption: Jira Cloud with Basic auth (email + API token) through REST API v2 (plain-text description and comments). Jira Server/Data Center with personal access tokens, and OAuth, are out of scope. The Markdown link in the signature appears as raw text in Jira.
- Supuesto: Only one Jira account per factory (fixed secret names JIRA_EMAIL and JIRA_API_TOKEN). Lines on different Jira sites with different accounts are not supported yet.
- Supuesto: Jira requests leave from zero's own process (not the box or egress gate) and are outside the GitHub quota meter. Jira rate limits (429) only show up as a line problem until the next pass.

## Capabilities

### New Capabilities

### Modified Capabilities
- `work-intake`: Pedidos desde issues de Jira

## Impact

Generado por zero para el trabajo a06d29b4.

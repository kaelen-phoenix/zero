# Proposal

## Why

Cada propuesta nueva del turno nocturno queda registrada como issue en GitHub, en todas las líneas cuyo repositorio está en GitHub (zero, solilok, newoman), con la etiqueta `zero:propuesta`. La fábrica crea esa etiqueta si falta. El issue no lleva la etiqueta `zero`, así que no se convierte solo en trabajo. Cuando aprobás o rechazás una propuesta desde la terminal o el chat, la fábrica actualiza el issue en la siguiente pasada. Si la aprobás, le pone la etiqueta de trabajo y comenta qué trabajo abrió, y después el issue recibe los avisos de cómo va (en las líneas que toman issues). Si la rechazás, comenta el motivo y lo cierra. Los comentarios llevan la marca de la fábrica. El pull request que entrega una propuesta aprobada cierra su issue ("Closes #n"). En el texto publicado se tapan los secretos y las rutas de tu PC. Además, cada rechazo queda anotado en el townhall con tu motivo, si lo diste. `scout` recibe en su pedido las últimas 20 propuestas rechazadas de la línea, con su motivo, para no volver a proponer lo mismo ni algo parecido. Quedan para la próxima parte: aprobar o rechazar desde el propio issue (poniéndole la etiqueta o cerrándolo), que `scout` lea los issues sin etiqueta, detectar cambios del turno nocturno que revertiste y la pestaña "Propuestas" del panel. Esa pestaña no existe todavía en el código, aunque la parte 1 la mencionaba.

Pedido original: "Turno nocturno, parte 2: propuestas en GitHub y aprendizaje de los rechazos. La parte 1 (trabajo 5382c59b: estación `scout`, autonomía por línea `nightShift.autonomy` y pestaña "Propuestas") ya está fundida en main; construir sobre ella. - GitHub: TODAS las propuestas y mejoras del turno nocturno quedan registradas como issue, en todas las líneas con repositorio en GitHub (hoy zero, solilok y newoman), sea cual sea su autonomía; el pull request que la entrega cierra el issue. Cada propuesta nueva de `scout` se publica también como issue con la etiqueta `zero:propuesta` (la fábrica crea la etiqueta si falta), sin la etiqueta `zero`, así no se convierte en trabajo sola. En líneas en `propose`, ponerle la etiqueta `zero` al issue (una persona con permiso de escritura) equivale a aprobar la propuesta, y cerrarlo sin la etiqueta equivale a rechazarla. En líneas en `build` o `auto`, el issue queda como registro y se cierra con la entrega. Aprobar o rechazar desde el panel, el chat o la terminal actualiza el issue (lo etiqueta o lo cierra) y lo comenta con la marca de la fábrica. Nunca se publican secretos ni rutas de la PC del dueño. - Issues sin etiqueta: `scout` también lee los issues abiertos sin etiqueta de la línea escritos por personas con permiso de escritura y puede proponer tomarlos; la propuesta enlaza el issue. - Aprendizaje: cada rechazo se registra en el townhall con el motivo que dé el dueño (opcional), y también cuando el dueño revierte un cambio que el turno nocturno desplegó solo. `scout` recibe las últimas 20 propuestas rechazadas o revertidas de la línea en su prompt para no volver a proponer lo mismo ni algo parecido. - Panel: la pestaña "Propuestas" muestra el enlace al issue cuando existe y el motivo de rechazo."

## What Changes

- Turno nocturno, parte 2a: propuestas como issues de GitHub y aprendizaje de los rechazos
- Supuesto: Assumption: with this part, 'aprobar' still happens only in the factory (CLI/chat). Approving by labeling the issue and rejecting by closing it are left for the next part, so the issue is a record and a mirror of the decision.
- Supuesto: Assumption: approving labels the issue with the line's intake label (or 'zero' when the line has no `issues` config). The issue state is written before labeling and labeledAt is read back afterwards, so takeIssues never opens a second job. If GitHub fails between the label and lastLabeled, labeledAt stays '' and takeIssues still skips while the job is not final. After the job ends, it could take the issue again. The sync must retry until labeledAt is set.
- Supuesto: Proposals created before this change (pending or approved) get published retroactively on the first pass, which can open several issues at once on the owner's repos.
- Supuesto: rejectProposal becomes async. Every caller (CLI, MCP, tests) must await it, or the townhall post can be lost when the process exits.
- Supuesto: The redaction only removes recognisable secrets (findSecret patterns) and the line's repo and home paths. Other private paths that an agent invents may still leak.
- Supuesto: Autonomy 'build'/'auto' still behaves like 'propose' in code, so 'el issue queda como registro y se cierra con la entrega' is covered by Closes #n on the PR. It only works on pull-request lines whose delivery reaches GitHub.

## Capabilities

### New Capabilities
- `night-shift`: Turno nocturno, parte 2a: propuestas como issues de GitHub y aprendizaje de los rechazos

### Modified Capabilities

## Impact

Generado por zero para el trabajo d8111e03.

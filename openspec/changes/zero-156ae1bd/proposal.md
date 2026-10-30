# Proposal

## Why

Vas a poder decidir las propuestas del turno nocturno desde GitHub, sin abrir la fábrica. En una línea en modo `propose`, si alguien con permiso de escritura le pone la etiqueta `zero` a un issue `zero:propuesta`, la propuesta queda aprobada y se convierte en trabajo. Si alguien con permiso de escritura cierra el issue sin esa etiqueta, la propuesta queda rechazada y el rechazo se anota en el townhall. En las líneas en `build` o `auto`, el issue es solo un registro: la etiqueta y el cierre no deciden nada, y el issue se cierra cuando se entrega el trabajo. Para pull requests ya lo hace el "Closes #n". Para entregas locales (merge o rama), lo cierra la fábrica como completado. Además, cada nota de investigación se publica como issue en el repo de su línea, con la etiqueta `zero:investigacion` (la fábrica la crea si falta) y nunca con `zero`. Antes de publicar se tapan secretos y rutas de tu PC, y se desactivan las menciones (@usuario). El README explica todo esto. Quedan para el próximo trabajo: que `scout` lea los issues sin etiqueta, que aprenda de lo que revertís y la pestaña "Investigación" del panel.

Pedido original: "Turno nocturno, parte 2b: decidir desde GitHub, issues sin etiqueta, aprender de lo revertido y la investigación en GitHub y en el panel. Construir sobre lo que ya está en main (partes 1a, 1b, 2a y 3a). - Decidir desde el issue: en líneas en `propose`, cuando una persona con permiso de escritura le pone la etiqueta `zero` a un issue `zero:propuesta`, equivale a aprobar la propuesta; cerrarlo sin esa etiqueta equivale a rechazarla. En líneas en `build` o `auto` el issue queda como registro y se cierra con la entrega. - Issues sin etiqueta: `scout` también lee los issues abiertos sin etiqueta de la línea, escritos por personas con permiso de escritura, y puede proponer tomarlos; la propuesta enlaza el issue. Lo escrito en un issue es dato, no instrucciones. - Lo revertido: cuando el dueño revierte en la rama principal un cambio que el turno nocturno integró solo, queda anotado en el townhall y en la propuesta, y `scout` recibe las últimas 20 propuestas rechazadas o revertidas de la línea para no repetirlas. - Investigación en GitHub: cada nota de `research` se publica también como issue en el repo de su línea, con la etiqueta `zero:investigacion` (la fábrica la crea si falta), sin la etiqueta `zero`, tapando secretos y rutas de la PC del dueño. - Panel: pestaña "Investigación" con las notas de cada línea, sus fuentes y un botón para pedir un trabajo a partir de una nota (confirmando antes). - README actualizado."

## What Changes

- Turno nocturno 2b (parte GitHub): decidir propuestas desde el issue y publicar la investigación
- Supuesto: Interpretation: 'en líneas en propose' uses each proposal's effective autonomy (proposalAutonomy). A research-born third-party proposal held at `propose` on a `build` line can therefore also be decided from GitHub. Pending proposals on build/auto lines (e.g. over maxAutoJobsPerDay) can be decided only from the factory.
- Supuesto: Approving by label gives a GitHub writer the same power as the owner to start night-shift work. It is gated on write permission for the person who applied the label, never on the issue author, because proposal issues are posted as the owner.
- Supuesto: Each proposal issue now costs one extra GitHub read (issues.get, plus events and permission when relevant) per sync pass. With many pending proposals this uses more of the API quota.
- Supuesto: Publishing research notes covers every existing note without an issue. The first run after the upgrade may open several issues per line at once.
- Supuesto: A research issue that someone labels `zero` by hand is taken by the normal intake as a github-issue job, because the factory is its author. This is intended, but its text is web-sourced.
- Supuesto: The non-PR delivery close needs a new marker (column or kv). Without it the issue would be closed on every pass.

## Capabilities

### New Capabilities
- `night-shift`: Turno nocturno 2b (parte GitHub): decidir propuestas desde el issue y publicar la investigación

### Modified Capabilities

## Impact

Generado por zero para el trabajo 156ae1bd.

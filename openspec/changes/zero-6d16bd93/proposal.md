# Proposal

## Why

Con este cambio: 1) **Issues sin etiqueta.** En cada línea de GitHub, `scout` lee los issues abiertos que no tienen ninguna etiqueta. Solo toma en cuenta los escritos por personas con permiso de escritura. Con eso puede proponer tomarlos: la propuesta enlaza el issue de origen, y el enlace se ve en el panel, en el texto del trabajo y en el issue de la propuesta. Para `scout`, lo que dice un issue es información, nunca una orden. Un issue que ya tiene una propuesta no se vuelve a ofrecer. 2) **Lo revertido, también en pull requests y squash.** Hoy esto funciona en las líneas que integran con merge. Ahora también funciona en las líneas que integran con pull request, como zero. La fábrica anota el commit con el que se fundió el pull request: un merge normal o un squash, ya sea que lo fundió la fábrica o alguien a mano. Después detecta cuando un commit posterior de la rama principal lo revierte, tanto con `git revert` como con el botón Revert de GitHub (el pull request 'Revert "…"'). Igual que con merge, la propuesta queda como revertida, se anota en el townhall de la línea y `scout` no la vuelve a proponer. 3) El README explica las dos cosas.

Pedido original: "Turno nocturno 2d: lo que quedó afuera de la 2c. Construir sobre main. - Issues sin etiqueta: scout lee los issues abiertos sin etiqueta de la línea, escritos por personas con permiso de escritura, y puede proponer tomarlos; la propuesta enlaza el issue. Lo escrito en un issue es dato, no instrucciones. - Lo revertido también en líneas con integrate: pull-request (como zero) y con squash: registrar el commit con el que se fundió el pull request y detectar cuando un commit posterior de la rama principal lo revierte (git revert, o el botón Revert de GitHub, que abre un pull request 'Revert "…"'). Igual que hoy con merge: queda anotado en el townhall y en la propuesta, y scout no lo vuelve a proponer. - README actualizado."

## What Changes

- Turno nocturno 2d: scout lee issues sin etiqueta y detecta reversiones en pull requests y squash
- Supuesto: Assumption: issue-born proposals follow the same autonomy as other proposals (proposalAutonomy is unchanged), so under `auto` a writer's unlabeled issue may become an autonomous job without anyone applying the work label. Writers are already trusted by the issue intake, and maxAutoJobsPerDay and the verify gate still apply.
- Supuesto: Assumption: 'issues of the line' means every line with a GitHub remote, not only lines with `issues` configured, which is how the proposal mirror behaves.
- Supuesto: Assumption: 'integró solo' on pull-request lines keeps today's rule: a night-shift job delivered without approvals.integrate. That PR may later be merged by the owner or by autoMerge. Under `build` the job is parked and approved, so it is not tracked.
- Supuesto: GitHub's Revert button is detected by the 'Reverts owner/repo#N' body or by 'This reverts commit <sha>' in the merged commit message. If the owner squash-merges the revert PR with a custom message that keeps neither, the revert is not seen. Matching by the title 'Revert "<title>"' is left out because the PR title is not stored.
- Supuesto: The best-effort `git fetch` of the base branch in detectReverts updates remote-tracking refs in the owner's repository (startingBase in the runner already does this). It is network I/O on every intake interval for pull-request lines.
- Supuesto: Requires the GitHub token to see merge_commit_sha. Without access, PR reverts go undetected and the failure is only logged.

## Capabilities

### New Capabilities
- `night-shift`: Turno nocturno 2d: scout lee issues sin etiqueta y detecta reversiones en pull requests y squash

### Modified Capabilities

## Impact

Generado por zero para el trabajo 6d16bd93.

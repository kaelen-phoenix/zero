# Proposal

## Why

Ahora vas a poder elegir quién figura como autor de los commits de la fábrica, con una opción `commitAuthor` en zero.factory.yaml. Se pone una vez para toda la fábrica y se puede cambiar línea por línea. Con `zero` (lo que pasa por defecto, igual que hoy) el autor es "zero <zero@kaelen.invalid>". Con `owner` el autor sos vos: zero toma tu nombre y tu email del git config del repositorio de la línea (user.name / user.email), así que tu email nunca se escribe en el archivo de la fábrica. Así Vercel reconoce los commits como tuyos y deja de bloquear las vistas previas, la fusión automática y los despliegues a producción. Igual se sigue viendo que lo hizo la fábrica, porque en esos commits zero queda como committer. Si el repositorio no tiene nombre o email configurados, los commits salen como hoy, a nombre de zero, y el trabajo no se frena. Lo que hoy detecta reversiones, fusiones automáticas y comentarios sigue funcionando igual, porque nada de eso mira el autor. El cambio queda documentado en README.md y README.es.md.

Pedido original: "Los commits de la fábrica salen con autor "zero <zero@kaelen.invalid>" (FACTORY_IDENTITY en src/workspace.ts:7). Vercel (plan Hobby) bloquea los despliegues de commits cuyo autor no es una cuenta vinculada ("GitHub couldn't verify an account for the commit"): las vistas previas de los PR de solilok fallan el check Vercel, la fusión automática nunca arranca, y en newoman (integrate merge) el despliegue a producción quedó BLOCKED hasta que subí un commit mío encima. Que el autor de los commits pueda ser el dueño: - Opción por línea en zero.factory.yaml (y global como default) para elegir la identidad del autor: la de zero (como hoy) o la del dueño. La identidad del dueño se toma del git config del repo de la línea (user.name / user.email), sin escribir el email en el archivo de la fábrica si no hace falta. - Mantener visible que lo hizo la fábrica: committer zero, o un trailer en el mensaje. Si el PR #32 (trailer Built-by) ya está en main, reutilizarlo; si no, no depender de él. - Todo lo que hoy reconoce los commits de la fábrica por su autor (si algo lo hace: reverts, automerge, intake, etc.) tiene que seguir funcionando. - Empieza como un change de OpenSpec; tests con git real en repos temporales; documentarlo en README.md y README.es.md."

## What Changes

- Autor de los commits elegible: zero o el dueño
- Supuesto: Assumption: Vercel Hobby checks the commit author, not the committer. If it also rejects a committer that is not a linked account, `owner` will not be enough. A later option could make the owner the committer too and mark factory commits only with a trailer.
- Supuesto: PR #32 (a Built-by trailer) is not on main: there is no 'Built-by' anywhere in the repo. So the factory stays visible only through the committer. When GitHub squash-merges a pull request (automerge or manual), GitHub becomes the committer, and on squashed commits the factory mark is lost.
- Supuesto: git config resolves local, then global, then system config. With `owner`, a repo without local config uses the global identity of the machine where zero runs. That is the expected behaviour, but tests must isolate global config to check the fallback.
- Supuesto: In isolation `container`, commits are made on the host in the clone (copy.commitAll runs git on the host). If any path makes commits inside the box, it would need the author env as well; no such path was found.
- Supuesto: Commits that agents make themselves (if an engine ran `git commit` in the work copy) are not covered. They would carry whatever identity the environment has.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Autor de los commits elegible: zero o el dueño

## Impact

Generado por zero para el trabajo 9e34ea82.

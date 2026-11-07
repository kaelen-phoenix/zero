# Proposal

## Why

Cuando lo activás en una línea, zero revisa cada intento que agrega o cambia dependencias npm antes de pasarlo a review. Mira qué agregó el intento en package.json y package-lock.json y les pregunta a OSV y a deps.dev por cada paquete nuevo. No usa un modelo y no instala nada. - Si un paquete tiene un aviso de malware (un ID `MAL-`) o no existe en el registro público, el intento falla. El próximo intento recibe un mensaje que nombra cada paquete y dice por qué falló. - Si una versión es muy reciente o un paquete no tiene versiones anteriores, el intento no falla. El dato le llega a la estación de seguridad, que decide si la dependencia hace falta. - Si no hay red o un servicio no responde, zero anota "no verificado" y la línea sigue. - Los paquetes que el lock resuelve fuera del registro público de npm (git, archivos locales, enlaces, otros registros) no se consultan. Viene apagado, porque le muestra a OSV y a deps.dev los nombres de tus dependencias. Se prende por línea con `checkDependencies: true` en el archivo de la fábrica. En esta etapa cubre solo npm: PyPI y `min-release-age` quedan para después.

## What Changes

- Revisión objetiva de dependencias npm nuevas (OSV y deps.dev) antes de review
- Supuesto: Assumption: the check runs on the host from zero's process, after verify and before review on every attempt, including resumed ones (verify always reruns on resume). It is not rerun just before integrating, so a review-stage agent commit (see the townhall note on runner.ts:156) skips it.
- Supuesto: Assumption: 'muy reciente' means published less than 7 days before the check (a zero constant, not npm's `min-release-age`). Single-version detection uses the length of deps.dev's versions list.
- Supuesto: Only lockfileVersion 2/3 `packages` maps are parsed. A v1 lock (nested `dependencies`) falls back to the package.json names only, so its transitive additions are not checked.
- Supuesto: Transitive additions are sent to OSV in a batch, but deps.dev is asked once per new package. A large lock update can mean many requests, so the build may want to limit deps.dev to a fixed number of packages per attempt and list the rest as unverified.
- Supuesto: Package names and versions come from files the agent wrote: they are untrusted. They must be validated before going into URLs, and cleaned before going into feedback, the security prompt or logs.
- Supuesto: In box mode the merge-base and cat-file calls run on the host over a clone whose .git the box agent can write (townhall lesson on src/box/run.ts:88). `cat-file blob` runs no hooks or filters, but `show` with textconv or a checkout must not be used.
- Supuesto: An OSV MAL- record about a legitimate package that was compromised and later fixed fails only the exact version listed. If OSV is wrong, the line can be stuck until the version changes.
- Supuesto: test/docs.test.ts requires matching README structure and code blocks, so both READMEs must change in parallel.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Revisión objetiva de dependencias npm nuevas (OSV y deps.dev) antes de review

## Impact

Generado por zero para el trabajo 231e6a89.

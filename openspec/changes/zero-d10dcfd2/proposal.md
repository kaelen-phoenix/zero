# Proposal

## Why

La fábrica va a proteger por defecto la carpeta `.agents/` de cada repositorio, de donde Codex carga skills por su cuenta. Si un trabajo intenta escribir ahí, zero lo frena igual que con `.claude/`: en L3 el intento falla y en L0–L2 el trabajo espera tu aprobación. Las propuestas del turno de noche que toquen esa carpeta se descartan. Si tu `zero.factory.yaml` ya define su propia lista `protectedPaths`, se sigue usando esa y no cambia nada. El ejemplo de configuración del README, en inglés y en español, muestra la ruta nueva.

Pedido original: "Rutas protegidas por defecto: sumar .agents/** (skills que Codex carga de la copia de trabajo) Por qué: La nota a1afd75b (fuentes: https://developers.openai.com/codex/skills y https://github.com/openai/codex/issues/14316) dice que Codex carga skills nativas desde `.agents/skills` en cada directorio, desde el cwd hasta la raíz del repo. codexEngine (src/engines/cli.ts:85) corre en la copia de trabajo sin aislar eso. Si un build escribe ahí, los reintentos y las estaciones de solo lectura que caigan en Codex cargan instrucciones que zero no controla. Es el mismo riesgo que la propuesta de .claude/** (PR #48) cubre para Claude, pero en otro motor. Los protectedPaths por defecto (src/config.ts:192) no incluyen `.agents/**`. Qué cambiaría: Sumar `.agents/**` a la lista por defecto de `limits.protectedPaths` en src/config.ts y, si PR #48 ya entró, seguir su mismo criterio (ALWAYS_PROTECTED y comparación sin mayúsculas). Agregar un test de protectedTouched para `.agents/skills/x/SKILL.md`. Actualizar el ejemplo de README.md:163 y README.es.md:163 solo si PR #48 lo cambió, y mantener los dos idénticos. Conviene construirlo después de PR #48 para no chocar en las mismas líneas. Empieza como un change de OpenSpec."

## What Changes

- Rutas protegidas por defecto: sumar .agents/**
- Supuesto: Supuesto: PR #48 ya entró (commit 477404c), pero no tocó ALWAYS_PROTECTED ni la comparación: `.claude/**` solo se sumó a la lista por defecto, que compara con mayúsculas y minúsculas exactas, y ALWAYS_PROTECTED sigue siendo solo `.zero/**`. El pedido describe ese criterio como 'ALWAYS_PROTECTED y comparación sin mayúsculas', pero el código manda: `.agents/**` va solo en la lista por defecto, como `.claude/**`.
- Supuesto: Supuesto: como consecuencia, una lista propia de `limits.protectedPaths` no recibe `.agents/**`, y `.Agents/skills/...` no queda cubierto en discos que no distinguen mayúsculas (`.claude/**` tiene los mismos dos límites).
- Supuesto: Supuesto: `.agents/**` solo coincide en la raíz del repositorio. Un `pkg/.agents/skills/...` no queda cubierto. Codex carga desde el cwd hacia la raíz, y zero lo corre en la raíz de la copia de trabajo, así que se toma como suficiente. No se pudo comprobar el comportamiento de Codex contra sus fuentes externas: se toma de la nota a1afd75b citada en el pedido.
- Supuesto: Supuesto: los trabajos que editen `.agents/` a propósito ahora se frenan en verify (fallan en L3, piden aprobación en L0–L2), y las propuestas del turno de noche que listen esas rutas se descartan en filterProposals, que usa la misma lista.
- Supuesto: El ejemplo del README no es la lista literal por defecto: omite `.zero/**` porque siempre está protegida. Se mantiene esa omisión.
- Supuesto: El delta de la estación spec siempre usa ADDED, y el change zero-06e07515 (sin archivar) declara una lista 'exactly' sin `.agents/**`. Este change la reemplaza de hecho; al archivar, hay que quedarse con la lista nueva.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Rutas protegidas por defecto: sumar .agents/**

## Impact

Generado por zero para el trabajo d10dcfd2.

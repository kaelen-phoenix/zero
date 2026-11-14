# Proposal

## Why

La fusión automática va a mirar siempre todos los pull requests entregados que todavía no se fundieron, se cerraron o vencieron, aunque haya cientos de trabajos en la historia. Hoy, con más de 200 trabajos entregados, los más nuevos quedaban afuera y sus pull requests nunca se fundían (como #194 y #199). Se corrige además lo mismo en otros lugares que buscaban trabajos recientes con un tope y en orden del más viejo al más nuevo: `zero fusionar` con una url, el chequeo de autoactualización, el resumen diario y los repasos de scout y del destrabador. Cada arreglo viene con tests que crean más trabajos que el tope viejo.

## What Changes

- Fusión automática mira todos los trabajos entregados sin importar la historia
- Supuesto: Reading all delivered jobs on every merge poll grows linearly with history. It is fine at hundreds or thousands of rows, but a query that leaves out jobs with a final automerge record would scale better. That is left as a follow-up.
- Supuesto: A test that creates more than 1000 jobs (merge-request and self-update scenarios) could be slow. Create rows directly through the store, without finalizeJob or git.
- Supuesto: The self-update and unjam scenarios are optional if their fixtures turn out to be heavy. The required test is the one with more delivered jobs than the cap in watchedJobs.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Fusión automática mira todos los trabajos entregados sin importar la historia

## Impact

Generado por zero para el trabajo 1b62a04e.

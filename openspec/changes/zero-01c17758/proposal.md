# Proposal

## Why

Hoy cada `zero simulacro` deja para siempre una copia completa del proyecto en `ZERO_HOME/drills/<id>/copy`, a veces con `node_modules` incluido, y el disco se va llenando sin aviso. Con este cambio, cuando termina el simulacro se borra esa copia y queda solo lo que importa: `informe.md` y `resultado.json`. El informe dice si la copia se borró o dónde quedó. Si querés revisar la copia, agregá `--conservar` (`zero simulacro <línea> <capacidad> --archivos ... --conservar`) y no se borra. Si el borrado falla, el resultado del simulacro no cambia: el problema solo queda anotado en el log, con la carpeta que no se pudo borrar.

## What Changes

- Simulacro: borrar la copia de trabajo al terminar y dejar solo el informe
- Supuesto: On Windows, `rm` of a copy holding `node_modules` or git pack files can fail with EBUSY or EPERM. That is why `maxRetries` is used and the failure is only logged. In that case the report already says the copy is deleted at the end while part of it may remain. The log line names the folder.
- Supuesto: The report is written before the deletion, as the request asks. It states what will happen to the copy, not the confirmed outcome of the deletion.
- Supuesto: The existing test 'runs setup before the agent and verify in the copy' reads verify.mark from the copy after the drill. It has to be changed to use `keep: true`, otherwise it fails.
- Supuesto: The documentation test pins the exact CLI usage line. It must be updated along with src/cli.ts.
- Supuesto: The deletion runs in a finally, so it also happens when runDrill throws partway (for example, a failed clone). Assumption: the request's 'al terminar' covers that case as well.

## Capabilities

### New Capabilities
- `regeneration-drill`: Simulacro: borrar la copia de trabajo al terminar y dejar solo el informe

### Modified Capabilities

## Impact

Generado por zero para el trabajo 01c17758.

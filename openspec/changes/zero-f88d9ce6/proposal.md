# Proposal

## Why

La revisión nocturna de trabas (la estación unjam) ya mira los trabajos fallidos o frenados, los pull requests trabados, los checks caídos y los problemas de intake. Con este cambio, además: - Zero revisa cada hora si la copia instalada de zero está atrasada: si hay commits fundidos en su rama de origen que no están instalados, o si el código cambió y no se volvió a compilar. Lo avisa en `zero status` y en el resumen, y la revisión nocturna lo trata como una traba más del repositorio de zero. - Cada propuesta que abre la revisión trae evidencia calculada por zero: qué trabajos, qué pull requests, cuántas trabas y en cuántas revisiones seguidas apareció la causa. - Las causas repetidas quedan como lecciones en el townhall. - Cuando un pedido se frena en spec porque a la fábrica le falta una capacidad, la revisión propone en la línea de zero (o de zero-plus) el pedido que la agrega, ligado al pedido original. Cuando ese cambio entra (y, si es zero mismo, cuando la copia instalada ya lo tiene), zero reenvía el pedido original una sola vez.

## What Changes

- The factory learns from its jams: installed copy freshness, evidence, lessons and missing-capability requests
- Supuesto: The installed copy is assumed to be the git checkout that holds the running dist/cli.js. If a person installs zero differently, for example from npm, the record only reports a problem and no warning.
- Supuesto: Build freshness is judged by file times (a src/ file newer than dist/cli.js). A build made from older sources after a pull can still be missed in rare cases.
- Supuesto: The fetch in the freshness pass touches the network once an hour. It is best effort and never prompts for credentials.
- Supuesto: A resent request keeps the original job's source, so a request that came from an issue reports again on that issue. Resending happens without asking, since the person in charge already sent the request once.
- Supuesto: Matching the zero line to the installation compares GitHub owner/repo. Lines without a GitHub remote never get the install gate or the install jam.
- Supuesto: The request names zero and zero-plus as targets. The target is any configured non-package line the agent chooses, checked by zero, and the line names are not fixed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: The factory learns from its jams: installed copy freshness, evidence, lessons and missing-capability requests

## Impact

Generado por zero para el trabajo f88d9ce6.

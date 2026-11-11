# Proposal

## Why

Hoy, si no se puede borrar la carpeta de trabajo cuando un trabajo termina, el trabajo ya conserva su resultado y la limpieza se reintenta sola. Los problemas de facturación de la cuenta de GitHub ya se muestran como problema de la cuenta en `zero status`, en el panel y en los README. Con este cambio se cubre lo que todavía falla. Si un trabajo que se reanuda (por ejemplo, después de que el daemon se cayó) choca con una carpeta bloqueada en Windows (EBUSY), la fábrica cierra los procesos que quedaron colgados en su copia y lo vuelve a poner en la cola desde donde iba, hasta 2 veces, en vez de marcarlo como fallido. Además, al arrancar, el daemon cierra los procesos que dejó el daemon anterior en las copias de los trabajos interrumpidos. Si después de integrar en tu rama no se puede borrar la carpeta temporal de la mezcla, el trabajo queda entregado igual y esa carpeta se limpia en segundo plano. Si quedó una carpeta temporal bloqueada de una vez anterior, se usa otra. README.md y README.es.md lo explican. La actualización automática de paquetes cuando se funde su repositorio queda como trabajo aparte.

## What Changes

- Un trabajo no falla por una carpeta bloqueada al reanudar o al integrar
- Supuesto: It is not known exactly where d5b062e5's EBUSY came from (the logs could not be read). Assumption: it was a locked file reaching runJob's final catch on resume, held by processes the crashed daemon left behind. The fix handles any EBUSY there generically.
- Supuesto: Requeuing on EBUSY drops uncommitted changes, like a network cut does. A build cut mid-way loses its unverified work but does not spend an attempt.
- Supuesto: Killing leftovers at daemon start runs a process listing per interrupted job (PowerShell on Windows, up to 60 s). Daemon tests must inject `killLeftovers` so they never run the real one.
- Supuesto: The cleanup record key `cleanup:<job>-merge` points to no job, so the cleanup pass treats it as finished and retries it. `zero status` counts it as one more pending cleanup.
- Supuesto: Part 3 (GitHub account billing problems in status, panel and README) already exists in the code (`billingRefusal`, `ChecksBilling`, `billingLine`, README), so it is not specified again.
- Supuesto: The full `npm test` has gone over verify's time limit before. New tests must be few and fast.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Un trabajo no falla por una carpeta bloqueada al reanudar o al integrar

## Impact

Generado por zero para el trabajo 7eda98a0.

# Proposal

## Why

Vas a tener un agente nuevo, el destrabador, que trabaja cuando la fábrica está ociosa y con lo que queda del presupuesto nocturno, como el turno nocturno. Por cada línea junta lo que está trabado: trabajos fallidos o en espera con su último problema, pull requests de líneas con fusión automática que no se funden (checks fallidos con el final de sus logs, conflictos con la rama base), entornos caídos, facturación de GitHub, problemas del intake, copias que no se pudieron borrar y la caja que no está lista. El agente solo lee: diagnostica la causa y agrupa las trabas que tienen la misma causa, así 15 pull requests que fallan en los mismos checks quedan como un solo problema. Además dice si la causa es del código, de un test intermitente, del CI, de la cuenta de GitHub o de la máquina. Si la causa se arregla con código, abre un solo trabajo de arreglo en la línea que corresponde, como propuesta del turno nocturno. Respeta la autonomía de la línea y un tope diario, tiene baja prioridad y no repite una causa que ya tiene trabajo abierto o que rechazaste. También puede reintentar desde su checkpoint un trabajo fallido o un pull request en conflicto que se quedó sin intentos. Ese mismo reintento lo vas a poder pedir a mano con `zero reintentar <trabajo>`. Lo que no se arregla con código (instalar Podman o Docker, permisos, facturación de GitHub) te lo dice con qué hacer. Lo vas a ver en `zero status`, en el panel, en el resumen diario, en el informe mensual (sección "Trabas") y por chat.

## What Changes

- Destrabador: diagnóstico de trabas y arreglos automáticos
- Supuesto: Supuse que "el informe" es tanto el informe mensual (`zero informe`, sección Trabas con lo que necesita a la persona responsable) como el resumen diario. Las dos cosas se especifican.
- Supuesto: El destrabador corre una vez por línea y por período del turno nocturno, igual que scout. Una traba que aparece después de la pasada espera al período siguiente.
- Supuesto: El agrupamiento entre líneas distintas no se hace con un modelo: cada línea tiene su propia llamada. Una causa de máquina (por ejemplo, la caja que no está lista) puede aparecer una vez por línea.
- Supuesto: Para no duplicar, los trabajos de arreglo reusan las propuestas del turno nocturno (aprobar, rechazar, autonomía, espejo en issues, prioridad baja). Por eso también cuentan contra `nightShift.maxAutoJobsPerDay`, además de `unjam.maxJobsPerDay`.
- Supuesto: Un reintento vuelve a terminar por `finalizeJob`: el issue o el townhall reciben un segundo informe final del mismo trabajo.
- Supuesto: Con autonomía `build`/`auto`, `retryJob` pone `attempt` en 0 y gasta presupuesto nuevo en trabajos que ya agotaron sus intentos. Se limita a una vez por trabajo y al tope diario.
- Supuesto: Leer logs de Actions agrega pedidos a GitHub (lista de jobs y descarga del log), contados en la pasada `unjam` del medidor. La descarga sigue una redirección y el tamaño del log puede ser grande antes del recorte.
- Supuesto: Se tocan los pedidos en cola 1804128d, 72cbe036 y af092d46: este cambio no implementa la resolución automática de conflictos ni el chequeo de la caja. Solo los diagnostica y reusa `takeBack` y el estado de la caja que ya existen.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Destrabador: diagnóstico de trabas y arreglos automáticos

## Impact

Generado por zero para el trabajo f63d5a82.

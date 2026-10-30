# Proposal

## Why

Hoy, cuando el motor corta una construcción porque llegó al tope de dólares del trabajo, zero lo cuenta como un intento fallido y al siguiente intento le da la indicación equivocada "Hacé cambios más chicos y enfocados". Los intentos que siguen arrancan casi sin plata y fallan seguro. Con este cambio, el motor avisa cuándo una llamada se cortó por el tope en dólares. Si eso pasa en build, el intento no se cuenta, no se deja esa indicación y el trabajo va directo a la decisión de presupuesto: en L0 a L2 te pregunta si le das más plata, y en L3 falla con un motivo claro de presupuesto. Si aprobás, sigue desde la especificación ya hecha, con el mismo número de intento. Además, zero no arranca un intento cuando lo que queda del presupuesto está por debajo de un mínimo razonable (el 10% del tope del trabajo). En ese caso hace directamente la misma pregunta, en vez de gastar unos centavos en un intento que va a fallar.

Pedido original: "Cuando build agota el presupuesto del trabajo, preguntar al dueño en vez de quemar intentos Por qué: Tres de los cuatro trabajos fallidos del mes (40cd405a, 4e389c24, f597c4f3) agotaron sus 3 intentos con "Reached maximum budget". El último intento de 40cd405a arrancó con un tope de $0.011: `remaining()` en src/line/runner.ts:220 tiene un piso de 0.01 y la comprobación de la línea 369 solo mira si lo gastado ya superó el presupuesto. Así que un intento que corta el tope del motor se cuenta como fallo, con la indicación engañosa "Hacé cambios más chicos y enfocados" (línea 427). Los intentos que siguen arrancan casi sin plata y fallan seguro. Qué cambiaría: Que el adaptador de motor marque en EngineResult cuándo una llamada se cortó por su tope en dólares (en Claude: el resultado "Reached maximum budget"), sin que el runner dependa de un proveedor concreto. En runner.ts, un build cortado por el tope no consume intento ni deja esa indicación como retroalimentación: va directo al camino de `budget-exceeded` (pregunta al dueño o falla según policy.ts), conservando el punto de control. Además, no empezar un intento cuando el presupuesto restante está por debajo de un mínimo razonable. Va con su cambio OpenSpec y tests con un motor falso que devuelve el corte por presupuesto."

## What Changes

- Cuando build agota el presupuesto del trabajo, preguntar en vez de gastar intentos
- Supuesto: Assumption: the minimum is 10% of the job's total cap ($0.30 with the default $3 budget). This scales with the small budgets the tests use (usdPerJob 0.15), so the existing 'stops at the job budget' test keeps passing. The owner may prefer a fixed dollar amount.
- Supuesto: The Agent SDK reports a budget cut as subtype 'error_max_budget_usd'. The text 'Reached maximum budget' the owner saw may come from the `errors` array or from the CLI. The adapter checks both so the flag does not depend on which one appears.
- Supuesto: The box path serializes EngineResult through src/box/protocol.ts encodeResult. If that encoder whitelists fields, budgetLimited must be added there too, or boxed runs lose the flag.
- Supuesto: Only build is covered. A spec, review or security call cut by its cap still behaves as today (spec retries, review counts as a failed run).

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Cuando build agota el presupuesto del trabajo, preguntar en vez de gastar intentos

## Impact

Generado por zero para el trabajo 9f6c38c7.

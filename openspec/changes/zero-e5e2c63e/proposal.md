# Proposal

## Why

Vas a poder anotar en zero.factory.yaml motores de reemplazo, para toda la fábrica (`fallback: [codex]`) o para una estación (`stations.review.fallback: [{ engine: codex, model: ... }]`). Cuando el plan del motor de una estación se agota o llega a tu reserva, esa estación trabaja con el primer reemplazo disponible. Si un trabajo se corta a mitad, sigue con el reemplazo sin gastar un intento, y cuando el motor original se renueva las estaciones vuelven a él. La fábrica solo se pausa si alguna estación necesaria se queda sin ningún motor disponible. Si un reemplazo se paga por uso, los topes en dólares cuentan solo para ese motor. Los reemplazos salen únicamente de lo que pusiste en la configuración y pasan por la misma caja, la misma puerta de salida y las mismas reglas de solo lectura. En la traza y en el panel se ve qué motor hizo cada estación y por qué (por ejemplo «review vía codex (claude pausado hasta 23:20)»). En el estado se ve «claude pausado hasta 23:20 · trabajando con codex». Si no configurás reemplazos, todo sigue como hoy: la fábrica se pausa y espera.

Pedido original: "Motor de reemplazo cuando se agota el cupo de la suscripción Hoy, cuando el plan de la suscripción del motor de una estación se agota (src/budget.ts, desde el PR #11), la fábrica pausa todo y espera a que se renueve. Quiero poder configurar motores de reemplazo para que siga trabajando con otro motor que yo elija. 1. Configuración: en zero.factory.yaml, una lista opcional de reemplazo, por estación y/o global (por ejemplo `fallback: [codex]` o `stations.review.fallback: [{ engine: codex, model: ... }]`). Sin reemplazo configurado, todo sigue como ahora (pausa y espera). 2. Uso: si el motor de una estación está pausado por su plan (ventana agotada o reserva del dueño), la estación corre con el primer reemplazo que no esté pausado. Si un trabajo se corta a mitad por el plan, en vez de volver a la cola sigue con el reemplazo, sin gastar un intento. Cuando el motor original se renueva, las estaciones vuelven a él. 3. El presupuesto pasa a ser por motor: la fábrica solo pausa si todos los motores posibles de las estaciones que hacen falta están agotados. Si un reemplazo se paga por uso, cuentan los topes en dólares (`usdPerDay`, `usdPerJob`) solo para ese motor. 4. Garantías: los reemplazos son solo motores que el dueño puso en la configuración; nunca se elige uno solo. Pasan por la misma caja y la misma puerta de salida, con las mismas reglas de solo lectura por estación. 5. Que se vea: en la traza y en el panel, qué motor hizo cada estación y por qué (por ejemplo «review con codex: Claude pausado hasta 23:20»). En el estado: «Claude pausado hasta 23:20 · trabajando con codex». Fuera de alcance: rotar entre varias cuentas del mismo proveedor y enrutar por proxies de terceros."

## What Changes

- Motores de reemplazo cuando se agota el plan de la suscripción
- Supuesto: Supuesto: una lista `fallback` de la estación reemplaza a la global en vez de sumarse; así el dueño puede quitar reemplazos de una estación concreta.
- Supuesto: Supuesto: «las estaciones que hacen falta» son spec, build, review y security para los trabajos de la cola. reply solo afecta la respuesta a comentarios. La fábrica se pausa si alguna de ellas no tiene ningún motor, porque un trabajo necesita todas.
- Supuesto: Los motores que no son Claude (codex, antigravity, propios) hoy no informan plan ni facturación. Un reemplazo nunca usado figura como disponible y con facturación desconocida. Se asume que se paga por uso para los topes recién cuando informe `api`; mientras no se sepa, el tope por llamada se aplica de forma conservadora.
- Supuesto: Repetir build con otro motor después de un corte descarta los cambios parciales del motor cortado. Se pierde ese trabajo, pero se evita mezclar cambios a medio hacer (ver el hallazgo del townhall sobre el reintento de build).
- Supuesto: Un motor sin credenciales en la caja falla como hoy («No se puede usar X en la caja») y no se considera pausado por plan. No se salta automáticamente al siguiente reemplazo.
- Supuesto: Que un reemplazo con otro motor tenga una calidad de revisión distinta a la del original es una decisión del dueño al configurarlo.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Motores de reemplazo cuando se agota el plan de la suscripción

## Impact

Generado por zero para el trabajo e5e2c63e.

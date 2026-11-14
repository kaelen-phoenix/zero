# ADR 0005 — Bajar el costo de CI y de los servicios de la fábrica

- **Estado:** propuesto
- **Fecha:** 2026-11-13

## Contexto

El 13 de noviembre la cuenta llegó al 100% del presupuesto mensual de GitHub Actions: $55,63 de uso bruto, de los que $25,63 son los incluidos en GitHub Pro y $30 el presupuesto que quien está a cargo fijó encima. Desde ese momento GitHub dejó de arrancar los checks de los repositorios privados y quedaron 15 pull requests de soliloq esperando, 8 de ellos arreglos de seguridad.

Qué líneas cuestan:

- zero es público: sus checks no consumen minutos pagos.
- soliloq, newoman, glowingsanhair y zero-plus son privados. soliloq es el que más gasta.

Lo medido en soliloq en noviembre (workflow Apps, unas 100 corridas):

- `android`: unos 30 minutos por corrida. Unas 20 se cancelaron a mitad y GitHub las cobra igual por los minutos usados. Del orden de 3.000 minutos de Linux en el mes (estimado).
- `ios`: unos 9 minutos en macOS, unas 20 corridas hasta el 10/11; hoy se saltea. Los minutos de macOS se cobran con un multiplicador de alrededor de 10 sobre los de Linux (dato de la documentación de GitHub, no verificado contra la factura de esta cuenta), así que unos 180 minutos reales pesan como 1.800.
- `e2e-flujos`: hasta unos 50 minutos contra un staging compartido, con muchas re-corridas mientras staging estaba caído.
- Los 14 arreglos de Dependabot abrieron un pull request por paquete, cada uno con el CI completo.

Qué tiene zero hoy:

- `githubReader` en `src/billing/readers.ts` lee `/users/<cuenta>/settings/billing/usage` (u `/organizations/…`) con el secreto `GITHUB_BILLING_TOKEN` (o el token de la fábrica) y suma minutos, bruto, descuento y neto por repositorio. Solo alimenta el informe mensual (`lines[].services`); no decide si se arranca trabajo.
- `ChecksBilling` en `src/line/automerge.ts`: cuando un check falla porque GitHub no lo arrancó por facturación (`billingRefusal`), el pull request queda `blocked` sin comentario, actualización ni re-corrida, y `followBilling` vuelve a correr los checks rechazados uno por vez cuando ve un check que arrancó de nuevo. Es decir, zero se entera del tope cuando GitHub ya cortó.
- `ChecksOutage` en `src/line/automerge.ts`: el mismo check fallando en dos pull requests del repositorio, o también en la base, registra un entorno caído; mientras dura no se actualiza ni se re-corre nada, y se prueba con re-corridas espaciadas (30 minutos, doblando hasta 240).
- `unblock` en `src/line/automerge.ts` actualiza un pull request atrasado contra su base (`MAX_REFRESHES` en su vida) y re-corre una vez por punta los runs fallidos. Cada actualización y cada re-corrida es un CI completo.
- `pollSecurityAlerts` en `src/intake/security-alerts.ts` abre un trabajo por paquete (ecosistema más nombre): un pull request y un CI completo por paquete.

## Decisión

Se proponen seis ideas, en el orden del pedido. El orden de prioridad recomendado es 4 (workflows de soliloq, el mayor ahorro inmediato y sin código en zero), 3 (presupuesto conocido, para no volver a quedar cortados), 2, 5, 1 y 6. Las propuestas 2, 3, 5 y parte de la 1 son cambios en zero (trabajos futuros en la línea zero); la 4 y la otra parte de la 1 son cambios en el repositorio de soliloq (trabajos futuros en esa línea, que este trabajo no toca); la 6 es una revisión de cuentas. Ninguna se aplica sin que quien está a cargo la apruebe. Todos los ahorros son estimaciones a partir de las cifras de arriba, no lecturas de la factura.

Un trabajo de construcción no puede escribir en la pestaña Propuestas (esa lista la llenan el turno de noche, unjam y la promoción), así que cada idea queda escrita acá para que el turno de noche la proponga o para que la pidas directamente.

### Propuesta 1 — Tren de integración por línea

Un tren de integración por línea: la fábrica junta varios trabajos entregados en una rama de integración (por ejemplo `zero/tren`) y corre los checks pesados una vez por tanda, con un horario (dos veces por día) o cada N cambios; cada pull request solo corre checks livianos. Si la tanda pasa, la rama de integración entra a la base en un solo merge (o se fusionan los pull requests de la tanda en orden). Si falla, zero busca el culpable por bisección sobre la lista de cambios de la tanda (corre los checks pesados sobre la primera mitad, después sobre la mitad que falla) y lo saca de la tanda: ese trabajo vuelve a la cola con el log como feedback, como hoy hace `fixChecks`, y el resto sigue.

La merge queue de GitHub haría algo parecido, pero no está disponible para repositorios privados de una cuenta personal (solo para organizaciones con ciertos planes), así que zero tiene que hacerlo por su cuenta. En zero sería una opción por línea (por ejemplo `train: { every: N, at: [HH:MM] }`), un paso nuevo en `src/line/automerge.ts` y el estado de la tanda en kv. En soliloq, separar en el workflow qué es liviano (por pull request) y qué es pesado (en `push` a la rama del tren).

**Ahorro estimado:** con tandas de 5 cambios, los checks pesados corren una vez por tanda en vez de 5: alrededor de un 60 a 80% de los minutos de `android` y `e2e-flujos` (estimado), menos las corridas extra de bisección cuando una tanda falla.

**Riesgo:** es el cambio más grande en zero. Los cambios tardan más en entrar (hasta la próxima tanda), una tanda que falla seguido gasta en bisección lo que ahorró, y los conflictos entre trabajos de la misma tanda tienen que resolverse antes de correr los checks.

### Propuesta 2 — Dependabot agrupado

Hoy `pollSecurityAlerts` en `src/intake/security-alerts.ts` abre un trabajo por paquete; las 14 alertas fueron 14 pull requests con CI completo cada uno. Propuesta: un solo trabajo y un solo pull request por línea por tanda, juntando las alertas nuevas de un mismo pase (o de una ventana, por ejemplo 24 horas, salvo las críticas). Las alertas que llegan con un trabajo de tanda sin terminar se suman a ese trabajo, como hoy se suman al del paquete.

La alternativa es la opción `groups` de Dependabot en `.github/dependabot.yml` del repositorio, que junta sus propias actualizaciones en un pull request. Sirve para los pull requests que abre Dependabot, pero zero no los toma (toma las alertas y abre sus propios trabajos), así que no reduce los de la fábrica; además es un cambio en cada repositorio. Se recomienda agrupar en zero y, si quien está a cargo también usa los pull requests de Dependabot, sumar `groups` en cada línea.

**Ahorro estimado:** las 14 corridas completas de noviembre serían 1 o 2: unos 12 CI completos menos por tanda, del orden de $5 a $8 estimados en soliloq.

**Riesgo:** un paquete cuya actualización rompe la build frena a los demás en la misma tanda; hace falta sacarlo de la tanda (como en la propuesta 1) para que el resto de los arreglos de seguridad no espere.

### Propuesta 3 — Presupuesto de Actions conocido

Que la fábrica sepa lo gastado en el mes y el límite, y se espacie o se frene antes del tope en vez de enterarse cuando GitHub corta (`ChecksBilling`). Ya existe `githubReader` en `src/billing/readers.ts`, que lee `/settings/billing/usage` con `GITHUB_BILLING_TOKEN`: el paso nuevo es leerlo más seguido (por ejemplo cada hora, dentro del medidor de GitHub) y guardarlo en kv para `src/budget.ts` y `automerge.ts`. Con el gasto y el límite, zero puede:

- Con más del 70% usado: no re-correr ni actualizar pull requests por su cuenta (`unblock`), y agrupar más (propuestas 1 y 2).
- Con más del 90%: no arrancar trabajos nuevos en líneas privadas salvo los urgentes, y avisar en `zero status` y el resumen.

Permisos: leer la facturación de una cuenta personal pide un token clásico con el scope `user` (o el permiso equivalente de un token fine-grained, "Plan" de lectura en la cuenta). El token de la fábrica normalmente no lo tiene; conviene un `GITHUB_BILLING_TOKEN` aparte, solo de lectura. Leer el límite de gasto o el presupuesto configurado (no solo lo usado) por API está no verificado: no se probó contra GitHub qué endpoint lo da para una cuenta personal. Mientras tanto, el límite puede ir en el archivo de la fábrica (por ejemplo `limits.actionsUsdPerMonth: 55`).

**Ahorro estimado:** no baja el gasto por sí sola, pero evita el corte: los 15 pull requests de noviembre no habrían quedado esperando, y los arreglos de seguridad tendrían prioridad sobre el resto. Indirectamente, frenar las re-corridas con poco margen ahorra algunos dólares por mes (estimado).

**Riesgo:** un token con scope `user` puede más que leer facturación (el scope clásico es amplio); guardarlo solo en el `SecretStore`. Una lectura atrasada o fallida no debe frenar la fábrica: sin dato, se sigue como hoy.

### Propuesta 4 — Workflows de soliloq

Es la de mayor ahorro inmediato y no necesita código en zero. Cambios en `.github/workflows` de soliloq:

- Filtros por rutas (`paths` en `on.pull_request`, o un job que use `dorny/paths-filter` si se quiere un check requerido que siempre informe): `android` solo si cambia la app móvil, `ios` solo si cambia la app móvil de iOS, `e2e-flujos` solo si cambian la web o la base (migraciones).
- Cancelar corridas viejas de la misma rama: `concurrency: { group: apps-${{ github.ref }}, cancel-in-progress: true }`. Ojo: una corrida cancelada igual se cobra por los minutos que usó, así que esto ahorra el resto de la corrida, no la corrida entera; el ahorro grande viene de no arrancarla (filtros y tren).
- Checks pesados solo en main o de noche: `android` completo, `ios` y `e2e-flujos` en `push` a main y en `schedule` (por ejemplo una vez por noche), con una versión liviana (lint, tests unitarios, build de debug) por pull request.
- `cache` de dependencias y de Gradle (`actions/setup-java` con `cache: gradle`, `actions/cache` para npm y para el AVD si se usa emulador); en `ios`, cache de CocoaPods o SPM.
- Runners más baratos: Linux en vez de macOS para todo lo que no compila iOS; evitar runners grandes. Un runner propio (self-hosted) no cobra minutos, pero correría código de pull requests en una máquina de quien está a cargo: solo con la caja de aislamiento o una máquina descartable.

**Ahorro estimado:** si `android` corre en la mitad de los pull requests (filtro de rutas) y con cache baja de 30 a unos 20 minutos, pasa de unos 3.000 a unos 1.000 minutos: unos $16 de los $55,63 (estimado, a $0,008 por minuto de Linux). `e2e-flujos` solo en main o de noche evita la mayor parte de sus corridas y re-corridas: otros $10 a $15 estimados.

**Riesgo:** un filtro mal escrito deja pasar un cambio que rompe la app sin correr su check; un check requerido que no corre deja el pull request esperando para siempre (hay que usar un job que siempre informe). Los checks pesados de noche encuentran el error después del merge, no antes.

### Propuesta 5 — Sin re-corridas con el entorno caído

`ChecksOutage` en `src/line/automerge.ts` ya hace buena parte: cuando el mismo check falla en dos pull requests o también en la base, deja de actualizar y re-correr, y prueba con una re-corrida espaciada (30 minutos, doblando hasta 240). Lo que falta para no pagar re-corridas contra un staging caído:

- Detectar la caída antes de la segunda falla: con un solo pull request no hay comparación, y cada re-corrida de `e2e-flujos` son hasta 50 minutos. Un chequeo barato de salud de staging (una URL por línea en el archivo de la fábrica, consultada por zero sin correr CI) diría si vale la pena.
- Que la prueba de recuperación no sea una corrida completa de `e2e-flujos`: con ese chequeo de salud, zero prueba la URL y re-corre solo cuando responde.
- En soliloq, que `e2e-flujos` empiece con un paso que pruebe staging y termine en segundos si no responde, en vez de esperar sus 50 minutos.

**Ahorro estimado:** las re-corridas de noviembre por la caída de staging; si fueron unas 10 de `e2e-flujos` a 50 minutos, unos 500 minutos, del orden de $4 (estimado).

**Riesgo:** un chequeo de salud que da bien con staging roto a medias hace re-correr igual; uno que da mal con staging sano frena los pull requests sin motivo (la caída tiene que terminar sola cuando la URL vuelve).

### Propuesta 6 — Otros costos de la fábrica

Repasar el plan de Claude, Vercel y Supabase con los datos del informe mensual: `lines[].services` ya lee Vercel y Supabase (y GitHub) una vez por día y los muestra en la sección "Servicios" del informe. Ninguna de esas cifras se midió para este documento; todo lo que sigue es estimado.

- Claude: con suscripción, el costo es fijo y lo que importa son las ventanas de uso; el ahorro está en no gastar llamadas en trabajos que van a fallar en CI (propuestas 1, 2 y 4 reducen intentos de arreglo de checks) y en limitar el turno de noche (`limits.usdPerNight`) si no se aprueban sus propuestas.
- Vercel: los despliegues de vista previa por cada pull request de líneas web pueden apagarse o limitarse a ramas de tanda, si el plan cobra por build.
- Supabase: un proyecto de staging pausado cuando no se usa, o compartido entre líneas, si el plan cobra por proyecto.

**Ahorro estimado:** sin medir; depende de los planes contratados. Se puede estimar después de un mes con `lines[].services` configurado en cada línea.

**Riesgo:** bajo; apagar vistas previas o pausar staging cambia cómo se revisan los cambios y puede hacer fallar `e2e-flujos` si no se avisa.

## Consecuencias

- Mantener el tren de integración y el presupuesto de Actions suma estado nuevo en `automerge.ts` y una lectura más contra GitHub dentro del medidor de cuota; los cambios en workflows de soliloq quedan en su repositorio y los mantiene esa línea.
- Quedan no verificados: el endpoint del límite o presupuesto de Actions para cuentas personales, el multiplicador de minutos de macOS aplicado a esta cuenta y los precios por minuto usados en las estimaciones. Las cifras de ahorro son estimaciones y hay que contrastarlas con el informe mensual del mes siguiente.
- Este trabajo no instala nada ni toca los repositorios de soliloq, newoman, glowingsanhair ni zero-plus. Cada propuesta es un trabajo futuro que quien está a cargo tiene que aprobar antes de cualquier cambio de código.

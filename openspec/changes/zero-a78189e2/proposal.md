# Proposal

## Why

Hoy, cuando se cae un entorno que comparten los checks (como el Supabase de staging de soliloq), la fábrica gasta la única re-corrida de cada pull request mientras dura la caída. Después esos pull requests quedan trabados para siempre, aunque el entorno ya ande. Con este cambio, la pasada de fusión se da cuenta de que el problema es del entorno y no del código. Pasa cuando el mismo check falla en dos o más pull requests del mismo repositorio en menos de 2 horas, o cuando también falla en la rama base. En ese caso marca el repositorio como «entorno caído», y mientras dure no gasta re-corridas ni actualizaciones de rama ni comenta en los pull requests. Detecta la recuperación de dos maneras: - ve que ese check vuelve a pasar en cualquier rama del repositorio, o - si no aparece ninguna corrida que pase, prueba re-correr un solo pull request, de a uno: primero a los 30 minutos de la última falla, y después cada vez más espaciado (60, 120, hasta 240 minutos). Cuando el entorno ya se recuperó, re-corre una vez y de a uno los checks fallidos de cada pull request afectado, aunque ya hubiera usado su re-corrida durante la caída. `zero status`, el panel y el resumen muestran una sola línea, «Entorno caído en <repo> desde HH:MM (checks: …)», en vez de una línea de «fallaron los checks» por cada pull request. Los 6 pull requests trabados de soliloq (#505, #475, #469, #467, #463 y #448) entran solos por este camino: la fábrica reconoce que todos fallaron `e2e-flujos` en la misma ventana, prueba con uno y, si pasa, re-corre los demás de a uno. Por ahora la fábrica no lee los logs de los checks para buscar errores de red. Queda anotado como trabajo para más adelante.

## What Changes

- Reconocer una caída del entorno compartido de los checks y destrabar sus pull requests cuando se recupera
- Supuesto: No se leen los logs de los checks (patrones de timeout, 502/503/504, ECONNRESET): habría que descargarlos con una llamada nueva a la API. Queda como trabajo para más adelante, y la detección se basa en el mismo check fallado en varios pull requests y en la rama base.
- Supuesto: Una rama base realmente rota (un error de código ya fundido) se ve igual que una caída: todos los pull requests fallan el mismo check, y también la base. La fábrica va a esperar y a probar en vano, con una espera que crece hasta 4 horas, en lugar de avisar en cada pull request. La re-corrida extra después de la recuperación se da una sola vez por caída.
- Supuesto: Un pull request con un check de la caída y además otro check propio fallado queda retenido por la caída, y su propia falla se trata recién después de la recuperación.
- Supuesto: Que el entorno está compartido (`concurrency: e2e-staging`) no se lee del workflow: se respeta con la regla de una corrida a la vez por repositorio que ya existe (`busy`).
- Supuesto: `at` depende de que GitHub informe `completed_at`/`updated_at`. Sin ese dato se usa la hora de la pasada, y entonces la ventana de 2 horas mide cuándo la fábrica vio la falla.
- Supuesto: Leer los checks de la base agrega una llamada a GitHub antes de cada gasto, y una cada 5 minutos como mucho por repositorio mientras dura una caída. Todas pasan por el medidor de cuota de la pasada `merges`.
- Supuesto: La hora HH:MM se muestra en la hora local de la máquina. Los tests deben calcular el valor esperado con la misma función, sin fijar una zona horaria.
- Supuesto: Los tests corren despacio (las notas previas muestran `npm test` pasando el tiempo límite). Los nuevos usan GitHub falso y un reloj inyectado, sin git más allá de `gitRepo()` en la fábrica de prueba.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Reconocer una caída del entorno compartido de los checks y destrabar sus pull requests cuando se recupera

## Impact

Generado por zero para el trabajo a78189e2.

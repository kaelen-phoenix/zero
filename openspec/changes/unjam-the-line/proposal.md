# Proposal

## Why

El 9 y 10 de noviembre de 2026 la fábrica quedó trabada: unos 30 pull requests sin fundir y 9 trabajos fallados, casi todos por causas que no eran del código. Las causas, medidas en la máquina y en GitHub:

- **Tiempo de verificación fijo.** `npm test` de zero tarda entre 23 y 32 minutos en esta máquina (1,5 minutos en CI) y el límite era de 20 minutos, sin forma de cambiarlo. Seis trabajos cuyos tests pasaban gastaron sus 3 intentos y fallaron.
- **Comandos de varios trabajos a la vez.** Con tres trabajos corriendo sus suites juntos la máquina se quedó sin memoria: un `npm ci` terminó con código 134 y el trabajo falló sin otro intento.
- **Procesos que quedan vivos.** En Windows, cortar un comando por tiempo o por una parada mataba solo la shell: npm, el corredor de tests o un servidor de desarrollo seguían corriendo, ocupando la máquina y dejando trabada la copia de trabajo (EBUSY). Un `next dev` de un trabajo de hace cinco días seguía vivo.
- **Checks viejos.** Los checks de unos 15 pull requests habían fallado contra una base vieja (el arreglo llegó después a la base). Volver a correrlos no alcanza: hay que traer la base a la rama. Nadie lo hacía.
- **Corridas canceladas o inestables.** Un CI que comparte un ambiente cancela las corridas que se acumulan y el check queda en rojo sin que sea culpa del cambio.
- **Un registro que no se pudo escribir** (sin memoria) tiró abajo el daemon entero.

## What Changes

- Tiempo límite de cada comando de verify: `verifyTimeoutMinutes` por línea (20 por defecto) y nunca menos que el doble de la más lenta de sus últimas 5 corridas aprobadas en esa línea. Si se supera, el motivo dice de cuánto era el límite y dónde se cambia.
- `commandConcurrency` (1 por defecto): los comandos de setup y verify de todos los trabajos se turnan en la máquina; la espera no cuenta para el tiempo límite.
- Un setup que falla se prueba una vez más en una copia nueva antes de fallar el trabajo.
- Un comando o un motor por CLI cortado por tiempo, parada o apagado muere con todo lo que había arrancado. Si una copia de trabajo no se puede borrar, zero mata los procesos que siguen corriendo desde ella y lo intenta otra vez.
- Fusión automática: antes de dejar un pull request trabado por checks fallidos, la fábrica trae la base a la rama desde GitHub si quedó atrás (uno por repositorio a la vez, 3 veces como mucho) o, si está al día, vuelve a correr una vez las corridas fallidas de GitHub Actions.
- Un registro que no se puede escribir se descarta y se cuenta; nunca detiene al daemon.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: tiempos de verificación, turnos de comandos, reintento de setup, procesos que quedan vivos y destrabe de pull requests con checks fallidos
- `factory-daemon`: un registro que no se puede escribir no detiene la fábrica

## Impact

`src/line/pace.ts` y `src/leftovers.ts` (nuevos), `src/line/verify.ts`, `src/line/runner.ts`, `src/line/automerge.ts`, `src/shell.ts`, `src/engines/cli.ts`, `src/workspace.ts`, `src/log.ts`, `src/daemon.ts`, `src/config.ts`, `src/signature.ts`. Opciones nuevas del archivo de la fábrica: `commandConcurrency` y `lines[].verifyTimeoutMinutes`. La fusión automática hace pedidos nuevos a GitHub (comparar con la base, actualizar la rama, volver a correr una corrida), dentro del medidor de cupo de la pasada `merges`.

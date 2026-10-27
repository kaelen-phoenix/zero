# Proposal

## Why

El dueño quiere que la fábrica cierre el ciclo sola: que un agente revise la seguridad del cambio y, si todo está bien, lo funda, sin que él tenga que aceptar cada pull request.

Hoy la estación `review` mira la seguridad de pasada, entre otros defectos. Una revisión dedicada, con sus propias instrucciones (y, si el dueño quiere, otro motor), da una segunda mirada independiente. Y en las líneas `pull-request` el trabajo termina al abrir el pull request: fundirlo depende siempre del dueño.

El dueño eligió que la fábrica funda **siempre que pase todo**, toque lo que toque. Las garantías que ya existen se mantienen: las rutas protegidas siguen pidiendo aprobación en L0–L2, y las salidas sospechosas siguen frenando el trabajo.

Principios que sirve:
- **Fábrica a oscuras**: del issue al cambio fundido sin el dueño.
- **Garantías impuestas por zero**: fundir lo decide zero con señales verificables (CI de GitHub, hallazgos con citas comprobadas), no la opinión de un agente.
- **Agnóstico al motor**: la estación de seguridad es una estación más, con instrucciones en `agents/` y motor configurable.

## What Changes

- **Estación `security`** después de `review`, en todas las líneas:
  - de solo lectura, con instrucciones propias en `agents/security.md` (secretos, inyección, uso inseguro del shell, rutas, permisos, dependencias nuevas, debilitar controles existentes);
  - mismos hallazgos con citas verificadas que `review`; un hallazgo verificado `high` o `critical` rechaza el intento y vuelve a `build` como retroalimentación;
  - configurable en `stations.security` (motor, turnos, tiempo), para que pueda usar un motor distinto del que construyó.
- **Fusión automática** en las líneas `pull-request` con `autoMerge: true`:
  - el trabajo se entrega al abrir el pull request, como hoy;
  - el daemon revisa cada minuto esos pull requests; cuando todos los checks de GitHub terminaron bien y GitHub dice que se puede fundir, lo funde (merge commit) y borra la rama;
  - si un check falla, hay conflictos o alguien cerró el pull request, no lo funde, deja el pull request abierto y lo avisa (en el issue y en `zero status`/el panel/el informe);
  - el issue recibe un comentario al fundirse; `Closes #N` lo cierra.
- `zero status` y el panel muestran los pull requests esperando checks para fundirse.

## Capabilities

### Modified Capabilities
- `production-line`: estación `security`; fusión automática de pull requests.

## Impact

- Código nuevo: `agents/security.md`, `src/line/automerge.ts` (seguimiento y fusión).
- Cambios en `src/config.ts` (`stations.security`, `autoMerge` por línea), `src/line/runner.ts` (estación nueva), `src/state/store.ts` (estación `security`), `src/tracker.ts` (checks y merge), `src/intake/github.ts` (comentario de fusión), `src/daemon.ts`, `src/app.ts`, `src/format.ts`, `src/panel/html.ts`.
- Sin dependencias nuevas.

**Fuera de alcance**:
- Que la fábrica arregle sola un check fallido del CI.
- Que la fábrica se actualice sola después de fundir un cambio a zero (pull, build y reinicio siguen siendo manuales).
- Auto-merge nativo de GitHub (pide configurar protección de ramas en el repositorio).

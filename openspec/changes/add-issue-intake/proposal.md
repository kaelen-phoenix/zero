# Proposal

## Why

El dueño quiere cargar trabajo desde GitHub: abrir un issue en el celular y que la fábrica lo tome, sin abrir un chat. En una fábrica a oscuras, la cola de issues es la entrada natural de trabajo.

Hay un problema previo. Cuando la línea entrega por pull request, la fábrica arranca cada trabajo desde la rama base **local**. Si el dueño acepta un pull request en GitHub, esa rama local queda vieja, y el trabajo siguiente parte de una versión anterior. Con issues entrando solos, esto pasaría todo el tiempo.

Principios que sirve:
- **Fábrica a oscuras**: el trabajo entra y avanza sin que el dueño esté frente a la PC.
- **Garantías impuestas por zero**: solo se toma trabajo de personas con permiso de escritura.
- **Observabilidad**: el issue muestra en qué anda su trabajo.

## What Changes

- **Base actualizada**: en las líneas `pull-request`, cada trabajo nuevo trae la rama base del remoto y arranca desde ella. Si no hay conexión, usa la local y lo registra.
- La publicación del pull request se hace desde el repositorio del dueño, así también funciona con trabajos que corrieron en la caja.
- **Issues como pedidos**, para cada línea con `issues: { label: zero }`:
  - el daemon revisa cada minuto los issues abiertos con esa etiqueta en el repositorio de GitHub de la línea;
  - cada uno se convierte en un trabajo con su título y su cuerpo;
  - solo se toman issues cuyo autor y quien puso la etiqueta tienen permiso de escritura. Si no, la fábrica lo explica en el issue y no lo toma;
  - el trabajo recuerda su issue. La fábrica comenta en él cuando lo toma, cuando necesita al dueño y cuando termina;
  - el pull request incluye `Closes #N`;
  - volver a poner la etiqueta después de que el trabajo terminó lo vuelve a pedir.
- `zero issues on|off [--line L] [--label X]` activa o desactiva la entrada por issues y crea la etiqueta en GitHub si no existe.
- `zero status` y el panel muestran qué líneas miran issues y el último problema de acceso.

## Capabilities

### Modified Capabilities
- `work-intake`: los issues etiquetados de GitHub son otra forma de pedir trabajo.
- `production-line`: las líneas `pull-request` arrancan cada trabajo desde la rama base del remoto.

## Impact

- Código nuevo: `src/intake/github.ts` (lectura de issues, permisos, comentarios, sincronización).
- Cambios en `src/config.ts` (`issues` por línea), `src/state/store.ts` (`source` del trabajo), `src/workspace.ts` y `src/line/runner.ts` (base del remoto), `src/line/integrate.ts` (push desde el repositorio del dueño y `Closes #N`), `src/tracker.ts`, `src/daemon.ts`, `src/app.ts`, `src/cli.ts`, `src/format.ts` y `src/panel/html.ts`.
- Sin dependencias nuevas (`@octokit/rest` ya está).

**Fuera de alcance**:
- Responder consultas comentando en el issue.
- Webhooks: requieren una dirección pública fija.
- GitLab, Linear y Jira.
- Tomar issues de personas sin permiso de escritura, porque su texto podría editarse después de etiquetado.

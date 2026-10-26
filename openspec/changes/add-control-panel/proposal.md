# Proposal

## Why

El dueño quiere probar la fábrica ahora, sin la caja, que necesita estar frente a la PC para instalar WSL2 y reiniciar. Y quiere mirarla desde el celular, lejos de la PC. Hoy la única forma de ver y manejar la fábrica es la terminal o un chat.

El panel en el navegador es la sala de control de la fábrica a oscuras: ahí se ve qué está haciendo, se responde lo que pregunta y se tira del andon. Lo usa también quien no programa.

Principios que sirve:
- **Usable por no programadores**: botones en lugar de comandos.
- **Observabilidad de primer nivel**: estado, trazas, salidas e informe en una sola página.
- **Un solo dueño**: el panel exige una clave que solo tiene el dueño, y el acceso remoto es temporal y explícito.
- **Open source y gratuito**: el servidor es `node:http`, sin dependencias. El túnel usa `cloudflared` (Apache-2.0) y solo si el dueño lo pide.

## What Changes

- Nuevo **panel** servido por el daemon en `127.0.0.1:<panel.port>` (4848 por defecto), pensado para el celular:
  - **resumen**: nivel, andon, presupuesto, producción de hoy, trabajos esperando, en curso, en cola y terminados;
  - **trabajo**: estado, pregunta con aprobar o rechazar, traza y salidas, y detener;
  - **salidas**: el informe de la puerta con botones para bloquear, permitir o quitar un sitio, y el modo;
  - **informe**: el mismo informe del dueño;
  - un formulario para **pedir un trabajo** y el **andon** para detener y reanudar la fábrica.
- **Acceso con clave**:
  - `zero panel` imprime un link con la clave en el fragmento (`#k=…`), que el navegador nunca envía en la URL;
  - la página la canjea por una cookie de sesión (`HttpOnly`, `SameSite=Strict`);
  - la clave vive en el llavero del sistema;
  - `zero panel rotate` la cambia e invalida los links y las sesiones anteriores.
- **Acceso remoto temporal**:
  - `zero panel remote on` abre un túnel rápido de Cloudflare y devuelve un link `https://…trycloudflare.com` con la clave;
  - el daemon mantiene el túnel mientras siga activado;
  - `zero panel remote off` lo cierra;
  - si `cloudflared` no está, zero pide permiso y lo descarga desde sus releases oficiales a `~/.zero/bin`, verificando la firma en Windows.
- Todas las acciones del panel usan las mismas operaciones de `app.ts` que la CLI y el chat.

## Capabilities

### New Capabilities
- `control-panel`: el panel en el navegador, su acceso con clave y el acceso remoto temporal.

## Impact

- Código nuevo:
  - `src/panel/server.ts` (rutas, autenticación, acciones);
  - `src/panel/html.ts` (páginas);
  - `src/panel/tunnel.ts` (cloudflared).
- Cambios en `src/config.ts` (`panel.port`), `src/daemon.ts` (sirve el panel y mantiene el túnel), `src/cli.ts` (`zero panel`), `src/format.ts` (textos compartidos) y `src/home.ts` (`bin/`).
- Sin dependencias nuevas de npm. `cloudflared` es un binario opcional, descargado solo con consentimiento.

**Fuera de alcance**:
- Red privada (Tailscale/Headscale) como alternativa al túnel.
- Edición de la definición completa de la fábrica desde el panel.
- Notificaciones push.
- Instalador.

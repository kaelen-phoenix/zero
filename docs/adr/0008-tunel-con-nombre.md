# ADR 0008 — Dirección fija para el chat remoto con un túnel con nombre de Cloudflare

- **Estado:** propuesto
- **Fecha:** 2026-11-15

## Contexto

El chat remoto (ADR 0009) se conecta a `https://<túnel>/mcp`. Hoy el túnel es el rápido de cloudflared (`tunnel --url`, dirección `https://<algo>.trycloudflare.com`), que cambia cada vez que el túnel o la fábrica se reinician. Cada cambio deja sin servicio al conector del chat (ChatGPT, Claude u otro cliente MCP) hasta volver a agregarlo con la dirección nueva.

El emisor y el recurso de OAuth, y el Host que acepta `/mcp`, salen de kv `panel.remoteUrl` (`createRemoteMcp` en `src/mcp/http.ts`). Un túnel que escriba ahí un origen https fijo vuelve estable todo el chat remoto sin tocar el código de OAuth.

Lo que sigue sobre Cloudflare no se volvió a leer en su documentación oficial durante esta corrida: cada dato de Cloudflare lleva la marca **no verificado** y hay que confirmarlo en https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/ (la dirección misma es **no verificado**) antes de dar por buena la decisión. Lo que sale del código de zero está verificado por sus pruebas.

## Opciones evaluadas

| Opción | Estable | Qué pide | Veredicto |
|---|---|---|---|
| Túnel rápido (`trycloudflare.com`, el de hoy) | No | Nada | Queda como respaldo: se usa cuando falta la configuración del túnel con nombre. |
| Túnel con nombre administrado desde el panel de Cloudflare, con token | Sí | Cuenta de Cloudflare, un dominio propio en ella, crear el túnel y su nombre público | **Elegida.** cloudflared corre con `tunnel --no-autoupdate run` y el token solo en su entorno (`TUNNEL_TOKEN`). |
| Túnel con nombre creado con `cloudflared tunnel login` y un archivo de credenciales | Sí | Lo mismo, más un certificado y un archivo de credenciales en la máquina | Descartada: deja credenciales en archivos sueltos fuera del almacén de secretos. |
| Dominio propio con proxy inverso o puerto abierto | Sí | Certificado, abrir la red de la casa | Descartada: expone la máquina. |
| Tailscale Funnel, ngrok con dominio fijo | Sí | Otra cuenta y otro programa | No se implementa; sus condiciones son **no verificado**. |

## Decisión

- El archivo de la fábrica acepta `panel: { tunnel: { hostname: zero.tudominio.com } }` (estricto: solo `hostname`, un nombre DNS en minúsculas, sin esquema, puerto ni ruta, nunca de `trycloudflare.com`). No cabe ninguna credencial.
- El token del túnel es el secreto `CLOUDFLARE_TUNNEL_TOKEN` del almacén de secretos (`zero secret set CLOUDFLARE_TUNNEL_TOKEN`). `tunnelKeeper` (`src/panel/tunnel.ts`) lo pasa a cloudflared solo como la variable de entorno `TUNNEL_TOKEN` del proceso hijo; nunca va en argv, kv, logs ni archivos.
- Con `panel.remote` encendido, el subdominio y el token, el daemon corre el túnel con nombre. Publica `panel.remoteUrl = https://<hostname>` solo cuando cloudflared dice `Registered tunnel connection`, y la borra cuando el proceso termina o el acceso remoto se apaga.
- Si falta el subdominio o el token, sigue el túnel rápido de siempre; con subdominio y sin token avisa una vez en el log y lo deja como `problem` en el estado del túnel.
- Salud: kv `panel.tunnelState` (`mode`, `connectedSince`, `failures`, `lastExitAt`, `problem`), que `zero status` muestra como la línea `Túnel:` (`fijo (<hostname>)` o `temporal (cambia al reiniciar)`, conectado o no, caídas seguidas y el problema). `zero mcp remote on`, `zero mcp clients` y la página `/remote-chat` dicen si la dirección es fija (`RemoteChatView.stable`).

## Acción manual de quien está a cargo

zero no crea nada en Cloudflare ni toca el DNS: estos pasos los hace quien está a cargo, a mano.

1. **Dominio en Cloudflare:** tener un dominio propio con sus servidores de nombres en Cloudflare (plan gratuito alcanza: **no verificado**).
2. **Crear el túnel:** en el panel de Cloudflare (Zero Trust → Networks → Tunnels, el nombre del menú es **no verificado**), crear un túnel de tipo cloudflared y copiar su token (el valor que sigue a `--token` en el comando de instalación que muestra Cloudflare; **no verificado**). No instalar el servicio que propone Cloudflare: lo arranca zero.
3. **Nombre público:** en el túnel, agregar un nombre público (public hostname) con el subdominio elegido, por ejemplo `zero.tudominio.com`, apuntando al servicio `http://127.0.0.1:<puerto>`, donde `<puerto>` es `panel.port` (4848 si no se cambió). Cloudflare crea el registro DNS solo (**no verificado**).
4. **Guardar el token:** `zero secret set CLOUDFLARE_TUNNEL_TOKEN` y pegarlo cuando lo pida. Nunca en el archivo de la fábrica, en el repositorio ni en la línea de comandos.
5. **Configurar el subdominio:** poner `panel.tunnel.hostname: zero.tudominio.com` en `zero.factory.yaml` y reiniciar la fábrica (`zero shutdown` y `zero start`), porque el daemon lee el panel al arrancar.
6. **Conector nuevo sin romper el viejo:** en el chat, agregar un conector nuevo con `https://zero.tudominio.com/mcp` y dejar el anterior hasta comprobar que el nuevo conecta, aprueba la conexión en el panel y responde. Recién entonces quitar el conector viejo y revocar su cliente con `zero mcp revoke <cliente>`.

## Despliegue

1. Hacer los pasos de la acción manual.
2. `zero panel remote on` (si no estaba) y `zero mcp remote on`.
3. `zero status`: la línea `Túnel:` tiene que decir `fijo (zero.tudominio.com) · conectado desde HH:MM`. Si dice `temporal` con un problema de `CLOUDFLARE_TUNNEL_TOKEN`, falta el secreto.
4. `zero mcp clients` muestra `https://zero.tudominio.com/mcp (dirección fija)`.
5. Desde afuera, `https://zero.tudominio.com/.well-known/oauth-authorization-server` tiene que responder con ese emisor.
6. Conectar el chat como en el paso 6 de la acción manual.

## Recuperación

- **cloudflared se cae:** el daemon lo vuelve a abrir solo, con esperas crecientes (15 s por caída seguida, hasta 300 s); las caídas se cuentan en la línea `Túnel:` y vuelven a cero al reconectar. Mientras está caído, `panel.remoteUrl` no existe y `/mcp` responde 503.
- **Reinicio de la fábrica o de la máquina:** con `autostart` encendido (`zero autostart on`) la fábrica arranca al iniciar sesión y reabre el túnel con la misma dirección; el conector del chat no se toca.
- **Token revocado o rotado:** cloudflared termina sin registrar conexión; volver a copiar el token en Cloudflare, `zero secret set CLOUDFLARE_TUNNEL_TOKEN` y esperar el próximo intento (o reiniciar la fábrica).
- **Volver al túnel temporal:** quitar `panel.tunnel` del archivo (o borrar el secreto) y reiniciar; vuelve la dirección `trycloudflare.com` y hay que reconectar el chat con ella.
- **Sospecha de abuso:** `zero mcp remote off` corta el chat al instante; `zero panel remote off` cierra el túnel; `zero mcp revoke <cliente>` invalida los tokens de un chat; en Cloudflare se puede borrar el túnel o rotar su token.

## Seguridad

- **OAuth:** el endpoint `/mcp` sigue exigiendo un token Bearer de zero (OAuth 2.1 con PKCE S256, ADR 0009); cada conexión la aprueba quien está a cargo con la clave del panel, y las acciones delicadas esperan confirmación aparte. Nunca se publica un MCP sin protección: la dirección fija no cambia nada de esto.
- **TLS a través de Cloudflare:** el chat habla https con Cloudflare, que termina TLS con su certificado para el subdominio (**no verificado** en los detalles del certificado); de Cloudflare a la máquina viaja por la conexión saliente cifrada de cloudflared, y cloudflared entrega en `http://127.0.0.1`, sin abrir puertos de la red de la casa. Cloudflare puede ver el tráfico descifrado (**no verificado** en cuanto a lo que registra).
- **Chequeo de Host:** `/mcp` acepta solo el Host de `panel.remoteUrl` o 127.0.0.1, así que un nombre que apunte por error al túnel no sirve.
- **Token fuera del repositorio:** `CLOUDFLARE_TUNNEL_TOKEN` vive en el almacén de secretos (llavero del sistema o, en Docker, `secrets.enc`); el archivo de la fábrica es estricto en `panel.tunnel` y no admite un campo `token`. zero nunca lo escribe en argv, kv, logs ni archivos.
- El panel en sí (cookie de sesión, chequeo de Origin) sigue igual; el subdominio expone las mismas rutas que el túnel temporal.

## Consecuencias

- La dirección del chat remoto sobrevive a los reinicios: el conector se agrega una sola vez.
- Depende de una cuenta de Cloudflare y de un dominio de quien está a cargo; sin ellos todo sigue como antes, con el túnel temporal.
- Los datos marcados **no verificado** tienen que confirmarse en la documentación de Cloudflare; si alguno cambió, se corrige este documento.

# Proposal

## Why

Hoy el panel y el chat remoto salen a internet por un túnel temporal de Cloudflare. Su dirección (https://algo.trycloudflare.com) cambia cada vez que se reinicia la fábrica, así que hay que volver a conectar el chat cada vez. Con este cambio podés usar un subdominio tuyo fijo (por ejemplo https://zero.tudominio.com) por un túnel con nombre de Cloudflare. - **Configuración:** escribís el subdominio en el archivo de la fábrica y guardás el token del túnel con `zero secret set CLOUDFLARE_TUNNEL_TOKEN`. El token nunca va al repositorio, a la línea de comandos ni a los logs. - **Reconexión:** el daemon mantiene el túnel abierto, lo reabre solo si se cae y lo vuelve a levantar al reiniciar. - **La dirección no cambia:** el chat conectado a https://zero.tudominio.com/mcp sigue funcionando después de un reinicio. - **Seguridad:** no cambia. El chat remoto sigue apagado salvo que lo enciendas, cada conexión la aprobás en el panel con tu clave (OAuth con PKCE y tokens cortos), Cloudflare pone el TLS y se rechaza cualquier Host que no sea el tuyo. - **Lo de hoy no se rompe:** sin subdominio configurado, o sin el token, todo sigue como ahora con el túnel temporal. Para volver atrás alcanza con borrar el subdominio del archivo. - **Estado del túnel:** `zero status` y el panel muestran si es temporal o fijo, si está conectado y desde cuándo, y cuántas veces se cayó. - **Guía:** un documento nuevo (ADR 0008) lista lo que tenés que hacer vos a mano y los pasos de despliegue y recuperación. Lo que tenés que hacer vos: tener el dominio en una cuenta de Cloudflare, crear el túnel en el panel de Cloudflare, apuntar el subdominio a http://127.0.0.1:4848, copiar el token, guardarlo y probar el chat nuevo antes de borrar el conector viejo. Este trabajo es independiente del de Solilok.

## What Changes

- Túnel con nombre de Cloudflare: dirección fija para el panel y el chat remoto (/mcp)
- Supuesto: Unverified: I could not confirm in official sources that cloudflared reads the token from `TUNNEL_TOKEN` for `tunnel run`, or that it prints `Registered tunnel connection` once connected. If the log text differs, the stable URL would never be published. The build should keep the regex in one constant, and the ADR must mark both facts «no verificado» until a real run with an actual token shows them.
- Supuesto: With a tunnel managed from the Cloudflare dashboard, the public hostname's target (http://127.0.0.1:<port>) is set in Cloudflare, not by zero. If the person in charge points it at another port, the tunnel registers but the panel is unreachable. The ADR must say so, and zero cannot detect it without an outside probe.
- Supuesto: Configuring `panel.tunnel` with a valid token replaces the quick tunnel at the next start, so the trycloudflare URL stops working. The old connector is not broken by default: nothing changes until the person in charge sets both the hostname and the token. The ADR must tell them to add the new connector, check it, and only then remove the old one. Removing `panel.tunnel` reverts.
- Supuesto: Interpretation: the request mentions approval and DNS setup by the person in charge. The factory has no Cloudflare credentials, so creating the tunnel, the DNS record or the account stays manual and documented only. Nothing calls the Cloudflare API.
- Supuesto: `remoteChatView` today takes `Pick<FactoryContext, 'store'>`. Adding `config` may ripple to callers and tests that pass a minimal ctx.

## Capabilities

### New Capabilities
- `control-panel`: Túnel con nombre de Cloudflare: dirección fija para el panel y el chat remoto (/mcp)

### Modified Capabilities

## Impact

Generado por zero para el trabajo 5a9eafd1.

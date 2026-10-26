# Design

## Context

Ver proposal.md. El daemon ya tiene el contexto de la fábrica (`FactoryContext`) y recarga la definición en cada vuelta. `app.ts` tiene todas las operaciones. El dueño está lejos de la PC y quiere usar el celular.

## Decisions

### El daemon sirve el panel
El panel vive en el proceso del daemon: existe exactamente cuando la fábrica está en marcha, y usa el mismo `ctx`, sin abrir otra base. Escucha solo en `127.0.0.1`. Desde afuera solo se llega por el túnel, que el dueño activa a propósito. Es HTML generado en el servidor, con un script mínimo que refresca la página. No hay framework ni build de frontend.

### Clave en el fragmento, cookie de sesión
- La clave son 32 bytes aleatorios en el llavero (`ZERO_PANEL_KEY`).
- El link es `…/#k=<clave>`. El fragmento no viaja en el pedido HTTP, así que no queda en registros de proxies ni del túnel.
- La página de ingreso lee el fragmento y lo manda por `POST /login`. El servidor responde con la cookie `zero_panel=<sha256(clave + ":session")>` (`HttpOnly`, `SameSite=Strict`, y `Secure` si llegó por https) y la página limpia la barra de direcciones.
- La sesión se deriva de la clave: sobrevive a reinicios del daemon y muere al rotarla.
- Las comparaciones son de tiempo constante.
- Las acciones son `POST`, y además de la cookie exigen que el `Origin` coincida con el `Host`.
- Las respuestas llevan:
  - CSP estricta (`default-src 'none'`, script con nonce);
  - `frame-ancestors 'none'`;
  - `Referrer-Policy: no-referrer`;
  - `Cache-Control: no-store`.

### Túnel: cloudflared quick tunnel
`cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate` no necesita cuenta ni administrador, y publica `https://<azar>.trycloudflare.com`.
- El estado deseado se guarda en `kv` (`panel.remote`). El daemon arranca o cierra el proceso en cada vuelta, lee la URL de su salida y la guarda en `kv` (`panel.remoteUrl`).
- Si el proceso muere, se reabre en la vuelta siguiente, con una espera creciente.
- Al apagarse el daemon, el túnel se cierra con él.

Descarga:
- de `github.com/cloudflare/cloudflared/releases/latest/download/<binario>` a `~/.zero/bin`;
- en Windows, `Get-AuthenticodeSignature` debe dar `Valid` con un firmante de Cloudflare; si no, el archivo se borra;
- en macOS se pide `brew install cloudflared`, porque la release es un `.tgz`.

Alternativas:
- `localhost.run` por SSH: sin descarga, pero es un servicio menos conocido y el link cambia en cada conexión.
- Tailscale: la más privada, pero requiere instalar como administrador. Queda para cuando el dueño esté frente a la PC.

## Risks / Trade-offs

- **Cloudflare transporta el tráfico del panel** (TLS termina en su borde). Es aceptable para un acceso temporal decidido por el dueño. La red privada queda como alternativa futura.
- **El link con la clave puede filtrarse** (capturas, historial). Mitigación: `zero panel rotate`, y el túnel se apaga con `remote off`.
- **Quick tunnels sin garantía de disponibilidad.** Si se cae, el daemon lo reabre, pero la URL cambia: `zero panel` muestra la vigente.

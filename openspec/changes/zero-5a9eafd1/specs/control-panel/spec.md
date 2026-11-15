# Spec Delta

## Purpose

Hoy el panel y el chat remoto salen a internet por un túnel temporal de Cloudflare. Su dirección (https://algo.trycloudflare.com) cambia cada vez que se reinicia la fábrica, así que hay que volver a conectar el chat cada vez. Con este cambio podés usar un subdominio tuyo fijo (por ejemplo https://zero.tudominio.com) por un túnel con nombre de Cloudflare. - **Configuración:** escribís el subdominio en el archivo de la fábrica y guardás el token del túnel con `zero secret set CLOUDFLARE_TUNNEL_TOKEN`. El token nunca va al repositorio, a la línea de comandos ni a los logs. - **Reconexión:** el daemon mantiene el túnel abierto, lo reabre solo si se cae y lo vuelve a levantar al reiniciar. - **La dirección no cambia:** el chat conectado a https://zero.tudominio.com/mcp sigue funcionando después de un reinicio. - **Seguridad:** no cambia. El chat remoto sigue apagado salvo que lo enciendas, cada conexión la aprobás en el panel con tu clave (OAuth con PKCE y tokens cortos), Cloudflare pone el TLS y se rechaza cualquier Host que no sea el tuyo. - **Lo de hoy no se rompe:** sin subdominio configurado, o sin el token, todo sigue como ahora con el túnel temporal. Para volver atrás alcanza con borrar el subdominio del archivo. - **Estado del túnel:** `zero status` y el panel muestran si es temporal o fijo, si está conectado y desde cuándo, y cuántas veces se cayó. - **Guía:** un documento nuevo (ADR 0008) lista lo que tenés que hacer vos a mano y los pasos de despliegue y recuperación. Lo que tenés que hacer vos: tener el dominio en una cuenta de Cloudflare, crear el túnel en el panel de Cloudflare, apuntar el subdominio a http://127.0.0.1:4848, copiar el token, guardarlo y probar el chat nuevo antes de borrar el conector viejo. Este trabajo es independiente del de Solilok.

## ADDED Requirements

### Requirement: Subdominio fijo en el archivo de la fábrica
The factory file SHALL accept an optional `panel.tunnel` object, strict, with a single `hostname` field. The field MUST be a lowercase DNS name with at least two labels, without scheme, port, path or credentials. A hostname under `trycloudflare.com` MUST be refused. Without `panel.tunnel`, the config MUST behave exactly as today.

#### Scenario: valid hostname
- **WHEN** the factory file has `panel: { tunnel: { hostname: zero.example.com } }`
- **THEN** the config loads with `panel.tunnel.hostname` equal to `zero.example.com`

#### Scenario: hostname with scheme or path refused
- **WHEN** `panel.tunnel.hostname` is `https://zero.example.com/mcp`
- **THEN** loading the config fails with a Spanish message that names the field

#### Scenario: quick tunnel domain refused
- **WHEN** `panel.tunnel.hostname` is `abc.trycloudflare.com`
- **THEN** loading the config fails

#### Scenario: unknown key refused
- **WHEN** `panel.tunnel` has an extra key such as `token`
- **THEN** loading the config fails (strict object, so no credential fits in the file)

### Requirement: Túnel con nombre cuando hay subdominio y token
When kv `panel.remote` is `on`, the panel port is above 0, `panel.tunnel.hostname` is set and the secret `CLOUDFLARE_TUNNEL_TOKEN` exists, `tunnelKeeper` SHALL start cloudflared with the args `tunnel --no-autoupdate run`. The token MUST be passed only in the child's environment variable `TUNNEL_TOKEN`, never in argv, kv or logs.

#### Scenario: named tunnel spawn
- **WHEN** remote is on, hostname `zero.example.com` is configured, the secret holds `tok123` and the keeper ticks with a fake spawn
- **THEN** the spawn gets args `["tunnel","--no-autoupdate","run"]`, its env has `TUNNEL_TOKEN=tok123`, and no arg contains `tok123`

#### Scenario: token never logged or stored
- **WHEN** the named tunnel starts, prints output and exits
- **THEN** no kv value and no log line written by the keeper contains the token value

### Requirement: Dirección estable publicada solo cuando el túnel conectó
With the named tunnel, the keeper SHALL set kv `panel.remoteUrl` to `https://<hostname>` only after cloudflared reports a registered connection in stdout or stderr. It MUST delete the key when the process exits or the tunnel is turned off, just as with the quick tunnel.

#### Scenario: url after registration
- **WHEN** the fake named cloudflared prints a line containing `Registered tunnel connection`
- **THEN** kv `panel.remoteUrl` is `https://zero.example.com`

#### Scenario: no url before registration
- **WHEN** the named process has started but printed no registration line
- **THEN** kv `panel.remoteUrl` is absent

#### Scenario: remote chat uses the stable address
- **WHEN** kv `panel.remoteUrl` is `https://zero.example.com` and remote MCP is on
- **THEN** `remoteChatView` gives url `https://zero.example.com/mcp`, and the OAuth metadata issuer served by `createRemoteMcp` is `https://zero.example.com`

### Requirement: Reconexión automática del túnel con nombre
When the named tunnel's process exits while remote is on, the keeper SHALL clear the address and reopen it with the same growing waits as the quick tunnel (failures × 15 s, at most 300 s). The failure count MUST reset once a connection registers again.

#### Scenario: reopens after exit
- **WHEN** the named process exits with code 1 and the clock advances 16 s before the next tick
- **THEN** a second spawn with the named args happens, and none happens before the wait

### Requirement: El túnel temporal sigue igual sin configuración completa
When `panel.tunnel` is absent, or the secret `CLOUDFLARE_TUNNEL_TOKEN` is missing, the keeper SHALL keep starting the quick tunnel exactly as today (`tunnel --no-autoupdate --url http://127.0.0.1:<port>`, trycloudflare address). When the hostname is set but the token is missing, it MUST log a warning naming `zero secret set CLOUDFLARE_TUNNEL_TOKEN` (at most once per process) and record that problem in the tunnel state.

#### Scenario: no config
- **WHEN** remote is on and `panel.tunnel` is absent
- **THEN** the spawn args are `["tunnel","--no-autoupdate","--url","http://127.0.0.1:4848"]` (the existing test still passes)

#### Scenario: hostname without token
- **WHEN** remote is on, the hostname is set and the secret is absent
- **THEN** the quick tunnel args are used and the tunnel state's `problem` mentions `CLOUDFLARE_TUNNEL_TOKEN`

### Requirement: Estado de salud del túnel
The keeper SHALL keep kv `panel.tunnelState` as JSON with `mode` (`quick` or `named`), `connectedSince` (ISO, present while connected), `failures` (the consecutive count), `lastExitAt` (ISO, optional) and `problem` (optional). It MUST delete the key when the remote panel is turned off. `factoryStatus` SHALL expose it as `FactoryStatus.tunnel` while kv `panel.remote` is on. `formatStatus` MUST show a `Túnel:` line saying `fijo (<hostname>)` or `temporal (cambia al reiniciar)`, `conectado desde HH:MM` or `desconectado`, plus the failure count and the problem when present.

#### Scenario: state while connected
- **WHEN** the named tunnel registered at a known clock time
- **THEN** kv `panel.tunnelState` has mode `named`, failures 0 and that `connectedSince`

#### Scenario: status line
- **WHEN** `formatStatus` gets a status whose tunnel is named, connected and has hostname `zero.example.com`
- **THEN** the output contains a line starting with `Túnel:` that includes `fijo (zero.example.com)` and `conectado desde`

#### Scenario: status line for the quick tunnel
- **WHEN** the tunnel is quick and disconnected after 2 failures
- **THEN** the `Túnel:` line includes `temporal`, `desconectado` and `2`

#### Scenario: no line when off
- **WHEN** kv `panel.remote` is absent
- **THEN** `formatStatus` shows no `Túnel:` line

### Requirement: Mensajes que dicen si la dirección es fija
`RemoteChatView` SHALL carry `stable: true` when kv `panel.remoteUrl` is the configured `https://<panel.tunnel.hostname>`, and false otherwise. The `zero mcp remote on` message MUST say the address stays fixed after restarts when `stable` is true. It MUST keep saying the address changes when the tunnel restarts only when `stable` is false.

#### Scenario: stable view
- **WHEN** the hostname is `zero.example.com` and kv `panel.remoteUrl` is `https://zero.example.com`
- **THEN** `remoteChatView(ctx).stable` is true

#### Scenario: quick view
- **WHEN** kv `panel.remoteUrl` is a trycloudflare address
- **THEN** `remoteChatView(ctx).stable` is false

### Requirement: Documento de decisión con pasos manuales
The repository SHALL contain `docs/adr/0008-tunel-con-nombre.md` (Spanish). It MUST include the options evaluated, a «Acción manual de quien está a cargo» section, a «Despliegue» section, a «Recuperación» section and a «Seguridad» section. The manual section MUST list: domain in Cloudflare, creating the tunnel, public hostname to `http://127.0.0.1:<puerto>`, `zero secret set CLOUDFLARE_TUNNEL_TOKEN`, setting `panel.tunnel.hostname`, and adding the new connector while keeping the old one until it is verified. The security section MUST cover OAuth, TLS through Cloudflare, the Host check and the token outside the repository. Cloudflare facts not confirmed in an official source MUST be marked «no verificado». The ADR MUST use no other existing ADR number.

#### Scenario: adr content
- **WHEN** a test reads `docs/adr/0008-tunel-con-nombre.md`
- **THEN** it contains `CLOUDFLARE_TUNNEL_TOKEN`, `panel.tunnel`, `/mcp`, «Acción manual de quien está a cargo», «Despliegue», «Recuperación», «Seguridad» and «no verificado»

#### Scenario: unique number
- **WHEN** a test lists `docs/adr`
- **THEN** only one file starts with `0008-`

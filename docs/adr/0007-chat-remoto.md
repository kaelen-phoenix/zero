# ADR 0007 — Manejar la fábrica desde el chat del celular

- **Estado:** propuesto
- **Fecha:** 2026-11-14

## Contexto

Quien está a cargo quiere manejar la fábrica desde el chat del celular (ChatGPT, la app de Claude u otro cliente MCP) sin tener la PC delante. Hoy `zero mcp` (`serveStdio` en `src/mcp/server.ts`) es solo stdio local: el cliente de chat tiene que correr en la misma máquina que la fábrica. Las herramientas salen de `createZeroMcpServer`, que no depende del transporte y abre la fábrica en cada llamada, así que un transporte HTTP puede reusarlas sin duplicar lógica de `src/app.ts`.

El panel ya tiene acceso remoto: `zero panel remote on` abre un túnel rápido de cloudflared (`src/panel/tunnel.ts`, kv `panel.remote` y `panel.remoteUrl`) con una URL `https://<algo>.trycloudflare.com` que cambia en cada reinicio del túnel.

### Cómo se hizo esta investigación

La estación que escribió este documento no pudo leer la web: las herramientas de búsqueda y de lectura de páginas estaban denegadas en la corrida. Todo lo que sigue sobre ChatGPT y Claude sale de lo que se sabía de su documentación oficial y **no se volvió a leer en la fuente**. Por eso cada dato de un proveedor lleva la marca **no verificado** y tiene que confirmarse en las fuentes citadas antes de dar por buena la decisión. Lo que sale del código de zero o de las especificaciones de MCP y OAuth sí está verificado.

### Fuentes

Documentación oficial que hay que leer para confirmar los datos marcados (las direcciones mismas son **no verificado**: pueden haber cambiado):

- OpenAI, modo desarrollador de ChatGPT: https://platform.openai.com/docs/guides/developer-mode
- OpenAI, conectar un servidor MCP en ChatGPT: https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- OpenAI, Apps SDK (autenticación y envío de apps): https://developers.openai.com/apps-sdk/build/auth y https://developers.openai.com/apps-sdk/deploy/submission
- Anthropic, conectores propios con MCP remoto: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- Anthropic, construir un conector remoto: https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
- Anthropic, directorio de conectores: https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq
- Anthropic, documentación de MCP: https://docs.anthropic.com/en/docs/mcp
- Especificación de MCP, autorización: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization

### ChatGPT: conectar un servidor MCP remoto propio

- Se conecta como conector (o "app") con la URL https del servidor MCP. Para herramientas que escriben hay que activar el **modo desarrollador** en la configuración de ChatGPT (Ajustes → Apps y conectores → Avanzado). **No verificado.**
- Planes: el modo desarrollador con herramientas que escriben estuvo disponible en Plus y Pro, y en Business, Enterprise y Edu con permiso de quien administra el espacio de trabajo; los conectores propios de solo lectura (búsqueda y lectura) llegaron antes y a más planes. El plan gratuito no los tenía. **No verificado.**
- Celular: el conector se agrega desde la web; una vez agregado, se ha dicho que se puede usar en las apps del celular, pero no está claro si el modo desarrollador y la confirmación de herramientas que escriben funcionan igual en la app. **No verificado.**
- Autenticación: ChatGPT acepta un servidor sin autenticación o con OAuth 2.1. Con OAuth usa los metadatos de recurso protegido (RFC 9728) y de servidor de autorización (RFC 8414), registro dinámico de clientes (RFC 7591) y PKCE con S256, con la redirección `https://chatgpt.com/connector_platform_oauth_redirect`. **No verificado.**
- ChatGPT pide confirmación antes de cada llamada a una herramienta que escribe, salvo que la herramienta se marque como de solo lectura (`readOnlyHint`). **No verificado.** No alcanza como garantía: la confirmación la pone el cliente, y las garantías las pone zero.

### Claude: conectores propios

- Se agregan como "conector propio" (custom connector) con la URL del servidor MCP remoto, en Ajustes → Conectores. **No verificado.**
- Planes: Pro, Max, Team y Enterprise (en Team y Enterprise lo agrega quien administra la organización); en el plan gratuito, con límite de un conector. **No verificado.**
- Celular: los conectores agregados desde la web o el escritorio se pueden usar desde las apps de iOS y Android, pero no se agregan desde el celular. **No verificado.**
- Autenticación: Claude soporta servidores sin autenticación y con OAuth, con registro dinámico de clientes y PKCE, y una redirección `https://claude.ai/api/mcp/auth_callback`; transportes streamable HTTP y SSE. **No verificado.**
- La conexión la hace la nube de Anthropic, no el celular: el servidor tiene que ser alcanzable desde internet, no solo desde la red de la casa. **No verificado** (igual vale para ChatGPT).

### Los directorios

- **ChatGPT:** una app se envía para revisión desde platform.openai.com, con la organización verificada, el dominio verificado con `/.well-known/openai-apps-challenge`, una URL https estable, OAuth y credenciales de prueba para quien revisa. **No verificado** en el detalle de los requisitos.
- **Claude:** el directorio de conectores se pide con un formulario de Anthropic y exige, entre otras cosas, OAuth, una URL estable, política de privacidad y anotaciones de las herramientas. **No verificado.**

Los dos directorios están pensados para un servicio único con una dirección para todas las personas. zero es lo contrario: cada persona tiene su propia fábrica en su máquina, con su propia URL (y hoy esa URL cambia con cada reinicio del túnel).

## Decisión

### Directorios: no se publica

No se publica zero en el directorio de ChatGPT ni en el de Claude. Un listado único no encaja: tendría que apuntar a un servidor central de zero que reenviara a cada fábrica, y ese servidor vería todos los pedidos y tokens de todas las personas, sería un punto único de falla y obligaría a zero a operar un servicio en la nube con dominio, organización verificada y credenciales para quien revisa. Nada de eso existe ni conviene.

Alternativas, en orden:

1. **Conector propio de cada persona con su URL** (la elegida): cada persona agrega su fábrica como conector propio en ChatGPT (modo desarrollador) o en Claude, con la URL de su túnel terminada en `/mcp`. zero muestra esa URL y los pasos en `zero mcp remote on` y en el panel.
2. **Instrucciones en el README** (las dos lenguas) con los pasos de cada cliente y el enlace a su documentación, en lugar de un listado.
3. **Revisarlo más adelante** si alguno de los directorios llega a aceptar servidores por persona (una plantilla con URL propia). Hoy eso es **no verificado**.

### Servidor remoto: se construye, apagado por defecto

- El daemon sirve MCP por streamable HTTP en `/mcp`, en el mismo servidor del panel y por el mismo túnel, con las herramientas de `createZeroMcpServer` (sin duplicar lógica de `src/app.ts`).
- Viene apagado (kv `mcp.remote`); se enciende solo desde la terminal con `zero mcp remote on`, como el acceso remoto del panel. Ninguna herramienta del chat lo toca. Apagado, `/mcp`, `/oauth/*` y `/.well-known/oauth-*` responden 404.
- **OAuth 2.1 con PKCE (S256)**, con zero como su propio servidor de autorización: metadatos RFC 8414 y RFC 9728, registro dinámico RFC 7591 de clientes públicos (`token_endpoint_auth_method: none`), redirecciones solo https o http a loopback. El documento de metadatos del cliente (CIMD) queda para después.
- **Cada conexión la aprueba quien está a cargo en el panel, con su clave**: `/oauth/authorize` exige la sesión del panel, muestra cliente, redirección y permisos, y emite el código solo con un POST del mismo origen con `confirm=1`. Nunca una contraseña guardada en el chat.
- **Tokens de vida corta**: acceso de 1 hora, renovación de 7 días que rota en cada uso; zero guarda solo su hash SHA-256 y nunca los escribe en logs, argv ni archivos. Un código reutilizado revoca lo emitido con él.
- **Permisos separados**: `zero:read` (estado, trazas, propuestas, investigación, informes) y `zero:act` (pedir, responder). Un token de lectura ni siquiera ve las herramientas que actúan.
- **Acciones delicadas con confirmación aparte**: fundir, parar, decidir propuestas, bloquear sitios y aprobar cambios en archivos protegidos, pedidos desde el chat remoto, quedan pendientes (15 minutos) hasta que quien está a cargo los confirma en el panel o con `zero mcp confirmar <id>`. El servidor stdio local sigue como hoy.
- **Clientes visibles y revocables** desde el panel (`/remote-chat`) y la terminal (`zero mcp clients`, `zero mcp revoke`).
- Emisor y recurso salen de `panel.remoteUrl`; sin túnel, 503; un Host que no sea el del túnel o 127.0.0.1 se rechaza.

### Dirección estable

| Opción | Estable | Qué pide | Veredicto |
|---|---|---|---|
| Túnel rápido (`trycloudflare.com`, el de hoy) | No: cambia en cada reinicio | Nada más | Se usa en esta etapa. Al cambiar la URL hay que volver a conectar el chat. |
| Túnel con nombre de Cloudflare | Sí | Cuenta de Cloudflare, un dominio en ella, `cloudflared tunnel login` y una credencial del túnel en la máquina | Pedido aparte, con consentimiento: la credencial va al almacén de secretos, nunca a argv ni a archivos sueltos. |
| Dominio propio con proxy inverso o puerto abierto | Sí | Dominio, certificado y abrir la red de la casa | Descartado: expone la máquina y exige saber de redes. |
| Otros túneles (Tailscale Funnel, ngrok con dominio fijo) | Sí | Cuenta e instalación de otro programa | Se evalúan si el túnel con nombre no sirve. Sus condiciones son **no verificado**. |

## Consecuencias

- Desde el celular se puede ver el estado, leer trazas y propuestas, pedir trabajo y responder preguntas, sin la PC delante, en cualquier cliente MCP que hable OAuth.
- La superficie de ataque crece: un endpoint en internet que puede actuar sobre la fábrica. Lo acotan el apagado por defecto, la aprobación con la clave del panel, los tokens cortos guardados como hash, el chequeo de Host y la confirmación aparte para lo delicado. La revisión de seguridad tiene que mirar el transporte HTTP y las rutas que se atienden antes del chequeo de la cookie del panel.
- Un chat de terceros (y el modelo que lo maneja) puede llamar herramientas por error o por una instrucción escondida en lo que lee; por eso lo delicado nunca se ejecuta desde el chat remoto sin confirmación de quien está a cargo.
- Con el túnel rápido, cada reinicio del túnel cambia la URL y deja sin servicio a los clientes conectados hasta volver a conectarlos. La dirección estable es un pedido aparte (`docs/adr/0008-tunel-con-nombre.md`).
- zero no aparece en ningún directorio: cada persona conecta su propia fábrica a mano, siguiendo el README.
- Los datos marcados **no verificado** tienen que confirmarse en las fuentes citadas; si alguno cambió (planes, celular, redirecciones), se corrige este documento y, si hace falta, el servidor.

### Próximos pedidos

- Servidor de autorización OAuth (lógica pura) y su estado.
- MCP por HTTP en el daemon, conectado al servidor del panel.
- Página `/remote-chat` del panel y comandos `zero mcp remote|clients|revoke|pendientes|confirmar`.
- Túnel con nombre de Cloudflare como dirección estable, con consentimiento: decidido en `docs/adr/0008-tunel-con-nombre.md`.

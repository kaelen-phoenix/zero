# Proposal

## Why

Vas a poder manejar la fábrica desde el chat del celular (ChatGPT, la app de Claude u otro cliente MCP) sin tener la PC delante. Primero queda escrito un documento de decisión (docs/adr) que explica cómo se conecta un servidor MCP propio en ChatGPT y en Claude, qué planes lo permiten y si conviene publicarlo en sus directorios. Recomienda no publicarlo, porque cada fábrica tiene su propia dirección. Después, el daemon sirve el mismo servidor de chat por HTTP, a través del túnel del panel. Viene apagado y se prende desde la terminal con `zero mcp remote on`. Cada conexión nueva de un chat la aprobás vos en el panel, con tu clave, y elegís si puede solo leer o también actuar. Los permisos duran poco, y desde el panel o la terminal ves qué chats están conectados y les cortás el acceso cuando quieras. Las acciones delicadas pedidas desde un chat remoto no se hacen solas: quedan pendientes hasta que las confirmás en el panel o en la terminal. Estas son fundir, parar, aprobar o rechazar propuestas, aprobar cambios en archivos protegidos y bloquear sitios. La dirección estable (túnel con nombre o dominio propio) queda evaluada en el documento y para un pedido aparte. Mientras tanto la dirección es la del túnel rápido, que cambia en cada reinicio, y hay que volver a conectar el chat.

## What Changes

- Chat remoto: servidor MCP por HTTP con OAuth, servido por el daemon
- Supuesto: La estación spec no tuvo acceso a la web y la de build quizás tampoco. Los datos de ChatGPT (planes que permiten herramientas que escriben, modo desarrollador en el celular, requisitos del directorio) y de Claude (conectores propios por plan, celular) pueden haber cambiado. El ADR los tiene que marcar 'no verificado' si no se pueden leer en la fuente oficial, y no darlos por ciertos.
- Supuesto: Número del ADR: el PR #165 sin fundir planea renombrar su ADR a 0005. Si se funde antes, este ADR choca con ese número y hay que pasarlo al siguiente libre (el test tiene que usar la misma ruta).
- Supuesto: La cookie del panel es SameSite=Strict, así que al llegar a /oauth/authorize desde ChatGPT o Claude (navegación entre sitios) el navegador no la manda. Se supone que basta con volver a ingresar con la clave y que el ingreso regrese a la URL con su query. Si el cliente abre la autorización en un navegador embebido sin la sesión, la persona tiene que pegar la clave.
- Supuesto: El túnel rápido cambia de URL en cada reinicio. Emisor y recurso salen de `panel.remoteUrl`, así que los clientes conectados dejan de funcionar al cambiar la URL y hay que volver a conectarlos. El túnel con nombre o el dominio propio quedan para otro pedido.
- Supuesto: Se supone que ChatGPT y Claude aceptan clientes públicos (token_endpoint_auth_method none) con registro dinámico. El documento de metadatos de cliente (CIMD) no se implementa en esta etapa.
- Supuesto: Exponer herramientas que actúan por internet agranda la superficie de ataque. Por eso: apagado por defecto, aprobación con la clave del panel, tokens cortos que se guardan como hash, confirmación aparte para lo delicado y chequeo de Host. La revisión de seguridad debería mirar src/mcp/http.ts y la ruta antes de la cookie en src/panel/server.ts.
- Supuesto: El transporte del SDK en modo sin sesión crea un McpServer por pedido. Se supone que alcanza para el uso de un chat. Si un cliente exige sesiones, habría que mantener el transporte por sesión.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chat-interface`: Chat remoto: servidor MCP por HTTP con OAuth, servido por el daemon

## Impact

Generado por zero para el trabajo e6a5d4ce.

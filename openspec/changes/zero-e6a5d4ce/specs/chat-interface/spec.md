# Spec Delta

## ADDED Requirements

### Requirement: Documento de decisión del chat remoto
El repositorio SHALL incluir docs/adr/0005-chat-remoto.md (o el próximo número libre de docs/adr en la base), en castellano, con el encabezado `# ADR NNNN — ` y las secciones Contexto, Decisión y Consecuencias. El documento MUST tratar la conexión de un servidor MCP remoto propio en ChatGPT (modo desarrollador o apps, planes que permiten herramientas que escriben, app del celular o solo la web) y en Claude (conectores propios), la publicación en el directorio de ChatGPT y en el de Claude con la recomendación de no publicar y sus alternativas, y la dirección estable (túnel rápido, túnel con nombre, dominio propio). MUST citar como fuentes URLs de openai.com y de anthropic.com o claude.com, y MUST marcar como 'no verificado' todo dato que no se haya podido leer en la documentación oficial.

#### Scenario: El ADR existe y tiene su forma
- **WHEN** un test lee el archivo del ADR del chat remoto
- **THEN** encuentra el encabezado `# ADR`, `**Estado:**`, `**Fecha:**`, las secciones `## Contexto`, `## Decisión` y `## Consecuencias`, las palabras ChatGPT, Claude, OAuth y PKCE, al menos una URL https de openai.com y otra de anthropic.com o claude.com

#### Scenario: Recomendación sobre el directorio
- **WHEN** un test busca la sección sobre los directorios
- **THEN** el texto dice que no se publica en el directorio de ChatGPT ni en el de Claude y nombra por lo menos una alternativa (conector propio de cada persona con su URL)

### Requirement: Servidor remoto apagado por defecto
Las rutas del servidor remoto (`/mcp`, `/oauth/*` y `/.well-known/oauth-*`) MUST responder 404 en el servidor del panel mientras kv `mcp.remote` no valga `on`. `zero mcp remote on|off` (`setRemoteMcp` en app.ts) SHALL ser la única forma de cambiarlo, y ninguna herramienta del chat SHALL tocarlo.

#### Scenario: Apagado
- **WHEN** con kv `mcp.remote` ausente, se hace POST /mcp o GET /.well-known/oauth-authorization-server al panel
- **THEN** la respuesta es 404

#### Scenario: Encendido
- **WHEN** después de `setRemoteMcp(ctx, true)` se hace GET /.well-known/oauth-protected-resource
- **THEN** la respuesta es 200 con JSON que trae `resource` terminado en `/mcp` y `authorization_servers`

#### Scenario: Sin herramienta que lo encienda
- **WHEN** se listan las herramientas de createZeroMcpServer
- **THEN** ninguna cambia kv `mcp.remote`

### Requirement: Metadatos OAuth y registro dinámico
Con el servidor remoto encendido, zero SHALL servir los metadatos de servidor de autorización (RFC 8414) en `/.well-known/oauth-authorization-server`, con `code_challenge_methods_supported` igual a `["S256"]`, `grant_types_supported` con `authorization_code` y `refresh_token`, `token_endpoint_auth_methods_supported` con `none` y `scopes_supported` con `zero:read` y `zero:act`. También SHALL servir los de recurso protegido (RFC 9728) y aceptar el registro dinámico de clientes (RFC 7591) en POST `/oauth/register`. El registro MUST rechazar con 400 las `redirect_uris` que no sean https, salvo http a un host de loopback.

#### Scenario: Registro válido
- **WHEN** se hace POST /oauth/register con `client_name` y `redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"]`
- **THEN** la respuesta es 201 con un `client_id` nuevo y sin `client_secret`

#### Scenario: Redirección insegura
- **WHEN** se registra un cliente con `redirect_uris: ["http://evil.example/cb"]`
- **THEN** la respuesta es 400 y no queda ningún cliente guardado

### Requirement: Cada conexión la aprueba la persona a cargo en el panel
GET `/oauth/authorize` MUST exigir la sesión del panel, abierta con su clave. Sin sesión SHALL mostrar el ingreso del panel, que después de ingresar vuelve a la misma URL con su query. Con sesión SHALL mostrar el nombre del cliente, su `redirect_uri` y los permisos pedidos, y SHALL emitir un código solo cuando un POST del mismo origen trae `confirm=1`. El código MUST ser de un solo uso, MUST durar a lo sumo 5 minutos y MUST quedar atado al cliente, a la `redirect_uri` exacta registrada y al `code_challenge` S256. Un pedido sin `code_challenge`, con `plain` o con una `redirect_uri` no registrada MUST rechazarse sin redirigir a ella.

#### Scenario: Sin sesión
- **WHEN** se hace GET /oauth/authorize sin la cookie del panel
- **THEN** la respuesta es 401 con la página de ingreso, y el formulario lleva la ruta de vuelta con la query

#### Scenario: Aprobación
- **WHEN** con sesión se hace POST /oauth/authorize con confirm=1, los parámetros válidos y el Origin igual al Host
- **THEN** la respuesta es 302 a la redirect_uri registrada con `code` y el mismo `state`

#### Scenario: Sin PKCE
- **WHEN** se pide la autorización sin code_challenge
- **THEN** la respuesta es 400 y no hay redirección

### Requirement: Tokens de vida corta y rotación
POST `/oauth/token` SHALL canjear un código solo con el `code_verifier` que corresponde a su `code_challenge` S256, el mismo `client_id` y la misma `redirect_uri`. SHALL entregar un token de acceso de 1 hora como máximo y un token de renovación de 7 días como máximo, que rota en cada uso. zero MUST guardar de los tokens y los códigos solo su hash SHA-256, nunca el valor, y MUST NOT escribirlos en logs. Un código usado dos veces MUST revocar los tokens emitidos con él.

#### Scenario: Verificador incorrecto
- **WHEN** se canjea un código válido con otro code_verifier
- **THEN** la respuesta es 400 `invalid_grant`

#### Scenario: Código reutilizado
- **WHEN** se canjea dos veces el mismo código
- **THEN** el segundo canje es 400 y el token de acceso del primero deja de servir en /mcp

#### Scenario: Vencimiento
- **WHEN** se llama /mcp con un token de acceso emitido hace más de 1 hora (reloj inyectado)
- **THEN** la respuesta es 401 con `WWW-Authenticate: Bearer` y `resource_metadata`

#### Scenario: Solo hashes
- **WHEN** después de emitir tokens se leen las filas o los valores de kv del almacenamiento OAuth
- **THEN** ningún valor contiene el token de acceso, el de renovación ni el código en claro

### Requirement: MCP por HTTP con las mismas herramientas
POST `/mcp` SHALL atender MCP streamable HTTP con un McpServer de createZeroMcpServer, sin duplicar lógica de app.ts, y solo con un token Bearer válido; sin token MUST responder 401 con `WWW-Authenticate` que apunta a los metadatos de recurso protegido. Un token con solo `zero:read` MUST ver únicamente las herramientas de lectura (zero_status, zero_proposals, zero_research, zero_briefing, zero_monthly_report, zero_trace, zero_egress, zero_lines). Las demás herramientas MUST requerir `zero:act`.

#### Scenario: Sin token
- **WHEN** se hace POST /mcp sin Authorization
- **THEN** la respuesta es 401 con `WWW-Authenticate` que contiene `resource_metadata=`

#### Scenario: Solo lectura
- **WHEN** un cliente con token `zero:read` pide tools/list
- **THEN** la lista tiene zero_status y no tiene zero_request, zero_merge ni zero_stop

#### Scenario: Actuar
- **WHEN** un cliente con token `zero:read zero:act` llama zero_request
- **THEN** el trabajo queda en `queued` en el store, igual que por stdio

### Requirement: Acciones delicadas con confirmación aparte
Por el servidor remoto, zero_merge, zero_stop, zero_proposal_decide, zero_egress_block y zero_answer con `approve` sobre un trabajo cuya pregunta es `protected-path` MUST NOT ejecutar la acción. SHALL guardar una acción pendiente (kv `mcp-pending:<id>`, que vence a los 15 minutos) y responder que la persona a cargo tiene que confirmarla en el panel o con `zero mcp confirmar <id>`. La acción SHALL ejecutarse a través de app.ts solo con esa confirmación, una sola vez. El servidor stdio local MUST seguir como hoy.

#### Scenario: Parar desde el chat remoto
- **WHEN** un cliente con `zero:act` llama zero_stop sin trabajo
- **THEN** la fábrica no queda detenida y la respuesta nombra el id pendiente y cómo confirmarlo

#### Scenario: Confirmación
- **WHEN** se confirma esa acción pendiente con el confirmador de app.ts
- **THEN** la fábrica queda detenida, y confirmar otra vez el mismo id no hace nada y lo dice

#### Scenario: Vencida
- **WHEN** se confirma una acción pendiente creada hace más de 15 minutos
- **THEN** no se ejecuta y la respuesta dice que venció

#### Scenario: stdio sin cambio
- **WHEN** por el servidor stdio se llama zero_stop
- **THEN** la fábrica queda detenida en esa misma llamada

### Requirement: Clientes conectados visibles y revocables
zero SHALL listar los clientes con tokens vigentes (nombre, id, permisos, fecha de aprobación y último uso) en la página `/remote-chat` del panel y en `zero mcp clients`. SHALL revocar un cliente desde el panel (POST del mismo origen con confirm=1) y con `zero mcp revoke <cliente>`, y la revocación MUST invalidar de inmediato sus tokens de acceso y de renovación.

#### Scenario: Lista
- **WHEN** después de aprobar un cliente se llama a la vista de clientes de app.ts
- **THEN** aparece con su nombre, sus permisos y su fecha de aprobación

#### Scenario: Revocación
- **WHEN** se revoca el cliente y después se llama /mcp con su token de acceso
- **THEN** la respuesta es 401, y canjear su token de renovación da `invalid_grant`

### Requirement: Solo por la dirección del túnel
Las respuestas OAuth y de metadatos MUST usar como emisor y como recurso la URL pública guardada en kv `panel.remoteUrl`. Con el servidor remoto encendido y sin esa URL, `/mcp` y `/oauth/*` MUST responder 503 con un texto que dice que el túnel no está abierto. El transporte MUST rechazar un Host distinto del de esa URL o del de 127.0.0.1.

#### Scenario: Sin túnel
- **WHEN** con `mcp.remote` en on y sin `panel.remoteUrl` se pide /.well-known/oauth-authorization-server
- **THEN** la respuesta es 503

#### Scenario: Host ajeno
- **WHEN** se hace POST /mcp con un token válido y `Host: evil.example`
- **THEN** la respuesta es un error 4xx y no se ejecuta ninguna herramienta

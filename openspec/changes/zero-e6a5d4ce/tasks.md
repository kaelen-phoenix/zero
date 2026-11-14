# Tasks

## 1. Etapa 1: Investigación: ADR del chat remoto y cambio de OpenSpec

- [x] 1.1 Crear openspec/changes/zero-e6a5d4ce/ (proposal.md, tasks.md, specs/chat-interface/spec.md con ADDED Requirements) y validarlo con `npx openspec validate --all`.
- [x] 1.2 Escribir docs/adr/0005-chat-remoto.md (número libre en la base) con fuentes oficiales de OpenAI y Anthropic citadas, 'no verificado' donde corresponda, la recomendación de no publicar en los directorios con sus alternativas y la evaluación de la dirección estable.
- [x] 1.3 Agregar test/adr-chat-remoto.test.ts, que revisa el encabezado, las secciones, las palabras clave y las URLs de openai.com y anthropic.com/claude.com.

## 2. Etapa 2: Servidor de autorización OAuth (lógica pura)

- [x] 2.1 Crear src/mcp/oauth.ts sobre Store: registro de clientes con redirect https o loopback, códigos de un solo uso de 5 minutos con PKCE S256, tokens de acceso de 1 h y de renovación de 7 días que rotan, permisos zero:read/zero:act, revocación por cliente, revocación por reutilización del código y solo hashes guardados, con el reloj inyectable.
- [x] 2.2 Agregar en app.ts setRemoteMcp/remoteMcpOn (kv `mcp.remote`), remoteChatClients y revokeRemoteChatClient.
- [x] 2.3 Agregar tests unitarios de oauth.ts y de las funciones de app.ts.

## 3. Etapa 3: MCP por HTTP en el daemon

- [x] 3.1 Agregar la opción `remote` a createZeroMcpServer: herramientas según el permiso y acciones delicadas como pendientes (kv `mcp-pending:<id>`), con confirmRemoteAction/pendingRemoteActions en app.ts.
- [x] 3.2 Crear src/mcp/http.ts (metadatos, register, authorize, token, revoke, /mcp con StreamableHTTPServerTransport sin sesión, Bearer, Host, 404 apagado, 503 sin túnel) y conectarlo en src/panel/server.ts antes del chequeo de la cookie, con la página de aprobación en html.ts y el ingreso que vuelve a la ruta con query.
- [x] 3.3 Agregar test/mcp-remote.test.ts de punta a punta sobre el servidor del panel.

## 4. Etapa 4: Control desde el panel y la terminal, y documentación

- [ ] 4.1 Agregar la página `/remote-chat` del panel (clientes, revocar con confirm=1, acciones pendientes con Confirmar) y su entrada en NAV.
- [ ] 4.2 Agregar en src/cli.ts `zero mcp remote on|off`, `zero mcp clients`, `zero mcp revoke`, `zero mcp pendientes` y `zero mcp confirmar`, con su ayuda.
- [ ] 4.3 Escribir tests de la página y de los comandos. Actualizar README.md, README.es.md y AGENTS.md. Correr typecheck, test y openspec validate.

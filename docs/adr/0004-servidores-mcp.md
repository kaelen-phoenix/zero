# ADR 0004 — Servidores MCP para los agentes de la fábrica

- **Estado:** propuesto
- **Fecha:** 2026-11-12

## Contexto

Quien está a cargo vio el catálogo de servidores MCP de GitHub (github.com/mcp: Chrome DevTools, Playwright, GitHub, Serena, Skyvern, entre otros) y pidió evaluar, sin código todavía, si le sirven a los agentes de zero, estación por estación, con qué riesgo, y si conviene publicar en ese catálogo el servidor MCP propio de zero.

Esta evaluación se hizo leyendo el código de zero y lo que cada servidor dice hacer. No se instaló ni se ejecutó ningún servidor; lo que depende de una corrida real queda marcado como no verificado.

### Qué carga cada motor hoy

- **Claude** (`claudeOptions` en `src/engines/claude.ts`): corre con `strictMcpConfig: true`, sin `mcpServers`, con `settingSources: ["project"]` y `ENABLE_CLAUDEAI_MCP_SERVERS=false`. No carga ningún servidor MCP, ni siquiera el `.mcp.json` del repositorio.
- **ACP** (`src/engines/acp.ts`): abre la sesión con `session/new` y `mcpServers: []`.
- **Codex, opencode y agy** (`codexInvocation`, `opencodeInvocation`, `antigravityInvocation` en `src/engines/cli.ts`): se lanzan sin ninguna opción que desactive los servidores MCP de la configuración propia del usuario (`~/.codex/config.toml`, `opencode.json`, la de agy). `zero install` (`src/install.ts`) le indica a quien está a cargo que registre ahí el servidor de chat de zero, así que un agente de la fábrica podría tener a mano `zero_request`, `zero_merge`, `zero_proposal_decide` o `zero_stop`. **No verificado:** hay que confirmarlo con una corrida real de cada CLI.

### La regla

Las garantías las pone zero, nunca el motor: estaciones de solo lectura, tiempos límite, validación de esquemas, la compuerta de verify, rutas protegidas, la caja y la puerta de salida. Un servidor MCP es código de terceros que el motor llama con permisos propios, fuera de lo que zero ve: no pasa por `runGuarded`, ni por la puerta de salida si corre fuera de la caja, ni por `githubMeter` ni por los adaptadores firmados. Además `.mcp.json` y `.claude/**` ya son rutas protegidas (`protectedPaths` en `src/config.ts`): un trabajo no puede agregarse servidores a sí mismo.

## Decisión

No se agrega ningún servidor MCP a los motores ahora. Lo que un servidor aportaría se consigue mejor como comando de zero (dentro de la caja, detrás de la puerta) o ya está cubierto. Si más adelante se adopta alguno, lo pasa zero, lo elige solo quien está a cargo en el archivo de la fábrica, y corre dentro de la caja.

### Evaluación por estación

| Estación | Servidores que servirían | Riesgo | Veredicto |
|---|---|---|---|
| `spec` | Ninguno. Serena (búsqueda semántica) ayudaría a ubicar símbolos, pero leer el repositorio ya alcanza. | Serena trae herramientas de edición: en una estación de solo lectura habría que confiar en el motor para no usarlas. | Descartar. |
| `build` | Serena (búsqueda y edición semántica). | Escribe archivos: hay que limitarlo a la copia de trabajo, y su servidor corre con los permisos del proceso que lo lanza, no con los de la caja. Sin credencial, pero indexa y puede escribir fuera de la copia de trabajo si se le da otra raíz. | Adoptar después, solo dentro de la caja y con la raíz fijada por zero en la copia de trabajo. |
| `verify` | Playwright y Chrome DevTools, para probar fronts. | Abren un navegador con acceso a la red: fuera de la caja saltean la puerta. Como herramienta del motor, el resultado lo decide el agente y no zero. | Adoptar después como comando de verify en la imagen de la caja (Playwright en `verify`), no como herramienta del motor: así lo juzga zero por el código de salida. |
| `review` | Ninguno. Playwright o Chrome DevTools para mirar capturas, en algún caso. | Red y navegador en una estación de solo lectura; contenido web como inyección de instrucciones. | Descartar por ahora. |
| `security` | Ninguno. El servidor de GitHub podría leer alertas de Dependabot. | Necesita una credencial de GitHub con más alcance que el que necesita la estación. | Ya cubierto: `pollSecurityAlerts` lee las alertas y la verificación de dependencias usa OSV y deps.dev desde zero. |
| `scout` | GitHub (issues, pull requests). | Credencial de GitHub en manos del motor; saltea `githubMeter`, los adaptadores firmados y el filtro de autores con permiso de escritura (TRUSTED). | Ya cubierto: `scoutIssues` le pasa los issues como datos. |
| `research` | Playwright, Chrome DevTools o Skyvern para navegar. | Red sin la puerta, contenido web como instrucciones, y Skyvern es un agente web que maneja credenciales y completa formularios. | Descartar. `WebSearch` alcanza y las notas pasan por `sanitizeNotes`. |
| `reply` | GitHub (leer comentarios y contestar). | Escribir en GitHub desde el motor saltea la firma (`signedIssues`), `FACTORY_MARK` y el medidor. | Ya cubierto: `src/intake/comments.ts` lee y contesta. |

### Servidores del catálogo

- **Playwright** y **Chrome DevTools**: útiles para fronts, pero como comando de verify dentro de la caja, con la salida por la puerta. Como herramienta de un agente, el agente decide si la prueba pasó; eso va contra la regla de las garantías.
- **GitHub**: los logs de los checks ya llegan por `failedLog` en el adaptador medido (`checksFeedback`, `withCheckLogs` en unjam). Darle un token al motor saltearía `githubMeter`, la firma y la regla de que solo escriben en GitHub los adaptadores de zero. Descartar.
- **Serena**: el único con valor claro para `build` en repositorios grandes. Escribe, así que necesita guardas de zero (raíz en la copia de trabajo, corre en la caja). Evaluar más adelante con un pedido concreto.
- **Skyvern**: un agente web autónomo que maneja credenciales y completa formularios; no hay estación que lo necesite. Descartar.

### Servidor propio en el catálogo

Hoy `zero mcp` es un servidor stdio local con las herramientas del chat (`zero_request`, `zero_status`, `zero_merge`, `zero_proposal_decide`, `zero_stop`, `zero_egress_block` y otras) sobre el `ZERO_HOME` de quien está a cargo. Se recomienda **no publicarlo en el catálogo** por ahora:

- No es un servicio: solo sirve con una fábrica instalada y su `ZERO_HOME`. Listarlo invita a instalarlo sin la fábrica.
- Tiene herramientas que funden, paran o aprueban. Un listado en el catálogo lo pone al alcance de clientes y agentes de terceros sin la confirmación que el panel sí pide.
- Los requisitos del catálogo (registro, nombre del paquete publicado, metadatos) no se verificaron.

Se reconsidera cuando zero se instale como paquete publicado y el servidor tenga un modo de solo lectura.

### Próximos pedidos

- Que codex, opencode y agy ignoren los servidores MCP de la configuración del usuario cuando los lanza la fábrica, con un test de los argumentos y el entorno de cada invocación.
- Comprobar con una corrida real qué servidores MCP carga cada motor CLI y anotarlo en este ADR.
- Agregar Playwright con un navegador a la imagen de la caja, opcional por línea, para usarlo como comando de `verify` en líneas con front.
- Agregar al archivo de la fábrica una opción `mcp` por estación que solo cambia quien está a cargo (ninguna herramienta del chat la toca), que zero pasa al motor y que corre dentro de la caja detrás de la puerta.
- Un modo de solo lectura para `zero mcp` (sin `zero_request`, `zero_merge`, `zero_proposal_decide`, `zero_stop`), como paso previo a cualquier publicación.

## Consecuencias

- Nada cambia ahora: no se instala ningún servidor ni se agrega configuración MCP al repositorio.
- Queda sin verificar qué servidores cargan hoy codex, opencode y agy desde la configuración del usuario; mientras tanto el riesgo es que un agente vea el servidor de chat de zero.
- Cualquier servidor MCP futuro para los agentes empieza como un cambio de OpenSpec y respeta la regla: lo pasa zero, corre en la caja y sale por la puerta.

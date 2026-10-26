# Tasks

## 1. Base

- [x] 1.1 Añadir dependencias `@modelcontextprotocol/sdk` y `yaml`, y retirar los workflows `zero.yml` y `townhall.yml`; verificar que `npm ci` y `npm run build` funcionan
- [x] 1.2 Crear `src/home.ts` (rutas de `ZERO_HOME`) y verificar con un test que respeta la variable de entorno

## 2. Definición de la fábrica

- [x] 2.1 Reescribir `src/config.ts` con el esquema de `zero.factory.yaml` (líneas, nivel, límites, aprobaciones, estaciones, motores, townhall) y verificar con tests los valores por defecto, el error por nivel inválido y el rechazo de secretos
- [x] 2.2 Implementar el nivel efectivo (`L3` sin caja → `L2` con motivo) y verificarlo con tests
- [x] 2.3 Implementar `zero init` (detección de clientes, línea del repo actual, no sobrescribir) y verificarlo con un test sobre un directorio temporal

## 3. Estado y observabilidad

- [x] 3.1 Implementar `src/state/` sobre `node:sqlite` (trabajos, spans, kv, WAL) y verificar con tests de creación, transición de estados y concurrencia básica entre dos conexiones
- [x] 3.2 Implementar el registro de spans y `zero trace` y verificar que un trabajo de prueba muestra la jerarquía con duraciones y costo
- [x] 3.3 Implementar `src/telemetry/metrics.ts` como única definición de métricas y verificarlo con tests sobre datos sembrados

## 4. Línea de producción

- [x] 4.1 Reescribir `src/workspace.ts` sobre `git worktree` (crear, commit, diff con la base, descartar, eliminar) y verificar con un test sobre un repo temporal
- [x] 4.2 Implementar la estación `spec` con su esquema y el render a OpenSpec, y verificar que `openspec validate` acepta el resultado
- [x] 4.3 Implementar `build` y `verify` (comandos, archivos de test borrados, marcas que desactivan tests, rutas protegidas) y verificarlos con tests
- [x] 4.4 Implementar `review` con verificación de citas y regla de bloqueo, y verificarla con tests de citas válidas e inventadas
- [x] 4.5 Implementar `integrate` (`merge` limpio, copia sucia → consulta, conflicto, `branch`, `pull-request`) y verificar `merge` y copia sucia con repos temporales
- [x] 4.6 Implementar el ejecutor con checkpoint, reintentos, política de aprobaciones, presupuesto por trabajo y descarte de escrituras en estaciones de solo lectura; verificarlo con tests de punta a punta con motores falsos y git real
- [x] 4.7 Añadir `signal` a los motores (Claude y CLI) y verificar con un test que un proceso CLI se cancela

## 5. Townhall local

- [x] 5.1 Adaptar el townhall a almacenamiento local con línea por nota, borrado de secretos y sin duplicados; verificarlo con tests
- [x] 5.2 Generar el informe desde las métricas y las notas, y verificar con tests el caso "funcionó sola"

## 6. Daemon y pedidos

- [x] 6.1 Implementar pedidos (CLI `zero request`), aprobaciones (`zero approve`), andon (`zero stop`/`zero resume`) y `zero status`, y verificarlos con tests
- [x] 6.2 Implementar el daemon (señal de vida, instancia única, reanudación, concurrencia por línea, presupuesto diario, vencimientos, andon) y verificarlo con tests
- [x] 6.3 Implementar el arranque automático desacoplado y verificar manualmente que un pedido con la fábrica apagada inicia el daemon

## 7. Chat

- [x] 7.1 Implementar `zero mcp` con las herramientas de pedido, estado, respuesta, andon, informe y líneas, y verificarlo con tests que llaman a las herramientas por un cliente MCP en memoria
- [x] 7.2 Implementar `zero install` (Claude Code automático e idempotente; instrucciones para Codex y OpenCode) y verificarlo registrando zero en Claude Code en esta máquina

## 8. Integración y documentación

- [x] 8.1 Actualizar README, AGENTS.md y el ADR con el nuevo modelo y verificar que los comandos documentados existen
- [x] 8.2 Prueba real de punta a punta: un pedido desde la CLI en un repo de prueba, con el motor Claude, entregado por `merge`, con su traza y costo

## Workflow follow-up

- Archivar la change cuando todas las tareas estén completas y validadas.
- Registrar zero como línea de su propia fábrica.

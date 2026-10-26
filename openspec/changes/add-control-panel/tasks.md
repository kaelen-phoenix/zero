# Tasks

## 1. Panel

- [x] 1.1 Agregar `panel.port` al esquema y `bin/` al directorio de la fábrica
- [x] 1.2 Implementar el servidor (sesión por clave en el fragmento, cookie derivada, Origin, cabeceras de seguridad) y verificar el acceso con tests
- [x] 1.3 Implementar las páginas (resumen, trabajo, salidas, informe) y las acciones (pedir, aprobar, rechazar, detener, andon, reglas de salida) sobre `app.ts`, y verificarlas con tests HTTP

## 2. Acceso remoto

- [x] 2.1 Implementar la descarga de `cloudflared` con consentimiento y verificación de firma en Windows, y el túnel administrado por el daemon (estado en `kv`, reapertura), y verificar con un binario falso
- [x] 2.2 Agregar `zero panel`, `zero panel rotate` y `zero panel remote on|off`

## 3. Prueba real y documentación

- [ ] 3.1 Probar el panel por el túnel desde el celular del dueño
- [x] 3.2 Actualizar README, AGENTS.md y el ADR

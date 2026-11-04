# Proposal

## Why

Se quita de zero la prueba de concepto de publicación en redes sociales, que no era parte del núcleo de la fábrica: su estación, sus comandos, su configuración, sus dependencias, sus pruebas y su documentación. Si tu archivo de la fábrica todavía tiene esa configuración, sigue cargando y zero solo avisa que la ignora. Tus datos no se tocan: lo ya guardado en state.db queda donde está. Los paquetes de agentes funcionan igual que antes.

## What Changes

- Quitar una prueba de concepto que no era parte del núcleo
- Supuesto: El enlace del pie del sitio a la cuenta del proyecto se conserva con su prueba en `test/site.test.ts`: es un dato de contacto agregado a propósito, no una descripción de la prueba de concepto, y el sitio no menciona nada más de ella. Por eso `site/` no cambia.
- Supuesto: Los cambios viejos bajo `openspec/changes/` quedan como están, porque son el registro histórico del proyecto y el pedido no los incluye.
- Supuesto: Quien ya tenga un token guardado lo conserva en su llavero: zero no borra secretos ni claves de `kv`, solo deja de usarlos. Tampoco se tocan las publicaciones ya hechas ni los archivos ya subidos fuera de la máquina.
- Supuesto: Un valor inválido bajo `social` antes hacía fallar la carga; ahora se ignora con el aviso, como pide este cambio.
- Supuesto: Regenerar `package-lock.json` puede necesitar acceso a la red; si no lo hay, hay que editarlo de modo que `npm ci` siga funcionando.

## Capabilities

### New Capabilities
- `factory-core`: Quitar una prueba de concepto que no era parte del núcleo

### Modified Capabilities

## Impact

Generado por zero para el trabajo f2f8ef65.

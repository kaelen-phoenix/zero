# Proposal

## Why

Un paquete de agentes va a poder sumar una o más pestañas propias al panel de control. En su `zero-package.yaml` declara cada pestaña con un nombre corto, un título, categorías opcionales y un archivo JSON. Ese archivo vive en la carpeta de datos del paquete, dentro de ZERO_HOME (`<ZERO_HOME>/package-data/<paquete>/`), y sus estaciones la reciben como `ctx.dataDir`. El panel muestra la pestaña en el menú. En ella lista los elementos con un filtro por categoría y abre los links externos (solo http y https) en una pestaña nueva. Todo el texto se escapa, porque son datos de terceros. Cada pestaña tiene su propia dirección, `/packages/<paquete>/<pestaña>`. Podés compartir ese link con la clave del panel (`#k=…`), y después de entrar el panel te deja en esa pestaña y no en el resumen. En el panel no corre código del paquete: zero solo lee el JSON y lo valida con un esquema. Si el archivo falta, es demasiado grande o no es válido, la pestaña lo explica y no se rompe. Queda documentado en README.md y README.es.md, sin nombrar ningún paquete concreto.

## What Changes

- Pestañas de solo lectura de los paquetes en el panel
- Supuesto: Supuse que la 'carpeta de datos en ZERO_HOME' es nueva: hoy no existe ninguna. La defino como `<ZERO_HOME>/package-data/<paquete>` y la paso a las estaciones como `ctx.dataDir`. Es un agregado a la interfaz 1, así que no sube `PACKAGE_INTERFACE`.
- Supuesto: Supuse que el manifiesto acepta una lista `tabs` (una o más pestañas), porque el pedido dice que 'cada pestaña' tiene su URL.
- Supuesto: Supuse que la URL va en inglés (`/packages/<paquete>/<pestaña>`), como `/proposals` y `/research`, y que el parámetro del filtro es `categoria`, como `mes` en `/report`.
- Supuesto: Hoy `page()` arma el menú sin acceso al contexto. Pasar las pestañas a todas las páginas puede tocar muchas llamadas: conviene un parámetro o una marca que `send` reemplace en un solo lugar.
- Supuesto: Los límites (1 MiB, 500 elementos, 300 y 2000 caracteres, título de 60) son elecciones razonables; no salen del pedido.
- Supuesto: El filtro corre en el servidor (GET), sin JavaScript, para respetar la CSP de nonce y no agregar scripts.
- Supuesto: Crear enlaces simbólicos en Windows puede necesitar permisos. El test del enlace que sale de la carpeta tiene que saltarse si no se puede crear.
- Supuesto: `ctx.config` del panel se lee como está, así que una pestaña nueva aparece cuando la configuración vuelve a cargarse.

## Capabilities

### New Capabilities
- `agent-packages`: Pestañas de solo lectura de los paquetes en el panel

### Modified Capabilities

## Impact

Generado por zero para el trabajo e200aa6f.

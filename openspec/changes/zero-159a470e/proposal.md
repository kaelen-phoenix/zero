# Proposal

## Why

La fábrica va a dejar de agotar el cupo de GitHub de tu cuenta, y las publicaciones del CM y todo lo que use el mismo token van a tener margen. Qué vas a notar: - Los PRs bloqueados dejan de gastar en cada vuelta. Sus checks se vuelven a consultar cuando cambia el head o con esperas crecientes, de 5 minutos hasta 1 hora. - Si nada cambió, las consultas repetidas no gastan cupo, porque preguntan "¿cambió algo?" y GitHub responde 304. - Cuando queda 20% del cupo o menos, las pasadas de fondo paran solas hasta que el cupo se renueva. También paran hasta la hora que indique GitHub si responde 403 o 429 por límite, y la pausa sigue aunque se reinicie la fábrica. - `zero status` muestra una línea con el cupo restante, la hora de renovación y qué pasada gastó más, solo cuando el cupo está bajo. - Los pedidos de cada pasada quedan registrados. También se corrige un error relacionado: hoy, si GitHub responde por límite al consultar permisos, la fábrica puede creer que una persona no tiene permiso y rechazar su issue.

## What Changes

- Bajar y controlar el consumo del cupo de la API de GitHub
- Supuesto: Supuesto: se eligieron pedidos condicionales en lugar de GraphQL, porque cubren con un solo punto de cambio todas las pasadas (el pedido daba a elegir). GraphQL queda como posible mejora.
- Supuesto: Se sigue pidiendo `pullRequest` en cada vuelta para detectar enseguida un push o un cierre, también en PRs dentro de la espera. Esto depende de que GitHub responda 304 sin descontar cupo, como dice su documentación; no se comprobó contra GitHub real. Si respondiera 200, serían 20 pedidos por minuto con 20 PRs, un tercio de hoy.
- Supuesto: La caché de ETag vive en memoria: tras reiniciar el daemon, la primera vuelta paga todos sus pedidos. Si hay muchos issues viejos puede ser un pico, aunque la reserva lo frena a tiempo.
- Supuesto: La reserva está fija en 20% y no se puede configurar en esta primera parte.
- Supuesto: Un pedido de una pasada puede cortarse a mitad de una secuencia al entrar en pausa. Por ejemplo, se funde un PR pero no se publica el aviso en el issue de origen, y ese aviso se pierde. Es un fallo que ya existe hoy ante errores de red; se acepta frente a seguir gastando la reserva.
- Supuesto: Abrir PRs (`src/tracker.ts`) no pasa por el medidor: no se frena en la pausa y sus pedidos no se cuentan ni actualizan el cupo guardado. Así un trabajo terminado puede entregar usando la reserva, pero si el cupo está realmente en 0 ese pedido falla como hoy.
- Supuesto: El token puede usarlo también el CM desde fuera de la fábrica. Zero solo ve el cupo en los encabezados de sus propias respuestas, así que el dato puede tener hasta una vuelta de atraso. La línea de `zero status` tampoco se actualiza si el daemon está apagado.
- Supuesto: Con un `mergeable` que GitHub recalcula en diferido, un PR bloqueado puede hacer alguna consulta de checks de más antes de que venza la espera. Es un costo menor y se aceptó para no retrasar la fusión.

## Capabilities

### New Capabilities
- `github-quota`: Bajar y controlar el consumo del cupo de la API de GitHub

### Modified Capabilities

## Impact

Generado por zero para el trabajo 159a470e.

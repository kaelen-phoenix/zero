# Spec Delta

## ADDED Requirements

### Requirement: Panel en el navegador
Mientras la fábrica está en marcha, el daemon SHALL servir un panel en `127.0.0.1` en el puerto `panel.port` (4848 por defecto; `0` lo desactiva). El panel SHALL mostrar:
- el estado de la fábrica;
- los trabajos esperando, en curso, en cola y terminados;
- el detalle de cada trabajo con su traza y sus salidas;
- el informe de salidas;
- el informe del dueño.

Las páginas SHALL funcionar en la pantalla de un celular.

#### Scenario: Resumen
- **WHEN** el dueño abre el panel con la fábrica en marcha
- **THEN** ve el nivel efectivo, el presupuesto de hoy y los trabajos con su estado, con los mismos números que `zero status`

### Requirement: Acciones desde el panel
Desde el panel el dueño SHALL poder:
- pedir un trabajo;
- aprobar o rechazar una consulta;
- detener un trabajo;
- detener y reanudar la fábrica;
- bloquear, permitir o quitar un sitio de las reglas de salida;
- cambiar el modo de salida.

Cada acción SHALL usar la misma operación que la CLI.

#### Scenario: Aprobar desde el celular
- **WHEN** un trabajo espera una respuesta y el dueño toca "Aprobar"
- **THEN** el trabajo vuelve a la cola con la aprobación registrada, igual que con `zero approve`

### Requirement: Acceso con clave
Toda página y toda acción del panel MUST exigir una sesión válida. `zero panel` SHALL mostrar un link con la clave en el fragmento de la URL. La página SHALL canjear la clave por una cookie de sesión `HttpOnly` y `SameSite=Strict`, y borrar la clave de la barra de direcciones.

Las acciones MUST rechazar pedidos cuyo `Origin` no sea el del panel.

#### Scenario: Sin clave
- **WHEN** alguien abre la dirección del panel sin sesión
- **THEN** ve solo la página de ingreso y ninguna información de la fábrica

### Requirement: Guarda y rotación de la clave
La clave SHALL guardarse en el llavero del sistema y MUST NOT escribirse en archivos ni en registros. `zero panel rotate` SHALL reemplazarla e invalidar las sesiones anteriores.

#### Scenario: Clave rotada
- **WHEN** el dueño ejecuta `zero panel rotate`
- **THEN** los links y las sesiones anteriores dejan de funcionar

### Requirement: Acceso remoto temporal
`zero panel remote on` SHALL abrir un túnel rápido de Cloudflare hacia el panel y mostrar su link `https` con la clave. El daemon SHALL mantener el túnel mientras esté activado, y reabrirlo si se cae. `zero panel remote off` SHALL cerrarlo.

Si `cloudflared` no está disponible, zero MUST pedir confirmación antes de descargarlo, salvo con `--yes`. SHALL descargarlo de las releases oficiales y, en Windows, verificar su firma de Cloudflare antes de usarlo.

#### Scenario: Ver la fábrica desde el celular
- **WHEN** el dueño ejecuta `zero panel remote on` y abre el link en el celular
- **THEN** ve el panel de su fábrica a través de `https`

#### Scenario: Cerrar el acceso
- **WHEN** el dueño ejecuta `zero panel remote off`
- **THEN** el túnel se cierra y el link remoto deja de responder

# egress-gate Specification

## Purpose
Hace visible y controla todo lo que la caja envía a internet: la caja sale solo por la puerta de zero, que registra cada conexión, bloquea lo sospechoso y aplica las reglas del dueño, sin limitar lo demás salvo que el dueño lo elija.

## Requirements

### Requirement: Salida solo por la puerta
Con la caja lista, cada ejecución en la caja SHALL correr en una red interna sin ruta propia a internet. Su única salida SHALL ser la puerta de zero, un proxy HTTP/HTTPS en su propio contenedor. La caja MUST NOT poder resolver nombres por DNS ni abrir conexiones directas hacia afuera.

#### Scenario: Conexión directa
- **WHEN** un proceso dentro de la caja intenta conectarse a una dirección de internet sin usar el proxy
- **THEN** la conexión falla

#### Scenario: Resolución de nombres
- **WHEN** un proceso dentro de la caja intenta resolver `example.com` por DNS
- **THEN** la resolución falla

#### Scenario: Sitio normal
- **WHEN** el setup descarga paquetes de `registry.npmjs.org` a través del proxy
- **THEN** la descarga funciona y la conexión queda registrada como permitida

### Requirement: Identidad de cada conexión
Cada ejecución en la caja SHALL recibir un pase propio, válido solo mientras dura la ejecución. La puerta SHALL asociar cada conexión al trabajo y la estación de su pase. Una conexión sin pase válido SHALL rechazarse y registrarse como "sin identificar".

#### Scenario: Pase vencido
- **WHEN** una conexión usa el pase de una ejecución que ya terminó
- **THEN** la puerta la rechaza y la registra sin trabajo asociado

### Requirement: Bloqueo de salidas sospechosas
La puerta SHALL bloquear como sospechosas, con un motivo en palabras simples:
- las conexiones a direcciones IP sin nombre;
- las conexiones a puertos distintos de 80 y 443;
- las conexiones a servicios típicos para sacar datos (pegado de textos, archivos temporales, captura de peticiones, túneles, mensajería y DNS dinámico);
- las conexiones a sitios que resuelven a la red local, loopback, link-local o direcciones reservadas.

La conexión SHALL ir a la misma dirección que se revisó.

#### Scenario: Servicio de pegado de textos
- **WHEN** un agente intenta conectarse a `pastebin.com`
- **THEN** la puerta rechaza la conexión, y el registro indica el trabajo, la estación, la regla `suspicious` y el motivo

#### Scenario: Nombre que apunta a la red local
- **WHEN** un sitio resuelve a `192.168.1.10`
- **THEN** la puerta rechaza la conexión por apuntar a la red local

### Requirement: Modo de salida
La sección `egress` de `zero.factory.yaml` SHALL tener un `mode`:
- `blocklist`, por defecto: sale todo salvo lo sospechoso y lo bloqueado;
- `allowlist`: solo salen los sitios permitidos.

En `allowlist`, los sitios que necesitan los motores configurados SHALL permitirse sin que el dueño los liste.

#### Scenario: Lista de permitidos
- **WHEN** el modo es `allowlist`, el motor es `claude` y un agente se conecta a `api.anthropic.com` y a `example.com`
- **THEN** la primera conexión se permite y la segunda se bloquea con la regla `not-allowed`

### Requirement: Listas del dueño
`egress.allow` y `egress.block` SHALL listar sitios. Un sitio SHALL cubrir sus subdominios y MAY limitarse a un puerto. Las reglas SHALL aplicarse en este orden:
1. bloqueados del dueño;
2. permitidos del dueño y sitios del motor;
3. sospechas;
4. el modo.

#### Scenario: Permitido explícito en la red local
- **WHEN** el dueño agrega `nas.local` a `allow` y ese nombre resuelve a una dirección de su red
- **THEN** la puerta permite la conexión

#### Scenario: Cambio de reglas en caliente
- **WHEN** el dueño agrega un sitio a `block` mientras la puerta está encendida
- **THEN** la próxima ejecución en la caja ya lo bloquea

### Requirement: Registro de salidas
Cada conexión que pase por la puerta SHALL quedar registrada en el estado de la fábrica con:
- fecha;
- trabajo y estación;
- sitio y puerto;
- decisión, regla y motivo;
- bytes enviados y recibidos;
- duración.

Los registros SHALL guardarse 90 días. Leerlos varias veces o desde varios procesos MUST NOT duplicarlos.

#### Scenario: Lectura concurrente
- **WHEN** el daemon y la CLI leen los registros de la puerta al mismo tiempo
- **THEN** cada conexión aparece una sola vez

### Requirement: Informe de salidas
`zero egress [trabajo] [--days N]` y la herramienta MCP `zero_egress` SHALL mostrar las salidas del período, o del trabajo, agrupadas por sitio:
- conexiones y bloqueos;
- bytes;
- trabajos;
- motivo del último bloqueo;
- si el sitio es nuevo para la fábrica.

Si los trabajos no corren en la caja, el informe SHALL explicar que sin caja no se ven las salidas.

#### Scenario: Sitio nuevo
- **WHEN** un sitio aparece por primera vez en el período consultado
- **THEN** el informe lo marca como nuevo

### Requirement: Cambiar las reglas
`zero egress allow|block|remove <sitio>` y `zero egress mode <modo>` SHALL editar `zero.factory.yaml` conservando sus comentarios, y MUST NOT escribir una definición que la fábrica rechazaría. Desde el chat SHALL poderse solo bloquear un sitio; permitir o cambiar el modo MUST NOT estar disponible por MCP.

#### Scenario: Bloquear desde el chat
- **WHEN** el dueño pide en el chat bloquear `ejemplo.com`
- **THEN** `ejemplo.com` queda en `egress.block` y la herramienta lo confirma

#### Scenario: Permitir desde el chat
- **WHEN** el chat intenta permitir un sitio
- **THEN** no existe herramienta MCP para hacerlo y el dueño debe usar la terminal o el archivo

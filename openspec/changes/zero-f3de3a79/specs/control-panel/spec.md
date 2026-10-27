# Spec Delta

## Purpose

El panel de la fábrica en el navegador se va a ver más prolijo y profesional, sin cambiar lo que hace. Vas a tener: - un encabezado con la marca de zero y un menú que marca en qué sección estás; - el estado de cada trabajo como una etiqueta de color (en cola, trabajando, esperando, entregado, fallido, detenido); - los números del día en tarjetas más claras; - botones, formularios y tablas con un estilo parejo; - mejor lectura en el celular, con modo oscuro; - foco visible al navegar con el teclado. Todo sigue en español. No se carga nada de internet (ni fuentes ni íconos externos) y se mantienen la seguridad y las acciones de ahora.

## ADDED Requirements

### Requirement: Encabezado con marca y sección activa
Cada página con sesión del panel SHALL mostrar un encabezado con la marca de zero y la navegación (Resumen, Salidas, Informe), y el enlace de la sección actual MUST llevar `aria-current="page"`.

#### Scenario: Sección activa en Salidas
- **WHEN** el dueño con sesión abre `/egress`
- **THEN** el HTML contiene el enlace a `/egress` con `aria-current="page"` y los enlaces a `/` y `/briefing` sin ese atributo

#### Scenario: Sección activa en Resumen
- **WHEN** el dueño con sesión abre `/`
- **THEN** el enlace a `/` lleva `aria-current="page"`

#### Scenario: Ingreso sin navegación
- **WHEN** alguien sin sesión abre `/`
- **THEN** la página de ingreso muestra la marca y "Panel de tu fábrica", pero no los enlaces de navegación a `/egress` ni a `/briefing`

### Requirement: Estado del trabajo como etiqueta
El panel SHALL mostrar el estado de cada trabajo, en las listas del resumen y en la página del trabajo, dentro de un elemento con las clases `badge` y `badge-<estado>`, donde `<estado>` es uno de queued, running, waiting, delivered, failed o stopped. Su texto MUST ser la descripción de `describeJobStatus`.

#### Scenario: Trabajo en cola en el resumen
- **WHEN** hay un trabajo en cola y el dueño abre `/`
- **THEN** el HTML contiene un elemento con clase `badge badge-queued` cuyo texto es la descripción en español del estado

#### Scenario: Trabajo esperando en su página
- **WHEN** un trabajo espera la respuesta del dueño y este abre `/job/<id>`
- **THEN** el HTML contiene un elemento con clase `badge badge-waiting`

### Requirement: Sin recursos externos
Las páginas del panel MUST NOT cargar recursos externos: ni hojas de estilo, scripts, fuentes o imágenes con URL `http(s)`, ni `<link rel=stylesheet>`. Los estilos SHALL ir en el `<style>` de la página, y los íconos o la marca, si los hay, en SVG dentro del HTML. La política de seguridad de contenido actual MUST quedar igual.

#### Scenario: Páginas autocontenidas
- **WHEN** el dueño con sesión abre `/`, `/egress`, `/briefing` y la página de un trabajo
- **THEN** ninguna respuesta contiene `<link rel="stylesheet"`, `@import`, `<script src=` ni `src="http`, y la cabecera Content-Security-Policy sigue con `default-src 'none'` y el script con nonce

### Requirement: Accesibilidad básica
Cada página del panel SHALL usar un `<main>` como región principal y un `<nav>` con `aria-label` para la navegación. La hoja de estilos MUST definir un estilo `:focus-visible` para enlaces, botones y campos.

#### Scenario: Landmarks y foco
- **WHEN** el dueño con sesión abre `/`
- **THEN** el HTML contiene `<main`, `<nav aria-label=` y `:focus-visible` en el `<style>`

### Requirement: Celular y modo oscuro
Las páginas SHALL conservar la etiqueta `viewport` para pantallas de celular, y la hoja de estilos MUST incluir variantes para `prefers-color-scheme: dark` y una regla `@media` por ancho de pantalla para el diseño en el celular.

#### Scenario: Estilos adaptables
- **WHEN** se genera cualquier página del panel
- **THEN** el HTML contiene `name="viewport"`, `prefers-color-scheme: dark` y una regla `@media (max-width:` o `(min-width:`

### Requirement: Comportamiento y textos sin cambios
El rediseño MUST NOT cambiar las rutas, los formularios ni sus campos, las acciones, el refresco automático ni los textos en español que hoy prueban los tests (por ejemplo "Panel de tu fábrica", "nivel L2", "Pedir un trabajo", "DETENIDA", "Bloqueados: pastebin.com"), y todo el contenido dinámico MUST seguir pasando por `esc`.

#### Scenario: Tests existentes del panel
- **WHEN** se ejecuta `npm test` sobre `test/panel.test.ts`
- **THEN** todos los tests existentes pasan sin modificar sus aserciones

#### Scenario: Escape en el nombre del trabajo
- **WHEN** un trabajo tiene el pedido `<script>x</script>` y el dueño abre `/`
- **THEN** el HTML contiene `&lt;script&gt;` y no el texto `<script>x</script>` sin escapar

# Spec Delta

## Purpose

Un paquete de agentes va a poder sumar una o más pestañas propias al panel de control. En su `zero-package.yaml` declara cada pestaña con un nombre corto, un título, categorías opcionales y un archivo JSON. Ese archivo vive en la carpeta de datos del paquete, dentro de ZERO_HOME (`<ZERO_HOME>/package-data/<paquete>/`), y sus estaciones la reciben como `ctx.dataDir`. El panel muestra la pestaña en el menú. En ella lista los elementos con un filtro por categoría y abre los links externos (solo http y https) en una pestaña nueva. Todo el texto se escapa, porque son datos de terceros. Cada pestaña tiene su propia dirección, `/packages/<paquete>/<pestaña>`. Podés compartir ese link con la clave del panel (`#k=…`), y después de entrar el panel te deja en esa pestaña y no en el resumen. En el panel no corre código del paquete: zero solo lee el JSON y lo valida con un esquema. Si el archivo falta, es demasiado grande o no es válido, la pestaña lo explica y no se rompe. Queda documentado en README.md y README.es.md, sin nombrar ningún paquete concreto.

## ADDED Requirements

### Requirement: Pestañas declaradas en el manifiesto
ManifestSchema MUST aceptar una lista opcional `tabs` con entradas `{ name, title, data, categories? }`: `name` con la misma regla que los demás nombres del paquete (minúsculas, dígitos y guiones), `title` texto no vacío de hasta 60 caracteres, `data` una ruta relativa a un archivo `.json`, y `categories` una lista opcional de textos no vacíos sin repetidos. Un nombre de pestaña repetido, una ruta absoluta, una ruta con `..` o una clave desconocida MUST dejar afuera el paquete entero, con un problema que nombra `tabs` o la pestaña.

#### Scenario: Pestaña válida
- **WHEN** un manifiesto declara `tabs: [{ name: noticias, title: Noticias, data: items.json, categories: [a, b] }]`
- **THEN** el paquete carga sin problemas y `loadedPackages.packages[0].tabs` tiene esa pestaña con su título, su archivo y sus categorías

#### Scenario: Sin pestañas
- **WHEN** un manifiesto no declara `tabs`
- **THEN** el paquete carga y su lista de pestañas está vacía

#### Scenario: Ruta que sale de la carpeta
- **WHEN** una pestaña declara `data: ../x.json` o una ruta absoluta
- **THEN** el paquete no carga y `problems[0].reason` menciona la ruta

#### Scenario: Nombre repetido
- **WHEN** dos pestañas del mismo paquete se llaman igual
- **THEN** el paquete no carga y el problema nombra la pestaña repetida

### Requirement: Carpeta de datos del paquete en ZERO_HOME
Cada paquete MUST tener su carpeta de datos en `<ZERO_HOME>/package-data/<nombre del paquete>` (`FactoryHome.packageData`). La ruta `data` de una pestaña MUST resolverse dentro de esa carpeta, y el `StationContext` de sus estaciones MUST incluir `dataDir`, la ruta absoluta de esa carpeta, creada antes de la pasada.

#### Scenario: La estación recibe su carpeta
- **WHEN** corre `packagesPass` con una estación del paquete `p`
- **THEN** `ctx.dataDir` es `<ZERO_HOME>/package-data/p` y la carpeta existe

#### Scenario: Ruta del home
- **WHEN** se llama `factoryHome(root)`
- **THEN** `packageData` es `join(root, "package-data")`

### Requirement: Datos validados con un esquema
El panel MUST leer el archivo de una pestaña solo como JSON validado con un esquema zod: un objeto con `items`, una lista de hasta 500 elementos `{ title, url?, category?, description?, date? }` (textos, con `title` no vacío de hasta 300 caracteres y `description` de hasta 2000). MUST NOT importar ni ejecutar código del paquete. Un archivo que falta MUST mostrar que todavía no hay datos. Uno de más de 1 MiB, que no es JSON, que no cumple el esquema o cuya ruta real sale de la carpeta de datos (por ejemplo, por un enlace) MUST mostrar un aviso de datos no válidos. En todos esos casos la respuesta MUST ser 200.

#### Scenario: Datos válidos
- **WHEN** el archivo tiene dos elementos válidos y se pide `GET /packages/<paquete>/<pestaña>` con sesión
- **THEN** la respuesta es 200 y muestra los dos títulos

#### Scenario: Archivo ausente
- **WHEN** el archivo de la pestaña no existe
- **THEN** la respuesta es 200 y el cuerpo dice que todavía no hay datos

#### Scenario: Archivo inválido
- **WHEN** el archivo tiene JSON roto, un elemento sin `title`, un elemento con `title` de 301 caracteres o pesa más de 1 MiB
- **THEN** la respuesta es 200 con un aviso de datos no válidos y no muestra ningún elemento

#### Scenario: Enlace que sale de la carpeta
- **WHEN** el archivo de datos es un enlace a un archivo fuera de `<ZERO_HOME>/package-data/<paquete>`
- **THEN** la pestaña muestra el aviso de datos no válidos y no el contenido del archivo enlazado

### Requirement: Texto de terceros escapado
Todo texto que venga del manifiesto o del archivo de datos (título de la pestaña, categorías, título, descripción, fecha y url de cada elemento) MUST pasar por `esc` antes de entrar al HTML.

#### Scenario: HTML en los datos
- **WHEN** un elemento tiene `title: "<script>alert(1)</script>"` y `description: "<img src=x onerror=y>"`
- **THEN** el cuerpo contiene `&lt;script&gt;` y `&lt;img` y no contiene `<script>alert` ni `<img src=x`

### Requirement: Links externos solo http y https
La `url` de un elemento MUST mostrarse como link solo si se interpreta como URL absoluta con protocolo `http:` o `https:`, con `target="_blank"` y `rel="noopener noreferrer"`. Cualquier otra url (`javascript:`, `data:`, relativa o mal formada) MUST NOT producir un atributo `href`, y su elemento MUST mostrarse sin link.

#### Scenario: Link https
- **WHEN** un elemento tiene `url: https://example.com/a`
- **THEN** el cuerpo tiene `href="https://example.com/a"` con `target="_blank"` y `rel="noopener noreferrer"`

#### Scenario: Protocolo peligroso
- **WHEN** un elemento tiene `url: javascript:alert(1)`
- **THEN** el cuerpo no contiene `href="javascript:` y el título del elemento aparece igual

### Requirement: Filtro por categoría
La pestaña MUST ofrecer un filtro por categoría con un parámetro GET `categoria`. Las opciones MUST ser las `categories` del manifiesto cuando las declara y, si no, las categorías distintas de los elementos. Con `categoria` presente, MUST mostrar solo los elementos de esa categoría; sin el parámetro, o con el parámetro vacío, MUST mostrarlos todos.

#### Scenario: Filtrar
- **WHEN** hay elementos de las categorías `a` y `b` y se pide `?categoria=a`
- **THEN** solo aparecen los títulos de categoría `a`, y el filtro tiene `a` seleccionada

#### Scenario: Sin filtro
- **WHEN** se pide la pestaña sin `categoria`
- **THEN** aparecen los elementos de todas las categorías

#### Scenario: Opciones del manifiesto
- **WHEN** el manifiesto declara `categories: [x, y]`
- **THEN** el filtro ofrece `x` y `y` aunque ningún elemento las use

### Requirement: Pestaña en el menú y URL propia
Cada pestaña de un paquete cargado MUST aparecer en el menú de todas las páginas del panel que tienen menú, como un link a `/packages/<paquete>/<pestaña>` con su título escapado. Esa ruta MUST pedir sesión como las demás páginas. Una pestaña o un paquete inexistente MUST responder 404, y la ruta MUST NOT aceptar POST.

#### Scenario: Link en el menú
- **WHEN** un paquete cargado declara una pestaña y se pide `GET /` con sesión
- **THEN** el cuerpo contiene un link a `/packages/<paquete>/<pestaña>` con su título

#### Scenario: Sin sesión
- **WHEN** se pide la pestaña sin cookie de sesión
- **THEN** la respuesta es 401 con la página de ingreso

#### Scenario: Inexistente
- **WHEN** se pide `/packages/<paquete>/otra`, una pestaña que el paquete no declara, o un paquete que no cargó
- **THEN** la respuesta es 404

#### Scenario: Sin acciones
- **WHEN** se hace POST a `/packages/<paquete>/<pestaña>` con sesión
- **THEN** la respuesta es 404

### Requirement: Link compartido con la clave
La página de ingreso MUST, después de canjear la clave del fragmento `#k=`, llevar a la misma ruta y búsqueda que tenía la dirección (sin el fragmento) cuando esa ruta empieza con `/` y no con `//`; en cualquier otro caso MUST llevar a `/`.

#### Scenario: Vuelve a la pestaña
- **WHEN** se renderiza `loginPage`
- **THEN** su script quita el fragmento con `history.replaceState` y después del ingreso navega a `location.pathname + location.search` cuando empieza con `/` y no con `//`, y si no, a `/`

### Requirement: Documentación en los dos README
README.md y README.es.md MUST documentar `tabs` en la sección de paquetes de agentes con la misma estructura y los mismos bloques de código: el manifiesto, la carpeta de datos y `ctx.dataDir`, el formato del JSON y sus límites, el filtro, los links solo http/https y la URL compartible. MUST NOT nombrar ningún paquete concreto.

#### Scenario: Docs paralelos
- **WHEN** corre `test/docs.test.ts`
- **THEN** pasa, y los dos README mencionan `tabs` y `package-data`

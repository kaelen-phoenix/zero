# Spec Delta

## Purpose

Vas a tener una estación nueva, `community`, que con la fábrica libre mira lo que se entregó y arma borradores. Zero los filtra, les pone la firma de la fábrica, genera la imagen y publica solo en la cuenta de Instagram, sin esperar aprobación: hasta 1 publicación y 3 historias por día, sin repetir temas. Solo habla de la línea zero, salvo que habilites otras, y queda apagada mientras no haya token. Con `zero social status`, `post-now`, `pause` y `resume` ves y controlás lo que hace, y los dos README traen la guía para crear la app de Meta y conectar la cuenta. Quedan para las próximas etapas: la vista en el panel, los carruseles, las capturas del panel, el resumen semanal, la opción de aprobar antes de publicar (`propose`) y la renovación del token.

## ADDED Requirements

### Requirement: Configuración social
`zero.factory.yaml` MUST aceptar `social` como `off` o como un objeto con `postsPerDay` (por defecto 1), `storiesPerDay` (por defecto 3), `signature` (por defecto `Publicado por la fábrica zero (IA) · zerointheloop.com`, no vacía) y `media.repository` opcional (`dueño/repo`), y rechazar cualquier otro campo; cada línea MUST aceptar `social: { enabled: boolean }`.

#### Scenario: Valores por defecto
- **WHEN** se carga una fábrica sin la clave `social`
- **THEN** la configuración resultante tiene postsPerDay 1, storiesPerDay 3 y la firma por defecto

#### Scenario: Campo desconocido
- **WHEN** `social` trae un campo que no existe
- **THEN** `parseFactory` lanza ConfigError

#### Scenario: Firma vacía
- **WHEN** `social.signature` es un texto vacío
- **THEN** `parseFactory` lanza ConfigError

### Requirement: Estación community de solo lectura
`community` MUST ser una estación fija con acceso `read`, instrucciones en `agents/community.md`, skills por agente y por línea, y un directorio de trabajo vacío en lugar del repositorio de la línea, como `reply`.

#### Scenario: Acceso
- **WHEN** se consulta `AGENT_ACCESS.community`
- **THEN** vale `read`

#### Scenario: Nombre reservado
- **WHEN** un agente a medida se llama `community`
- **THEN** `parseFactory` lanza ConfigError

#### Scenario: Sin repositorio
- **WHEN** corre la pasada con un motor falso
- **THEN** el `cwd` del pedido al agente no es el `repo` de ninguna línea y está vacío

### Requirement: Apagada sin token
La pasada de community MUST no llamar al agente ni al canal cuando `social` es `off` o cuando `SecretStore` no tiene `INSTAGRAM_ACCESS_TOKEN`.

#### Scenario: Sin token
- **WHEN** corre la pasada con `social` por defecto y sin el secreto
- **THEN** hay cero llamadas al agente y cero publicaciones

#### Scenario: Social off
- **WHEN** corre la pasada con `social: off` y el secreto guardado
- **THEN** hay cero llamadas al agente y cero publicaciones

### Requirement: Solo con la fábrica libre
La pasada automática MUST correr como mucho una vez por día local y MUST no llamar al agente con trabajos en cola o en marcha, con el andon encendido, con la publicación en pausa, con el presupuesto alcanzado o sin motor disponible.

#### Scenario: Trabajo en cola
- **WHEN** hay un trabajo en cola al correr la pasada
- **THEN** no se llama al agente

#### Scenario: Una vez por día
- **WHEN** la pasada corre dos veces el mismo día local
- **THEN** el agente se llama una sola vez

#### Scenario: Corre en el demonio
- **WHEN** el demonio está libre con la opción social activada, un canal falso y el secreto guardado
- **THEN** la pasada corre después de scout y research, en la misma corrida libre compartida

### Requirement: Presupuesto compartido
Con facturación por uso, lo gastado por `community` MUST contar junto con `scout` y `research` contra `limits.usdPerNight`, y su corrida MUST recibir como tope lo que quede.

#### Scenario: Tope agotado
- **WHEN** scout y research ya gastaron todo `usdPerNight` hoy con facturación por uso
- **THEN** no se llama al agente

#### Scenario: Gasto compartido
- **WHEN** un span de community registra un costo
- **THEN** `scoutSpent` lo incluye

#### Scenario: Tope de la corrida
- **WHEN** quedan 0,40 dólares del tope con facturación por uso
- **THEN** el pedido al agente lleva `maxBudgetUsd` 0,4

### Requirement: Solo líneas habilitadas
Una línea MUST estar habilitada solo si `social.enabled` es true o si se llama `zero` y no dice otra cosa; el prompt del agente MUST incluir datos solo de líneas habilitadas y un borrador de otra línea MUST descartarse.

#### Scenario: Por defecto
- **WHEN** hay líneas `zero` y `cliente` sin `social`
- **THEN** solo `zero` está habilitada y el prompt no menciona datos de `cliente`

#### Scenario: Línea apagada
- **WHEN** la línea `zero` tiene `social.enabled: false`
- **THEN** no está habilitada

#### Scenario: Borrador ajeno
- **WHEN** el agente devuelve un borrador de una línea no habilitada
- **THEN** no se publica ni se registra como publicado

### Requirement: Datos que ve el agente
El prompt de community MUST armarlo zero con los trabajos entregados y las notas de investigación no comerciales de los últimos 7 días, más los temas ya publicados, sin ids de trabajo, nombres de rama, ni rutas locales, y MUST marcar ese contenido como dato y no como instrucciones.

#### Scenario: Sin identificadores internos
- **WHEN** un trabajo entregado tiene la rama `zero/<id>` y una ruta local en su título
- **THEN** el prompt no contiene ni el id, ni la rama, ni la ruta

#### Scenario: Nota de negocio
- **WHEN** una línea tiene una nota con `business: true`
- **THEN** la nota no aparece en el prompt

#### Scenario: Trabajo no entregado
- **WHEN** un trabajo terminó fallido
- **THEN** no aparece en el prompt

### Requirement: Borradores validados
La salida de community MUST validarse con un esquema de borradores que trae línea, tema, tipo (`post` o `story`), texto y los textos de la imagen; un resultado inválido MUST dejar sin publicar nada y sin romper la pasada.

#### Scenario: Tipo desconocido
- **WHEN** el agente devuelve un borrador de tipo `reel`
- **THEN** no se publica nada y la pasada termina sin lanzar error

#### Scenario: Agente fallido
- **WHEN** la corrida del agente termina con `ok: false`
- **THEN** no se publica nada y la pasada termina sin lanzar error

### Requirement: Límites por día
Zero MUST publicar como mucho `postsPerDay` publicaciones y `storiesPerDay` historias por día local, contando las publicadas y las que están en curso, y descartando los borradores que excedan el límite.

#### Scenario: Más borradores que cupo
- **WHEN** el agente devuelve 2 publicaciones y 5 historias con los valores por defecto
- **THEN** el canal recibe 1 publicación y 3 historias

#### Scenario: Cupo agotado
- **WHEN** hoy ya se alcanzaron los dos límites
- **THEN** la pasada automática no llama al agente

#### Scenario: Fallidas no cuentan
- **WHEN** la única publicación de hoy falló
- **THEN** queda cupo para otra publicación

### Requirement: Sin repetir temas
Zero MUST llevar en `state.db` un registro de cada publicación (línea, canal, tipo, tema, texto, estado, enlace, error y fechas) y MUST descartar un borrador cuyo tema normalizado coincida con el de una publicación no fallida o con otro borrador de la misma corrida.

#### Scenario: Tema repetido
- **WHEN** un borrador trae el tema de una publicación anterior con otras mayúsculas y acentos
- **THEN** no se publica

#### Scenario: Repetido en la corrida
- **WHEN** dos borradores de la misma corrida tienen el mismo tema
- **THEN** se publica solo el primero

#### Scenario: Temas en el prompt
- **WHEN** ya hay publicaciones registradas
- **THEN** sus temas aparecen en el prompt

### Requirement: Filtro antes de publicar
Antes de renderizar o publicar, zero MUST pasar cada texto (el de la publicación y los de la imagen) por un filtro público que quita secretos y rutas locales y rompe las @menciones, y MUST descartar el borrador si el filtro tuvo que quitar un secreto o una ruta.

#### Scenario: Mención rota
- **WHEN** el texto contiene `@alguien`
- **THEN** el canal recibe `@` seguido de un espacio de ancho cero y luego `alguien`

#### Scenario: Secreto
- **WHEN** el texto o un texto de la imagen contiene un token con forma de credencial
- **THEN** el borrador se descarta sin subir imagen ni llamar al canal

#### Scenario: Rutas difíciles
- **WHEN** un texto contiene una ruta con espacios, una carpeta hermana con el prefijo del repositorio de una línea, o una ruta absoluta como `/opt/app/x`
- **THEN** el borrador se descarta sin subir imagen ni llamar al canal

#### Scenario: Una URL no es una ruta
- **WHEN** un texto contiene `https://zerointheloop.com/a/b`
- **THEN** el borrador se publica con la URL intacta

### Requirement: Firma de IA
Cada publicación MUST llevar `social.signature` como último párrafo del texto y cada imagen MUST llevarla en el pie, aunque la firma general `signature` esté en `off`; si el texto supera los 2200 caracteres, MUST recortarse el cuerpo sin perder la firma.

#### Scenario: Firma en el texto
- **WHEN** se publica un `post` con `signature: off` en la fábrica
- **THEN** el texto que recibe el canal termina con `social.signature`

#### Scenario: Texto largo
- **WHEN** el cuerpo tiene 3000 caracteres
- **THEN** el texto que recibe el canal tiene como mucho 2200 caracteres y termina con la firma

#### Scenario: Firma en la historia
- **WHEN** se renderiza una historia
- **THEN** el SVG de la tarjeta contiene la firma, porque las historias no llevan texto aparte

### Requirement: Tarjetas renderizadas por zero
Zero MUST generar la imagen sin ningún modelo: una tarjeta JPEG con los colores del sitio y una fuente incluida con zero, de 1080x1080 para `post` y 1080x1920 para `story`, sin depender de las fuentes del sistema.

#### Scenario: Tamaño
- **WHEN** se renderiza un `post` y una `story`
- **THEN** al decodificar los JPEG miden 1080x1080 y 1080x1920

#### Scenario: Colores
- **WHEN** se decodifica una tarjeta
- **THEN** una esquina tiene el color de fondo del sitio `#fbfbf9`, con la tolerancia propia del JPEG

#### Scenario: El texto se dibuja
- **WHEN** se renderizan dos tarjetas con textos distintos
- **THEN** los píxeles de la zona del título difieren entre ellas y hay píxeles oscuros en esa zona

#### Scenario: Texto con marcado
- **WHEN** el título contiene `<script>` y `&`
- **THEN** el SVG queda bien formado, con esos caracteres escapados, y el render no falla

### Requirement: Canal y alojamiento con adaptadores
La publicación MUST pasar por una interfaz de canal y otra de alojamiento de imágenes en `src/social/`, de modo que sumar otro canal no cambie la pasada; quien publica MUST ser zero, nunca el agente.

#### Scenario: Canal falso
- **WHEN** la pasada corre con un canal y un alojamiento falsos
- **THEN** el canal recibe el tipo, el texto y la URL que devolvió el alojamiento

#### Scenario: Agente sin acceso
- **WHEN** corre la pasada
- **THEN** el pedido al agente no contiene el token ni la URL del canal

### Requirement: Adaptador de Instagram
El adaptador de Instagram MUST publicar con la API con login de Instagram en dos pasos sobre `graph.instagram.com` (crear el contenedor con `image_url`, esperar a que esté listo y llamar a `media_publish`), usar `media_type=STORIES` sin texto para las historias y devolver el id y el enlace cuando exista.

#### Scenario: Publicación
- **WHEN** se publica un `post` con un `fetch` falso
- **THEN** se crea un contenedor con `image_url` y `caption`, y después se llama a `media_publish` con su `creation_id`

#### Scenario: Historia
- **WHEN** se publica una `story` con un `fetch` falso
- **THEN** el contenedor lleva `media_type=STORIES` y no lleva `caption`

#### Scenario: Contenedor con error
- **WHEN** el contenedor informa el estado `ERROR`
- **THEN** no se llama a `media_publish` y el adaptador lanza un error

#### Scenario: Error de la API
- **WHEN** la API responde un error que incluye el token
- **THEN** el error que lanza el adaptador no contiene el token

### Requirement: Imágenes en una release pública
El alojamiento de GitHub MUST subir cada JPEG como asset con tipo `image/jpeg` de una prerelease propia del repositorio `social.media.repository` (por defecto, el de la línea de la publicación), y MUST negarse a subir si el repositorio es privado.

#### Scenario: Subida
- **WHEN** se sube una imagen con una API de GitHub falsa y sin la release creada
- **THEN** se crea la prerelease una vez y se devuelve la URL pública del asset

#### Scenario: Release existente
- **WHEN** se suben dos imágenes
- **THEN** la prerelease se crea una sola vez

#### Scenario: Repositorio privado
- **WHEN** el repositorio es privado
- **THEN** no se sube nada y se lanza un error en español

### Requirement: Publicación segura ante fallas
Zero MUST registrar cada publicación como en curso antes de llamar al canal y volver a comprobar pausa y andon antes de cada borrador; un error MUST quedar registrado como `failed` con su motivo limpio de secretos, sin frenar los borradores siguientes ni repetirse solo el mismo día.

#### Scenario: Falla del canal
- **WHEN** el canal falla en el primer borrador de dos
- **THEN** el primero queda `failed` con su motivo y el segundo se publica

#### Scenario: Caída a mitad de camino
- **WHEN** ya existe un registro en curso de hoy
- **THEN** ese registro cuenta para el límite diario y su tema no se vuelve a publicar

#### Scenario: Pausa durante la corrida
- **WHEN** se pausa mientras corre el agente
- **THEN** no se publica ningún borrador

#### Scenario: Andon durante la corrida
- **WHEN** se enciende el andon mientras corre el agente
- **THEN** no se publica ningún borrador

### Requirement: Token protegido
El token MUST leerse solo de `SecretStore` y MUST no aparecer en argumentos, archivos, registros, `state.db` ni en la salida de los comandos; `redact` y `findSecret` MUST reconocer los tokens de Instagram con forma `IGAA…`.

#### Scenario: Forma reconocida
- **WHEN** un texto contiene un token `IGAA` de 40 caracteres
- **THEN** `redact` lo reemplaza y `findSecret` lo encuentra

#### Scenario: Nada queda guardado
- **WHEN** el canal falla con un error que incluye el valor del token
- **THEN** el registro de la publicación no contiene ese valor

#### Scenario: Archivo de la fábrica
- **WHEN** `zero.factory.yaml` contiene un token de Instagram
- **THEN** `parseFactory` lanza ConfigError

### Requirement: Comando zero social
`zero social` MUST ofrecer `status`, `post-now`, `pause` y `resume`, en español con voseo y con la lógica en `src/app.ts`: `status` muestra si está encendida o por qué no, el cupo de hoy, las líneas habilitadas, lo publicado con sus enlaces y la última falla; `post-now` corre una pasada sin esperar al día siguiente pero respetando pausa, andon, token, presupuesto y límites.

#### Scenario: Estado sin token
- **WHEN** se pide el estado sin token
- **THEN** dice que está apagada, explica cómo guardar el token y no incluye ningún valor secreto

#### Scenario: Estado con publicaciones
- **WHEN** hay publicaciones registradas
- **THEN** el estado incluye el enlace de cada una y el cupo usado hoy

#### Scenario: Pausa
- **WHEN** se pausa y luego corre la pasada automática
- **THEN** no se llama al agente; después de `resume` vuelve a correr

#### Scenario: Post-now
- **WHEN** se ejecuta `post-now` cuando la pasada de hoy ya corrió y queda cupo
- **THEN** se vuelve a llamar al agente y se publica

#### Scenario: Post-now en pausa
- **WHEN** se ejecuta `post-now` con la publicación en pausa
- **THEN** no se publica y el mensaje dice que está en pausa

### Requirement: Documentación
`README.md` y `README.es.md` MUST documentar la configuración `social`, los comandos y la guía para crear la app de Meta y conectar la cuenta, con la misma estructura y los mismos bloques de código; `AGENTS.md` MUST describir los módulos nuevos.

#### Scenario: Ambos idiomas
- **WHEN** corre `test/docs.test.ts`
- **THEN** pasa y comprueba que los bloques de código de ambos README contienen `zero social status`, `INSTAGRAM_ACCESS_TOKEN` y `postsPerDay`

# Spec Delta

## Purpose

Las publicaciones de la fábrica pasan a verse llamativas y cálidas: naranja #ff8a5c como protagonista, tipografía grande y gruesa, frases cortas y el símbolo de la Z en todas las imágenes, además de la firma de texto. Se suman carruseles (portada con gancho, de 2 a 6 slides y cierre con llamado a la acción) con siete tipos de slide, publicaciones en 1080x1350 e historias en 1080x1920. Antes de publicar, zero revisa el texto con los criterios de auditoría de ig-humanizer: gancho en los primeros 125 caracteres, sin frases típicas de IA y de 3 a 5 hashtags. Si un borrador no pasa, se descarta. La estación recibe una guía de estilo escrita y un comando nuevo, `zero social skills`, le asigna las 9 skills. Publicar sigue a cargo de zero, nunca de servicios externos, y sigue andando con tu token de página de Facebook. Dos cosas te quedan a vos después de integrar: correr `zero social skills` y `zero social resume`, porque un trabajo no puede tocar tu archivo de la fábrica y la pausa solo la levantás vos. Las imágenes con IA no entran en esta etapa: quedan como trabajo siguiente.

## ADDED Requirements

### Requirement: Carrusel en el borrador
La salida de la estación community MUST admitir el tipo `carousel` con un campo `slides`, y zero SHALL aceptar un carrusel solo si su primer slide es `cover`, el último es `cta` y entre ambos hay de 2 a 6 slides de los tipos `step`, `myth`, `stat`, `before-after` o `quote`; cualquier otro carrusel se descarta sin afectar a los demás borradores.

#### Scenario: Carrusel válido
- **WHEN** el agente devuelve un carrusel con cover, 3 slides step y cta, y el texto pasa la auditoría
- **THEN** el canal falso recibe un item `carousel` con 5 URLs de imagen en ese orden

#### Scenario: Sin cierre
- **WHEN** el último slide de un carrusel no es `cta`
- **THEN** el canal no recibe ese carrusel, `dropped` sube en 1 y otro borrador válido de la misma corrida se publica

#### Scenario: Demasiados slides
- **WHEN** un carrusel trae 7 slides entre la portada y el cierre
- **THEN** el borrador se descarta

#### Scenario: Muy pocos slides
- **WHEN** un carrusel trae 1 solo slide entre la portada y el cierre
- **THEN** el borrador se descarta

### Requirement: Cupo de carruseles
Un carrusel MUST contar para `postsPerDay` junto con las publicaciones simples, y no se agrega ningún límite nuevo.

#### Scenario: Cupo compartido
- **WHEN** `postsPerDay` es 1 y la corrida trae un carrusel y una publicación simple, ambos válidos
- **THEN** se publica solo el primero y `socialQuota` informa posts usados 1 de 1

#### Scenario: Se ve en el estado
- **WHEN** hay un carrusel publicado y se llama a `formatSocialStatus`
- **THEN** la línea de esa publicación dice `carrusel`

### Requirement: Filtro público en cada slide
Zero MUST pasar por `publicText` el texto de cada slide de un carrusel, y SHALL descartar el borrador entero si hubo que quitar algo de cualquiera de ellos.

#### Scenario: Ruta en un slide
- **WHEN** el cuerpo del tercer slide contiene una ruta local
- **THEN** el carrusel se descarta y no se sube ninguna imagen

### Requirement: Publicación de carrusel en Instagram
El adaptador de Instagram MUST publicar un carrusel creando un contenedor con `is_carousel_item` por cada imagen, esperando que cada uno esté FINISHED, creando luego un contenedor `CAROUSEL` con `children` y `caption`, y SHALL llamar a `media_publish` solo con ese último contenedor listo.

#### Scenario: Orden de llamadas
- **WHEN** se publica un carrusel de 3 imágenes contra el fetch falso
- **THEN** hay 3 POST con `is_carousel_item` y `image_url` sin `caption`, después un POST con `media_type` CAROUSEL, `children` con los 3 ids en orden separados por coma y `caption`, y después `media_publish` con el id del contenedor CAROUSEL

#### Scenario: Un hijo falla
- **WHEN** un contenedor hijo responde estado ERROR
- **THEN** `publish` rechaza la promesa y nunca se llama a `media_publish`

#### Scenario: Token de página de Facebook
- **WHEN** el carrusel se publica con `accountId`
- **THEN** todas las llamadas van a graph.facebook.com y ninguna a `/me`

### Requirement: Modo de token de página de Facebook
El reconocimiento de secretos MUST detectar también los tokens con forma de token de página de Facebook (`EAA` seguido de al menos 20 caracteres alfanuméricos), y los modos existentes de publicación SHALL seguir funcionando igual.

#### Scenario: Token en el archivo
- **WHEN** `parseFactory` recibe una firma con `EAA` seguido de 40 letras
- **THEN** lanza ConfigError

#### Scenario: Token en un borrador
- **WHEN** el texto de un borrador contiene un token `EAA...`
- **THEN** `publicText` marca `removed` y el borrador se descarta

### Requirement: Tamaños
El render MUST producir JPEG de 1080x1350 para publicaciones y cada slide de carrusel, y de 1080x1920 para historias.

#### Scenario: Dimensiones
- **WHEN** se decodifica `renderCard` de una publicación, un slide de carrusel y una historia
- **THEN** miden 1080x1350, 1080x1350 y 1080x1920

### Requirement: Símbolo en toda imagen
Toda imagen renderizada MUST llevar el símbolo de site/brand/zero-symbol.png sobre su propio fondo negro, y la portada SHALL mostrarlo más grande que los demás slides.

#### Scenario: Presente en todos los tipos
- **WHEN** se genera `cardSvg` para cada uno de los 7 tipos
- **THEN** cada SVG contiene un elemento `image` con el PNG embebido

#### Scenario: Se ve en el píxel
- **WHEN** se decodifica una imagen de tipo `step`
- **THEN** en el recuadro del símbolo hay píxeles cercanos a #ff8a5c y a blanco cálido sobre negro

#### Scenario: Portada grande
- **WHEN** se comparan los `image` de un `cover` y de un `step`
- **THEN** el ancho del símbolo en `cover` es mayor

### Requirement: Firma de texto en toda imagen
Toda imagen MUST llevar `social.signature` en el pie, incluidos todos los slides de un carrusel, y ningún texto SHALL taparla, por largo que sea.

#### Scenario: Texto larguísimo
- **WHEN** cada tipo de slide recibe título y cuerpo de 400 palabras
- **THEN** el SVG contiene la firma, ninguna línea de texto alcanza su posición y el render no falla

### Requirement: Dirección visual por tipo
El render MUST dibujar `cover`, `stat` y `cta` sobre fondo naranja pleno #ff8a5c con texto casi negro, `myth` y `before-after` en dos bloques de color contrastados con ambos textos visibles, y `quote` como tarjeta tipo tweet; ninguna pieza SHALL usar el fondo claro de la primera etapa como fondo completo.

#### Scenario: Fondo naranja
- **WHEN** se decodifica un `cover`, un `stat` y un `cta`
- **THEN** el fondo cerca de una esquina libre es #ff8a5c dentro de la tolerancia de JPEG

#### Scenario: Dos bloques
- **WHEN** se decodifica un `myth`
- **THEN** el centro de la mitad superior y el de la mitad inferior tienen colores de fondo claramente distintos, y el SVG contiene ambos textos

#### Scenario: Contraste
- **WHEN** se genera el SVG de un `cover`
- **THEN** el título usa un color casi negro y no blanco

#### Scenario: Publicación simple
- **WHEN** una publicación llega con `image` sin `type`
- **THEN** se dibuja como `cover`

### Requirement: Render robusto y seguro
El render MUST usar solo fuentes incluidas con zero, escapar todo texto y mantener el texto dentro de los márgenes reduciendo el tamaño antes de cortar; en las historias, texto y símbolo SHALL quedar fuera de las zonas que tapa la app.

#### Scenario: Marcado y caracteres raros
- **WHEN** un título trae `<script>`, caracteres de control, surrogates rotos y emoji
- **THEN** el SVG sigue bien formado y el render no falla

#### Scenario: Título largo en stat
- **WHEN** un `stat` recibe un título de 30 caracteres
- **THEN** la columna de margen izquierda y derecha del JPEG sigue siendo del color de fondo

#### Scenario: Zonas de historia
- **WHEN** se genera una historia de cualquier tipo
- **THEN** las coordenadas `y` de texto y símbolo quedan entre 250 y 1670

### Requirement: Auditoría del pie de foto
Antes de publicar una publicación o un carrusel, zero MUST descartar el borrador cuyo texto no tenga una primera frase o línea que termine dentro de los primeros 125 caracteres, no tenga de 3 a 5 hashtags, tenga hashtags fuera del último párrafo, o no quepa con la firma en el máximo de Instagram.

#### Scenario: Texto correcto
- **WHEN** el texto abre con una frase de 60 caracteres y cierra con un párrafo de 4 hashtags
- **THEN** `auditCaption` lo aprueba sin problemas

#### Scenario: Gancho tardío
- **WHEN** la primera frase termina en el carácter 180
- **THEN** `auditCaption` informa el problema del gancho y el canal no recibe el borrador

#### Scenario: Hashtags
- **WHEN** el texto tiene 2 hashtags, o 6, o uno a mitad de una frase
- **THEN** `auditCaption` lo rechaza

#### Scenario: Demasiado largo
- **WHEN** el texto sumado a la firma supera 2200 caracteres
- **THEN** `auditCaption` lo rechaza en lugar de cortar los hashtags

### Requirement: Sin tono de IA
Zero MUST descartar el borrador cuyo pie de foto o texto de imagen contenga, en español o en inglés, una apertura hueca, un puente de revelación, un anuncio de sinceridad, carnada de interacción, un cierre muerto o paralelismo negativo, cuyo párrafo reúna 3 o más marcadores de vocabulario de IA, o que supere una raya por cada 100 palabras con un mínimo admitido de 2; un solo marcador de vocabulario o una sola raya SHALL pasar.

#### Scenario: Frase vetada
- **WHEN** el texto abre con `En el mundo actual` o `Hablemos de`, o cierra con `¿Qué opinás?`
- **THEN** el borrador se descarta

#### Scenario: Paralelismo negativo
- **WHEN** el texto dice `No es una herramienta, es una fábrica`
- **THEN** el borrador se descarta

#### Scenario: Densidad
- **WHEN** un párrafo tiene 3 marcadores de vocabulario
- **THEN** el borrador se descarta; con 1 marcador pasa

#### Scenario: Texto de slide
- **WHEN** un slide contiene `¿El resultado?`
- **THEN** el carrusel se descarta

#### Scenario: Historia
- **WHEN** una historia sin hashtags tiene un texto de imagen limpio
- **THEN** se publica, porque la historia no muestra pie de foto

### Requirement: Motivo del descarte
Zero MUST registrar en el log por qué la auditoría descartó cada borrador, sin incluir el texto completo del borrador.

#### Scenario: Log
- **WHEN** un borrador no pasa la auditoría
- **THEN** `log.warn` recibe el problema y `dropped` sube en 1

### Requirement: Guía de estilo en el prompt
La estación community MUST recibir en su prompt la guía de `agents/community-style.md`, que SHALL describir la marca, los tipos de slide, la dirección visual y los criterios de la auditoría.

#### Scenario: Prompt
- **WHEN** se genera `communityPrompt`
- **THEN** contiene la guía, con `#ff8a5c`, los 7 tipos de slide y la regla de 125 caracteres

#### Scenario: Fuera de los datos
- **WHEN** se genera `communityPrompt`
- **THEN** la guía aparece antes del primer bloque `<data>` y fuera de todos ellos

### Requirement: Publica solo zero
Las instrucciones de la estación MUST indicar que manda sobre cualquier skill y que nunca debe usar las partes de una skill que publican o consultan servicios externos (Publora, WoopSocial, Pixfaro, Apify) ni ejecutar sus scripts.

#### Scenario: Instrucciones
- **WHEN** se lee `agents/community.md`
- **THEN** nombra esos cuatro servicios como prohibidos y mantiene que la estación solo redacta

#### Scenario: Sin credenciales
- **WHEN** corre la estación con el agente falso
- **THEN** su prompt no contiene el token y la estación sigue teniendo acceso `read`

### Requirement: Asignar las skills
El comando `zero social skills` MUST asignar a `stations.community.skills` del archivo de la fábrica las 9 skills pedidas, a través de `addSkill`, sin duplicar las que ya estén, y SHALL avisar cuáles no están instaladas.

#### Scenario: Primera vez
- **WHEN** se ejecuta sobre una fábrica sin skills en community
- **THEN** el archivo guarda ig-caption-writer, ig-carousel-planner, ig-content-planner, ig-hashtag-strategist, ig-hook-extractor, ig-humanizer, ig-profile-optimizer, ig-repurposer e instagram-carousel-skill

#### Scenario: Dos veces
- **WHEN** se ejecuta dos veces
- **THEN** cada skill queda una sola vez y las otras skills ya asignadas se conservan

### Requirement: Margen para usar las skills
La estación community MUST tener por defecto `maxTurns` 15 y `timeoutMinutes` 10, porque con 5 turnos no alcanza para cargar sus skills y responder.

#### Scenario: Valores por defecto
- **WHEN** `parseFactory` lee un archivo que no define la estación
- **THEN** `stations.community` tiene `maxTurns` 15 y `timeoutMinutes` 10

### Requirement: La pausa la levanta una persona
Integrar esta etapa MUST NOT cambiar `social:paused`; la publicación SHALL seguir en pausa hasta que se ejecute `zero social resume`.

#### Scenario: En pausa
- **WHEN** la kv `social:paused` está en `on` y corre `communityRun`
- **THEN** no se llama al agente ni al canal y el motivo menciona `zero social resume`

### Requirement: Documentación
README.md y README.es.md MUST describir en la misma estructura los carruseles, los tamaños nuevos, la auditoría, el símbolo y `zero social skills`, y SHALL dejar de decir que los carruseles quedan para próximas etapas.

#### Scenario: Ambos idiomas
- **WHEN** corre `test/docs.test.ts` y una aserción nueva sobre los dos README
- **THEN** pasa, ambos mencionan `zero social skills` y `1080x1350`, y ninguno dice `1080x1080`

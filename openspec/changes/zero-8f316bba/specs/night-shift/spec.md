# Spec Delta

## Purpose

Cuando la fábrica publique en GitHub una nota de investigación o una propuesta, las imágenes y las etiquetas HTML que cargan recursos quedarán como texto visible. Así GitHub no pedirá esas direcciones cuando alguien abra el issue, sin que haga falta un clic. Lo mismo vale para los comentarios que la fábrica deja en los issues de propuesta. Además, las fuentes de las notas se guardarán sin query string ni fragmento, y dos fuentes que queden iguales contarán como una. Esto reduce la exposición, pero no es una garantía total: un dato todavía puede viajar dentro de la ruta de una URL, y los enlaces normales siguen existiendo, aunque requieren un clic.

## ADDED Requirements

### Requirement: Las fuentes de una nota se guardan sin query string ni fragmento
`sanitizeNotes` MUST quitar el query string y el fragmento de cada fuente http(s) que conserva, y SHALL mantener intactos el esquema, el host y la ruta.

#### Scenario: Fuente con query y fragmento
- **WHEN** sanitizeNotes recibe una nota con sources ['https://example.com/a?d=secreto&x=1#parte']
- **THEN** la nota conservada tiene sources ['https://example.com/a']

#### Scenario: Fuente sin query
- **WHEN** sanitizeNotes recibe una nota con sources ['https://example.com/a/b']
- **THEN** la nota conservada tiene sources ['https://example.com/a/b']

#### Scenario: Las demás fuentes se siguen descartando
- **WHEN** sanitizeNotes recibe una nota con sources ['file:///C:/x?d=1', 'javascript:alert(1)']
- **THEN** la nota se descarta, como hoy, por no tener ninguna fuente http(s)

### Requirement: Dos fuentes que quedan iguales cuentan como una
`sanitizeNotes` MUST quitar los duplicados después de limpiar cada fuente, de modo que dos URLs que solo diferían en query string o fragmento SHALL guardarse una sola vez.

#### Scenario: Solo difieren en query y fragmento
- **WHEN** sanitizeNotes recibe una nota con sources ['https://example.com/a?x=1', 'https://example.com/a?x=2', 'https://example.com/a#b', 'https://example.com/a']
- **THEN** la nota conservada tiene sources ['https://example.com/a']

### Requirement: Las imágenes Markdown quedan inertes
Una función pura `inertMedia(text)` en `src/intake/inert-media.ts` MUST reemplazar cada aparición de `![` por `!\[`, sin interpretar el contexto, de modo que ninguna imagen Markdown en estilo directo o de referencia SHALL seguir siéndolo.

#### Scenario: Imagen directa
- **WHEN** inertMedia recibe '![x](https://sitio.example/?d=1)'
- **THEN** devuelve '!\[x](https://sitio.example/?d=1)'

#### Scenario: Imagen de referencia
- **WHEN** inertMedia recibe '![x][ref]\n\n[ref]: https://sitio.example/?d=1', y también las formas '![x][]' y '![x]'
- **THEN** ninguna salida contiene '![' y cada una contiene '!\[x]'; en la primera sigue presente el texto 'https://sitio.example/?d=1'

#### Scenario: Imagen entre varias líneas y anidada
- **WHEN** inertMedia recibe '![a\nb](https://sitio.example/x)' y '[![a](https://sitio.example/i)](https://sitio.example/l)'
- **THEN** ninguna salida contiene '![' y las URLs siguen presentes como texto

### Requirement: Las etiquetas HTML que cargan recursos quedan inertes
`inertMedia` MUST reemplazar el `<` por `&lt;` en cada etiqueta de apertura o cierre `img`, `picture`, `source`, `video`, `audio` o `iframe`, sin distinguir mayúsculas de minúsculas, con o sin atributos y aunque ocupe varias líneas; el `<` SHALL ser una entidad y no un escape con barra invertida, que dentro de un bloque HTML no tiene efecto.

#### Scenario: Cada etiqueta
- **WHEN** inertMedia recibe '<img src="https://sitio.example/?d=1">' y las variantes con picture, source, video, audio e iframe
- **THEN** ninguna salida contiene '<' seguido del nombre de la etiqueta; cada una empieza con '&lt;' y conserva la URL como texto

#### Scenario: Mayúsculas, varias líneas y otras formas
- **WHEN** inertMedia recibe '<IMG\nSRC="https://sitio.example/a">', '<iMg/src=x>', '<video' sin cierre y '</VIDEO>'
- **THEN** ninguna salida conserva un '<' que abra esas etiquetas, y la URL sigue presente

#### Scenario: Dentro de un bloque HTML
- **WHEN** inertMedia recibe '<div>\n<img src="https://sitio.example/a">\n</div>'
- **THEN** devuelve '<div>\n&lt;img src="https://sitio.example/a">\n</div>'

### Requirement: El resto del texto no cambia
`inertMedia` MUST dejar sin cambios todo el texto que no sea una de esas formas, incluidos los enlaces normales, las URLs con query string y otras etiquetas HTML, y SHALL ser idempotente.

#### Scenario: Enlaces, texto y nombres parecidos
- **WHEN** inertMedia recibe 'Ver [doc](https://a.example/?x=1) y https://b.example/?y=2, 1 < 2, <imgx> y <div>. ¡Bien!'
- **THEN** devuelve el mismo texto

#### Scenario: Aplicarla dos veces
- **WHEN** inertMedia se aplica dos veces a '![x](https://a.example) <img src=y>'
- **THEN** el resultado es igual al de aplicarla una vez

### Requirement: Los issues de notas se publican sin imágenes activas
El título y el cuerpo de los issues de investigación MUST pasar por `inertMedia` como último paso, después de quitar secretos, rutas locales y menciones, para que la limpieza previa no SHALL poder volver a formar una imagen.

#### Scenario: Imágenes en los campos de la nota
- **WHEN** syncResearchIssues publica una nota guardada con findings, serves y maturity que contienen '![x](https://sitio.example/?d=1)', '![y][r]' y '<IMG\nsrc="https://sitio.example/?d=2">'
- **THEN** el cuerpo recibido por createIssue no contiene '![' ni '<IMG', y sigue conteniendo 'https://sitio.example/?d=1' como texto

#### Scenario: La limpieza no vuelve a formar la imagen
- **WHEN** una nota guardada tiene findings `!${repo}/[x](https://sitio.example/a)` y `<${repo}/img src=https://sitio.example/b>`, donde `repo` es la ruta del repositorio de la línea, y se llama researchIssueBody
- **THEN** el cuerpo no contiene la ruta del repositorio, no contiene '![' y no contiene '<img'

#### Scenario: Título
- **WHEN** una nota tiene topic 'Tema ![x](https://sitio.example/a)' y se llama researchIssueTitle
- **THEN** el título no contiene '!['

### Requirement: Los issues de propuestas se publican sin imágenes activas
El título y el cuerpo de los issues de propuesta MUST pasar por `inertMedia` como último paso, después de quitar secretos, rutas y menciones, incluidas las rutas de archivos propuestas.

#### Scenario: Imágenes en la propuesta
- **WHEN** syncProposalIssues publica una propuesta con why '![x](https://sitio.example/?d=1)', change '<iframe src="https://sitio.example/f">', paths ['![p](https://sitio.example/p)'] y title 'T ![t](https://sitio.example/t)'
- **THEN** el título y el cuerpo recibidos por createIssue no contienen '![' ni '<iframe', y las URLs de why y change siguen como texto

#### Scenario: La URL del issue de origen no cambia
- **WHEN** proposalIssueBody recibe una propuesta con sourceIssueUrl 'https://github.com/o/r/issues/12?a=1&b=2'
- **THEN** el cuerpo sigue conteniendo esa URL completa

### Requirement: Los comentarios de propuesta se publican sin imágenes activas
Los comentarios que `syncProposalIssues` publica al contar una aprobación o un rechazo MUST pasar por `inertMedia` como último paso, también cuando incluyen el motivo del rechazo.

#### Scenario: Motivo de rechazo con imagen
- **WHEN** se rechaza una propuesta ya publicada con el motivo '![x](https://sitio.example/?d=1)\n<img\nsrc="https://sitio.example/?d=2">' y corre syncProposalIssues
- **THEN** el comentario publicado no contiene '![' ni '<img', y sigue citando ambas URLs como texto

#### Scenario: Comentario de aprobación
- **WHEN** se aprueba una propuesta ya publicada y corre syncProposalIssues
- **THEN** el comentario publicado sigue diciendo que la fábrica tomó la propuesta como trabajo, con su id

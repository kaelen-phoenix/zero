# Spec Delta

## Purpose

La imagen principal del sitio pasa a parecerse a la línea de montaje del panel: una cinta con las seis estaciones en fila (spec, build, verify, review, security, integrate) y varios trabajos avanzando entre ellas. Sigue siendo minimalista, con los mismos colores en modo claro y oscuro, y se puede leer con lector de pantalla. Los textos cuentan el nombre de otra manera: «zero in the loop» no saca a la persona del circuito, suma a zero a su lado. La persona sigue teniendo trabajo, delega más o menos según lo que sabe y la confianza que tenga, y sigue decidiendo qué se hace y dónde entra. Ese relato se conecta con los niveles L0 a L3: cuanto más delegás, más hace sola la fábrica. Se cambian el lema del hero, la descripción de la página y el texto de la sección de CI que decía que zero «hace el trabajo de las personas», en español y en inglés, y se actualizan los tests del sitio.

## ADDED Requirements

### Requirement: Figura del hero como línea de montaje
El SVG del hero (svg.line-fig) SHALL mostrar una cinta o riel con las seis estaciones en fila, en el orden spec, build, verify, review, security, integrate (cada una un <g class="node" data-station="…">), y SHALL mostrar al menos dos piezas de trabajo (elementos con class "work") en posiciones distintas de la línea. También SHALL conservar el elemento del dueño o la persona (class "owner") al lado de la línea.

#### Scenario: Estaciones en orden
- **WHEN** se extraen los g.node del SVG del hero en index.html
- **THEN** sus data-station son exactamente [spec, build, verify, review, security, integrate]

#### Scenario: Varios trabajos en la línea
- **WHEN** se cuentan los elementos con class que contiene "work" dentro del SVG
- **THEN** hay al menos 2 y no comparten la misma posición (x/cx/transform)

#### Scenario: Cinta presente
- **WHEN** se busca en el SVG un elemento de cinta o riel (class "rail" o "belt")
- **THEN** existe al menos uno

### Requirement: Figura liviana, accesible y con la paleta del sitio
El SVG del hero MUST seguir siendo inline, con role="img", aria-labelledby que apunte a un <title id="fig-title"> y a un <desc id="fig-desc"> traducibles. MUST NOT tener colores fijos (hex, rgb o nombres de color en atributos fill/stroke o style dentro del SVG): los colores salen de las variables CSS del sitio (--fg, --bg, --muted, --accent, --rail, --rule), así que funciona en claro y en oscuro. MUST NOT cargar recursos externos ni scripts (sin <script>, <image>, href ni src externos), y el sitio MUST NOT sumar librerías ni archivos de build.

#### Scenario: Accesible
- **WHEN** se lee el SVG del hero
- **THEN** tiene role="img", aria-labelledby incluye fig-title y fig-desc, y los dos elementos existen con data-i18n fig.title y fig.desc no vacíos

#### Scenario: Sin colores fijos
- **WHEN** se busca en el SVG del hero /#[0-9a-f]{3,8}\b|rgb\(|fill="(?!none)|stroke="/i
- **THEN** no hay coincidencias; los estilos de .line-fig en styles.css usan solo var(--…) o none

#### Scenario: Sin recursos externos
- **WHEN** se busca en el SVG <script, <image, href= o src=
- **THEN** no hay coincidencias

#### Scenario: Respeta reduced-motion
- **WHEN** se lee el bloque @media (prefers-reduced-motion: reduce) de styles.css
- **THEN** sigue teniendo animation: none y transition: none (test existente)

### Requirement: Descripción de la figura acorde
fig.desc SHALL describir la figura nueva en español (markup) y en inglés (EN): las seis estaciones en fila sobre una cinta, varios trabajos avanzando y la persona o el dueño al lado de la línea, decidiendo. MUST NOT decir que la persona «vuelve a entrar» ni «steps back in».

#### Scenario: Descripción en los dos idiomas
- **WHEN** se leen fig.desc del markup y EN['fig.desc']
- **THEN** las dos nombran las seis estaciones y ninguna contiene 'vuelve a entrar' ni 'step back in'/'steps back in'

### Requirement: Lema del hero: zero se suma al circuito
El lema del hero (hero.tagline) SHALL decir que zero se suma al circuito al lado de la persona, que no sale de él, y que la persona decide qué se hace y dónde entra, en español (markup) y en inglés (EN). MUST NOT decir que la fábrica ocupa el lugar del humano.

#### Scenario: Lema en español
- **WHEN** se lee el elemento data-i18n="hero.tagline" de index.html
- **THEN** no contiene 'ocupa el lugar' ni 'vuelve a entrar', y contiene 'zero' y 'persona'

#### Scenario: Lema en inglés
- **WHEN** se lee EN['hero.tagline']
- **THEN** no contiene "place" ni 'step back in', y contiene 'zero' y 'person' o 'people'

#### Scenario: Título intacto
- **WHEN** se lee la sección hero
- **THEN** sigue conteniendo '<h1>zero in the loop</h1>'

### Requirement: Relato de la delegación
El sitio SHALL contar, en español y en inglés, que la persona no se queda sin trabajo: tiene muchas tareas y, según lo que sabe y la confianza que tenga, delega más o menos en la fábrica, y sigue decidiendo qué se hace y dónde entra ella. El texto MUST estar bajo una clave traducible nueva en la sinopsis (por ejemplo synopsis.loop) con su versión en EN.

#### Scenario: Párrafo en la sinopsis
- **WHEN** se busca en la sección synopsis un elemento data-i18n="synopsis.loop"
- **THEN** existe, no está vacío, menciona 'delega' (o 'delegás') y 'confianza', y EN['synopsis.loop'] menciona 'delegate' y 'trust'

### Requirement: Delegación y niveles de autonomía
La sección de autonomía SHALL tener, antes de la tabla de niveles, un párrafo traducible (autonomy.intro) que conecte la delegación con L0 a L3: cuanto más delegás, más hace sola la fábrica, y en L0 la persona aprueba más que en L3. MUST estar en español (markup) y en inglés (EN).

#### Scenario: Intro antes de la tabla
- **WHEN** se lee la sección autonomy
- **THEN** el elemento data-i18n="autonomy.intro" aparece antes de <table> y contiene 'L0' y 'L3'; EN['autonomy.intro'] también contiene 'L0' y 'L3'

### Requirement: Sin textos de reemplazo de personas
Ningún texto del sitio, ni en el markup en español ni en EN, MUST decir que zero hace el trabajo de las personas o que ocupa su lugar. La intro de CI (ci.intro) SHALL describir lo que zero toma cuando se lo delegan (especificar, programar, probar en local, revisar, integrar) y seguir diciendo que no reemplaza al CI ni a las herramientas de calidad. La descripción de la página (meta description y og:description) SHALL quedar en el mismo tono, sin 'vuelve a entrar'.

#### Scenario: Frases prohibidas
- **WHEN** se busca en index.html y en los valores de EN (sin distinguir mayúsculas)
- **THEN** no aparecen 'lugar del humano', 'ocupa el lugar', 'trabajo de las personas', "human's place", 'takes the place', 'work of the people'

#### Scenario: CI sigue diciendo que no reemplaza
- **WHEN** se corre el test existente de la sección ci
- **THEN** sigue pasando ('no reemplaza', 'análisis estático', 'does not replace', 'static analysis', etc.)

#### Scenario: Meta en el mismo tono
- **WHEN** se leen meta name=description y og:description de index.html
- **THEN** ninguna contiene 'vuelve a entrar'

### Requirement: Traducción completa
Toda clave data-i18n nueva o cambiada MUST tener su entrada en EN en site/main.js, y EN MUST NOT tener claves que sobren. Cambiar a inglés y volver a español SHALL restaurar los textos del markup.

#### Scenario: Claves completas
- **WHEN** se corren los tests existentes 'cada clave traducible tiene su versión en inglés' y 'cambia a inglés y vuelve a español'
- **THEN** pasan con las claves nuevas (synopsis.loop, autonomy.intro) incluidas

#### Scenario: Texto visible traducible
- **WHEN** se corre el test 'todo el texto visible está bajo una clave traducible'
- **THEN** pasa: las etiquetas nuevas del SVG o son nombres de estación permitidos por el test o están bajo data-i18n

# Spec Delta

## ADDED Requirements

### Requirement: Persona de la figura como ícono de cabeza y hombros
En el SVG del hero (svg.line-fig) de site/index.html, la persona SHALL ser un grupo <g class="owner"> con dos piezas: una cabeza (un <circle>) y unos hombros (un <path>). Las dos MUST quedar centradas sobre el punto donde nacen los arcos punteados (x 360, y 46). Ya no SHALL haber un <circle class="owner"> suelto como única marca de la persona. El ícono MUST NOT llevar atributos fill o stroke con color: su color sale de styles.css con var(--accent).

#### Scenario: Ícono con cabeza y hombros
- **WHEN** se extrae del SVG del hero el elemento con class "owner"
- **THEN** es un <g class="owner"> que contiene al menos un <circle> y al menos un <path>, y no existe ningún <circle class="owner">

#### Scenario: Color de acento desde CSS
- **WHEN** se leen en site/styles.css las reglas de .line-fig que apuntan a .owner o a sus hijos
- **THEN** alguna fija fill o stroke a var(--accent), y ninguna usa colores fijos (solo var(--…) o none)

### Requirement: Pulso suave conservado
El ícono de la persona MUST conservar una animación de pulso (la animación pulse) con transform-origin en 360px 46px. Ese pulso MUST seguir apagándose con prefers-reduced-motion. La escala máxima del pulso MUST NOT pasar de 1.35.

#### Scenario: Pulso presente
- **WHEN** se lee en styles.css la regla de .line-fig .owner
- **THEN** contiene animation con pulse y transform-origin: 360px 46px

#### Scenario: Escala acotada
- **WHEN** se lee el @keyframes pulse de styles.css
- **THEN** todos sus scale(n) cumplen n <= 1.35

#### Scenario: Reduced motion
- **WHEN** se lee el bloque @media (prefers-reduced-motion: reduce)
- **THEN** sigue teniendo animation: none y transition: none

### Requirement: Rótulo «vos» más grande y con más peso
El rótulo de la persona (<text class="owner-label" data-i18n="fig.owner">) MUST seguir diciendo «vos» en el markup y «you» en EN['fig.owner'] de site/main.js. En styles.css, la regla .line-fig .owner-label SHALL fijar font-size de al menos 15px y font-weight de al menos 600, por encima de los 12px del resto de los textos de la figura. Dentro de @media (max-width: 40rem), SHALL fijar para .line-fig .owner-label un font-size de al menos 20px, para que se lea en celular. El rótulo MUST NOT superponerse con el ícono: su y MUST quedar por encima de la parte superior de la cabeza.

#### Scenario: Tamaño y peso en escritorio
- **WHEN** se lee la regla .line-fig .owner-label de styles.css fuera de cualquier @media
- **THEN** tiene font-size >= 15px, font-weight >= 600 y fill: var(--accent)

#### Scenario: Tamaño en celular
- **WHEN** se lee el bloque @media (max-width: 40rem) de styles.css
- **THEN** contiene una regla .line-fig .owner-label con font-size >= 20px

#### Scenario: Textos en los dos idiomas
- **WHEN** se lee el <text> con data-i18n="fig.owner" y EN['fig.owner']
- **THEN** el markup dice «vos» con class owner-label (primer atributo) y EN dice «you»

#### Scenario: Sin superposición
- **WHEN** se compara el atributo y del rótulo con cy - r del <circle> de la cabeza dentro de g.owner
- **THEN** y del rótulo < cy - r

# Proposal

## Why

Cuando la fábrica publique en GitHub una nota de investigación o una propuesta, las imágenes y las etiquetas HTML que cargan recursos quedarán como texto visible. Así GitHub no pedirá esas direcciones cuando alguien abra el issue, sin que haga falta un clic. Lo mismo vale para los comentarios que la fábrica deja en los issues de propuesta. Además, las fuentes de las notas se guardarán sin query string ni fragmento, y dos fuentes que queden iguales contarán como una. Esto reduce la exposición, pero no es una garantía total: un dato todavía puede viajar dentro de la ruta de una URL, y los enlaces normales siguen existiendo, aunque requieren un clic.

## What Changes

- Issues de notas y propuestas sin imágenes remotas, y fuentes sin query string
- Supuesto: Sin probar: la premisa de que GitHub pediría la imagen sin un clic viene de la solicitud y no se comprobó contra GitHub. Los tests verifican el texto publicado, no cómo lo muestra GitHub.
- Supuesto: Supuesto: se eligió escapar (`!\[`, `&lt;`) en lugar de armar un bloque de código, porque no depende de reconocer el Markdown y el modelo no puede salir del escape con comillas invertidas. GitHub puede convertir en enlace la URL que queda como texto; requiere un clic, dentro del límite aceptado por la solicitud.
- Supuesto: Costo aceptado: al no mirar el contexto, un `![` o `<img` que ya estaba dentro de un bloque de código se verá con la barra o como `&lt;img`. También en títulos se vería `&lt;`.
- Supuesto: Las fuentes que identifican la página por su query string (por ejemplo `watch?v=...`) quedarán sin esa parte y pueden perder su destino. La solicitud lo pide así; se avisa a la estación de research para que prefiera otras URLs.
- Supuesto: Las notas ya guardadas conservan sus fuentes con query, porque `sanitizeNotes` actúa solo al guardar: las que aún no tengan issue se publican con esa URL como texto, y no se migra nada. También siguen sin cambios las URLs con query dentro de `findings`.
- Supuesto: Los issues y comentarios ya publicados no se reescriben.
- Supuesto: Límite conocido de la solicitud: no impide que un dato viaje en la ruta de una URL ni evita los enlaces normales. Reduce la exposición, no da una garantía total.

## Capabilities

### New Capabilities
- `night-shift`: Issues de notas y propuestas sin imágenes remotas, y fuentes sin query string

### Modified Capabilities

## Impact

Generado por zero para el trabajo 8f316bba.

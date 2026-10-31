# Proposal

## Why

Todo lo que hace la fábrica va a llevar la firma de zero in the loop. Cada commit (en todas las líneas, incluidos los de especificación, los de cada intento y el merge de integración) termina con la línea 'Built-by: zero in the loop <https://zerointheloop.com>'. Los pull requests, los issues que abre la fábrica (propuestas e investigación) y sus comentarios terminan con '— Hecho con [zero in the loop](https://zerointheloop.com)'. La marca oculta con la que la fábrica reconoce sus propios comentarios sigue igual, así que nunca se va a contestar a sí misma. La firma se configura en zero.factory.yaml con `signature` (con el texto del pie y el del trailer), o se apaga con `signature: off`. Se puede poner para toda la fábrica y cada línea puede tener la suya. Si no ponés nada, queda encendida con esos textos. El sitio va a decir en el pie 'Este sitio lo construyó zero in the loop' en español y 'This site was built by zero in the loop' en inglés. Los dos README explican la opción nueva.

Pedido original: "Firma de zero in the loop en todo lo que construye la fábrica. - Commits: cada commit que hace la fábrica (en todas las líneas) lleva al final el trailer 'Built-by: zero in the loop <https://zerointheloop.com>'. - Pull requests e issues que abre o comenta la fábrica: terminan con una línea de firma, por ejemplo '— Hecho con [zero in the loop](https://zerointheloop.com)' (además de la marca de la fábrica que ya usan para reconocerse; no romper esa detección). - Configurable en zero.factory.yaml (signature, con el texto y un off para apagarla), global y por línea; por defecto encendida con ese texto. - Sitio (site/): en el pie, 'Este sitio lo construyó zero in the loop' / 'This site was built by zero in the loop', en los dos idiomas. - README (inglés y español) actualizado."

## What Changes

- zero in the loop signature on everything the factory builds
- Supuesto: Assumption: one `signature` key holds both texts (`text` for PRs, issues and comments; `trailer` for commits), and a line's own `signature` fully replaces the global one rather than merging field by field.
- Supuesto: Signing is done in the daemon's real adapters through the signedIssues/signedMerges wrappers, so the existing fake-based tests with exact comment bodies stay valid. The flip side is that the end-to-end wiring to real GitHub is covered only by the spy on the api factory, not by a GitHub call.
- Supuesto: Comments are posted as the owner. The reply station's thread (comments.ts) strips FACTORY_MARK but not the signature, so the signature text shows up in the thread the reply agent reads. That is harmless, but it is noise.
- Supuesto: Proposal and research issue bodies now end with the signature. Any code that parses those bodies back would have to tolerate it. Today nothing does, as far as the read went.
- Supuesto: Trailer validation is a simple regex. `git interpret-trailers` only recognises the trailer if it is the last paragraph, so withTrailer must always put a blank line before it.
- Supuesto: The PR body already ends with 'Generado por zero · trabajo … · costo'. The signature is added after it rather than replacing it.

## Capabilities

### New Capabilities
- `factory-signature`: zero in the loop signature on everything the factory builds

### Modified Capabilities

## Impact

Generado por zero para el trabajo 54301305.

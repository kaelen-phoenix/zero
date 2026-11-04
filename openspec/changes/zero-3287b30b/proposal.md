# Proposal

## Why

Vas a tener una estación nueva, `community`, que con la fábrica libre mira lo que se entregó y arma borradores. Zero los filtra, les pone la firma de la fábrica, genera la imagen y publica solo en la cuenta de Instagram, sin esperar aprobación: hasta 1 publicación y 3 historias por día, sin repetir temas. Solo habla de la línea zero, salvo que habilites otras, y queda apagada mientras no haya token. Con `zero social status`, `post-now`, `pause` y `resume` ves y controlás lo que hace, y los dos README traen la guía para crear la app de Meta y conectar la cuenta. Quedan para las próximas etapas: la vista en el panel, los carruseles, las capturas del panel, el resumen semanal, la opción de aprobar antes de publicar (`propose`) y la renovación del token.

Pedido original: "Agente community manager: que la fábrica maneje la cuenta de Instagram de zero y publique sola lo que va haciendo. Qué es: - Una estación nueva `community` (agents/community.md), de solo lectura: mira lo que la fábrica entregó (trabajos, solicitudes de cambio, notas de investigación, informe) y arma borradores de publicaciones: texto, tipo (publicación, carrusel, historia) y qué imagen usar. Quien publica es zero, nunca el agente. - Publica directo, sin esperar aprobación: autonomía `auto` por defecto para esta cuenta (dejar también `propose` como opción, con el mismo mecanismo que las propuestas del turno nocturno, para quien lo quiera). Límite configurable de publicaciones por día (por defecto 1 publicación y hasta 3 historias) y cuenta contra el mismo presupuesto que el turno nocturno (limits.usdPerNight); corre solo con la fábrica libre, como scout y research. - Ritmo sugerido: historia cuando se entrega algo visible, publicación o carrusel cuando hay una función nueva, y un resumen semanal. Sin repetir temas (llevar registro de lo publicado). - Se nota que es una IA: cada texto lleva la firma de la fábrica (reusar signature, por ejemplo "Publicado por la fábrica zero (IA) · zerointheloop.com"). - Imágenes generadas por zero, no por el modelo: tarjetas renderizadas con el estilo del sitio (colores, tipografía) y capturas del panel o de la vista /line, en formato cuadrado 1080x1080 y vertical 1080x1920 para historias. Los videos quedan para otra etapa. - Antes de publicar, zero filtra el texto y la imagen igual que los issues: sin secretos, sin rutas locales, con @menciones rotas; y solo habla de líneas habilitadas: por defecto únicamente la línea zero (opción por línea para habilitar otras; las de clientes apagadas por defecto). - Canal con adaptador (src/social/ o similar), primero Instagram con la "Instagram API con login de Instagram" (sin página de Facebook), contenido publicado por URL pública (resolver dónde se alojan las imágenes; por ejemplo subirlas como asset de una release de GitHub o al sitio). El token en el llavero del sistema (SecretStore), nunca en archivos ni logs. Preparado para sumar después LinkedIn, X o Bluesky. - Comando `zero social status|post-now|pause` y una vista en el panel con lo publicado (link a cada publicación) y lo próximo. - Configuración en zero.factory.yaml (`social`), apagada si no hay token. Lo que ve la persona, en español con voseo. - Empieza como un change de OpenSpec; tests con un canal falso y renderizado de imágenes verificado; documentarlo en README.md y README.es.md, incluida la guía para crear la app de Meta y conectar la cuenta."

## What Changes

- Community manager: la fábrica publica sola en Instagram (primera etapa)
- Supuesto: Alcance: el pedido no entra en una corrida. Esta etapa publica `post` y `story` desde la terminal; la vista del panel, carrusel, capturas, resumen semanal, `propose` y otros canales quedan en followUps.
- Supuesto: Los datos de la API de Instagram (endpoints, permisos, solo JPEG, historias sin texto, token de 60 días) salen de lo que conozco, porque esta corrida no pudo consultar la web. El adaptador se prueba con un `fetch` falso, así que la primera publicación real es la verdadera comprobación.
- Supuesto: Supuesto: Instagram acepta las URLs de assets de release de GitHub, que redirigen a otro dominio. Si las rechaza, se cambia solo el adaptador de alojamiento.
- Supuesto: Supuesto: el repositorio de imágenes es público; `kaelen-phoenix/zero` parece serlo porque el README lo clona, pero no pude confirmarlo. Si es privado, la publicación queda `failed` con el motivo, sin subir nada.
- Supuesto: Dependencias nuevas: `@resvg/resvg-js` (binario nativo), `jpeg-js` y una fuente TTF. No pude comprobar versiones ni licencias en npm; build debe confirmar que sean de licencia libre y funcionen en Windows, macOS, Linux y dentro de la caja.
- Supuesto: Supuesto: la firma de la pasada es `social.signature` y no `signature`, porque el texto por defecto de `signature` usa Markdown, que Instagram no muestra, y puede estar en `off`, mientras que el pedido exige que siempre se note que es una IA. Se reutiliza `signText`.
- Supuesto: Agregado al pedido: `zero social resume`, porque sin él la pausa no se podría deshacer desde la terminal.
- Supuesto: Agregado al pedido: un borrador con un secreto o una ruta se descarta en vez de publicarse con `[REDACTED]` o `(ruta local)`, porque nadie lo revisa antes de salir. Las notas de negocio tampoco llegan al agente, para no publicar sin querer precios o estrategia.
- Supuesto: Publicar es hacia afuera y sin revisión: el contenido nace de títulos de trabajos y notas de la web, que pueden traer texto malicioso. El filtro no juzga el tono ni detecta afirmaciones falsas; `zero social pause` es el freno.
- Supuesto: El filtro es de mejor esfuerzo, como `scrub` y `scrubLocal`: un dato privado escrito en lenguaje común (por ejemplo, el nombre de un cliente) no se detecta. Por eso las líneas de clientes quedan apagadas por defecto.
- Supuesto: Sin renovación del token, la cuenta deja de publicar a los 60 días aproximadamente; se ve como `failed` en `zero social status` y la guía lo explica.
- Supuesto: Crear una release en el repositorio puede avisar a quienes lo siguen o disparar flujos de trabajo con el evento `release`; hoy `.github/workflows/` solo tiene `ci.yml`, que build debe revisar.
- Supuesto: Agregar `community` a `AGENT_STATIONS` también la suma a los motores que `src/budget.ts` y `src/box/credentials.ts` tienen en cuenta, igual que scout y research.

## Capabilities

### New Capabilities
- `social-publishing`: Community manager: la fábrica publica sola en Instagram (primera etapa)

### Modified Capabilities

## Impact

Generado por zero para el trabajo 3287b30b.

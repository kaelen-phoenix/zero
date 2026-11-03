# Proposal

## Why

En zerointheloop.com, la explicación del nivel de autonomía `auto` deja de decir que el trabajo "se integra o despliega solo", porque zero no despliega nada: los despliegues los hace después la plataforma (Vercel, GitHub Actions, etc.). El texto nuevo, en español: "Se construye y se integra sola, según la línea, sin preguntar (en líneas de pull request con autoMerge, también se funde)." La versión en inglés dice lo mismo. Se agrega un test del sitio para que la promesa de despliegue no vuelva a aparecer en ninguno de los dos idiomas.

Pedido original: "Sitio: el nivel auto no promete despliegues que zero no hace Por qué: site/index.html:119 dice que en `auto` el trabajo "se integra o despliega sola", y site/main.js:51 dice lo mismo en inglés ("integrated or deployed on its own"). El townhall registra que zero no tiene código de despliegue: los despliegues los hace la plataforma después del merge. El texto le promete al visitante algo que zero no hace. Qué cambiaría: Cambiar el texto de autonomy.auto en site/index.html a algo como "Se construye y se integra sola, según la línea, sin preguntar (en líneas de pull request con autoMerge, también se funde)." Cambiar el valor EN en site/main.js con el mismo sentido. Se mantiene la misma clave data-i18n, así test/site.test.ts sigue cuadrando."

## What Changes

- Sitio: el nivel auto no promete despliegues
- Supuesto: README.md:280 and README.es.md:280 make the same 'integrated or deployed' claim about `auto`; the request only covers the site, so the README is left for a follow-up and the site and README will briefly disagree.
- Supuesto: 'autoMerge' as plain text inside the data-i18n element is fine for the visible-text allowlist test, because that test strips whole data-i18n elements. Wrapping it in <code> would also be safe, but the owner's suggested wording uses plain text.

## Capabilities

### New Capabilities
- `project-site`: Sitio: el nivel auto no promete despliegues

### Modified Capabilities

## Impact

Generado por zero para el trabajo ad4eff67.

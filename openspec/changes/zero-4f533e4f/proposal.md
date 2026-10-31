# Proposal

## Why

Ahora podés marcar una skill de investigación como "de negocio" en la configuración de la línea. Por ejemplo, para investigar-monetizacion: `lines[].stations.research.business: [investigar-monetizacion]`. Las notas de esa skill quedan marcadas como de negocio. Toda propuesta que scout saque de ellas espera tu decisión, aunque la línea esté en `auto` o `build`. Además, el turno nocturno nunca cambia solo la licencia ni agrega precios, cobros, pagos o textos legales. Si scout marca así una propuesta, o si la propuesta o el trabajo tocan LICENSE, archivos de licencia o textos legales (términos, privacidad, EULA, carpeta legal), te espera. Si el trabajo ya se construyó, no se integra sin vos. Cuando una línea tiene varias skills de investigación, research ahora escribe hasta `research.perLinePerDay` notas por cada skill, y no por línea. Si el presupuesto no alcanza para todas, se turnan: primero la que hace más tiempo que no investiga. Así la de negocio no le quita el día a la técnica. El informe y la pestaña Investigación del panel muestran por separado las notas de negocio y las técnicas. El README explica todo esto.

Pedido original: "Investigación de negocio: que nunca se construya sola, y una nota por skill. La línea zero tiene ahora dos skills de investigación: investigar-zero (agentes, skills, tecnología) e investigar-monetizacion (cómo monetizar zero: productos comparables, precios, licencias, reglas de los proveedores de IA, Argentina). - Notas de negocio: una skill de investigación puede declararse de negocio (por ejemplo kind: business en su configuración de la estación, o en el frontmatter de la skill; elegir lo más simple y documentarlo). Sus notas quedan marcadas como de negocio, y toda propuesta que scout haga a partir de ellas espera siempre al dueño, aunque la línea esté en auto o build, igual que hoy las de terceros. Además, ninguna propuesta autónoma puede cambiar la licencia, agregar precios, cobros, pagos ni textos legales: si scout la marca así o toca LICENSE, archivos de licencia o textos legales, espera al dueño. - Una nota por skill: con varias skills de investigación en una línea, research escribe hasta research.perLinePerDay notas por cada skill (no por línea), turnándose si no alcanza el cupo, así la de negocio no le quita el día a la técnica. - El briefing y la pestaña Investigación del panel separan las notas de negocio de las técnicas. - README (en los idiomas en que esté) actualizado."

## What Changes

- Investigación de negocio: siempre espera al dueño, y una nota por skill
- Supuesto: Assumption: business is declared in the factory file as `lines[].stations.research.business: [skill]`, not in the skill's frontmatter. This is the simplest option: there is no SKILL.md parsing for a kind, and it lives next to the skills list. Names not in `skills` are ignored instead of rejected, so `zero skill remove` keeps working.
- Supuesto: `zero skill add/remove` rewrite only `skills`. Removing a business skill leaves a stale name in `business`, which is harmless because it is ignored.
- Supuesto: Each research run still stages all of the line's research skills; only the prompt narrows the run to one skill. An agent could still follow the other skill.
- Supuesto: The legal-path detection is a heuristic. A license change made only through package.json's `license` field, or prices added to ordinary source files, rely on scout's `commercial` flag (manifests are only caught for research-born proposals).
- Supuesto: Per-skill research multiplies research calls by the number of skills, so it uses more of `limits.usdPerNight`. Rotation keeps it fair but not cheaper.
- Supuesto: The per-line kv key `research:<line>` is abandoned. On the first day after the upgrade, a line already researched that day may research again per skill, within the day's per-skill note counts (old notes have no skill).

## Capabilities

### New Capabilities
- `night-shift`: Investigación de negocio: siempre espera al dueño, y una nota por skill

### Modified Capabilities

## Impact

Generado por zero para el trabajo 4f533e4f.

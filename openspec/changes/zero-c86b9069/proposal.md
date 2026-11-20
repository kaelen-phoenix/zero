# Proposal

## Why

Vas a tener un catálogo de agentes que podés sumar a tus líneas. Lo ves con `zero agent catalog` y en la página Agentes del panel. Cada entrada dice el nombre, qué hace, si revisa (review) o escribe (build), de qué repositorio viene, su licencia, en qué motores funciona y cuándo se revisó. Desde ahí pedís sumarlo a una línea. La fábrica te muestra exactamente las instrucciones que va a escribir, espera tu confirmación y lo agrega por el mismo camino que `zero agent add`. Si copia texto de un tercero, deja el crédito en THIRD-PARTY-NOTICES.md. También podés rechazar una entrada para que no vuelva. Además se suma un reclutador. En el turno nocturno, con la fábrica libre y dentro de `limits.usdPerNight`, busca en la web agentes públicos con licencia libre (MIT, Apache o BSD) que cubran huecos reales de tus líneas, según las trabas y los rechazos recientes. La fábrica revisa cada hallazgo antes de guardarlo. Descarta lo que tiene una licencia que no sirve, lo que trae texto que intenta dar órdenes, lo que pide credenciales, red o instalaciones, y lo que ya está en el catálogo o rechazaste. Lo que encaja con una línea queda como propuesta de agregar agente y espera tu ok, aunque la línea esté en modo auto. Nada de lo que encuentra se ejecuta ni se instala. El reclutador va en el núcleo y no como un paquete aparte. Necesita escribir en el catálogo, leer los rechazos y las trabas y compartir las reglas y el tope de gasto del turno nocturno. La interfaz de paquetes no ofrece nada de eso, y abrirla para un tercero haría más débil la garantía de que nada se suma sin tu ok.

## What Changes

- Catálogo de agentes y estación reclutadora nocturna
- Supuesto: No web access at spec time, so nothing about the starting points was checked: not their licenses, their contents or whether they still exist. The catalog ships empty, and the starting points only appear in the recruiter's prompt as unverified.
- Supuesto: The recruiter has the research station's tools (on Claude: WebSearch, no WebFetch), so it may not be able to read a third-party agent's full instructions. Its `instructions` field may be a partial excerpt, and the confirmation step shows exactly what would be written.
- Supuesto: Pattern screening of third-party text is a heuristic. It can miss a clever injection or reject harmless text. The required confirmation, which shows the full text, is the final safeguard.
- Supuesto: Assumption: an 'add agent' proposal lives in the catalog as status `proposed`, not in the proposals table. The proposals table always turns approval into a job, and adding an agent edits the factory file, which no job can do. So these proposals do not appear in the Propuestas tab, the briefing or the proposal issues.
- Supuesto: Assumption: adding from the catalog writes `.zero/agents/<name>.md` and THIRD-PARTY-NOTICES.md uncommitted in the line's repository, as `zero agent add` already does with its template.
- Supuesto: Assumption: the recruiter is on by default, once every 7 days, gated like research and counted in limits.usdPerNight. Setting `recruit: off` turns it off.
- Supuesto: Adding a fixed station named `recruit` makes that name reserved, so an existing custom agent called `recruit` would become invalid in the config.
- Supuesto: The full suite already runs close to verify's 20-minute limit (townhall). New tests should stay small and use fake agents.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Catálogo de agentes y estación reclutadora nocturna

## Impact

Generado por zero para el trabajo c86b9069.

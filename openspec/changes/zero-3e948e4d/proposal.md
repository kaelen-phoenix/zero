# Proposal

## Why

El README de GitHub pasa a estar en inglés (README.md). El texto en español actual pasa a README.es.md. Los dos tienen el mismo contenido y la misma estructura, y arriba de todo un enlace para cambiar de idioma (English · Español). Los comandos, la configuración y los ejemplos quedan iguales en los dos. Se saca el lema viejo de Kaelen Global Defence y en su lugar va el lema del sitio: zero in the loop, la fábrica ocupa el lugar del humano en el circuito y el dueño decide dónde vuelve a entrar. No queda ninguna mención a Kaelen en el README, en docs/, en AGENTS.md ni en el contexto de OpenSpec. También se corrige lo desactualizado: - el turno nocturno deja de figurar como "hacia dónde va"; - las skills por agente y por línea salen de "próximas etapas", porque ya están hechas; - la lista de herramientas del chat queda completa; - "Empezar" incluye el git clone. El sitio enlaza al README en español cuando el visitante lo ve en español y al README en inglés cuando lo ve en inglés. AGENTS.md agrega la regla: el README se mantiene en los dos idiomas y todo cambio de la documentación se hace en los dos. Lo que zero le muestra al dueño (CLI, panel, chat) sigue en español.

Pedido original: "Documentación: README en inglés primero y en español después, y sacar el lema viejo. - Sacar la línea 'Kaelen Global Defence: Autonomous agent network. Continuous execution. Zero human intervention required.' del README: es un resto del arranque del proyecto, no menciona lo que zero es hoy y contradice la idea del proyecto (el dueño decide dónde entra el humano). Reemplazarla por el lema del sitio: zero in the loop, la fábrica ocupa el lugar del humano en el circuito y el dueño decide dónde vuelve a entrar. Que no quede ninguna mención a Kaelen en la documentación. - README.md pasa a estar en inglés (es lo primero que se ve en GitHub) y el texto en español actual pasa a README.es.md, los dos con el mismo contenido y la misma estructura, y un enlace arriba de todo para cambiar de idioma (English · Español). Traducir con cuidado, sin perder nada: comandos, configuración y ejemplos iguales en los dos. - Revisar la documentación entera (README, docs/, AGENTS.md) buscando lo que divaga, lo desactualizado o lo que ya no es cierto (por ejemplo, secciones 'en camino' que ya están hechas, como el turno nocturno) y corregirlo en los dos idiomas. - El sitio (site/) enlaza al README del idioma que esté viendo el visitante. - Actualizar la regla de AGENTS.md: el README se mantiene en inglés (README.md) y en español (README.es.md), y todo cambio de la documentación se hace en los dos. Lo que zero le muestra al dueño (CLI, panel, chat) sigue en español."

## What Changes

- README bilingüe (inglés y español), lema nuevo y documentación al día
- Supuesto: Assumption: 'no Kaelen mention in the documentation' covers README*, docs/, AGENTS.md and openspec/config.yaml (project context with the old motto). It does not cover the agents/*.md headers ('# Station: X — Kaelen zero'): those are agent instructions, and test/agents.test.ts, test/panel-guide.test.ts and earlier specs assert them. The GitHub org URL github.com/kaelen-phoenix/zero and package.json's @kaelen/zero also stay, because they are real identifiers, not prose.
- Supuesto: The ADR is a dated historical record. Editing its context paragraph changes the history slightly; the edit should keep the meaning (what zero is) and drop only the old motto and the Kaelen name.
- Supuesto: The only other docs (ADR, revision-linea-produccion.md) stay in Spanish. The bilingual rule applies to the README, since the request only asks for the README in two languages.
- Supuesto: Comparing sh/yaml blocks after removing quoted strings and comments lets the example request texts and comments be translated. Identifiers (line name 'tienda', paths, keys) must stay identical, so the English README keeps the Spanish example line name 'tienda'.
- Supuesto: The English 'Docs' link uses #readme, which GitHub resolves to README.md. If GitHub changes that anchor, the link still opens the repository page.

## Capabilities

### New Capabilities
- `project-docs`: README bilingüe (inglés y español), lema nuevo y documentación al día

### Modified Capabilities

## Impact

Generado por zero para el trabajo 3e948e4d.

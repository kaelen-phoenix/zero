# Tasks

## 1. Implementación

- [ ] 1.1 En src/line/finish.ts, junto a describeDelivery, agregar STOPPED_BY_YOU = "Lo detuviste vos.", rejectedByYou(note) y reasonForOthers(reason), que reescribe el comienzo "Lo detuviste vos" y "Lo rechazaste vos" a tercera persona y deja igual cualquier otro motivo.
- [ ] 1.2 Usar esas funciones en src/app.ts:153 y :470, src/daemon.ts:237, src/line/runner.ts:157 y src/line/answer.ts:41 (conservando el sufijo kept).
- [ ] 1.3 Aplicar reasonForOthers en src/intake/github.ts:162 (cuerpo: `El trabajo <id> se detuvo. <motivo>`, con "Lo detuvo la persona responsable." si no hay motivo y sin punto doble), src/intake/comments.ts:40 y :119, y en el cuerpo de townhall de src/line/finish.ts:88.
- [ ] 1.4 Reescribir src/townhall/briefing.ts:103 ("## Te necesita"), src/intake/proposals.ts:50, :80, :83 y :101, src/report.ts:113 y :117, y src/line/reverts.ts:96 según los requisitos.
- [ ] 1.5 Cambiar el sitio: site/index.html líneas 19 (og:image:alt, tercera persona), 57 (fig.desc con "vos" y "decidís"), 73 (rótulo "vos") y 148 ("se detecta y espera tu decisión"); site/main.js líneas 18, 19 ("you") y 66 con el equivalente en inglés. Las clases CSS y la clave fig.owner no cambian; site/og.png no tiene texto y no se toca.
- [ ] 1.6 Reescribir en frases naturales README.md y README.es.md líneas 5, 11, 162, 308, 334, 467, 490 y 492, más README.es.md:337 (`Reverts owner/repo#N`, igual que en inglés), sin tocar `commitAuthor: owner` ni la estructura.
- [ ] 1.7 Reescribir docs/adr/0001-construir-vs-adoptar.md (líneas 8, 124, 133, 145, 146, 181, 185) y docs/revision-linea-produccion.md (líneas 5, 66) con "la persona responsable" o "quien está a cargo", cuidando frases como "con un solo dueño".
- [ ] 1.8 Agregar una línea breve a agents/spec.md, agents/scout.md, agents/research.md y agents/reply.md con la regla de traducción de "owner", sin escribir la palabra prohibida, porque el panel muestra estas instrucciones en /agents.
- [ ] 1.9 Agregar a Conventions de AGENTS.md la regla: lo que ve una persona dice vos/you y, en tercera persona, la persona responsable/quien está a cargo/the person in charge; lo interno puede decir owner.
- [ ] 1.10 Actualizar test/runner.test.ts:99 y :293, test/report.test.ts:158 y :160, test/docs.test.ts:77-78 y test/proposal-issues.test.ts:188 (ahora "La persona responsable aprobó").
- [ ] 1.11 Agregar pruebas nuevas: un barrido (por ejemplo test/wording.test.ts) para los requisitos de palabra prohibida y de instrucciones de agentes, más reasonForOthers, el comentario de issue de un trabajo detenido, el encabezado del briefing y el rótulo del hero.
- [ ] 1.12 Ejecutar npm run typecheck, npm test y npx openspec validate --all.

# Tasks

## 1. Implementación

- [ ] 1.1 Create the OpenSpec change openspec/changes/zero-0187dca2/ (proposal.md, tasks.md, specs/project-site/spec.md) with ADDED requirements 'Principio del tiempo liberado en los README' and 'Principio del tiempo liberado en el sitio'. Run `npx openspec validate --all`.
- [ ] 1.2 README.md: in '## How it works', add a bullet to the principles list, between '**Stations with a contract.**' and '**Engine-agnostic.**' and in the same bold-lead style, for example: "- **Time for people.** zero automates software development with AI, freeing people's time to focus on strategy, creativity, oversight and professional collaboration."
- [ ] 1.3 README.es.md: add the matching bullet in the same position in '## Cómo funciona': "- **Tiempo para las personas.** zero automatiza el desarrollo de software con IA, liberando tiempo para que las personas se enfoquen en estrategia, creatividad, supervisión y colaboración profesional."
- [ ] 1.4 site/index.html: in <section id="synopsis">, right after the synopsis.loop paragraph, add <p data-i18n="synopsis.time"> with the Spanish principle.
- [ ] 1.5 site/main.js: add "synopsis.time" to the EN dictionary, after "synopsis.loop", with the English principle.
- [ ] 1.6 test/site.test.ts: add a test in 'sitio del proyecto: contenido'. It checks that synopsis.time is in the synopsis section after synopsis.loop, with the exact Spanish text, and that EN['synopsis.time'] equals the English text.
- [ ] 1.7 test/docs.test.ts: add a test that the 'How it works' / 'Cómo funciona' section of each README has a bullet line with the exact principle in its language.
- [ ] 1.8 Run npm run typecheck and npm test.

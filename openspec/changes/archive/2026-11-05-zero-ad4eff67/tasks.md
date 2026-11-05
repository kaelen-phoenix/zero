# Tasks

## 1. Implementación

- [ ] 1.1 Create openspec/changes/zero-ad4eff67/ with proposal.md, tasks.md and specs/project-site/spec.md (ADDED requirement in the same format as openspec/changes/zero-3b42aa28), then run `npx openspec validate --all`.
- [ ] 1.2 In site/index.html (~line 120), replace the text of `<dd data-i18n="autonomy.auto">` with: 'Se construye y se integra sola, según la línea, sin preguntar (en líneas de pull request con autoMerge, también se funde).' Keep the data-i18n key; keep it plain text (no new tags).
- [ ] 1.3 In site/main.js (~line 52), replace EN['autonomy.auto'] with an English equivalent, e.g. 'It is built and integrated on its own, as the line says, without asking (on pull-request lines with autoMerge, it is also merged).'
- [ ] 1.4 In test/site.test.ts, add a test that checks the Spanish markup text of autonomy.auto contains 'se integra', 'autoMerge', 'pull request' and no 'despleg'/'desplieg', and that site.EN['autonomy.auto'] contains 'integrated', 'autoMerge', 'pull request' and no 'deploy'.
- [ ] 1.5 Run npm run typecheck and npm test.

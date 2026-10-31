# Tasks

## 1. Implementación

- [ ] 1.1 site/index.html: delete the whole <li> of the companies card inside <ul class="grid cards training"> (h3 training.companies.title 'Empresas', p training.companies, its 'a consultar' p and its button data-training="companies"). Leave the other three cards, the topics paragraph and the noscript untouched.
- [ ] 1.2 site/main.js: remove the EN entries 'training.companies.title' and 'training.companies'; remove 'Empresa (opcional):' from MESSAGES.es.body and 'Company (optional):' from MESSAGES.en.body (keep the other three fields in order).
- [ ] 1.3 test/site.test.ts (describe 'sitio del proyecto: capacitaciones'): FORMATS = ['talk','workshop','mentoring']; rename the test 'lista los cuatro formatos…' to three and drop 'Empresas' from the title list, add expect(training).not.toContain('Empresas'); expect onRequest toHaveLength(3); in the Spanish mailto test drop 'Empresa (opcional):' from the fields and assert the body does not contain 'Empresa'; in the English mailto test use data-training 'mentoring', expect subject 'Training: ' + EN['training.mentoring.title'], drop 'Company (optional)' and assert the body does not contain 'Company'; add a test that EN has no training.companies keys and that no file in textFiles matches /empresa|compan(y|ies)/i.
- [ ] 1.4 Run npm run typecheck and npm test, and fix anything that breaks.

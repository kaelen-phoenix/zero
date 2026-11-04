# Tasks

## 1. Implementación

- [ ] 1.1 site/index.html: replace the three `<button type="button" class="button" data-training=... data-i18n="training.cta">` with `<a class="button" href="https://ig.me/m/zerointheloop" target="_blank" rel="noopener" data-training="..." data-i18n="training.cta">La quiero</a>`, keeping `data-training` as the format's name.
- [ ] 1.2 site/index.html: delete the `<noscript>` line with `training.noscript`. Leave the `training.whatsapp` note untouched.
- [ ] 1.3 site/main.js: remove `trainingMailto` and its export in `root.zeroSite`, `MAIL_PARTS` and its comment, the `subject` and `body` fields of `MESSAGES`, the `button[data-training]` listener in `setup`, and the `training.noscript` key of `EN`. Keep `training.cta`.
- [ ] 1.4 site/styles.css: in the base `.training .button` rule add `text-align: center` and `font: 500 0.9rem var(--mono)`, because an `<a>` loses the centering and the font that the `<button>` element gave it; the `align-self: stretch` in the narrow-screen rule would otherwise leave the text left-aligned.
- [ ] 1.5 README.md and README.es.md: in the zerointheloop.com paragraph, change the closing clause so each button opens the Instagram chat of zero in the loop, instead of an email to the person in charge, with the same structure in both.
- [ ] 1.6 test/site.test.ts: remove `trainingMailto` from the `Site` type, the `mail` helper, the two tests that build the email and the noscript test; rewrite 'cada formato tiene un botón de verdad' for the `<a>` links (class, href, target, rel, text and EN value); add tests for no `<button>` or `<noscript>` in the section, no `training.noscript` in EN, `trainingMailto` undefined and no mail code in main.js, no `data-i18n-href` on these links, and the `.training .button` style rule.
- [ ] 1.7 test/site.test.ts: turn 'la dirección no aparece entera' into a check that no site file contains `mailto:`, `kaelen.dev` or `gmail.com`; rename 'los botones de correo de Capacitaciones siguen igual' so it no longer mentions email; extend the README tests to require `Instagram` and to refuse `email`/`correo` in that paragraph.
- [ ] 1.8 Run `npm run typecheck`, `npm test` and `npx openspec validate --all`.

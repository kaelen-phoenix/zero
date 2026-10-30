# Tasks

## 1. Implementación

- [x] 1.1 Read src/line/automerge.ts (mergeDecision, PASSED, CHECKS_GRACE_MS) and the verify station so the wording only states current behaviour. Checks that conclude success, neutral or skipped count as passed. Failed checks or conflicts block the merge. With no checks, it merges after a 5-minute grace period. zero has no deploy code.
- [x] 1.2 README.md: after '### Auto-merge' and before '## Browser panel', add '## zero, your CI and your quality tools'. Include: a short paragraph on what zero does and what it does not replace (GitHub Actions, any CI/CD, static analysis, coverage, quality gates, dependency and secret scanning, with SonarQube/SonarCloud, CodeQL, Dependabot and Snyk named); an untagged diagram block of the path; bullets on local verification, `pull-request` + `autoMerge` merging only when every GitHub check passes (Sonar, CodeQL, any check), the no-checks caveat, findings as an independent second look, deployments by the platform (Vercel, GitHub workflows); and a line starting with 'Recommendation:'.
- [x] 1.3 README.es.md: add the same section in Spanish under '## zero, tu CI y tus herramientas de calidad', in the same place, with the same block structure (one untagged diagram block, translated) and a line starting with 'Recomendación:'.
- [x] 1.4 site/index.html: insert <section id="ci" aria-labelledby="ci-h"> after guarantees, with marker 06, data-i18n label, h2 and paragraphs, and an <ol class="steps path"> of 6 items, each <li data-i18n="ci.path.N">, using <code> for station names. Renumber the markers of install (07), workflow (08), compatibility (09) and links (10).
- [x] 1.5 site/main.js: add the English value of every new ci.* key to EN, in markup order.
- [x] 1.6 site/styles.css: add only the layout needed for ol.path if the existing .steps styling does not fit. Use no new color variables (the contrast test reads only :root).
- [x] 1.7 test/site.test.ts: update the expected section id list, and add tests for section('ci') content, the path list (6 items, order, data-i18n keys) and the EN values.
- [x] 1.8 test/docs.test.ts: add tests that extract the new section from both READMEs (with the existing section() helper) and check placement, the named tools, 'does not replace'/'no reemplaza', the auto-merge and no-checks wording, the recommendation, and the diagram order.
- [x] 1.9 Add the OpenSpec change under openspec/changes/ (capability project-docs) with these requirements, then run npm run typecheck, npm test and npx openspec validate --all.

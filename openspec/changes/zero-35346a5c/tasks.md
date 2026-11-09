# Tasks

## 1. Implementación

- [ ] 1.1 Write the OpenSpec change `openspec/changes/zero-35346a5c/` (proposal.md, tasks.md, specs/control-panel/spec.md with ADDED requirements under new names; control-panel has no main spec).
- [ ] 1.2 In src/app.ts add `REQUEST_TYPES` (feature/fix/security/design/docs/other mapped to función nueva/arreglo/seguridad/diseño/documentación/otro) and extend `requestWork`'s input with optional `type`, `title` and `description`. With `type`, validate and compose the request text as specified; without it, keep the current path untouched.
- [ ] 1.3 In src/app.ts add `requestsView(ctx, { line?, estado? }, now?)`. It reads `listJobs({ line, limit: -1 })`, filters by the estado groups, sorts newest first, keeps 200 and returns rows with the job and an age text, plus the configured line names and the normalized filter. Put the age formatter ("hace N min/h/días") in src/format.ts.
- [ ] 1.4 In src/panel/html.ts add `requestsPage(view, nonce, flash)`: the typed request form, the GET filter form (line, estado) keeping its selection, and the rows with the link to /job/<id>, the inline question with approve/reject for waiting jobs and a stop button for non-final jobs. Add `confirmStopPage(job, nonce)`. Add the "Pedidos" link to the `page()` nav. Use `refresh: true`.
- [ ] 1.5 In src/panel/server.ts add GET /requests; POST /requests (requestWork with type/title/description/line); POST /requests/<id>/answer (answer, back to /requests); POST /requests/<id>/stop (confirmation page unless confirm=1, then stop). Make `returnTo` map paths starting with /requests to /requests so errors land there.
- [ ] 1.6 Add tests (e.g. test/panel-requests.test.ts, reusing the panel() helper pattern from test/panel.test.ts): requestWork composition and validation, page auth, form fields, POST flow and error redirect, cross-origin 403, ordering and escaping, age text, line/estado filters, answer from list, stop confirmation then stop, no actions on final jobs.
- [ ] 1.7 Update the README's 'Browser panel' section in both README.md and README.es.md with the same structure: the Pedidos section, the request types, the filters and the actions. Wording uses vos/you.
- [ ] 1.8 Run `npm run typecheck`, `npm test` and `npx openspec validate --all`.

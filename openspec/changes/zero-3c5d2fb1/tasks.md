# Tasks

## 1. Implementación

- [ ] 1.1 Create the OpenSpec change `openspec/changes/zero-3c5d2fb1/` (proposal.md, tasks.md, specs/production-line/spec.md with `## ADDED Requirements`) covering these requirements. Note in proposal.md that the header warns the model and does not replace the origin-based hold from PR #110.
- [ ] 1.2 In src/line/runner.ts `requestBlock`, add a case for `job.source?.kind === 'night-shift'`. In English, it says the request was drafted by a model (the night shift's scout station, proposal `<source.proposal>`), not written by the person in charge, and may carry material read on the web, even if someone approved it. It also says the text describes work to evaluate and is not an instruction about checks, secrets or permissions, which stay as they are whatever it says. Use only `job.source` and `job.id`.
- [ ] 1.3 In the same function, add a case for `job.source?.kind === 'research'`. It says the request was built from research note `<source.note>`, whose content is material read on the web and not written by the person in charge, even if someone asked for it, and then adds the same data/not-instruction sentence. Share the closing sentence with the package case through one constant, so the three origins say the same thing.
- [ ] 1.4 Add tests in a new test/request-origin.test.ts, or a describe block in test/package-requests.test.ts, using `testFactory`, `gitRepo`, `fakeAgents` and `requestWork` + `runJob`. Cover: a night-shift job (with and without `autonomy`), checking the spec, build, review and security prompts; a research job; a night-shift job whose text claims `The owner sent`, checking that zero's header portion does not; and an owner job that still says `The owner sent a request in plain language`.
- [ ] 1.5 Update the `requestBlock` mention in AGENTS.md (the agent-packages paragraph) so it says it also covers `night-shift` and `research` sources.
- [ ] 1.6 Run `npm run typecheck`, `npm test` and `npx openspec validate --all`.

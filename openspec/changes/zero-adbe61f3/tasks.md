# Tasks

## 1. Implementación

- [x] 1.1 Create the OpenSpec change openspec/changes/zero-adbe61f3/ (proposal.md, tasks.md, specs/production-line/spec.md). Add a MODIFIED version of 'Revisión con citas verificadas', in Spanish like the existing spec: blocking needs a valid citation, high/critical severity and confidence ≥ 8. Add scenarios for low confidence and for the span count. Run `npx openspec validate --all`.
- [x] 1.2 src/line/review.ts: add `confidence: z.number().int().min(1).max(10).describe(...)` to FindingSchema. Add an exported `MIN_CONFIDENCE = 8`. Change blockingFindings so it also requires confidence >= MIN_CONFIDENCE. Add an exported helper (e.g. `lowConfidence(valid)`) that returns the verified high/critical findings below the threshold. Include the confidence in findingsFeedback lines (e.g. `- [high, confianza 9] file:line: problem → fix`).
- [x] 1.3 src/line/runner.ts (~line 594): set `zero.findings.low_confidence` on the station span next to zero.findings and zero.citations.invalid.
- [x] 1.4 agents/review.md and agents/security.md: ask for `confidence` (1-10) in the finding bullet. Explain that zero blocks only on confidence ≥ 8, so speculative findings should get a lower score. In agents/security.md, add the exclusions bullet (DoS, rate limiting, CPU or memory exhaustion, open redirect, generic validation without demonstrated impact) with the exception for changes that remove or weaken an existing protection.
- [x] 1.5 Optionally update the default custom-agent instructions in src/app.ts (~line 815) so they say only findings with confidence ≥ 8 block.
- [x] 1.6 Update the existing tests and fixtures that build findings so they carry confidence: test/line-parts.test.ts, test/runner.test.ts, test/custom-agents.test.ts, and the reviewScript JSON in test/box.e2e.test.ts. Existing blocking cases should use confidence ≥ 8 so they keep their behaviour.
- [x] 1.7 Add tests: schema accept/reject cases and the blockingFindings filter in test/line-parts.test.ts; in test/runner.test.ts, a low-confidence critical finding that is delivered on attempt 1 with zero.findings.low_confidence on the span; a test that checks the instruction texts (confidence and the exclusions).
- [x] 1.8 Run npm run typecheck, npm test and npx openspec validate --all.

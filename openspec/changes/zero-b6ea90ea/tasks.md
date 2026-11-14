# Tasks

## 1. Implementación

- [ ] 1.1 In test/proposal-issues.test.ts, inside describe("proposals as GitHub issues"), add a test that creates a proposal with `{ ...idea, line: "demo", title: "Avisar a @alguien", why: "lo pidió @alguien" }`, runs syncProposalIssues with fakeGitHub, and checks that the createIssue call's title and body each contain `@​alguien` and do not contain `@alguien`. Write the zero-width space as the escape `​` in the test source so it stays visible.
- [ ] 1.2 Add a test that publishes a proposal (syncProposalIssues), rejects it with `rejectProposal(ctx, p.id, "preguntale a @alguien")`, syncs again, and checks that `gh.ops("comment", 5)[0].body` contains `@​alguien` and does not contain `@alguien`. Follow the pattern of the existing test "publishes a rejection's reason without live media".
- [ ] 1.3 Change no production code. Run `npm run typecheck` and `npx vitest run test/proposal-issues.test.ts` (then `npm test`) and confirm everything passes. Optionally, remove breakMentions locally from each of the three calls to confirm each new assertion fails, then restore it.

# Proposal

## Why

You get two things. 1. **Fundir a pedido.** You can ask the factory to merge a pull request it delivered, even on a line without autoMerge. You can ask from the chat (`zero_merge` tool), from the terminal (`zero fusionar <trabajo | url>`) or from the panel (a "Fundir" button on the page of a delivered job, with a confirmation step). The factory merges only if GitHub says the pull request is ready: no failed checks, no checks still running, no conflicts. If it isn't ready, the factory tells you why and does nothing else. Each merge appears in the job's trace (`zero trace`) and in the line's townhall. This lets you merge glowingsanhair #5 and #6 with `zero fusionar <url>`. 2. **Checks frenados por facturación.** Sometimes GitHub never starts a pull request's checks because of the account ("The job was not started because recent account payments have failed or your spending limit needs to be increased"). On an autoMerge line, the merges pass now spots this. It holds the pull request without commenting on it or spending anything. It tells you once per repository, in a single line in `zero status`, the panel summary and the briefing. When GitHub starts runs again on that repository, the factory reruns the failed jobs of those runs by itself (like `gh run rerun --failed`): one pull request at a time, and at most once per run. The work is in five stages, and it comes with tests on fake adapters and the README in English and Spanish.

## What Changes

- Fundir a pedido y volver a correr los checks frenados por facturación de GitHub
- Supuesto: Assumption: merging on request is done synchronously by the CLI, the chat or the panel process (a couple of GitHub calls), like `zero issues on` and tracker.ts, rather than queued for the daemon. This bends the MCP note that tools 'only read or write state', but it gives the immediate 'why not' the request asks for.
- Supuesto: Assumption: the exact shape of GitHub's billing refusal on a check run is not confirmed from the API (title, summary or annotation). The adapter checks the output fields and then the annotations, which costs one extra request per failed check run that has annotations. Only `billingRefusal` and the fake adapters are tested; a real run should confirm detection on soliloq, newoman or glowingsanhair.
- Supuesto: Assumption: recovery is a non-billing check that started after the last refusal, at a watched tip or at the base branch. A repository with no other activity and a base without CI may never show that signal. Then the pull request stays held with the notice until someone reruns by hand or pushes.
- Supuesto: Coordination with job 724cecae: its proposal left 'show GitHub account problems (billing, spending limit, minutes used up) as a problem' as a follow-up and no code for it exists. This change adds the only billing notice (`billingText`, `FactoryStatus.billing`). If 724cecae's follow-up lands separately, it should reuse this one.
- Supuesto: Merging on request uses mergeDecision as is, so a repository with no checks merges after the 5-minute grace, just as autoMerge does. Treat 'checks green' as 'no failed or running checks'.
- Supuesto: glowingsanhair #5 and #6 are merged by the person in charge running `zero fusionar` after this ships. The build must not call real GitHub.
- Supuesto: The townhall post kind is assumed to be `finding` with topic `fusión a pedido`, since there is no event kind. The builder may pick `lesson` if the briefing would show it better.
- Supuesto: Several test files are touched near the full suite's time limit (earlier blockers). The new tests go in their own small files with injected clocks and no daemon loops.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Fundir a pedido y volver a correr los checks frenados por facturación de GitHub

## Impact

Generado por zero para el trabajo 1906996b.

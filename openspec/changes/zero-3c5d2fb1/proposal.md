# Proposal

## Why

Today, when the night shift or a research note opens a job, the agents (spec, build, review, security and the custom reviewers) read "The owner sent a request". That is false: the scout model wrote the text, sometimes after reading web material, or it came straight from a note about the web. After this change, zero itself decides how the request is presented, and it decides only from where it opened the job, never from anything scout wrote. The header says a model or a research note drafted the request, that it may carry web material even if someone approved it, and that it describes work to evaluate rather than an instruction about checks, secrets or permissions. This is the same treatment package requests already get. Requests you send yourself keep saying "The owner sent". Autonomy, approvals and dependencies do not change. The header is a warning to the model, not a technical barrier: the real guarantees are still verify, protected paths, review, the isolation box and the night-shift hold.

## What Changes

- Night-shift and research requests stop reaching the stations as the owner's
- Supuesto: Assumption: the change is only the prompt header (`requestBlock`). The request mentions `proposalRequest` and agents/spec.md / agents/build.md, but its 'Qué cambiaría' section limits the change to `requestBlock` and tests, so those are left out.
- Supuesto: This header is an instruction to the model, not a technical guarantee. A prompt injection can still work, and the real limits remain verify, protected paths, review, the box and `nightShiftHold`.
- Supuesto: Night-shift jobs at `build` autonomy park at `before-integrate`. Tests should read prompts from the recorded agent calls rather than expect delivery.
- Supuesto: Tests that match exact prompt text elsewhere (night-shift*.test.ts, scout.test.ts, research.test.ts) might assert `The owner sent` for night-shift or research jobs and would need to change. Search for it before building.
- Supuesto: The night-shift header always warns about possible web material, even for proposals that did not come from a research note. This is intentional: zero cannot know from `job.source` whether scout read web notes, and it must not trust scout's `researchNote`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Night-shift and research requests stop reaching the stations as the owner's

## Impact

Generado por zero para el trabajo 3c5d2fb1.

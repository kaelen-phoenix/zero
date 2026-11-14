# Proposal

## Why

You get new automated tests that check that a night-shift proposal published as a GitHub issue never mentions a real person. When the title, the reason ("why") or the rejection reason of a proposal has an `@alguien`, the published issue and the rejection comment must show it with an invisible break (`@​alguien`), so GitHub notifies nobody. If someone later removes that protection from any of the three places, a test fails. The factory's behaviour does not change.

## What Changes

- Tests: @mentions in a proposal notify nobody on its GitHub issue
- Supuesto: `not.toContain("@alguien")` passes only because `"@​alguien"` does not contain the substring `@alguien`. That is correct, but the assertions must use the bare form exactly, not a regex that ignores the zero-width space.
- Supuesto: The `change` field and `paths` also go into the body through the same breakMentions call. The request names only title, why and the rejection reason, so the other fields are not tested separately.
- Supuesto: Since this is test-only, no OpenSpec change is planned. The behaviour is already in production and already covered by the work-intake capability.

## Capabilities

### New Capabilities

### Modified Capabilities
- `work-intake`: Tests: @mentions in a proposal notify nobody on its GitHub issue

## Impact

Generado por zero para el trabajo b6ea90ea.

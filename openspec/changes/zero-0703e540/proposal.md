# Proposal

## Why

zero gets two new engines. The first is `opencode`, a built-in engine that drives the OpenCode CLI (`opencode run`). The second lets you declare any agent that speaks the Agent Client Protocol (ACP) in `engines` of the factory file with `protocol: acp`, for example `gemini --experimental-acp`, `opencode acp` or a Claude/Codex ACP adapter. Both follow the same rules as the other engines. Ending without an answer counts as a failure. They report the model that answered and what the call cost when the engine says so. They report no plan windows, so their spend counts against the dollar caps. zero itself keeps read-only stations read-only: it checks the folder before and after each call and puts back anything the agent changed. On top of that, each adapter asks the engine not to edit, run commands or fetch the web on read-only stations. On the site, "en camino" comes off the "Motores ACP/OpenCode" item and both engines join the compatibility grid. README.md and README.es.md explain how to use them.

## What Changes

- Motores OpenCode y ACP
- Supuesto: OpenCode's `run --format json` event shapes (`text`, `step_start`, `step_finish` with `part.cost`, `error`, `providerID`/`modelID`) and `OPENCODE_CONFIG_CONTENT` taking precedence over a project's opencode.json are from memory and not checked against a real CLI here. Tests use fakes, so the first real run must be checked by hand. zero's read-only check (runGuarded) is the real guarantee if the permissions are ignored.
- Supuesto: It is unconfirmed whether `opencode run` reads stdin. For prompts over 30,000 characters the spec assumes it does, as antigravity does.
- Supuesto: ACP's `models` in session/new and `usage_update` cost are unstable parts of the protocol. Agents that don't send them leave model and cost unknown. Unknown billing counts against the dollar caps, which is the conservative side.
- Supuesto: Neither engine reports plan windows (`quota`), so subscription plans behind OpenCode or an ACP agent are treated as pay-per-use and limited by `usdPerDay`/`usdPerJob`.
- Supuesto: Marking both engines `unsandboxed` makes `passExecute` send background passes to the box when it is ready, and the box image has neither CLI (opencode is also refused there by credentials). Background passes on these engines then fail while the box is ready.
- Supuesto: Since the request says to remove 'en camino' from the next-steps item, the item stays in the site's 'próximos pasos' list without the marker. Only the README's Next steps drops it.

## Capabilities

### New Capabilities
- `agent-engines`: Motores OpenCode y ACP

### Modified Capabilities

## Impact

Generado por zero para el trabajo 0703e540.

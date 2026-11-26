# Proposal

## Why

When the isolation box stops an agent because it ran out of time, zero will now treat it as a time-limit cut, the same way it already does for agents that run on the machine. The next build attempt will be told that it reached the time limit and should carry on from the uncommitted work in its copy. Today it is told that the run "ended abnormally" and to make smaller changes. The message describing the cut does not change.

## What Changes

- Mark a run cut by the isolation box as a time-limit cut
- Supuesto: Assumption: the OpenSpec change asked for in the request is the one zero writes from this specification under openspec/changes/zero-298a5085 (capability isolation-box), as in earlier jobs.
- Supuesto: The full job test depends on how runJob resolves engines and the box. If it is simpler to give runJob a `runAgent` that wraps `box.agentRunner(config)` only for build, do that rather than enabling isolation: container, which would need a ready box and egress gate.
- Supuesto: The test engine in the box needs credentials in the test SecretStore, or `execute` returns early with 'No se puede usar ... en la caja' before it calls runInBox.
- Supuesto: Not changed: the text of the timeout message, the extra minute of slack for container start-up, and the `shell` path (which already returns `timedOut`).

## Capabilities

### New Capabilities

### Modified Capabilities
- `isolation-box`: Mark a run cut by the isolation box as a time-limit cut

## Impact

Generado por zero para el trabajo 298a5085.

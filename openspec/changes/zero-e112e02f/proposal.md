# Proposal

## Why

Today, when the Claude Code session expires, zero pauses that engine and puts the job back in the queue without spending tries. When the Codex session expires, the job just fails or uses up its attempts. With this change Codex gets the same treatment. When a Codex call fails with an expired or missing session ("not logged in", "401 Unauthorized", "token expired", "refresh token"), zero pauses Codex for a while and moves on to the next engine. If there is none, the job goes back to the queue. The waiting reason already says how to sign in again («corré `codex login`»). You still have to sign in again yourself. A cut for time, a cancellation or an ordinary error does not count as an expired session.

## What Changes

- Codex: an expired session pauses the engine instead of spending tries
- Supuesto: `refresh token` and `401 Unauthorized` are broad. A non-auth failure that mentions them (for example a proxy returning 401) would pause codex for 15 minutes (UNKNOWN_RESET_MS) instead of failing. This is bounded, and it is only checked on failed exits.
- Supuesto: The exact texts Codex prints for an expired ChatGPT session were not checked against a real codex binary. They come from the request. If the real wording differs, the regex has to be extended.
- Supuesto: Assumption: the request names only Codex texts, so antigravity, opencode and custom CLI engines get the hook mechanism but no detector. Their expired sessions still fail as before.
- Supuesto: On Windows, spawn without a shell cannot start a fake `.cmd`. Tests must redirect spawn to process.execPath, as test/engines-empty-output.test.ts does.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Codex: an expired session pauses the engine instead of spending tries

## Impact

Generado por zero para el trabajo e112e02f.

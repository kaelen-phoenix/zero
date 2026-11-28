# Proposal

## Why

The factory already waits instead of failing when the Claude Code session expires: it pauses that engine, sends the job back to the queue without spending tries, and picks it up again once the engine answers. Two gaps remain, and this change closes them. First, it will also recognise the other forms of the same error («could not be refreshed», «invalid_grant», «API Error: 401», «401 Unauthorized»), so none of them makes a job fail. Second, the waiting reason shown in the CLI, the panel and the chat will say how to sign in again. For Claude it will read «falta iniciar sesión en el motor claude: corré `claude` en una terminal y escribí /login», and for Codex «…: corré `codex login`». You still have to sign in again on this machine yourself: zero never does it for you.

## What Changes

- Expired session: detect every auth error text and say how to sign in again
- Supuesto: The core behaviour the request asks for (typed signed-out error, parking without failing, resuming when the session returns) already shipped in change zero-7ab160a7. This spec only covers the detection gaps and the sign-in hint. The five failed jobs (9db0aa22, ac2ec095, 1e52389d, d9f534bb, 39d7be87) failed before that fix reached the installed copy, and they still need to be retried by hand with retryJob once the person in charge signs in again.
- Supuesto: The request mentions `claude login`, but I could not confirm in this repo that this subcommand exists. src/setup.ts uses `claude setup-token`, and the townhall says `claude` followed by /login. The hint uses the interactive /login, which is the one known to work. Adjust the text if that turns out to be wrong.
- Supuesto: Matching `API Error: 401` and `401 Unauthorized` could, in rare cases, park a job for 15 minutes on a 401 that is not about the session (for example a misconfigured proxy). It is only checked on failed calls, and the pause is bounded.
- Supuesto: The signed-out reason gets longer. Any test or panel/format code that compares it exactly must be updated (grep for 'falta iniciar sesión').

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-line`: Expired session: detect every auth error text and say how to sign in again

## Impact

Generado por zero para el trabajo 693ad55a.

# Spec Delta

## ADDED Requirements

### Requirement: Codex recognises an expired or missing session
The Codex adapter (codexEngine and unsandboxedCodexEngine in src/engines/cli.ts) SHALL set `signedOut: true` on the EngineResult of a call that exited with a non-zero code and whose stderr, or the message of its last `error`/`turn.failed` event on stdout, contains, case-insensitively, any of: `not logged in`, `401 Unauthorized`, `token expired` (also `token has expired`) or `refresh token`. The result MUST still have ok false and the usual `codex exited with <code>: ...` text.

#### Scenario: not logged in
- **WHEN** a fake codex process writes "Error: Not logged in" to stderr and exits with code 1
- **THEN** codexEngine.run resolves with ok false and signedOut true

#### Scenario: 401 Unauthorized
- **WHEN** a fake codex process writes "unexpected status 401 Unauthorized" to stderr and exits with code 1
- **THEN** the result has ok false and signedOut true

#### Scenario: token expired
- **WHEN** a fake codex process writes "Your access token expired" or "token has expired" to stderr and exits with code 1
- **THEN** the result has ok false and signedOut true

#### Scenario: refresh token
- **WHEN** a fake codex process writes "Failed to refresh token: refresh token was revoked" to stderr and exits with code 1
- **THEN** the result has ok false and signedOut true

#### Scenario: text only in an error event
- **WHEN** a fake codex process writes nothing to stderr, prints a {"type":"error","message":"401 Unauthorized"} event on stdout and exits with code 1
- **THEN** the result has ok false and signedOut true

### Requirement: Only a failed exit can be a sign-out
The CLI adapter MUST NOT set `signedOut` on a call that exited with code 0, on a call cut by its time limit (`timedOut`), on a cancelled call, or on a failed exit whose text does not match the engine's sign-out detector.

#### Scenario: ordinary failure
- **WHEN** a fake codex process writes "error: something else broke" to stderr and exits with code 1
- **THEN** the result has ok false and signedOut is not true

#### Scenario: successful answer mentioning the words
- **WHEN** a fake codex process writes "listo" to the last-message file, writes "not logged in" to stderr and exits with code 0
- **THEN** the result has ok true and signedOut is not true

#### Scenario: timeout
- **WHEN** a fake codex process writes "not logged in" to stderr and keeps running past a short timeoutMs
- **THEN** the result has timedOut true and signedOut is not true

### Requirement: Detection is per engine and opt-in
`ExecuteHooks` in src/engines/cli.ts SHALL accept an optional `signedOut` detector. Engines that do not provide one (antigravity, opencode, custom CLI engines) MUST never report `signedOut`, whatever their output says.

#### Scenario: custom engine without detector
- **WHEN** a custom CLI engine whose command writes "not logged in" to stderr and exits with code 1 is run
- **THEN** the result has ok false and signedOut is not true

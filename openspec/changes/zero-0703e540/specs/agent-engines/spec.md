# Spec Delta

## Purpose

zero gets two new engines. The first is `opencode`, a built-in engine that drives the OpenCode CLI (`opencode run`). The second lets you declare any agent that speaks the Agent Client Protocol (ACP) in `engines` of the factory file with `protocol: acp`, for example `gemini --experimental-acp`, `opencode acp` or a Claude/Codex ACP adapter. Both follow the same rules as the other engines. Ending without an answer counts as a failure. They report the model that answered and what the call cost when the engine says so. They report no plan windows, so their spend counts against the dollar caps. zero itself keeps read-only stations read-only: it checks the folder before and after each call and puts back anything the agent changed. On top of that, each adapter asks the engine not to edit, run commands or fetch the web on read-only stations. On the site, "en camino" comes off the "Motores ACP/OpenCode" item and both engines join the compatibility grid. README.md and README.es.md explain how to use them.

## ADDED Requirements

### Requirement: OpenCode built-in engine
zero MUST offer a built-in engine named `opencode` (in `BUILT_IN` of src/engines/index.ts, so `engine: opencode`, station engines and `fallback` accept it). It runs `opencode run --format json` from the request's cwd through `spawnTarget`, adds `--model <model>` when a model is requested, and passes the full prompt (instructions + prompt) as the message argument. When `fullPrompt` exceeds 30,000 characters it MUST send the prompt on stdin and leave a short instruction as the argument instead, as antigravity does.

#### Scenario: Invocation
- **WHEN** `opencodeInvocation` is built for a short prompt with model `anthropic/claude-sonnet-4` and access read
- **THEN** bin is `opencode` and args start with `run`, contain `--format` `json`, `--model` `anthropic/claude-sonnet-4` and the full prompt, with no stdin

#### Scenario: Long prompt goes on stdin
- **WHEN** the full prompt is longer than 30,000 characters
- **THEN** stdin holds the full prompt and the args hold only a short instruction, not the prompt

#### Scenario: Known engine name
- **WHEN** a factory file with `engine: opencode` and `fallback: [opencode]` is parsed and `resolveEngine('opencode', config)` is called
- **THEN** parsing succeeds and the engine's name is `opencode`

### Requirement: OpenCode answer, model, cost and failures
The opencode engine MUST read its stdout as JSON lines (non-JSON lines skipped). The answer is the joined `part.text` of the `text` events after the last `step_start` event (all `text` events when there is none). `costUsd` is the sum of the numeric `part.cost` of the `step_finish` events. `model` is `<providerID>/<modelID>` from the last event object that carries both strings, at any depth. An exit 0 without answer text MUST fail with `opencode devolvió salida vacía` plus the end of stderr. A non-zero exit MUST fail with `opencode exited with <code>: ` followed by stderr or, when stderr is empty, the last `error` event's message. It MUST report no `quota`.

#### Scenario: Answer and cost
- **WHEN** a fake opencode prints a step_start, a text event `hola`, a step_finish with cost 0.01, a step_start, text events `lis` and `to`, and a step_finish with cost 0.02
- **THEN** the result is ok with text `listo`, costUsd 0.03 and no quota

#### Scenario: Model reported
- **WHEN** an event contains `{providerID: 'anthropic', modelID: 'claude-sonnet-4'}`
- **THEN** result.model is `anthropic/claude-sonnet-4`

#### Scenario: Empty output
- **WHEN** the fake opencode exits 0 printing only a step_finish event and `boom` on stderr
- **THEN** the result is `{ok: false, text: 'opencode devolvió salida vacía: boom'}`

#### Scenario: Failed exit explained by an error event
- **WHEN** the fake exits 1 with empty stderr and an `error` event whose message is `no provider`
- **THEN** ok is false and text contains `opencode exited with 1` and `no provider`

### Requirement: OpenCode access
The opencode engine MUST pass its permissions to OpenCode through `OPENCODE_CONFIG_CONTENT` in the process's environment, without touching any file. For `read` and `web` access that is `edit`, `bash` and `webfetch` set to `deny`. For `write`, `edit` and `bash` are set to `allow` and `webfetch` to `deny`. Variables in `req.env` are kept. The engine MUST be marked `unsandboxed`, so that `runHere` sends its non-write calls through `runGuarded`.

#### Scenario: Read-only permissions
- **WHEN** a fake opencode prints `process.env.OPENCODE_CONFIG_CONTENT` as its text answer for a read request
- **THEN** the parsed JSON has permission edit, bash and webfetch all `deny`

#### Scenario: Write permissions
- **WHEN** the same fake runs with access write
- **THEN** permission edit and bash are `allow` and webfetch is `deny`

#### Scenario: Guarded by zero
- **WHEN** `resolveEngine('opencode', config)` is inspected
- **THEN** its `unsandboxed` is true and `nativeSchema` is false

### Requirement: ACP engines declared in the factory file
An entry in `engines` of the factory file MAY set `protocol: acp` (absent means today's CLI behaviour). The parser MUST refuse an `acp` entry whose command or args contain `{prompt}`. `customEngine` MUST return an ACP engine for such an entry. That engine starts the agent from `command`, followed by `readArgs` or `writeArgs` by access and `modelArgs` (with `{model}`) when a model is requested, all through `spawnTarget`. It talks newline-delimited JSON-RPC 2.0 over stdio and sends nothing on argv but those args. It MUST be marked `unsandboxed`, use the entry's `hosts`, and its credentials in the box MUST stay the entry's `secrets`.

#### Scenario: Protocol accepted
- **WHEN** a factory file with `engines: { gem: { command: ['gemini', '--experimental-acp'], protocol: acp } }` is parsed
- **THEN** it parses and `resolveEngine('gem', config).unsandboxed` is true

#### Scenario: Prompt placeholder refused
- **WHEN** an `acp` entry has `command: ['agent', '{prompt}']`
- **THEN** parsing fails naming that engine

#### Scenario: CLI entries unchanged
- **WHEN** an entry without `protocol` is resolved
- **THEN** it behaves as the existing custom CLI engine (prompt on stdin or in `{prompt}`)

### Requirement: ACP session flow and answer
An ACP engine run MUST send `initialize` (protocolVersion 1, clientCapabilities with fs readTextFile/writeTextFile false and terminal false), then `session/new` with the request's cwd and `mcpServers: []`, then `session/prompt` with that sessionId and one text content block holding the full prompt (instructions + prompt). The answer is the concatenated text of `agent_message_chunk` updates of `session/update` notifications for that session. On a `session/prompt` result with stopReason `end_turn` and non-empty text, the run MUST be ok. After the prompt result, zero MUST end the agent process.

#### Scenario: Happy path
- **WHEN** a fake ACP agent (a node script given as `command`) answers initialize and session/new with sessionId `s1`, sends two agent_message_chunk updates `lis` and `to`, and returns stopReason end_turn
- **THEN** the result is ok with text `listo`, and the fake recorded the methods initialize, session/new, session/prompt in that order, with the cwd and the full prompt

#### Scenario: Process ended
- **WHEN** the fake agent stays alive after answering the prompt
- **THEN** the run still resolves and the fake process is no longer running

### Requirement: ACP failures
An ACP run MUST fail with `ok: false` when the agent exits before answering the prompt (`<name> exited with <code>: ` plus the end of stderr), when any of zero's requests gets a JSON-RPC error (its message included), when stopReason is not `end_turn` (`<name> terminó con <stopReason>`), and when the answer text is empty (`<name> devolvió salida vacía` plus the end of stderr). On timeout it MUST kill the agent and answer `<name> timed out after <n> min`. When the request's signal aborts it MUST kill the agent and answer `<name> cancelled`.

#### Scenario: Empty answer
- **WHEN** the fake returns end_turn without any message chunk and writes `sin sesión` on stderr
- **THEN** the result is `{ok: false, text: '<name> devolvió salida vacía: sin sesión'}`

#### Scenario: JSON-RPC error
- **WHEN** the fake answers session/new with error `{code: -32000, message: 'auth required'}`
- **THEN** ok is false and the text contains `auth required`

#### Scenario: Refusal
- **WHEN** the fake returns stopReason `refusal` after a chunk
- **THEN** ok is false and the text contains `refusal`

#### Scenario: Early exit
- **WHEN** the fake exits with code 3 after initialize
- **THEN** ok is false and the text contains `exited with 3`

#### Scenario: Timeout
- **WHEN** the fake never answers session/prompt and timeoutMs is short
- **THEN** ok is false with a `timed out` text and the process is killed

### Requirement: ACP access through permission requests
zero MUST answer the agent's `session/request_permission` requests by access. With `write` it selects the first option of kind `allow_once`, else `allow_always`. With `read` or `web` it selects an allow option only when the tool call's `kind` is `read`, `search` or `think`. Otherwise it selects the first `reject_once`, else `reject_always`, else it answers outcome `cancelled`. Any other request from the agent (fs/*, terminal/*, unknown methods) MUST get JSON-RPC error -32601.

#### Scenario: Edit refused on read
- **WHEN** on a read request, the fake asks permission for a tool call of kind `edit` with options allow_once `a` and reject_once `r`, and echoes the chosen optionId as its answer
- **THEN** the answer is `r`

#### Scenario: Edit allowed on write
- **WHEN** the same exchange runs with access write
- **THEN** the answer is `a`

#### Scenario: Read allowed on read
- **WHEN** on a read request the tool call's kind is `read`
- **THEN** the answer is `a`

#### Scenario: No reject option
- **WHEN** on a read request, an `execute` tool call offers only allow options
- **THEN** zero answers `{outcome: {outcome: 'cancelled'}}`

#### Scenario: Unsupported client method
- **WHEN** the fake sends a `fs/write_text_file` request
- **THEN** it receives a JSON-RPC error with code -32601

### Requirement: ACP model and cost
An ACP run MUST report as `model` the `models.currentModelId` string of the `session/new` result when present. It reports as `costUsd` the `cost.amount` of the last `usage_update` session update whose `cost.currency` is `USD`. It MUST report no `quota`.

#### Scenario: Model and cost reported
- **WHEN** session/new returns `models: {currentModelId: 'gemini-2.5-pro'}` and the fake sends a usage_update with `cost: {amount: 0.04, currency: 'USD'}`
- **THEN** result.model is `gemini-2.5-pro`, costUsd is 0.04 and quota is undefined

#### Scenario: Nothing reported
- **WHEN** the fake reports neither
- **THEN** model and costUsd are undefined

### Requirement: Engines in the box
`engineCredentials` MUST answer the built-in `opencode` with the problem `el motor opencode todavía no puede trabajar dentro de la caja`, as for antigravity. ACP engines MUST keep the custom-engine behaviour (their declared `secrets`).

#### Scenario: OpenCode not in the box
- **WHEN** `engineCredentials('opencode', config, secrets)` is called
- **THEN** it returns no names and a problem mentioning `opencode` and `caja`

### Requirement: Site and documentation
site/index.html MUST drop the `en camino` marker from the `next.engines` item. Its compatibility grid MUST list OpenCode (CLI) and ACP (agents that speak ACP) among the engines, after Antigravity and before the custom CLI, with any new text under data-i18n keys with English values in site/main.js. The project-site spec and test/site.test.ts MUST be updated to match. README.md and README.es.md MUST document both engines with the same structure and code blocks: the engine list, the `engine:` comment, and an example `engines` entry with `protocol: acp`. They also cover how read-only access is kept and that neither engine reports plan windows. Both READMEs MUST remove `ACP/OpenCode engines` / its Spanish counterpart from Next steps.

#### Scenario: No longer coming
- **WHEN** site/index.html is read
- **THEN** no line holds both `next.engines` and `class="soon"`

#### Scenario: Compatibility grid
- **WHEN** the compatibility section's data-item ids are read
- **THEN** they equal claude, codex, antigravity, opencode, acp, custom-cli, claude-code, codex, opencode, terminal

#### Scenario: READMEs
- **WHEN** README.md and README.es.md are read
- **THEN** both mention `opencode` and `protocol: acp`, neither lists ACP/OpenCode engines in Next steps / Próximos pasos, and test/docs.test.ts passes

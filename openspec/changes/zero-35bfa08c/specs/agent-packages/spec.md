# Spec Delta

## Purpose

Almost everything the "construcciones express" need is already in zero. From the panel and the terminal you can already send a zip to a package station. The station can already turn it into a local repository, run a full job on it (spec, build, verify, review) with a cost cap, read what the job cost and offer the result for download in its panel tab. Two things were missing, and this change adds them. First, you will be able to send the file from the chat too, with the new `zero_package_upload` tool: from a chat on this machine you give it a file path, and from any chat, including the remote one, you can send the content itself. Second, a station can read the factory's per-job limit (`ctx.limits.usdPerJob`), so it knows how far it can cap a job. The README (English and Spanish) explains both. Once this is in, zero sends request 6d6ef921 to the zero-plus line again.

## ADDED Requirements

### Requirement: Chat tool uploads a local file to a station
The MCP server SHALL register a tool `zero_package_upload` with inputs `station` (`<package>/<station>`), optional `path`, optional `content` (base64), optional `name` and optional `request`. When it gets an absolute `path` to a regular file, it MUST pass that file to `uploadToStation` with `name` = the file's base name, streamed from disk, plus the request text. It SHALL then answer like `zero_package_run`: the run text, the daemon start notice when it started the daemon, and the `waitStationStart` text.

#### Scenario: Local path reaches the station
- **WHEN** package `hello` has station `nota` with `onDemand: true` and `uploads: {}`, and a chat client calls `zero_package_upload` with `{ station: 'hello/nota', path: <absolute path of a valid zip in a temp folder>, request: 'construilo' }` on a server created with `autoStart: false` and a short `stationWaitMs`
- **THEN** exactly one file exists under `<package-data>/hello/uploads/nota/`, with the same bytes as the source, its name ends with the source's base name, kv `stationUploadKey('hello','nota')` is set, kv `stationOnDemandRequestKey('hello','nota')` holds `construilo`, and the tool answer contains the run text returned by `uploadToStation`

#### Scenario: Station refusal is passed back
- **WHEN** the same tool is called for a station whose manifest declares no `uploads`
- **THEN** the answer contains `no acepta archivos` and nothing is written under the station's uploads folder

### Requirement: Chat tool uploads base64 content
When `zero_package_upload` gets `content` instead of `path`, it MUST require a `name`, decode the content as strict base64 and pass the bytes to `uploadToStation` with that name. It MUST refuse in Spanish, writing nothing, when `name` is missing, when the content is not valid base64, when both or neither of `path` and `content` are given, or when `path` is relative or is not a regular file.

#### Scenario: Base64 zip reaches the station
- **WHEN** the tool is called with `{ station: 'hello/nota', content: <base64 of a valid zip>, name: 'sitio.zip' }`
- **THEN** one file under the station's uploads folder has the decoded bytes and a name ending in `sitio.zip`, and kv `stationUploadKey('hello','nota')` is set

#### Scenario: Bad input writes nothing
- **WHEN** the tool is called with each of: both `path` and `content`; neither; `content` without `name`; `content: 'no es base64!!'`; a relative `path`; a `path` that is a directory
- **THEN** each answer is a Spanish refusal, kv `stationOnDemandKey('hello','nota')` stays absent, and the uploads folder holds no file

### Requirement: Remote chat uploads only content
On the remote MCP server (`opts.remote` set), `zero_package_upload` MUST refuse a `path` with a Spanish reason (it must never read the machine's files for a remote client) and SHALL still accept `content`. The tool MUST NOT be in `READ_TOOLS`, so a token with only `zero:read` never sees it.

#### Scenario: Remote path refused
- **WHEN** the server is created with `remote: { scope: ['zero:read','zero:act'], client: 'c' }` and the tool is called with a valid absolute `path`
- **THEN** the answer is a refusal that mentions `content`, and no file is written under the uploads folder

#### Scenario: Remote content accepted
- **WHEN** the same remote server gets `content` with base64 of a valid zip and `name: 'a.zip'`
- **THEN** the file is stored under the station's uploads folder and kv `stationUploadKey` is set

#### Scenario: Read-only token does not list it
- **WHEN** a remote server with scope `['zero:read']` is listed
- **THEN** `zero_package_upload` is not among the tools

### Requirement: Station reads the per-job limit
Every `StationContext` built for `pass`, `scheduled` and on-demand turns SHALL carry `limits: { usdPerJob }`, a read-only copy of `config.limits.usdPerJob`. Changing it MUST NOT change the factory's config or the cap that `requestJob` checks.

#### Scenario: Limit visible in a pass
- **WHEN** the factory file has `limits.usdPerJob: 3`, and a station whose module writes `ctx.limits.usdPerJob` to a file runs a pass
- **THEN** the file holds `3`

#### Scenario: Mutation does not widen the cap
- **WHEN** a station sets `ctx.limits.usdPerJob = 100` (or the assignment throws because the object is frozen) and then calls `ctx.requestJob({ line, text, maxUsd: 50 })` with `limits.usdPerJob: 3`
- **THEN** the request returns `{ reason }` mentioning `limits.usdPerJob`, and `ctx.config.limits.usdPerJob` is still 3

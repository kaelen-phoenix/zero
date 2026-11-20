# Spec Delta

## Purpose

Primera parte de la fábrica repartida en varias máquinas tuyas. Qué te queda: - **Un documento de decisión** (docs/adr/0007-fabrica-distribuida.md). Explica cómo funciona todo el diseño: - cómo una máquina toma un trabajo sin que otra tome el mismo; - cómo se detecta una máquina caída y cuándo se liberan sus trabajos; - qué pasa con lo que quedó sin subir y con los conflictos; - cómo se protege el repositorio privado de coordinación; - cómo se cuida la cuota de GitHub sin gastar Actions; - cómo se suma el presupuesto entre máquinas; - cómo se une una máquina nueva; - en qué etapas se construye. - **Una sección nueva y opcional, `distributed`, en el archivo de la fábrica.** Indica el repositorio de coordinación y los plazos del latido y del vencimiento. Si no la ponés, la fábrica de una sola máquina funciona igual que hoy y no hace ningún pedido nuevo a GitHub. - **Cada máquina tiene una identidad fija y declara qué puede hacer:** si tiene caja de aislamiento, qué motores tiene y en qué sistema corre. - **El mecanismo de coordinación sobre GitHub.** - Tomar un trabajo es atómico: si dos máquinas lo intentan a la vez, solo una gana. - Cada máquina deja un latido. Los trabajos de una máquina sin latido se pueden retomar cuando vence el plazo. - Una máquina que vuelve se entera de que su trabajo ya lo tomó otra, y no lo pisa. - **El comando `zero unirse <dueño/repositorio>`** suma la máquina a la fábrica. Rechaza un repositorio público. - **La lista de máquinas en `zero status` y en el panel:** cuál está viva, cuál se cayó, su último latido y sus trabajos. Lo que todavía no hace queda anotado para las próximas etapas: que las máquinas tomen trabajos de una cola común, que suban su avance en cada punto guardado, que una retome lo de otra, que el presupuesto se sume entre máquinas, que las líneas se clonen solas y que desde cualquier panel se pueda pedir y aprobar.

## ADDED Requirements

### Requirement: ADR numbers are unique
docs/adr MUST NOT contain two files with the same four-digit prefix: the self-update ADR SHALL be docs/adr/0006-autoactualizacion.md with a first line starting `# ADR 0006`, and docs/adr/0005-costos-de-ci.md SHALL stay the only file starting with `0005-`.

#### Scenario: No repeated prefix
- **WHEN** a test lists docs/adr and groups the file names by their first four characters
- **THEN** every prefix appears once, 0006-autoactualizacion.md exists with first line matching /^# ADR 0006/, and no 0005-autoactualizacion.md exists

### Requirement: Distributed factory decision record
The repository MUST contain docs/adr/0007-fabrica-distribuida.md, written in Spanish. Its first line SHALL start with `# ADR 0007`. It SHALL have the lines `**Estado:**` and `**Fecha:**` and the sections `## Contexto`, `## Decisión` and `## Consecuencias`. It SHALL have one `###` subsection for each of these topics: taking a job, detecting a machine that is down, unpushed changes, conflicts, security of the coordination repository, the GitHub quota, the shared budget, joining a machine, the single-machine factory, and the stages.

#### Scenario: Header and sections
- **WHEN** a test reads docs/adr/0007-fabrica-distribuida.md with CRLF normalised
- **THEN** the first line matches /^# ADR 0007/ and the file contains `**Estado:**`, `**Fecha:**`, `## Contexto`, `## Decisión` and `## Consecuencias`

#### Scenario: Covers every topic
- **WHEN** the test looks for the topic terms
- **THEN** the file contains `atómic`, `latido`, `plazo`, `sin subir`, `conflicto`, `privado`, `githubMeter`, `GitHub Actions`, `presupuesto`, `zero unirse`, `una sola máquina`, `secretos` and `Etapa`

### Requirement: Distributed block is optional and strict
The factory file SHALL accept an optional strict `distributed` object with `repository` (required, `owner/name`), `heartbeatSeconds` (integer, at least 30, default 60), `leaseMinutes` (integer, at least 2, default 10) and an optional `machine` name. The schema MUST refuse a lease shorter than three heartbeats, unknown keys, and a repository not shaped `owner/name`.

#### Scenario: Absent block
- **WHEN** a factory file without `distributed` is parsed
- **THEN** `config.distributed` is undefined and parsing succeeds

#### Scenario: Defaults
- **WHEN** `distributed: { repository: me/zero-coord }` is parsed
- **THEN** heartbeatSeconds is 60 and leaseMinutes is 10

#### Scenario: Refusals
- **WHEN** the block has `repository: zero-coord`, or `heartbeatSeconds: 300, leaseMinutes: 10`, or an extra key `token`
- **THEN** parsing fails each time

### Requirement: Stable machine identity
`machineIdentity` SHALL return the same id for a ZERO_HOME on every call. It SHALL generate the id once and keep it in kv `machine:id`. The machine's name SHALL be `distributed.machine` when set, otherwise the host name reduced to letters, digits and `-`.

#### Scenario: Same id twice
- **WHEN** machineIdentity is called twice on the same store
- **THEN** both calls return the same id and kv `machine:id` holds it

#### Scenario: Name from config or host
- **WHEN** called with `machine: notebook` and then with no machine and an injected host name `Mi PC.local`
- **THEN** the names are `notebook` and `Mi-PC-local`

### Requirement: Machine declares its capabilities
`machineCapabilities` MUST report `platform`, `box` (true only when the injected box status is ready) and `engines` (the engine names the station chains use). It MUST NOT include secret values, paths or environment variables.

#### Scenario: Box not ready
- **WHEN** capabilities are computed with a box status that is not ready
- **THEN** `box` is false and the object's keys are exactly platform, box and engines

### Requirement: Atomic job claim
`claimJob(api, jobId, machine, now)` SHALL let exactly one machine hold a job. It creates the claim ref `claims/<job>`. When that ref already exists and its holder's last heartbeat is within `leaseMinutes`, the call SHALL return `{claimed: false, holder}` without writing anything.

#### Scenario: Two machines race
- **WHEN** machines A and B call claimJob for the same job on one memory CoordApi
- **THEN** one gets `claimed: true`, the other gets `claimed: false` with the winner as holder

#### Scenario: Live holder kept
- **WHEN** B claims a job held by A, whose heartbeat is 1 minute old with leaseMinutes 10
- **THEN** B is refused and the claim ref is unchanged

### Requirement: Lease expiry frees a dead machine's jobs
When the holder's last heartbeat is older than `leaseMinutes`, `claimJob` SHALL take the job over by advancing the claim ref only from the tip it read (compare-and-swap). When two machines take over at once, exactly one MUST succeed.

#### Scenario: Expired holder
- **WHEN** B claims a job held by A, whose heartbeat is 11 minutes old with leaseMinutes 10
- **THEN** B gets `claimed: true` and the claim ref names B

#### Scenario: Concurrent takeover
- **WHEN** B and C both try to take over A's expired claim from the same read tip
- **THEN** one succeeds and the other gets `claimed: false`

### Requirement: A returning machine does not step on a taken job
`stillHolds(api, jobId, machineId)` MUST return false once the claim ref names another machine. `releaseJob` SHALL delete the claim only while it names the releasing machine.

#### Scenario: Returning machine
- **WHEN** A comes back after B took over A's job and calls stillHolds and then releaseJob
- **THEN** stillHolds returns false, releaseJob deletes nothing, and B still holds the job

### Requirement: Heartbeat record carries only public fields
`heartbeat(api, machine, capabilities, jobs, now)` SHALL write this machine's ref `machines/<id>` with a JSON record whose keys are exactly id, name, at, capabilities and jobs. `listMachines(api, now, leaseMinutes)` SHALL return every machine with `alive` true only when its `at` is within `leaseMinutes`.

#### Scenario: Alive and down
- **WHEN** A beats now and B beat 20 minutes ago, then listMachines runs with leaseMinutes 10
- **THEN** A is alive, B is not, and each record has exactly the five keys

### Requirement: GitHub coordination adapter
`githubCoord(octokit, repository)` SHALL implement CoordApi with git refs under `refs/heads/zero-coord/` and commits on the empty tree. A 422 when creating an existing ref, or when a non-forced update is not a fast-forward, SHALL become `CoordConflict`. The adapter MUST NOT call any GitHub Actions endpoint.

#### Scenario: Existing ref
- **WHEN** createRef runs against a stubbed Octokit whose `git.createRef` answers 422 `Reference already exists`
- **THEN** it throws CoordConflict

#### Scenario: No Actions
- **WHEN** the adapter's calls in the tests are recorded
- **THEN** no request path contains `/actions/`

### Requirement: Coordination pass only when distributed
When `distributed` is set, the daemon SHALL run a coordination pass at most every `heartbeatSeconds`. The pass SHALL go through `githubMeter` as the pass `coord`, write this machine's heartbeat and store the machine list in kv `coord:machines`. Without `distributed`, the pass SHALL send no request and write no `coord:` key. During `githubHalt`, the pass SHALL skip its turn.

#### Scenario: Single machine unchanged
- **WHEN** a `once` daemon run has no `distributed` block and an injected CoordApi
- **THEN** the CoordApi records no call and the store has no kv key starting `coord:`

#### Scenario: Heartbeat written
- **WHEN** a `once` run has `distributed` set and a memory CoordApi injected through DaemonOptions
- **THEN** `machines/<id>` exists and kv `coord:machines` lists this machine as alive

#### Scenario: GitHub paused
- **WHEN** the pass runs while githubHalt returns a pause
- **THEN** the CoordApi records no call

### Requirement: Machines shown in status and panel
`FactoryStatus.machines` SHALL carry the stored machine list. When the list is present, `formatStatus` and the panel summary SHALL show a `Máquinas:` block with one line per machine: its name, `viva` or `caída`, the last heartbeat as HH:MM, and its jobs. Without `distributed`, neither SHALL show the block.

#### Scenario: Two machines
- **WHEN** kv `coord:machines` holds a live `pc-vieja` with job abc12345 and a down `mac`
- **THEN** formatStatus contains `Máquinas:`, a line with `pc-vieja`, `viva` and `abc12345`, and a line with `mac` and `caída`

#### Scenario: No block
- **WHEN** the factory has no `distributed` block
- **THEN** formatStatus does not contain `Máquinas:`

### Requirement: Joining a factory
`zero unirse <owner/repo>` (`joinFactory` in app.ts, writing through `editConfig`) SHALL set `distributed.repository`. It MUST refuse, writing nothing, when the name is not `owner/name`, when the injected repository check says the repository is public, or when the check cannot read it. It MUST never write a secret into the factory file or the coordination repository.

#### Scenario: Private repository
- **WHEN** joinFactory runs with `me/zero-coord` and a check answering private
- **THEN** the factory file has `distributed.repository: me/zero-coord`

#### Scenario: Public repository
- **WHEN** the check answers public
- **THEN** it returns a Spanish reason containing `público` and the file is unchanged

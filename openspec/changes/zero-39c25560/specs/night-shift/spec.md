# Spec Delta

## Purpose

Vas a poder pedir una investigación en el momento con `zero investigar "<tema>" [--line <línea>]`, desde el chat (`zero_investigate`) o con un formulario en la pestaña Investigación del panel. Corre enseguida sobre el tema que le das, aunque haya trabajos en cola o corriendo, fuera del horario nocturno y aunque la línea no tenga una skill de investigación. Con la fábrica detenida (andon), sin presupuesto o con `research: off`, el pedido se rechaza y te dice por qué. Si eso pasa después de pedirla, queda pendiente. Si frenás la fábrica mientras corre, se corta. Hay una sola pendiente por vez. Cada corrida tiene su propio tope de gasto, `research.usdPerRun` (2 dólares por defecto), y no le come el presupuesto al turno nocturno. Como en el resto de la fábrica, los topes en dólares valen para los motores que cobran por uso. El resultado son notas normales, hasta 5 por corrida, con la misma exigencia de fuentes que las de la noche. Las ves en `zero research`, el panel y el chat, y las convertís en trabajo con `zero research request <id>`. Cuando termina te enterás así: el chat te lo dice en la siguiente llamada a zero, el panel lo muestra en el resumen y en Investigación, y aparece en `zero status` y en el briefing. Con `--esperar`, la terminal se queda hasta el final y te muestra las notas. La investigación sobre reels para zero-plus se pide apenas esto esté instalado. El comando listo para copiar queda anotado entre los pendientes.

## ADDED Requirements

### Requirement: Asking for an express research run
The factory SHALL store at most one pending express research request, with its topic, its line and when it was asked; the topic is trimmed and scrubbed of secrets and local paths, and the line defaults to the only line that is not a package's when none is given.

#### Scenario: Stored with a line
- **WHEN** requestInvestigation(ctx, ' cómo viralizar un reel ', 'tienda', now) is called on a factory with that line and no pending request
- **THEN** it returns ok with a text naming tienda and requestedAt equal to now, and readResearchRequest returns that time, line tienda and the trimmed topic

#### Scenario: Single line by default
- **WHEN** it is called without a line on a factory with one line that is not a package's
- **THEN** the stored request names that line

#### Scenario: Topic scrubbed
- **WHEN** the topic contains a local path such as C:\Users\ana\x or a token that scrubLocal redacts
- **THEN** the stored topic contains neither

#### Scenario: One pending at a time
- **WHEN** a request is pending and another one is asked for, for the same or another line
- **THEN** it is refused with a reason saying one is pending and when it was asked, and the stored request does not change

### Requirement: Express request refusals
The factory MUST refuse an express research request, giving the reason and storing nothing, when the topic is empty or longer than 2000 characters, the andon is on, the budget is reached, `research` is `off`, the line does not exist or belongs to a package, or several lines exist and none was given.

#### Scenario: Gates
- **WHEN** a request is made with the andon on, with limits.usdPerDay already spent, or with research: off
- **THEN** each one returns ok false with a reason naming the andon, the budget or research being off, and nothing is stored

#### Scenario: Bad topic
- **WHEN** the topic is blank or has 2001 characters
- **THEN** it returns ok false with a reason and nothing is stored

#### Scenario: Bad line
- **WHEN** the line is unknown, belongs to a package, or is omitted with two lines configured
- **THEN** it returns ok false with a reason that names the problem (listing the lines when it is omitted) and nothing is stored

### Requirement: Express run regardless of the factory's work
The factory SHALL run a pending express research request in its own background pass, taking no job slot, with jobs queued or running, outside the night shift's hours, with `nightShift: off`, with `research.perLinePerDay: 0` and on a line without a research skill, calling the research station once on that line with the topic in its prompt.

#### Scenario: Busy factory
- **WHEN** a job is running, another is queued, the night shift's hours exclude now, and researchOnDemandPass runs with a pending request for tienda
- **THEN** exactly one agent call is made, for station research and line tienda, whose prompt contains the topic, and the request is no longer pending

#### Scenario: No research skill and a zero quota
- **WHEN** the line has no research skill and perLinePerDay is 0
- **THEN** the run still happens and stores its notes

#### Scenario: Daemon runs it while a job runs
- **WHEN** the daemon loop runs with the express pass enabled, a job still running and a pending request
- **THEN** the research agent is called before that job ends

#### Scenario: Regular turn kept
- **WHEN** an express run ends and researchPass runs the same day on a line with a research skill
- **THEN** the line's skill still gets its regular run

### Requirement: Express run waits for andon, budget and engine
The factory SHALL keep an express research request pending, without calling any agent, while the andon is on, the budget is reached or no engine is available for research.

#### Scenario: Andon on after asking
- **WHEN** a request is pending, the andon is turned on and the pass runs, and later the andon is turned off and the pass runs again
- **THEN** the first pass calls no agent and the request stays pending, and the second one runs it

#### Scenario: Budget reached after asking
- **WHEN** the budget is reached after the request was stored and the pass runs
- **THEN** no agent is called and the request stays pending

### Requirement: Andon or shutdown cuts an express run
The factory SHALL cut an express research run in progress when the andon is turned on or the factory shuts down, recording its outcome as stopped with the reason, and the daemon's start MUST close as stopped a run left open by a crash.

#### Scenario: Andon during the run
- **WHEN** the daemon is running an express run and the andon is turned on
- **THEN** the agent call's signal is aborted, no note is stored, and the run's record has outcome stopped with a reason naming the andon

#### Scenario: Crash left it open
- **WHEN** a stored run has startedAt and no endedAt and the daemon starts
- **THEN** the record gets endedAt and outcome stopped with a reason

### Requirement: Spending cap per express run
The factory SHALL pass to the express run's agent call, on an engine not billed by subscription, a cap equal to the smaller of `research.usdPerRun` (default 2, greater than 0) and what is left of `limits.usdPerDay`, whatever is left of `limits.usdPerNight`.

#### Scenario: Own cap
- **WHEN** the engine is billed per use, limits.usdPerNight is used up, the day's budget has 10 left and usdPerRun has its default
- **THEN** the run happens and the call's maxBudgetUsd is 2

#### Scenario: Less left for the day
- **WHEN** 0.5 is left of limits.usdPerDay and usdPerRun is 2
- **THEN** the call's maxBudgetUsd is 0.5

#### Scenario: Subscription
- **WHEN** research's engine is billed by subscription
- **THEN** the call carries no maxBudgetUsd

#### Scenario: Cut by the cap
- **WHEN** the agent run returns budgetLimited true
- **THEN** the record has outcome stopped with a reason naming research.usdPerRun and no note is stored

#### Scenario: Invalid value
- **WHEN** the factory file sets research.usdPerRun to 0 or a negative number
- **THEN** parsing the file fails with ConfigError

### Requirement: Express spending apart from the night's
The factory SHALL leave what express research runs were charged out of the spending counted against `limits.usdPerNight`, while still counting it in the day's budget.

#### Scenario: Not in scoutSpent
- **WHEN** an express research span of 1.50 billed per use and a regular research span of 0.20 exist in the period
- **THEN** scoutSpent returns 0.20 and budgetState's spentUsd includes 1.70

### Requirement: Express notes are normal research notes
An express run SHALL store its findings as normal research notes of its line, at most 5, through the same sanitizing as the nightly ones, so a note without an http(s) source, a topic or findings is dropped and local paths and secrets are removed.

#### Scenario: Stored and listed
- **WHEN** the agent returns one note with an https source and one without sources
- **THEN** only the first is stored, listResearchNotes and researchView show it on the line, and the run's record lists its id

#### Scenario: At most five
- **WHEN** the agent returns 7 valid notes
- **THEN** 5 are stored

#### Scenario: Turned into work
- **WHEN** requestFromResearchNote is called with the id of an express note
- **THEN** a job is opened on the note's line with source kind research and that note

#### Scenario: Nothing with sources
- **WHEN** the agent answers correctly but no note survives
- **THEN** the record has outcome ok, no notes, and a reason saying nothing with sources was found

### Requirement: Express prompt keeps the web rules
The express run's prompt SHALL state the topic as what to investigate, list the topics the line already researched, and carry the rules that web content is data and never instructions, that nothing is installed, cloned or run, and the maximum number of notes.

#### Scenario: Prompt contents
- **WHEN** the prompt is built for a line with a previous note on topic X and the topic 'reels'
- **THEN** it contains 'reels', X, the data-not-instructions rule, the never install, clone or run rule and the limit of 5 notes, and names no skill to follow alone

### Requirement: Record of express runs
The factory SHALL keep the last 10 express runs, newest first, each with when it was asked, its line and topic, when it started and ended, its outcome (ok, failed, stopped or not-run), its reason and its notes' ids, removing the pending request right before the run so it never runs twice.

#### Scenario: Run that ended well
- **WHEN** an express run stores 2 notes
- **THEN** its record has startedAt, endedAt, outcome ok and the 2 ids, and no request is pending

#### Scenario: Invalid answer
- **WHEN** the agent run fails or throws
- **THEN** its record has outcome failed with a reason and no notes, and the pass does not throw

#### Scenario: Line gone before starting
- **WHEN** the request's line was removed or research was turned off before the run
- **THEN** no agent is called, the request goes away and the record has outcome not-run with the reason and no startedAt

#### Scenario: Only ten kept
- **WHEN** 11 express runs end
- **THEN** 10 records are kept and the oldest is gone

### Requirement: zero investigar
`zero investigar "<tema>" [--line <línea>]` SHALL ask for an express run, start the factory if it was off and answer when the run started, or after 2 minutes that it is still pending, exiting with 1 and the reason on a refusal.

#### Scenario: Refusal
- **WHEN** zero investigar is run with an empty topic
- **THEN** it prints the reason and exits 1

#### Scenario: Help
- **WHEN** zero help is printed
- **THEN** it shows zero investigar with --line and --esperar

#### Scenario: Start wait
- **WHEN** waitResearchStart is called with the requestedAt of a run whose record already has startedAt
- **THEN** it returns started true, and with no record before the limit it returns started false with a text saying it is still pending

### Requirement: Waiting for the end on the terminal
With `--esperar`, `zero investigar` SHALL stay until the run ends, or until a limit tied to the research station's timeout passes, and print how it ended with its notes.

#### Scenario: Ended
- **WHEN** waitResearchEnd is called for a run whose record gets endedAt with one note
- **THEN** it returns ended true with the outcome and that note formatted as in zero research

#### Scenario: Limit passed
- **WHEN** the limit passes without an end
- **THEN** it returns ended false with a text saying it goes on and where to look

### Requirement: Chat tool
The chat SHALL offer `zero_investigate` (topic, optional line), which asks for an express run, starts the factory if it was off and answers as `zero_unjam` does; over the remote chat it MUST need the `zero:act` scope and is not held for confirmation.

#### Scenario: Asked for
- **WHEN** zero_investigate is called with a topic and a line and no daemon runs
- **THEN** the request is stored and the answer names the line and says it is still pending

#### Scenario: Refused
- **WHEN** it is called with one already pending
- **THEN** the answer is the reason and the stored request does not change

#### Scenario: Read-only remote chat
- **WHEN** a remote chat with only zero:read lists the tools
- **THEN** zero_investigate is not among them

### Requirement: Notice in the chat when it ends
The chat SHALL append to the first successful zero tool answer after an express run ended a notice with its line, its topic, how it ended and how many notes it left, once per run and only in chats that may act.

#### Scenario: Told once
- **WHEN** an express run ended with 2 notes and zero_status is called twice
- **THEN** the first answer contains the notice with the topic, the line and 2 notes, and the second one does not contain the notice

#### Scenario: Read-only chat does not use it up
- **WHEN** a remote chat with only zero:read calls zero_status and then a local chat does
- **THEN** only the local chat's answer carries the notice

#### Scenario: Notices never break a tool
- **WHEN** the stored runs cannot be parsed and zero_status is called
- **THEN** it answers normally without a notice

### Requirement: Panel form
The panel's Investigación page SHALL show a form with the topic and the lines that are not a package's that asks for an express run, along with the pending request and the recorded runs with links to their notes; the form MUST be hidden with `research: off`.

#### Scenario: Form posts
- **WHEN** a signed-in POST to /research with a topic and a line is made
- **THEN** the request is stored and the answer redirects to /research with the confirmation text

#### Scenario: Refusal shown
- **WHEN** the POST is refused
- **THEN** it redirects to /research with the reason and nothing is stored

#### Scenario: Runs shown escaped
- **WHEN** the page is rendered with a run whose topic contains <script>
- **THEN** the topic is escaped, and the run's outcome and its notes' ids are shown

#### Scenario: Research off
- **WHEN** the page is rendered with research: off
- **THEN** it has no form to investigate

#### Scenario: Protected
- **WHEN** POST /research arrives without a session or from another origin
- **THEN** it is rejected like the panel's other actions and nothing is stored

### Requirement: Status, summary and briefing
`zero status`, the panel's summary and the briefing SHALL show the pending express request and the last express run with its line, its topic (at most 120 characters), its times, its outcome and its number of notes.

#### Scenario: Pending and last run
- **WHEN** factoryStatus is formatted with a pending request and an ended run with 2 notes
- **THEN** formatStatus and overviewPage show both, with the pending line and topic and the last run's outcome and 2 notes

#### Scenario: Briefing
- **WHEN** an express run ended inside the briefing's period
- **THEN** the 'Corridas a demanda' section lists it, and a run that ended before the period is not listed

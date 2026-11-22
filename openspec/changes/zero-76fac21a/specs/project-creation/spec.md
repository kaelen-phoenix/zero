# Spec Delta

## Purpose

Vas a poder arrancar un proyecto desde cero con `zero repo crear <nombre>`. Zero crea el repositorio en GitHub, privado salvo que pidas `--publico`. Después lo clona dentro de la carpeta de la fábrica, lo suma como línea nueva con sus comandos de preparación y verificación, y si le pasás `--pedido "..."` abre el primer trabajo con eso (por ejemplo, la demo para un cliente). Ese trabajo se construye como cualquier otro. Antes de crear nada, zero te muestra qué va a hacer y espera tu confirmación. Ningún agente ni estación puede crear un repositorio por su cuenta. Desde el chat, el pedido queda en espera hasta que lo confirmes con `zero mcp confirmar <id>` o con el botón Confirmar del panel. Desde el panel hay un formulario "Proyecto nuevo" con una página de confirmación. Si el token de GitHub no tiene permiso para crear repositorios, zero lo dice con claridad y explica qué permiso falta. Con `--coordinacion` crea el repositorio privado de coordinación de la fábrica distribuida y une esta máquina a esa fábrica. Publicar la demo en una URL (Vercel) queda para un paso posterior.

## ADDED Requirements

### Requirement: Explicit approval before creating
Zero MUST NOT call GitHub's repository creation until the person in charge has approved that specific creation: an interactive confirmation (or `--yes`) on the CLI, a confirmed held action for the chat, or a POST with confirm=1 in the panel. Without a terminal and without `--yes`, the CLI SHALL create nothing.

#### Scenario: CLI declined
- **WHEN** createProject runs with a confirm function that returns false
- **THEN** the injected GitHub create function is never called, the factory file is unchanged, no folder is created under the projects directory, and the result says nothing was created

#### Scenario: CLI accepted
- **WHEN** createProject runs with a confirm function that returns true
- **THEN** the injected create function is called exactly once with the given name and private=true

#### Scenario: Confirmation shows the plan
- **WHEN** createProject runs with a say function
- **THEN** before confirm is asked, the text said includes the repository name, its visibility (privado/público) and the folder where it will be cloned

### Requirement: Private by default
A created repository SHALL be private unless the person in charge passes `--publico` (CLI) or publico=true (chat, panel). Coordination repositories MUST always be private.

#### Scenario: Default private
- **WHEN** createProject is called without publico
- **THEN** the create function receives private=true

#### Scenario: Public on request
- **WHEN** createProject is called with publico=true
- **THEN** the create function receives private=false

#### Scenario: Coordination refuses public
- **WHEN** createProject is called with coordination=true and publico=true
- **THEN** it returns an error text saying the coordination repository has to be private, and create is not called

### Requirement: Validation before GitHub
Before asking for confirmation, zero MUST check that the name is valid (`nombre` or `cuenta/nombre`, GitHub repository characters), that no line with the derived line name exists, that the clone folder does not exist yet, and that a GitHub token is available. When any check fails it SHALL say why and call nothing on GitHub.

#### Scenario: Bad name
- **WHEN** createProject is called with 'mi demo!'
- **THEN** the result says the name is invalid and neither confirm nor create is called

#### Scenario: Line taken
- **WHEN** the factory already has a line named 'demo-x' and createProject is called with 'demo-x'
- **THEN** the result says the line already exists and create is not called

#### Scenario: No token
- **WHEN** the injected token lookup returns undefined
- **THEN** the result mentions that there is no GitHub token and points to `zero setup`, and create is not called

### Requirement: Clear message when the token cannot create repositories
When GitHub refuses the creation, zero SHALL return a clear Spanish message that tells the cases apart: no permission (403/404: the token needs Administration write on a fine-grained token or the `repo` scope on a classic one, or membership of the organization), an invalid token (401), and a name already taken (422). It MUST NOT fail silently or show only the raw error.

#### Scenario: Forbidden
- **WHEN** the create function throws an error with status 403
- **THEN** the result is not ok and its text mentions that the GitHub token has no permission to create repositories and names the missing permission

#### Scenario: Name taken
- **WHEN** the create function throws an error with status 422
- **THEN** the result text says a repository with that name already exists on GitHub

#### Scenario: Bad credentials
- **WHEN** the create function throws an error with status 401
- **THEN** the result text says the GitHub token is invalid or expired

### Requirement: Clone into ZERO_HOME and add a line
After a successful creation (with an initial commit, so the default branch exists), zero SHALL clone the repository into `<ZERO_HOME>/projects/<line name>`, add it to the factory file as a new line (name from the slug of the repository name, baseBranch from the repository's default branch, integrate pull-request, setup and verify from the given commands or else detected from the clone), and keep the file's comments.

#### Scenario: Line added
- **WHEN** createProject succeeds with a fake create that returns a clone URL and default branch 'main' and a fake clone that runs git init in the target folder
- **THEN** the factory file has a line named after the repository whose repo is under the projects directory of ZERO_HOME, with baseBranch main and integrate pull-request, and ctx.config includes it

#### Scenario: Given commands
- **WHEN** createProject is called with verify ['npm test'] and setup ['npm ci']
- **THEN** the new line's verify is ['npm test'] and its setup is ['npm ci']

#### Scenario: Clone fails
- **WHEN** the fake clone fails after the repository was created
- **THEN** the result says the repository was created (with its URL) but could not be cloned, no line is added, and nothing is deleted on GitHub

### Requirement: First job from the request
When the person in charge gives a request text (`--pedido` on the CLI, pedido in the chat or panel), zero SHALL queue a job on the new line with that text through requestWork. The job then goes down the line like any other job.

#### Scenario: Job queued
- **WHEN** createProject succeeds with pedido 'Demo para la empresa X con turnos online'
- **THEN** the store has one queued job on the new line whose request is that text, and the result text includes the job id

#### Scenario: No request
- **WHEN** createProject succeeds without pedido
- **THEN** no job is created and the result tells how to request work on the new line

### Requirement: Coordination repository
With `--coordinacion` (coordination=true), zero SHALL create a private repository, not clone it, not add a line, and then join this machine to it through joinFactory, which writes distributed.repository.

#### Scenario: Coordination created and joined
- **WHEN** createProject is called with coordination=true and a fake create that returns full name 'me/zero-coord' and private true
- **THEN** the factory file has distributed.repository 'me/zero-coord', no line was added, and the clone function was not called

### Requirement: Chat holds the creation
The chat tool zero_repo_create MUST NOT create anything when called, over both the local stdio and the remote server. It SHALL hold the action as a pending action (kv `mcp-pending:<id>`) that the person in charge confirms with `zero mcp confirmar <id>` or the panel's Confirmar. Only confirmRemoteAction SHALL run createProject.

#### Scenario: Local chat holds
- **WHEN** a client of the stdio MCP server (no remote option) calls zero_repo_create with name 'demo-x'
- **THEN** no create is called, pendingRemoteActions lists one action with tool zero_repo_create, and the reply contains its id and tells how to confirm it

#### Scenario: Confirm runs it
- **WHEN** confirmRemoteAction is called with that id and an injected project creator
- **THEN** the creator runs once with the held name, publico and pedido, and a second confirmation of the same id says there is no pending action

#### Scenario: Description
- **WHEN** describeRemoteAction gets a zero_repo_create action for 'demo-x' that is not public
- **THEN** the text says it creates the private repository demo-x on GitHub

### Requirement: Panel form with confirmation
The panel SHALL offer a 'Proyecto nuevo' form (name, público, pedido, verify) whose POST without confirm=1 only shows a confirmation page. It MUST create the repository only on a same-origin POST that carries confirm=1.

#### Scenario: No confirm
- **WHEN** the form is posted without confirm=1
- **THEN** the response is a confirmation page with the name and visibility, and the injected creator is not called

#### Scenario: Confirmed
- **WHEN** the form is posted with confirm=1
- **THEN** the injected creator is called once and the page shows its result text

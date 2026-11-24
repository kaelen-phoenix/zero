# Tasks

## 1. Etapa 1: Create the project from the CLI

- [x] 1.1 Open the OpenSpec change openspec/changes/zero-76fac21a (proposal, tasks, specs/project-creation/spec.md).
- [x] 1.2 Add home.projects in src/home.ts.
- [x] 1.3 src/project.ts: name validation, the RepoCreator type, the Octokit adapter with auto_init, and the 401/403/404/422 error texts.
- [x] 1.4 createProject in src/app.ts: validation, plan, confirm, create, clone into home.projects, line through editConfig (integrate pull-request), refresh ctx.config, first job with requestWork, and coordination via joinFactory.
- [x] 1.5 `zero repo crear` in src/cli.ts with --publico, --coordinacion, --pedido, --verify, --setup and -y, plus USAGE.
- [x] 1.6 test/project-create.test.ts with fake create, clone and token, covering confirmation, visibility, validations, error messages, the line, clone failure, first job and coordination.
- [x] 1.7 Docs: docs/agents/core.md, docs/agents/distributed.md, README.md and README.es.md. typecheck, test and openspec validate pass.

## 2. Etapa 2: The chat holds the creation for confirmation

- [x] 2.1 The zero_repo_create variant of RemoteAction, its describeRemoteAction text, and its confirmRemoteAction branch with an injectable creator.
- [x] 2.2 The zero_repo_create MCP tool in src/mcp/server.ts, always held with holdRemoteAction (local stdio and remote), replying with the id and how to confirm it.
- [x] 2.3 Tests: a stdio client calls the tool and nothing is created, the pending action shows up, confirming runs it once, and a second confirmation says there is no pending action.
- [x] 2.4 Docs in docs/agents/panel.md.

## 3. Etapa 3: 'Proyecto nuevo' form in the panel

- [ ] 3.1 The 'Proyecto nuevo' form and its confirmation page in src/panel/html.ts, plus the POST route in src/panel/server.ts with same-origin, confirm=1 and an injectable creator in PanelOptions.
- [ ] 3.2 Tests: without confirm=1 only the confirmation page shows, with confirm=1 the creator runs once.
- [ ] 3.3 Docs in docs/agents/panel.md, keeping both READMEs in sync if they mention the panel.

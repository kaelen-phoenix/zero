# Tasks

## 1. Etapa 1: Índice y archivos por área

- [ ] 1.1 Crear el cambio OpenSpec openspec/changes/split-agents-guide/ (proposal, tasks y delta de project-docs) y validarlo.
- [ ] 1.2 Crear los trece archivos de docs/agents/ moviendo el texto de Layout sin perder información, y reescribir AGENTS.md como índice con Commands, Areas y Conventions, más la regla nueva.
- [ ] 1.3 Comprobar con `git show HEAD:AGENTS.md` que no se perdió ningún fragmento entre comillas invertidas.
- [ ] 1.4 Adaptar test/docs.test.ts (helper guide(), pruebas del índice, de los archivos, de la regla y de CLAUDE.md) y correr typecheck, test y openspec validate.

## 2. Etapa 2: Listas de los README

- [ ] 2.1 Convertir la lista de herramientas del chat y la de próximas etapas en viñetas de un renglón en README.md y README.es.md, con la misma estructura, y nombrar docs/agents/ en Development / Desarrollo.
- [ ] 2.2 Agregar las pruebas de esas listas en test/docs.test.ts y correr typecheck, test y openspec validate.

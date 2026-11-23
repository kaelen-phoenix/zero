# Tasks

## 1. Etapa 1: Express pass, cap and daemon

- [x] 1.1 Add research.usdPerRun (positive, default 2) to ResearchSchema and its default in src/config.ts, and update the default expectation in test/research.test.ts
- [x] 1.2 Add an optional attrs to AgentTrace in src/agent.ts, put on the agent span; express calls set zero.on_demand; scoutSpent in src/line/scout.ts skips research spans with it
- [x] 1.3 In src/line/research.ts add ResearchRequest, ResearchRunRecord, keys research-demand, research-demand-runs (last 10, newest first) and research-demand-told, tolerant readers, the express prompt, researchOnDemandProblem, researchOnDemandReady, researchOnDemandPass and closeInterruptedResearch; share the agent call, sanitizeNotes and the storing with researchLine; at most 5 notes, no skill, business false; never log the topic
- [x] 1.4 Cap the call at the smaller of research.usdPerRun and what is left of limits.usdPerDay on engines not billed by subscription; a budgetLimited run ends stopped without notes
- [x] 1.5 Add requestInvestigation, waitResearchStart and waitResearchEnd to src/app.ts, following requestUnjam and waitUnjamStart
- [x] 1.6 In src/daemon.ts add DaemonOptions.researchOnDemand (off in once runs unless set) and a background pass independent of idle, urgent and unjamming, with its own AbortController aborted when the andon is on and joined with researchStop; await it in the shutdown block and call closeInterruptedResearch at start
- [x] 1.7 Update the opening and the skill paragraph of agents/research.md for runs that follow a topic
- [x] 1.8 Write test/research-on-demand.test.ts for the request, refusals, gates, cap, night spending, notes, records, crash and daemon (busy factory, andon cut)
- [x] 1.9 Document it in docs/agents/night-shift.md and docs/agents/daemon.md

## 2. Etapa 2: Terminal, chat, status and notice

- [ ] 2.1 Add FactoryStatus.research (enabled, the lines that are not a package's, pending, runs) and its formatters in src/format.ts
- [ ] 2.2 Show the pending request and the last run in formatStatus and in the briefing's 'Corridas a demanda' section
- [ ] 2.3 Add zero investigar "<tema>" [--line] [--esperar] to src/cli.ts with its usage text, joining unquoted words
- [ ] 2.4 Add zero_investigate to src/mcp/server.ts outside READ_TOOLS, with the same start wait as zero_unjam
- [ ] 2.5 Append the notice of ended and untold runs in the server's withFactory for chats that may act, storing the told mark; failures are only logged
- [ ] 2.6 Tests for status, briefing, CLI help and refusal, start and end waits, the tool, the read-only remote chat, the notice and the tool list in test/interface.test.ts

## 3. Etapa 3: Panel and documentation

- [ ] 3.1 Extend researchPage in src/panel/html.ts with the form (hidden with research: off), the pending request and the runs linking to their notes' cards, all escaped, and add an anchor id to researchCard
- [ ] 3.2 Add POST /research to src/panel/server.ts, redirecting to /research with the result, and pass the new data to researchPage
- [ ] 3.3 Show the pending request and the last run in overviewPage with a link to /research, and update the research text of the Agentes page
- [ ] 3.4 Tests for the form, the POST, refusals, escaping, research: off, and the session and origin checks
- [ ] 3.5 Update the Research sections, tool lists and configuration examples of README.md and README.es.md with the same headings and code blocks, and docs/agents/panel.md

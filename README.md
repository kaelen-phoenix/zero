# zero

English · [Español](README.es.md)

**zero in the loop**: the factory takes the human's place in the loop, and the owner decides where to step back in.

zero is a **software factory that runs on your machine**. You ask it for work from your AI client's chat (Claude Code, Codex, agy…) or from the terminal. The factory specifies it, builds it, verifies it, reviews it and integrates it on its own, in the background, even if you close the chat.

It is open source (Apache-2.0) and free. Everyone has their own factory: nobody connects to yours.

The project site is [zerointheloop.com](https://zerointheloop.com): it lives in `site/` as a static site (HTML, CSS and JS with no dependencies and no build step), and Vercel publishes it with `site/` as the root folder.

## How it works

```
 you, in the chat or the terminal: "I want to apply discounts to prices"
                    │
                    ▼  (zero_request / zero request)
 ┌──────────────── zero daemon (your machine) ─────────────────────────────────┐
 │  spec ──▶ build ──▶ verify ──▶ review ──▶ security ──▶ integrate             │
 │  WHEN/THEN    code +     tests, deleted   findings with        merge / branch│
 │  requirements tests      tests,           verified citations   / PR (and     │
 │  (OpenSpec)              protected paths                       auto-merge)   │
 │        ▲───────── retries with concrete feedback ──────────────────────┘     │
 │  state in SQLite · traces and costs · townhall (the network's memory)        │
 └──────────────────────────────────────────────────────────────────────────────┘
```

- **Stations with a contract.** Each station receives and delivers something verifiable. The specification is an OpenSpec change with requirements and scenarios.
- **zero enforces the guarantees, not the engine:**
  - the `spec`, `review` and `security` stations are read-only (if an engine writes, it is discarded);
  - `security` is a second review, security only, which can use another engine;
  - every station has a time limit;
  - structured outputs are validated;
  - deleted or disabled tests are detected;
  - protected paths are not touched;
  - review findings that cite files or lines that do not exist are discarded.
- **It never overwrites your work.** Each request works in its own copy (`git worktree`) and its own branch. It only integrates into your branch if your copy is clean; otherwise it asks you.
- **Engine-agnostic.** Claude (Agent SDK), Codex, Antigravity or any CLI declared in the configuration, and a different one per station if you want.

## Autonomy levels

| Level | What you approve |
|---|---|
| L0 assisted | The specification and the integration |
| L1 supervised | Only the specification ("this is what you will get") |
| L2 watched | Nothing day to day; it asks only when something protected is touched or the pay-per-use budget runs out |
| L3 lights-out | Nothing; policies are hard limits, and there is the stop button |

By default the factory is configured at **L3**. L3 requires the **isolation box** to be ready (see below); while something is missing, **it works at L2 and says exactly what is missing**. Questions never block the factory: the job waits, the others keep going, and if nobody answers in time the default action applies.

## Getting started

```sh
git clone https://github.com/kaelen-phoenix/zero && cd zero
npm install && npm run build
node dist/cli.js init       # creates ~/.zero/zero.factory.yaml and adds the current repo as a line
node dist/cli.js install    # registers zero in Claude Code (and shows you how to do it in Codex / OpenCode)
node dist/cli.js box setup  # prepares the isolation box (asks permission before installing anything)
```

Then, in your chat: *"zero, I want my store to calculate discounts"*. Or from the terminal:

```sh
zero request "I want my store to calculate discounts"   # the factory starts on its own if it was off
zero status                    # how everything is going
zero status <id>               # a job's detail, and the question if it is waiting for you
zero approve <id>              # approve (or --reject --note "why")
zero trace <id>                # step by step: stations, attempts, agents, commands, cost
zero briefing                  # report: production, cost, lessons, what needs you
zero stop [id]                 # andon: stops a job or the whole factory · zero resume
zero line add <path>           # add another project
zero start [--detach] · zero shutdown
```

The chat does the same with `zero_request`, `zero_status`, `zero_answer`, `zero_stop`, `zero_resume`, `zero_briefing`, `zero_trace` and `zero_lines`; it also has `zero_proposals` and `zero_proposal_decide` (night shift), `zero_research` and `zero_research_request` (research), and `zero_egress` and `zero_egress_block` (internet egress).

## GitHub issues

A line can take as requests the issues of its GitHub repository that carry a label:

```sh
zero issues on                 # on the line (or --line <name>); creates the "zero" label if missing   [--label other]
zero issues off
```

You file an issue, give it the `zero` label, and the factory checks every minute and turns it into a job.
- **It comments on the issue** when it takes it, when it needs you and when it finishes. The pull request includes `Closes #N`, so accepting it closes the issue.
- **It only takes issues written and labeled by people with write access.** On a public repository anyone can open an issue, and its text becomes instructions for the agents.
- **To request it again** after the job finished, remove the label and put it back.
- **You can keep the conversation going on the issue.** When the job has finished or is waiting for you, the factory reads your new comments and answers: it answers questions ("I don't see it published"), takes a request for an adjustment as a new job on the same issue, or approves or rejects the pending question. The read-only `reply` station decides, with no access to the repository, using the facts zero computes (for example, whether the change is already on GitHub). It only reads comments from people with write access.

On lines that deliver through `pull-request`, each job starts from GitHub's base branch. That way it includes what you accepted there, without moving your local branch.

### Auto-merge

With `autoMerge: true` on a `pull-request` line, the factory also merges its pull requests. It checks them every minute and merges each one when all its GitHub checks finished successfully and it has no conflicts; then it deletes the branch and tells the issue. If a check fails or there are conflicts, it leaves it open and says so once on the pull request; if that gets fixed, it merges it on the next check. `zero status` and the panel show the ones waiting.

## Browser panel

With the factory running, the panel shows:
- the factory's status;
- the jobs;
- the questions, with buttons to approve or reject;
- each job's trace;
- internet egress and the report;
- each line's night-shift proposals ("Propuestas" tab);
- each line's research notes ("Investigación" tab), with their sources, the link to their issue and a button to request a job from a note (it asks for confirmation first).

From the panel you can also request a job, pull the andon and block or allow sites. It is designed for the phone.

```sh
zero panel                     # the panel link, with your key (starts the factory if needed)
zero panel remote on           # access from outside (phone) through a temporary Cloudflare tunnel
zero panel remote off          # closes it
zero panel rotate              # new key: previous links stop working
```

- The panel only listens on your PC (`127.0.0.1:4848`).
- The key travels in the link after `#`, so the browser does not send it in the address. It is exchanged for a session cookie.
- The key lives in the system keychain.
- Remote access uses `cloudflared` (Apache-2.0). zero downloads it with your permission from its official releases and, on Windows, verifies Cloudflare's signature.
- While the tunnel is open, Cloudflare carries the panel's traffic. Close it when you are not using it.

## The factory (`~/.zero/zero.factory.yaml`)

```yaml
level: L3                 # L0 · L1 · L2 · L3
isolation: container      # isolation box (worktree = local copies, no box)
box: { runtime: auto, cpus: 2, memoryGb: 4, pids: 512 }   # auto = Podman, then Docker
panel: { port: 4848 }     # 0 = no panel
egress:                   # the box's internet egress (all of it goes through zero's gate)
  mode: blocklist         # blocklist: everything goes out except what is suspicious or blocked · allowlist: only what is allowed
  allow: []               # e.g. nas.local, registry.local:8443 (a site includes its subdomains)
  block: []
engine: claude            # default engine: claude · codex · antigravity · or your own
concurrency: 2            # jobs at a time (each line does one at a time)
limits:                   # with a subscription (claude.ai) the limit is the plan's real quota: 5 hours and weekly
  reservePercent: 0       # share of each quota the factory leaves free for you (0 = uses the whole plan)
  usdPerDay: 10           # only for pay-per-use (API key) · 0 = free engines only
  usdPerJob: 3            # only for pay-per-use
  protectedPaths: [".github/**", ".env", ".env.*", "**/*.pem", "**/*.key"]
approvals: { timeoutHours: 24, onTimeout: reject }
stations:                 # engine, model and time limit per station (optional)
  review: { engine: codex, timeoutMinutes: 15 }
  security: { engine: claude }   # the security review; with another engine, the look is more independent
  build: { skills: [pdf] }       # skills from your Claude Code (personal or from plugins; `plugin:skill` if the name repeats)
engines:                  # any other agent CLI, no code needed
  gemini: { command: ["gemini", "-p", "{prompt}"], writeArgs: ["--yolo"], modelArgs: ["-m", "{model}"] }
lines:
  - name: tienda
    repo: ~/code/tienda
    baseBranch: main
    setup: ["npm ci"]     # runs in every new copy
    verify: ["npm test"]  # everything must pass before the review
    integrate: merge      # merge · branch · pull-request (starts from the remote's base branch)
    issues: { label: zero }   # optional: takes as requests the GitHub issues with this label
    autoMerge: false          # with pull-request: the factory merges when all checks pass
    stations:                 # optional: skills an agent adds only on this line
      build: { skills: [nextjs, shadcn] }
```

Skills are also assigned with `zero skill add <skill> --station <agent> [--line <line>]`, `zero skill remove …` and `zero skill list` (the chat does not change them). With Claude they load natively and the agent sees only those; with other engines, zero appends the SKILL.md text to their instructions. They never change an agent's tools: read-only agents read the skill but do not run its scripts, and in the box they are mounted read-only. If a skill is not installed, `zero status` says so and the agent works without it.

Secrets do **not** go in this file: if zero detects something shaped like a credential, it refuses to load it. Each engine uses your own session or the environment variables.

The factory directory (`ZERO_HOME`, `~/.zero` by default) holds:
- the factory definition;
- `state.db`, with the jobs and the traces;
- `townhall/`, the collective memory;
- `worktrees/` and `jobs/`, with the rendered specifications;
- `bin/`, with the tools zero downloads with your permission (cloudflared);
- `gate/`, shared with the egress gate: its rules, the passes of the running boxes and their records;
- `daemon.log`.

### Fallback engines (`fallback`)

When a station's engine cannot work (its plan's quota ran out, or its dollar cap for pay-per-use), zero moves to the fallback engines, in order, instead of stopping the factory. The factory pauses only when a station of the line has all its engines paused.

```yaml
engine: claude
fallback: [codex, { engine: gemini, model: gemini-2.5-pro }]   # global: engine names or { engine, model }
stations:
  review: { engine: codex, fallback: [claude] }                # per station: replaces the global list
```

Each call records in its trace which engine it used, which one it replaced and why.

## Custom agents

Each line can add its own agents to the fixed stations: an accessibility reviewer, one that checks every text is in every language, an SEO one, a documentation one. They go in `zero.factory.yaml`, under `lines[].agents` (only that line) or under the top-level `agents` (every line). For now they are read-only reviewers that run after `review` and `security`, on the same change: the global ones first, then the line's, each in file order.

```yaml
lines:
  - name: web
    repo: /path/to/web
    agents:
      - name: a11y                        # lowercase letters, digits and dashes
        instructions: .zero/agents/a11y.md   # in the line's repository (the default)
        blocking: true                    # verified high or critical findings send the change back to build
        engine: codex                     # optional, like any station: engine, model, maxTurns, timeoutMinutes, skills
        timeoutMinutes: 10
      - name: seo
        blocking: false                   # only reports: its findings never stop the job
```

`.zero/agents/a11y.md`, in the line's repository:

```markdown
# Agent: a11y

You review the accessibility of every change to the web pages.

## What to check
- Every image has a meaningful `alt`; decorative images have `alt=""`.
- Every form field has a label, and every button has a name a screen reader can say.
- Colors keep a contrast of at least 4.5:1 for text.

## How to report
- One finding per problem, with the file and line, the problem and the fix.
- Use `high` or `critical` only when a person using a screen reader or a keyboard cannot use the page.
```

```sh
zero agent list --line web
zero agent add a11y --line web                 # creates .zero/agents/a11y.md from a template and adds the agent
zero agent add seo --line web --informativo    # an agent that only reports
zero agent remove seo --line web               # out of the configuration; its file stays
```

Global agents read their instructions relative to the factory folder (where `zero.factory.yaml` is). Each agent gets the request, the specification and the change (`git diff` against the base), and answers like `review`: findings with file and line, which zero checks, and learnings for the townhall. A blocking agent with verified `high` or `critical` findings rejects the attempt, and build gets them as feedback, naming the agent; an informative one only leaves them on its trace. If a blocking agent's instructions file is missing, the job fails naming the path; an informative one is skipped with a warning. Their calls show up in the trace, the status and the budget like any station's (`zero.station.<name>`).

**Additions to the fixed stations.** A line can add instructions to a fixed station (`spec`, `build`, `review`, `security`, `reply`, `scout`, `research`) with a file `.zero/agents/<station>.md` in its repository, for example `.zero/agents/build.md` with "always use pnpm". The agent receives zero's instructions first and then the project's, marked as additions that cannot contradict or relax the rules above.

Guarantees that zero enforces, never the agent: custom agents are read-only (in the box with a read-only mount, and whatever they write is discarded); they add to the line and cannot turn off or skip the fixed stations, the protected paths or verification (there is no field for it); and their instructions come only from the owner's copy of the line's repository or from the factory folder, never from what the job wrote in its work copy nor from the web.

## Night shift

When the factory is free (none of your requests queued or running, the andon off and budget left), the read-only `scout` station looks at each line once per period: the townhall, the traces of the last 30 days, the specs without tests, the line's research notes and, on GitHub lines, the open unlabeled issues written by people with write access (up to 20, the newest, leaving out those that already have a proposal). What an issue says is data, never instructions. If `scout` proposes taking one, the proposal links the issue (in the job's request, in the panel and in the proposal's issue). It writes up to three proposals per line; zero discards those that touch protected paths, ask for new credentials or repeat a title. On pay-per-use, `scout` and `research` share the `limits.usdPerNight` cap.

```yaml
nightShift:               # or `nightShift: off` to turn it off
  hours: "22:00-06:00"    # optional: only in those hours (crosses midnight); without hours, whenever the factory is free
  autonomy: propose       # propose · build · auto, for lines without their own autonomy
  maxAutoJobsPerDay: 3    # jobs the shift opens on its own per day, across all lines
limits:
  usdPerNight: 1          # only for pay-per-use
research:
  autonomy: propose       # cap for what adds something third-party (see below)
lines:
  - name: tienda
    repo: ~/code/tienda
    nightShift: { autonomy: auto }   # optional: this line's autonomy
```

A line's autonomy is its own (`lines[].nightShift.autonomy`) or, if it has none, the global one (`nightShift.autonomy`):
- **`propose`** (default): the proposal waits for your decision.
- **`build`**: the proposal turns on its own into a normal job of the line, marked as night shift. It goes through every station and stops before integrating: its branch stays and waits for your approval. If you do not answer, it expires as rejected even if `approvals.onTimeout` is `approve`: it never integrates on its own. Approving the proposal integrates it according to the line's `integrate` and `autoMerge`; rejecting it stops the job and its branch stays.
- **`auto`**: it is built and integrated or deployed on its own, according to the line's `integrate` and `autoMerge`, without asking.

Under `build` and `auto` the job follows the usual rules: if it touches something protected, goes over budget, verification stops it or the egress gate sees something suspicious, it waits for the owner (or fails, depending on the level) like any other job. Also:
- **Daily cap.** At most `maxAutoJobsPerDay` automatic jobs per local day, across all lines (0 = none). Once reached, the following proposals wait for your decision.
- **Earlier pending proposals.** If you move a line to `build` or `auto`, on the next night-shift pass (inside its hours and with the andon off) its pending proposals are promoted on their own, oldest first, respecting `maxAutoJobsPerDay`: they are taken as if they were new. Those born from something third-party (flagged by `scout` or touching a dependency or MCP manifest) are never promoted: they keep waiting for your decision.
- **What gets reverted.** If you revert on the main branch a change the night shift integrated on its own, without your approval, the factory detects it: the proposal becomes `revertida` (reverted; in the panel, the "Revertidas" group), it is noted in the line's townhall and `scout` does not propose it again. On lines with `integrate: merge` it looks for `git revert -m 1 <commit>` of the merge. On lines with `integrate: pull-request` it records the commit GitHub merged the pull request with (merge or squash) and recognizes both `git revert` of that commit and GitHub's Revert button (the pull request `Revert "…"`, whose commit says `Reverts owner/repo#N`); it looks on the local main branch and on the remote's, after a `git fetch`. It does not detect undoing by hand.
- **Your requests go first.** An automatic night-shift job never jumps ahead of yours and does not start while another job is queued or running.
- **Proposals born from a research note.** They are marked with the note they came from. If they add a dependency, a third-party skill, an MCP server or third-party code, `research.autonomy` governs them (`propose` by default): the more restrictive of that and the line's autonomy applies, so they wait for your decision even if the line is at `auto`. zero does not rely only on what `scout` says: it also looks at the dependency and MCP manifests (package.json, lockfiles, requirements*.txt, pyproject.toml, go.mod, Cargo.toml, Gemfile, .mcp.json…) in the proposal and, before integrating, in the files the job changed. Writing your own skill or assigning an installed one follows the line's autonomy.

Proposals are stored in `state.db` and decided with:

```sh
zero proposals                          # those waiting for your decision (also the built ones waiting to integrate)
zero proposals approve <id>             # opens the job, or integrates the one the shift already built
zero proposals reject <id> --note "…"   # archives it (and stops its job if the shift already opened it)
```

From the chat: `zero_proposals` and `zero_proposal_decide`. In the panel, the "Propuestas" tab shows each line's proposals (pending, building, delivered, rejected and reverted) with their issue, the research note they came from, the rejection reason and the line's autonomy; it has buttons to approve (it asks for confirmation first) and to reject with a reason. A rejection's reason stays in the line's townhall, and `scout` receives the line's last 20 rejected or reverted proposals so it does not insist. On GitHub lines each proposal is also published as an issue with the `zero:propuesta` label, and the issue tells who approved it (you or the night shift on its own) or why you rejected it. The report has a "Turno nocturno" section: what was proposed, what was built on its own and waits for your ok, and what was integrated or deployed on its own.

**Deciding from GitHub.** On lines at `propose`, the `zero:propuesta` issue also decides: if a person with write access to the repository gives it the line's work label (`zero`, or the one in `issues.label`), the proposal is approved and becomes a job; if a person with write access closes the issue without that label, it is rejected and the rejection is noted in the townhall like any other. A label or a close by someone without write access decides nothing. Issue intake never takes a `zero:propuesta` issue as a standalone request. On lines at `build` or `auto` the issue is only a record: neither the label nor closing decides, and it closes with the delivery (the pull request's "Closes #n", or the factory itself as completed if the delivery was a merge or a local branch).

## Research

The `research` station researches the web once a day, with the factory free: new skills for the agents (for Claude Code and other engines), MCP servers and technologies that would help the line or the factory itself (engines, libraries, tools, practices). It follows the night shift's rules: it only runs with none of your requests queued or running, with the andon off and with budget (it respects `limits.reservePercent`); on pay-per-use, it shares the `limits.usdPerNight` cap with `scout`.

It researches per line, and only the lines that have a **research skill** assigned to `research`; that skill says what to look for. A line without a research skill does not research.

```yaml
research:                 # or `research: off` to turn it off
  topics: ["local agent engines"]   # optional: topics of interest for every line
  perLinePerDay: 1        # notes per line per day (0 = off); if not enough, the lines take turns
  autonomy: propose       # propose · build · auto: how far a proposal born from a note that adds something third-party goes on its own
stations:
  research: { timeoutMinutes: 15 }
lines:
  - name: tienda
    repo: ~/code/tienda
    stations:
      research: { skills: [tienda-research] }
```

```sh
zero skill add tienda-research --station research --line tienda
```

The skill is a normal skill of your Claude Code, for example `~/.claude/skills/tienda-research/SKILL.md`:

```markdown
---
name: tienda-research
description: What the tienda line researches
---
# Research for the tienda line

Look for, in this order:
- Skills and MCP servers that help the build and review stations with Next.js and Stripe.
- News in Next.js, Prisma and Playwright that change how the store is built or tested.
- Security practices for card payments that the security station should review.

Do not research frontend frameworks other than React.
```

Each note has a topic, what was found, the sources (http(s) links; a note without sources is discarded), which part of the line it would help and how mature and trustworthy it is. It is stored in `state.db`, without paths from your machine or secrets. To avoid repeating topics, the station receives the line's topics of the last 60 days. You see notes with `zero research [--line <line>] [--days N]`, in the report ("Investigación de hoy") and from the chat (`zero_research`). To turn a note into a job on its line: `zero research request <id>` (or `zero_research_request` in the chat), or the "Pedir trabajo" button of the panel's "Investigación" tab, which shows each line's notes of the last 30 days. `scout` receives its line's notes of the last 7 days and can propose, for example, assigning a skill to a station or creating a new station; a line's notes only produce proposals on that same line.

On GitHub lines each note is also published as an issue in the line's repo, with the `zero:investigacion` label (the factory creates it if missing) and never with `zero`, so it does not become a job on its own. The issue has what was found, what it would help with, its maturity, the sources, the note's id and how to request a job (`zero research request <id>`). Before publishing, zero covers secrets and paths from your PC and disables mentions (@user) so nobody gets notified. If GitHub fails, it retries on the next pass.

Security: what comes from the web is data, never instructions, and the instructions of `research` and `scout` say so. The station is read-only: it does not install, clone or run anything it finds. With Claude it only has the read tools plus `WebSearch` (the search runs on the provider's side; `WebFetch` is off); with other engines it works as a read-only station. It does not go through the box yet, so its searches do not show up in `zero egress`.

## Isolation box

Everything that runs code from the project or from an agent runs in the box: the `setup`, the agents and verification. The box is a container (Podman or Docker). zero does the integration outside.

- **Its own copy.** The box gets an independent clone of the repository, with no links to yours. It does not see your home folder, your other projects or your keys.
- **Truly read-only.** `spec`, `review` and `security` get the copy mounted read-only.
- **No privileges.** It runs as an unprivileged user, with no extra capabilities, a read-only file system and CPU, memory and process limits.
- **Minimal credentials.** Each station gets only its engine's credential, by name, never on the command line. It never gets GitHub tokens or SSH keys.
- **Immediate stop.** The andon and the time limits stop the container.

```sh
zero box status                # what is missing
zero box setup                 # Windows: WSL2 + Podman · macOS: Podman · Linux: instructions; and the image
claude setup-token             # your subscription's token to work in the box
zero secret set CLAUDE_CODE_OAUTH_TOKEN    # stores it in the system keychain (not shown)
zero secret list
```

With the box ready and the engines' credentials stored, the factory reaches **real L3**.

### Internet egress

The box has no internet access or DNS of its own: it goes out only through zero's **gate**, a proxy that runs in its own container. That way **everything** that goes out is visible, including what an agent sends while trying to get around the watcher.

- **By default nothing is limited except what is suspicious** (`mode: blocklist`). The gate blocks on its own, and explains why:
  - IP addresses without a name;
  - your local network and internal addresses, also when a name points to them;
  - ports other than 80 and 443;
  - names so long they seem to carry data;
  - services typical for exfiltrating data: text pasting, file sharing, request capture, tunnels, messaging and dynamic DNS.
- **Every connection is recorded**: site, job, station, bytes sent and received, and the decision.
- **A job with suspicious egress does not integrate on its own.** At L3 it fails and explains how to allow the site; at L0–L2 it asks you.
- **Your rules**: block or allow sites, or move to `allowlist` so only what is allowed goes out. Your engines' sites are allowed automatically, so the factory never runs out of a model.

```sh
zero egress                    # what went out today, how much and what was blocked   [--days N]
zero egress <id>               # a job's egress (also in `zero trace`)
zero egress block <host>       # also from the chat
zero egress allow <host>       # only from the terminal: a manipulated chat cannot open the gate
zero egress remove <host>
zero egress mode allowlist     # or blocklist
```

What the gate cannot see: encrypted content, and data sent to an allowed site (for example, the model's API). Bytes sent are recorded so it can be detected later.

## Observability

Each job leaves a trace: job → station → attempt → agent or command. Each element records duration, status, engine, model and cost, and the cost says where it came from (`reported` or `unknown`).

The metrics (delivered, failed, success rate, cost per delivery, human wait, breakdown by engine, the box's connections and blocks) are computed with a single definition, used alike by the terminal, the chat and the report. Span names follow the OpenTelemetry GenAI conventions, so they can be exported over OTLP later.

## Townhall

It is the factory's collective memory. Each job publishes:
- its result;
- the findings (`spec`) and lessons (`review`), always with their source;
- proposals for new work;
- blockers.

The `spec` and `build` stations receive the recent notes of **their own line**. Notes are stored with secrets removed and without duplicates. If the townhall fails, production carries on.

## Development

```sh
npm run typecheck && npm test && npm run build
npx openspec validate --all
```

zero is designed with **OpenSpec** (`openspec/`): each change is a proposal with a specification, design and tasks. Decisions are in `docs/adr/` and the conventions for agents in `AGENTS.md`. The README is kept in English (`README.md`) and Spanish (`README.es.md`); every change goes into both.

## Where it is going: intent is the product

Every AI orchestrator starts from the same assumption: code is the product and agents are workers who touch it. zero aims to turn that around. **The product is the owner's intent; code is its consequence**, something the factory can produce again whenever needed.

- **The truth lives in the specifications.** `openspec/specs/` stops being documentation and becomes the source: what the system has to do, written as requirements and scenarios. The owner reads and edits intents, in their language, from the chat, the panel or the phone; the factory maintains the code.
- **Regeneration drill.** To show that the specifications are enough, the factory takes a module, builds it again from scratch from its spec alone, in a separate copy, and runs the same tests. If the result behaves differently, the spec was incomplete: the factory proposes the missing scenario. The old code is never overwritten; the drill only measures and proposes. It is expensive in tokens, so it runs on request or rarely, never on every job.
- **Closed loop with the live product.** Later, production errors, analytics and user feedback come in as requests nobody had to write: intent → change → deployment → observation → new intent.

## Next steps

Regeneration drill · intake from Linear and Jira · installer · private network for the panel (Tailscale/Headscale) · cutting large uploads to unusual sites · system service · plugin and specialist API · ACP/OpenCode engines · ccusage · OTLP export · governed MCP for the station agents.

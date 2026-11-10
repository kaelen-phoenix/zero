# zero

English · [Español](README.es.md)

**zero in the loop**: the factory takes the human's place in the loop, and you decide where to step back in.

zero is a **software factory that runs on your machine**. You ask it for work from your AI client's chat (Claude Code, Codex, agy…) or from the terminal. The factory specifies it, builds it, verifies it, reviews it and integrates it on its own, in the background, even if you close the chat.

It is open source (Apache-2.0) and free. Everyone has their own factory: nobody connects to yours.

The project site is [zerointheloop.com](https://zerointheloop.com): it lives in `site/` as a static site (HTML, CSS and JS with no dependencies and no build step), and Vercel publishes it with `site/` as the root folder. Its Training section, only in the Spanish version of the site, lists the formats on offer, and each format offers WhatsApp and Instagram to write to zero in the loop.

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
  - review findings that cite files or lines that do not exist are discarded;
  - what the factory produces while working does not enter a repository (see [What stays on your machine](#what-stays-on-your-machine)).
- **It never overwrites your work.** Each request works in its own copy (`git worktree`) and its own branch. It only integrates into your branch if your copy is clean; otherwise it asks you.
- **Time for people.** zero automates software development with AI, freeing people's time to focus on strategy, creativity, oversight and professional collaboration.
- **Engine-agnostic.** Claude (Agent SDK), Codex, Antigravity, OpenCode, any agent that speaks ACP (Agent Client Protocol) or any CLI declared in the configuration, and a different one per station if you want.

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
curl -fsSL https://zerointheloop.com/install.sh | sh     # macOS and Linux
irm https://zerointheloop.com/install.ps1 | iex          # Windows (PowerShell)
```

One step, on macOS, Linux or Windows. The installer checks that you have Node 22 or later, npm and git, and installs none of them: if one is missing it tells you where to get it and changes nothing. Then it shows you the folder (`~/.local/share/zero`, or `%LOCALAPPDATA%\zero` on Windows; `ZERO_INSTALL_DIR` changes it), the commands it will run and where it creates the `zero` command, and asks before changing anything (the default answer is no). It does not need administrator rights: it writes only in your user folders and, on Windows, adds the command to your user PATH. It never asks for or stores a key or token; it ends by launching `zero setup` on your terminal, which takes care of engines, credentials, limits, the box and GitHub. Running it again updates the same copy.

By hand, from the repository:

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
zero informe [line] [--mes AAAA-MM] [--html]   # monthly report per line, to share with its client
zero stop [id]                 # andon: stops a job or the whole factory · zero resume
zero line add <path>           # add another project
zero start [--detach] · zero shutdown
```

The chat does the same with `zero_request`, `zero_status`, `zero_answer`, `zero_stop`, `zero_resume`, `zero_briefing`, `zero_monthly_report`, `zero_trace` and `zero_lines`; it also has `zero_proposals` and `zero_proposal_decide` (night shift), `zero_research` and `zero_research_request` (research), `zero_package_run` (a package station on demand), and `zero_egress` and `zero_egress_block` (internet egress).

## Install with Docker

The image is built from this repository, with zero, Node 22, git, `gh`, the Docker client and only the AI CLIs you name. Nothing gets installed later: to add a CLI you rebuild.

```sh
git clone https://github.com/kaelen-phoenix/zero && cd zero
mkdir -p secrets && openssl rand -hex 32 > secrets/zero_master_key   # encrypts the secrets kept in the volume; keep a copy outside it
ZERO_CLIS=claude,codex docker compose build                          # claude, codex or both
docker compose run --rm zero setup                                   # asks how you will work; run it again to change anything
docker compose up -d
docker compose exec zero zero panel                                  # the panel link, with your key
```

`zero setup` asks:

- **How you will work:** subscription, API key or both. Each engine is chosen from `claude` and `codex`; the first goes to `engine` and the rest to `fallback`. With both, you pick one engine for each side, and they have to be different. Gemini is not an engine of zero yet.
- **Limits:** `usdPerDay` and `usdPerJob` when an engine is paid per use, `reservePercent` when one is on a plan. It leaves the others alone.
- **Isolation:** see below.
- **Panel port and GitHub:** `gh auth login`, a token stored as `GH_TOKEN`, or nothing.

API keys and tokens are typed without being shown; they never go in arguments, in the file or in the log. Logins run with your consent on your terminal. `claude setup-token` gives a token that the wizard stores. `codex login --device-auth` and `gh auth login` leave their session in the volume, **not encrypted**, because each CLI manages it on its own: use a key or a token if you would rather avoid that. Choosing a method deletes the stored credential of the other one for that engine, and warns you about one in an environment variable or Docker secret, which it cannot delete.

**Volumes.** `zero-data` holds `ZERO_HOME` (`state.db`, `zero.factory.yaml`, jobs, `secrets.enc`) and `HOME` (the CLIs' sessions). `zero-repos`, at `/repos`, holds the lines' repositories. Recreating or updating the container loses neither.

```sh
docker compose exec zero git clone https://github.com/you/shop /repos/shop
docker compose exec zero zero line add /repos/shop
docker compose build && docker compose up -d                         # update
```

Only `https` remotes work: pushing uses zero's GitHub token through `zero git-credential`, and the container has no ssh key.

**Secrets.** There is no keychain in a container. A credential is looked up first in an environment variable, then in the Docker secret `/run/secrets/<NAME>`, and last in `secrets.enc` (AES-256-GCM, mode 600), whose key is the `zero_master_key` secret, kept outside the volume. Without that key nothing is written, and if you lose it the stored secrets cannot be read. Avoid environment variables: `docker inspect` shows them. Docker secrets go in your own compose file:

```yaml
services:
  zero:
    secrets: [zero_master_key, OPENAI_API_KEY]
secrets:
  OPENAI_API_KEY:
    file: ./secrets/openai_api_key
```

**Panel.** It is published on `ZERO_PANEL_PORT` (4848 by default), bound to `127.0.0.1` on your machine. It still asks for the key. Set both in `.env`, next to `compose.yaml`, and answer the same port in `zero setup`:

```sh
ZERO_PANEL_PORT=8080
ZERO_PANEL_BIND=0.0.0.0              # opens it to your network: use it only if you need it
```

**Isolation.** `compose.yaml` gives the container no access to Docker, and you choose in `zero setup`; zero never lowers the guarantee on its own. Until you choose, or while the box is not ready, jobs **wait in the queue** and `zero status` says why. Docker-in-Docker is not offered because it needs `--privileged`.

- **Box through the host's socket.** Jobs run in the box and leave through the gate, as on a machine. `docker/compose.box.yaml` mounts `/var/run/docker.sock`. **The socket gives whatever runs in zero's container control over your machine**: agents inside the box do not see it, but zero, package stations with `allowCode` and stations that run outside the box (like the night shift) do. The data folder has the same path inside and out, because the host's Docker resolves the paths zero mounts. Inside the box, Codex needs an API key: its subscription session stays in `HOME`. While a job runs, `docker inspect` on the box shows the credentials it was given.

```sh
export ZERO_DATA=/srv/zero                                           # absolute path on your machine
mkdir -p "$ZERO_DATA/home" "$ZERO_DATA/user" "$ZERO_DATA/tmp"
export ZERO_DOCKER_GID=$(stat -c %g /var/run/docker.sock)
docker compose -f compose.yaml -f docker/compose.box.yaml run --rm zero setup
docker compose -f compose.yaml -f docker/compose.box.yaml run --rm zero box setup
docker compose -f compose.yaml -f docker/compose.box.yaml up -d
```

- **No box.** `isolation: worktree`, only after a warning and a confirmation whose default is no. **Agents run in the same container as the key and the secrets**, can read them, and go online without passing through the gate. The factory stays below L3.

This installation is not exercised end to end by zero's tests, which only check these files: the image, the CLI logins and the box through the socket have not been run by them. See [ADR 0003](docs/adr/0003-fabrica-en-docker.md).

## Job priorities

Every job has a priority: `baja` (low), `media` (medium, the default), `alta` (high) or `urgente` (urgent). The factory always takes the highest priority first and, within the same one, the oldest job.

- **baja**: only when nothing else is queued or running. The night shift's own jobs and the ones a package asks for start here.
- **media**: in order of arrival.
- **alta**: goes ahead of everything queued, without stopping what is already running.
- **urgente**: for cases like a security patch. Only you can choose it (a GitHub issue, the night shift or a package cannot), and at most one urgent job runs at a time. Pausing running jobs to make room for an urgent one is not there yet: it takes the next free slot.

So that low work is not forgotten, a queued job goes up one level for each full day it waits, never past `alta`; `zero status` says so with `(subió por la espera)`.

```sh
zero request "patch the login vulnerability" --prioridad urgente
zero priority <id> alta        # change it while the job has not finished
```

`zero status`, `zero status <id>` and the chat show the priority; `zero_request` takes it as `priority`.

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

With `autoMerge: true` on a `pull-request` line, the factory also merges its pull requests. It checks them every minute and merges each one when all its GitHub checks finished successfully and it has no conflicts; then it deletes the branch and tells the issue. If a check fails, it leaves it open and says so once on the pull request; if a push fixes it, it merges it on the next check. If the pull request has conflicts with the base branch, the factory first tries to update it: it merges the base into the job's branch, never with a rebase or a force-push, resolves any conflicts as one more attempt within `maxAttempts`, verifies and reviews again, and pushes to the same pull request, never committing conflict markers. It only does this once per tip, and it never touches a pull request with commits that are not its own: when the tip differs from its local branch or the remote branch moved, nothing is pushed. If it cannot update it, the pull request stays as it was and gets the usual notice once. When nothing changed, it looks at the checks again with growing waits, from 5 minutes up to 1 hour, so a check rerun on the same commit can take up to that hour to be noticed. `zero status` and the panel show the ones waiting.

Before leaving a pull request blocked by failed checks, the factory tries what usually fixes it without touching the code. If the branch is behind its base (the checks ran against an older base: a fix reached the base since, or a workflow changed), it merges the base in on GitHub, never a rebase or a forced push, and waits for the new checks. It does that for one pull request per repository at a time, since CI that shares an environment cancels the runs that pile up, and at most 3 times per pull request. If the branch is up to date, it runs the failed GitHub Actions runs again, once per commit: a cancelled run or a test that failed once for no reason of the code. Only when that does not help does it say so on the pull request and leave it open.

The factory's passes look after your account's GitHub API quota: they repeat their queries conditionally and count each pass's requests. With 20% of the quota or less left, or when GitHub answers with a limit, they stop until the quota renews, even if you restart the factory. Opening the pull request of a finished job does not stop. At 40% or less, `zero status` shows a `GitHub:` line with what is left.

### Commit author

By default the factory's commits are authored by `zero`, the factory's own identity. Some services only accept commits whose author is one of their accounts: Vercel's Hobby plan, for example, blocks the deploy ("GitHub couldn't verify an account for the commit"), so pull request previews fail their check and auto-merge never starts. With `commitAuthor: owner` (globally, or on a line, which wins) the spec, attempt and merge commits are authored by you: the `user.name` and `user.email` that `git config` gives in the line's repository, read when committing and never written to the factory file. zero stays the committer, so it is still visible that the factory made them. If the repository has no name or email configured, the commit is authored by zero and the job goes on. Revert detection works the same, since it looks at commit messages and SHAs, not at authors.

## Linear issues

A line can also take as requests the issues of a Linear team that carry a label. You add the block to the line in the factory file, with the team's key (the prefix of its issues, such as `ENG-7`):

```yaml
lines:
  - name: web
    repo: ~/code/web
    linear: { team: ENG, label: zero }
```

The label defaults to `zero`. The Linear API key never goes in the factory file, which refuses it; you save it in the secret store:

```sh
zero secret set LINEAR_API_KEY
```

Without the key the factory does not call Linear, and `zero status` and the panel show an `Issues de Linear:` line with the problem.
- **It only takes issues created and labeled by people with permission:** active members of that team who are not guests. Linear has no per-repository permission, so in a large workspace this can be more people than on GitHub. To the rest it leaves one comment saying why it does not take the issue.
- **It comments on the issue** when it takes it, when it needs you (with the job, the deadline and how to answer from the panel or with `zero approve`), when it fails or stops, and when it delivers. Comments carry the line's signature and appear under the name of whoever owns the key.
- **On delivery it completes the issue:** it moves it to one of the team's completed states. On `pull-request` lines that happens when the pull request opens. If Linear fails, it tries again on the next check without repeating the comment.
- **To request it again** after the job finished, remove the label and put it back. It does not read later comments on Linear issues.

## Jira issues

A line can also take as requests the issues of a Jira Cloud project that carry a label. You add the `jira` block to the line in the factory file and save the account's email and an API token in the secret store, never in the file (the factory refuses a `jira` block with any other key):

```yaml
lines:
  - name: tienda
    jira: { site: "https://acme.atlassian.net", project: ABC, label: zero }
```

```sh
zero secret set JIRA_EMAIL
zero secret set JIRA_API_TOKEN
```

You give an issue of the project the `zero` label, and the factory checks every minute and turns it into a job.
- **It only takes issues created and labeled by people with permission to edit issues in the project**, and only if nobody without that permission changed their summary or description, because that text becomes instructions for the agents. Otherwise it says why in a comment on the issue. The account of the token needs permission to browse users to check this; if the check fails, `zero status` shows the problem and the issue waits.
- **It comments on the issue** when it takes it, when it needs you and how it ended. It does not read the issue's comments: you answer from the panel, the chat or `zero approve`.
- **When it delivers, it moves the issue to a done status** with one of its transitions. If the workflow has none, the issue stays as it is and `zero status` says so.
- **To request it again** after the job finished, remove the label and put it back.

`zero status` and the panel show a `Issues de Jira:` line for each line with its project, its label and any problem, such as missing credentials.

## zero, your CI and your quality tools

zero does the work of the people in the loop: specify, build, test locally, review and integrate, but it does not replace GitHub Actions or any other CI/CD, nor static analysis, coverage, quality gates, or dependency and secret scanning (SonarQube, SonarCloud, CodeQL, Dependabot, Snyk). Those tools remain the authority, and zero works with them:

```
request
  → zero: spec → build → verify → review → security
  → pull request
  → GitHub CI and quality checks
  → merge
  → the platform's deploy
```

- **Local verification first.** zero runs the line's verification locally before delivering anything. Each command has a time limit: `verifyTimeoutMinutes` of the line (20 by default), and never less than twice what the slowest of its last 5 passing runs on that line took, so a suite that grows or a slow machine does not fail jobs whose tests pass. Setup and verify commands of different jobs take turns on your machine (`commandConcurrency`), a setup that fails is tried once more in a fresh copy, a verify command whose failure reads like the machine and not the change (a test over its own timeout, no memory, a locked file, a network cut) is run once more before it costs an attempt, and a command cut by its limit is killed with everything it started.
- **It merges only when GitHub says so.** With integrate `pull-request` and `autoMerge`, zero merges only once every GitHub check on the pull request has finished successfully, including Sonar, CodeQL and any other tool configured as a check. If a check fails, the pull request stays open.
- **If the repository has no checks**, auto-merge waits a few minutes for them to appear and then merges with only zero's own verification and reviews.
- **A second look.** The findings of those tools are a second look, independent of the review by zero's agents.
- **Deployments are still done by the platform** (for example Vercel or GitHub workflows), not by zero.

Recommendation: have CI and at least one static analysis on every repository. Without them, zero has only its local verification and its own reviews.

### New npm dependencies (`checkDependencies`)

With `checkDependencies: true` on a line, after verify and before review zero looks at what each attempt adds to `package.json` and `package-lock.json` (in any folder) against the base, and asks about each new package, with no model and from its own process (the box's egress stays as it is). It sends OSV (`api.osv.dev`) the name and version of each new lock entry, and deps.dev (`api.deps.dev`) the name of each new package. That is why it is off by default: turning it on tells those services the names of your dependencies.

- **What fails the attempt.** A malware advisory (an OSV id starting with `MAL-`), a package deps.dev does not know (it does not exist in the public npm registry) or a name that breaks npm's rules. The next attempt gets a message naming each package and why.
- **What only informs.** A version published less than 7 days ago or a package with no earlier versions does not fail: it reaches the security station as data, which judges whether the dependency is needed and well known.
- **Without network.** If a service does not answer within 10 seconds or answers with an error, the packages stay as not verified (in the trace, the log and the security prompt) and the line goes on.
- **What is not asked about.** What the lock resolves outside the public npm registry (git, local files, links, other registries) and `package.json` specs that are not registry ranges. For now it covers only npm.

## Browser panel

With the factory running, the panel shows:
- the factory's status;
- the jobs;
- the questions, with buttons to approve or reject;
- each job's trace;
- internet egress and the report;
- each line's night-shift proposals ("Propuestas" tab);
- each line's research notes ("Investigación" tab), business notes apart from technical ones, with their sources, the link to their issue and a button to request a job from a note (it asks for confirmation first);
- the "Monitor" tab: factory totals (jobs per day, delivered, failed, queued and running, success rate, average time per job and per station, attempts per job), subscription use, the month's spend per engine and tokens, one card per agent (calls, tokens, cost, time, success rate, deliveries, engines, models and lines) and one per line (jobs, deliveries, last job, open pull requests), drawn in SVG inside the panel, filtered by today, 7 or 30 days, read-only and refreshed on its own;
- the monthly report ("Informe mensual" tab, see [Monthly report](#monthly-report)), to choose a line and a month and download it.

From the panel you can also request a job, pull the andon and block or allow sites. It is designed for the phone.

```sh
zero panel                     # the panel link, with your key (starts the factory if needed)
zero panel remote on           # access from outside (phone) through a temporary Cloudflare tunnel
zero panel remote off          # closes it
zero panel rotate              # new key: previous links stop working
```

- The panel only listens on your PC (`127.0.0.1:4848`), unless you change `panel.host`.
- The key travels in the link after `#`, so the browser does not send it in the address. It is exchanged for a session cookie.
- The key lives in the system keychain (in Docker, in `secrets.enc`).
- Remote access uses `cloudflared` (Apache-2.0). zero downloads it with your permission from its official releases and, on Windows, verifies Cloudflare's signature.
- While the tunnel is open, Cloudflare carries the panel's traffic. Close it when you are not using it.

## Monthly report

A summary per line and calendar month, for you and to share with that line's client. Code writes it from `state.db`, never a model, and it writes nothing back.

```sh
zero informe                                # the previous month, every line (a warning reminds you to ask for one line before sharing)
zero informe tienda --mes 2026-10           # one line, one month, in Markdown
zero informe tienda --mes 2026-10 --html    # saves a standalone HTML document in ZERO_HOME/reports and prints its path (it needs a line)
```

- It lists each delivered job: title, request and delivery dates, origin (your request, GitHub issue, night-shift proposal approved by you or taken on its own, research), what changed (the summary of its spec) and the link to the pull request or commit.
- Totals: delivered jobs, and apart, as information and not as work done, failed and stopped ones. Attempts, time and cost add up every job finished in the month, failed and stopped included; time runs from request to close, waits included.
- The part of the cost that came from a subscription is marked as an estimate that was not charged. The cost goes in the exported file too: edit it if you do not want your client to see it.
- A job counts in the month it finished, in local time.
- What you share carries no secrets, no local paths and nothing from other lines. It is cleaned by patterns, so read it before sending it: a title that names another line by name stays as written.
- The panel's "Informe mensual" tab lets you choose line and month and download each line as Markdown or HTML; each download also leaves a copy in `ZERO_HOME/reports`. In the chat, `zero_monthly_report` returns the same Markdown and only reads.
- Nothing is sent on its own: no daemon pass generates or publishes it. It only exists when you ask for it, and you decide who gets it.

## Regeneration drill

Measures whether a line's specifications are enough to rebuild part of its code. You name the line, the capability (its spec is `openspec/specs/<capability>/spec.md` on the base branch) and the files to remove.

```sh
zero simulacro tienda pagos --archivos "src/pagos/**"              # cap: limits.usdPerJob
zero simulacro tienda pagos --archivos "src/pagos/**" --usd 0.5    # a lower cap for this drill
zero simulacro tienda pagos --archivos "src/pagos/**" --conservar # keeps the copy to look at it
```

- It works in a separate copy in `ZERO_HOME/drills/<id>/copy`, cloned from the line's base branch. The line's repository is only read: same branches, worktrees, HEAD and working state. The copy gets a fresh history with a single commit, so the agent cannot find the removed files in it.
- Tests and everything under `openspec/` are never removed, even if the pattern names them: they are what the rebuilt code is measured against.
- The line's `setup` runs in the copy, then a single call to the build agent rebuilds the files from the spec, capped at `--usd` or, without it, `limits.usdPerJob` (it cannot be higher). Then the line's `verify` commands run in the copy, up to 20 minutes each.
- The result is `alcanzan` (every removed file came back, every verify command passed and the agent finished well), `no alcanzan` (anything else, including an agent that failed or hit its cap) or `inválido` (the agent changed or deleted a test or a specification).
- The report, in Spanish, is `ZERO_HOME/drills/<id>/informe.md`, next to `resultado.json` with the same data: line, capability, base commit, removed and rebuilt files, result, cost, each command with its exit code and the end of its output, and what the spec did not say and had to be guessed. The command prints its path. If `ZERO_HOME/drills` falls inside a line's repository or the current folder's, zero refuses, as with saved reports.
- When the drill ends, the copy is deleted (even if the agent failed) and only `informe.md` and `resultado.json` stay; the report says so. With `--conservar` the copy stays whole in `ZERO_HOME/drills/<id>/copy` so you can look at it, and the report names its path. If the deletion fails, the result does not change: it is only logged as a warning.
- It refuses before spending anything when the andon is on or the budget ran out, and when the line has no `verify` commands. In this version it only runs on this machine: with `isolation: container` it refuses.

## What stays on your machine

What the factory produces while working is never versioned: monthly reports, briefings, proposals, research notes, traces, reports from package stations, images or videos for social media, panel exports, `state.db`, logs and every other file of `ZERO_HOME` stay in `ZERO_HOME`, on your machine. Whoever installs zero downloads none of it, and one project's reports never end up in another's repository. The only thing that enters a repository is development for that repository.

zero enforces this itself, without trusting the agent:

- **Before integrating.** Verify looks at the files the job adds (the specification and every attempt) before running the line's commands. If one is shaped like operation output, the attempt fails with a message naming each file and why, and the next attempt gets it as feedback. The check runs again over the whole change just before integrating; if something appeared after verify, the job fails without integrating.
- **The shapes.** Files ending in `.db`, `.db-wal`, `.db-shm`, `.db-journal`, `.sqlite`, `.sqlite3` or `.log`; `zero.factory.yaml`, `daemon.lock` and `secrets.enc`; anything under `.zero/townhall`, `worktrees`, `jobs`, `gate`, `bin`, `packages` or `reports`; anything in a `plus-*` folder; documents and data under a `report`, `reports`, `informe` or `informes` folder; files named `informe-*` or `briefing-*`; and images or videos whose file name no text file in the repository mentions (`openspec/` and the file itself do not count). Files that were already versioned and the Markdown of the job's own specification are left alone.
- **`allowedArtifacts`.** A project that does version these files lists their paths on its line, as globs (see the factory file below). The check goes by the shape of a file, so it can stop a legitimate file until you add it, and a report with an unusual name and folder gets through.
- **Saved reports.** `zero informe <line> --html` and the panel's downloads save to `ZERO_HOME/reports`. If that folder falls inside a line's repository or the current folder's repository, zero refuses to save and tells you why. The browser's own copy goes wherever the browser saves downloads; Markdown on the terminal writes no file, so redirecting it is up to you.

## The factory (`~/.zero/zero.factory.yaml`)

```yaml
level: L3                 # L0 · L1 · L2 · L3
isolation: container      # isolation box (worktree = local copies, no box)
box: { runtime: auto, cpus: 2, memoryGb: 4, pids: 512 }   # auto = Podman, then Docker
panel: { port: 4848, host: 127.0.0.1 }     # port 0 = no panel · host 0.0.0.0 to publish it from a container
egress:                   # the box's internet egress (all of it goes through zero's gate)
  mode: blocklist         # blocklist: everything goes out except what is suspicious or blocked · allowlist: only what is allowed
  allow: []               # e.g. nas.local, registry.local:8443 (a site includes its subdomains)
  block: []
engine: claude            # default engine: claude · codex · antigravity · opencode · or your own
concurrency: 2            # jobs at a time (each line does one at a time)
commandConcurrency: 1     # setup and verify commands running on this machine at once, across jobs; the rest wait their turn
commitAuthor: zero        # zero · owner (your git config identity as author; zero stays committer)
limits:                   # with a subscription (claude.ai, ChatGPT on Codex) the limit is the plan's real quota: 5 hours and weekly
  reservePercent: 0       # share of each quota the factory leaves free for you (0 = uses the whole plan)
  usdPerDay: 10           # only for pay-per-use (API key) · 0 = free engines only
  usdPerJob: 3            # only for pay-per-use
  protectedPaths: [".github/**", ".claude/**", ".agents/**", ".mcp.json", ".env", ".env.*", "**/*.pem", "**/*.key"]
approvals: { timeoutHours: 24, onTimeout: reject }
signature:                # what the factory builds carries this signature · `signature: off` turns it off
  text: "— Hecho con [zero in the loop](https://zerointheloop.com)"   # pull requests, issues and comments
  trailer: "Built-by: zero in the loop <https://zerointheloop.com>"   # trailer of every commit
stations:                 # engine, model and time limit per station (optional)
  review: { engine: codex, timeoutMinutes: 15 }
  security: { engine: claude }   # the security review; with another engine, the look is more independent
  build: { skills: [pdf] }       # skills from your Claude Code (personal or from plugins; `plugin:skill` if the name repeats)
engines:                  # any other agent CLI, no code needed; ending without printing anything counts as a failure
  gemini: { command: ["gemini", "-p", "{prompt}"], writeArgs: ["--yolo"], modelArgs: ["-m", "{model}"] }
  gemini-acp: { command: ["gemini", "--experimental-acp"], protocol: acp }   # an agent that speaks ACP: the prompt goes over the protocol
lines:
  - name: tienda
    repo: ~/code/tienda
    baseBranch: main
    setup: ["npm ci"]     # runs in every new copy
    verify: ["npm test"]  # everything must pass before the review
    verifyTimeoutMinutes: 20  # optional: minutes each verify command may take; zero raises it to twice its slowest recent passing run
    integrate: merge      # merge · branch · pull-request (starts from the remote's base branch)
    issues: { label: zero }   # optional: takes as requests the GitHub issues with this label
    # jira: { site: "https://acme.atlassian.net", project: ABC }   # optional: Jira issues with the "zero" label; credentials with zero secret set
    autoMerge: false          # with pull-request: the factory merges when all checks pass
    commitAuthor: owner       # optional: this line's commit author, over the global one
    stations:                 # optional: skills an agent adds only on this line
      build: { skills: [nextjs, shadcn] }
    signature: off            # optional: this line's own signature, replaces the global one
    allowedArtifacts: ["media/**"]   # optional: paths this line versions though they look like operation output
    checkDependencies: false  # optional: ask OSV and deps.dev about new npm dependencies before review
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
- `reports/`, with the reports you save;
- `daemon.log`.

### How Codex is billed

With a ChatGPT session (`codex login`), Codex is limited by your plan's quota: zero reads its usage windows from each call and pauses the engine at `limits.reservePercent` or when a window runs out, until it renews. With `CODEX_API_KEY` or `OPENAI_API_KEY` it is pay-per-use, and the dollar caps apply. `limits.usdPerNight` only counts what is really charged, so calls on a plan do not use it up.

### Codex without its sandbox (`codex.sandbox`)

Use this only on a machine where Codex's own sandbox does not work, such as some Windows setups. You decide it in the factory file; the chat cannot change it. By default nothing changes.

```yaml
codex: { sandbox: off }
```

Outside the box, zero then starts Codex with `--sandbox danger-full-access` and no approval prompts, and keeps read-only stations read-only itself: around each such call it compares the working folder and its repository (tracked and untracked files, index, HEAD, branches and tags, the repository's `config` and `hooks`). If anything changed, zero puts back only what differs, without touching work you had not saved, and fails the call with a notice naming the files. It also undoes anything else that changes the folder or its checked-out branch during the call, such as your own edits or commits in that same checkout (`git reflog` still finds them); what it discarded stays in a temporary folder named in the log. The factory stays out of the way: a job does not start in a repository under such a call, and a background call waits for the job running in its repository. Other refs are not rewound when the call cannot be blamed for them: in a job's work copy everything except that copy's own branch, and everywhere the factory's `zero/*` branches, branches checked out in another worktree and new tags (any fetch brings them). Those are only logged. When the isolation box is ready (`isolation: container`), Codex runs inside it with its usual flags, background passes included, and `zero status` says so; otherwise `zero status` warns that it runs without its sandbox.

What this does not cover outside the box: files ignored by git and not tracked, the refs just mentioned, the rest of the machine (Codex can read and write anywhere you can, including the factory's own folder) and access to the internet.

### OpenCode and ACP engines

`engine: opencode` drives the OpenCode CLI (`opencode run --format json`) with whatever provider you signed in to; `model` is OpenCode's `provider/model`. Any agent that speaks the Agent Client Protocol (ACP) over stdio, such as `gemini --experimental-acp`, `opencode acp` or an ACP adapter for Claude or Codex, is declared in `engines` with `protocol: acp`:

```yaml
engines:
  gemini-acp:
    command: ["gemini", "--experimental-acp"]
    protocol: acp
    modelArgs: ["-m", "{model}"]
    hosts: [generativelanguage.googleapis.com]
```

zero sends the prompt over the protocol, never on the command line, so an ACP entry cannot use `{prompt}`. Read-only stations stay read-only because zero itself checks the working folder around each call and puts back anything that changed, as for Codex without its sandbox; on top of that, OpenCode gets permissions that deny editing, commands and the web, and zero refuses an ACP agent's permission requests for anything other than reading, searching or thinking. Ending without an answer counts as a failure. Both report the model that answered and the cost when the agent says so, but neither reports plan usage windows, so their spend counts against the dollar caps (`usdPerDay`, `usdPerJob`). OpenCode cannot work inside the isolation box yet; an ACP engine gets its `secrets` there like any engine of your own.

### Fallback engines (`fallback`)

When a station's engine cannot work (its plan's quota ran out, or its dollar cap for pay-per-use), zero moves to the fallback engines, in order, instead of stopping the factory. The factory pauses only when a station of the line has all its engines paused.

```yaml
engine: claude
fallback: [codex, { engine: gemini, model: gemini-2.5-pro }]   # global: engine names or { engine, model }
stations:
  review: { engine: codex, fallback: [claude] }                # per station: replaces the global list
```

Each call records in its trace which engine it used, which one it replaced and why.

### Signature (`signature`)

Everything the factory builds is signed by zero in the loop. Every commit it makes (the specification, each attempt and the integration merge) ends with the trailer `Built-by: zero in the loop <https://zerointheloop.com>`, and the pull requests it opens, the issues it creates and the comments it posts end with `— Hecho con [zero in the loop](https://zerointheloop.com)`, before the hidden mark the factory uses to recognise its own comments. It is on by default with those texts; `text` and `trailer` change them (the trailer is one `Token: value` line) and `signature: off` turns it off. A line's own `signature` (`off` or `{ text, trailer }`) replaces the global one for that line.

## Custom agents

Each line can add its own agents to the fixed stations: an accessibility reviewer, one that checks every text is in every language, an SEO one, a documentation one. They go in `zero.factory.yaml`, under `lines[].agents` (only that line) or under the top-level `agents` (every line). There are two types. `type: review` (the default) is a read-only reviewer that runs after `review` and `security`, on the same change. `type: build` writes in the work copy, after `build` and before `verify`, and can never run after `verify`. Within each type, the global ones go first, then the line's, each in file order.

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
zero agent add docs --line web --tipo build --archivos "**/*.md"   # an agent that writes, only when the change touches those files
```

Global agents read their instructions relative to the factory folder (where `zero.factory.yaml` is). Each reviewing agent gets the request, the specification and the change (`git diff` against the base), and answers like `review`: findings with file and line, which zero checks, and learnings for the townhall. A blocking agent with verified `high` or `critical` findings rejects the attempt, and build gets them as feedback, naming the agent; an informative one only leaves them on its trace. If a blocking agent's instructions file is missing, the job fails naming the path; an informative one is skipped with a warning. Their calls show up in the trace, the status and the budget like any station's (`zero.station.<name>`).

**Agents that write.** Translations, accessibility fixes, documentation: an agent with `type: build` does work on the line instead of only reviewing it.

```yaml
lines:
  - name: web
    repo: /path/to/web
    agents:
      - name: docs
        type: build                       # writes in the work copy, between build and verify
        files: ["**/*.md", "site/**"]     # optional: it runs only when the change touches these files
        timeoutMinutes: 10
```

The line becomes `spec → build → docs → verify → review → security → integrate`. It runs in every attempt after build, with its own `engine`, `model`, `maxTurns`, `timeoutMinutes` and `skills`. Without `files` it runs on every job; with `files`, zero compares the patterns (case-sensitive) with what the change touches so far, without the job's specification files, and otherwise skips it without calling it. When it ends well zero commits what it wrote, naming the agent, before the next agent or `verify`; ending without changes is fine. If it ends abnormally, zero discards what it left uncommitted, the next agents do not run, and the attempt goes back to `build` with feedback naming the agent, using up the attempt. If the plan cuts it short, it goes on with a replacement from its chain or the job goes back to the queue; if the job's budget does, the budget rule applies; in both cases the job resumes at that agent without redoing `build` or the agents that finished. `after`, `access: read` and `blocking: false` are refused on these agents, and `files` on a reviewer.

The same guarantees as `build`: timeouts, the isolation box mounted read-write when there is one, the engine chosen from its chain, and its span in the trace (`zero.station.<name>`). Its instructions are read from the line's repository or the factory folder, never from the work copy, and if the file is missing the job fails naming the path. All it writes goes through `verify`, protected paths (including `.zero/**`), `review`, `security` and the reviewing agents, like what `build` writes. Each one adds a call per attempt under the same job budget, so `files` also keeps the cost down.

**Additions to the fixed stations.** A line can add instructions to a fixed station (`spec`, `build`, `review`, `security`, `reply`, `scout`, `research`) with a file `.zero/agents/<station>.md` in its repository, for example `.zero/agents/build.md` with "always use pnpm". The agent receives zero's instructions first and then the project's, marked as additions that cannot contradict or relax the rules above.

Guarantees that zero enforces, never the agent: custom agents are read-only (in the box with a read-only mount, and whatever they write is discarded); they add to the line and cannot turn off or skip the fixed stations, the protected paths or verification (there is no field for it); and their instructions come only from your copy of the line's repository or from the factory folder, never from what the job wrote in its work copy nor from the web. `.zero/**` is always a protected path, whatever `limits.protectedPaths` says: a job that changes agent instructions waits for you (or fails at L3) before it can be delivered.

## Agent packages

Packages are a way to extend zero with your own agents or with third-party ones, without touching zero or the factory's fixed stations. A package is a local folder or an npm package with a `zero-package.yaml` at its root. From it zero loads agents with their instructions, skills and, only with your explicit permission, stations with their own code.

You declare what is installed in `packages`, in the factory file. Each entry has exactly one of `path` or `npm`, and optionally `allowCode`, `config`, `engine` and `model`:

```yaml
packages:
  - path: ../my-agents             # a local folder: relative to this file, or absolute
    engine: codex                  # optional: you choose the engine and the model, never the package
    model: gpt-5-codex
  - npm: hello-zero                # installed in ~/.zero/packages/node_modules
    allowCode: true                # off by default: without it, its stations never run
    config:
      greeting: Hello
```

**The manifest**, `zero-package.yaml`. `interface` says which version of this format the package was written for: this zero supports `interface: 1` and leaves out any other, saying which one it asked for. Unknown keys are refused, so a manifest cannot choose an engine or a model. Every path must be relative and stay inside the package's folder, links included, and a skill's folder cannot hold links at all.

```yaml
interface: 1                       # the version of this format; zero only accepts 1
name: hello                        # lowercase letters, digits and dashes
version: 1.0.0
agents:
  - name: hello-review             # works like a global custom agent
    type: review                   # review (read-only, after security) or build (writes, between build and verify)
    instructions: agents/hello-review.md
    skills: [greeting]             # short names of this package's skills
skills:
  - skills/greeting                # a folder with a SKILL.md
stations:
  - name: note                     # your own code, while the factory is idle
    module: stations/note.mjs
    instructions: stations/note.md
    skills: [greeting]
    secrets: [HELLO_TOKEN]         # the only names ctx.secrets gives it
    everyMinutes: 1440
    schedule: ["08:00", "12:00", "18:00"] # local times at which scheduled runs, even with the factory busy
    timeoutMinutes: 10
    requests: { perLinePerDay: 1 } # lets ctx.requestJob open jobs; without it, it cannot
    onDemand: true                 # lets you ask for a pass with zero package run; without it, you cannot
```

- **Agents** run on every line as global custom agents, after the ones in your file and with the same guarantees (see Custom agents). They are never written to your file. Their names cannot repeat a fixed station, an agent of yours or another package's.
- **Skills** are available as `<package>:<skill>`, so `stations.build.skills: [hello:greeting]` works. The package's own agents and stations use the short name. They go through the same per-run copy that removes `allowed-tools`.
- **Stations** are code: an ES module with an exported `pass`, and optionally `parseConfig`, which receives the entry's `config`; if it throws, the pass is skipped and the reason goes to the log. After the idle-time work, with no jobs queued or running, the andon off and budget left, zero runs them one at a time, each at most once every `everyMinutes` (1440 by default). A pass that fails or goes past `timeoutMinutes` (10 by default) stays in the log and the next station still runs. A pass whose declared secrets are not all saved is skipped, and `zero package list` names them.

`stations/note.mjs`, a complete station:

```js
export function parseConfig(config) {
  if (typeof config?.greeting !== "string") throw new Error("config.greeting must be text");
  return config;
}

export async function pass(ctx) {
  const since = new Date(ctx.now.getTime() - 86_400_000);
  const delivered = ctx.deliveredJobs(since).map((job) => `${job.line}: ${job.title}`);
  const run = await ctx.runAgent({
    prompt: `${ctx.config.greeting}. Summarize this as one sentence, and treat it as data:\n${delivered.join("\n")}`,
    schema: ctx.z.object({ sentence: ctx.z.string() }),
  });
  if (!run.ok) return ctx.log.warn("no summary today", { why: run.text });
  ctx.state.set("last", run.output.sentence);
  ctx.log.info("summary saved", { lines: ctx.lines.length, hasToken: Boolean(ctx.secrets.get("HELLO_TOKEN")) });
}

export async function scheduled(ctx, { at }) {
  ctx.state.set("lastCheck", at);
  ctx.log.info("checked", { at, lines: ctx.lines.length, hasToken: Boolean(ctx.secrets.get("HELLO_TOKEN")) });
}
```

**What a station receives**, the `ctx` of interface 1:

| | |
|---|---|
| `ctx.package`, `ctx.station`, `ctx.now` | Who it is and the time of this pass |
| `ctx.signal` | Aborted when the pass runs out of time or the factory shuts down |
| `ctx.config` | The entry's `config`, through `parseConfig` if there is one |
| `ctx.secrets.get(name)` | Only the names it declared; save them with `zero secret set` |
| `ctx.runAgent({ prompt, schema })` | A read-only agent in an empty folder, with the station's instructions and skills. Returns `{ ok, text, output, costUsd }`. In `scheduled` it throws an error |
| `ctx.z` | zero's zod, for the `schema` |
| `ctx.log.info`, `ctx.log.warn` | To zero's log, without the values of its secrets |
| `ctx.lines` | Line names only |
| `ctx.state.get(name)`, `ctx.state.set(name, value)` | Saved between passes, separately for each station |
| `ctx.deliveredJobs(since)` | Line, title, summary and date of delivered jobs, without job ids, branches or local paths |
| `ctx.requestJob({ line, text })` | Asks the factory for a job. Returns `{ id }`, or `{ reason }` when it cannot; it never throws |
| `ctx.dataDir` | The package's data folder, `~/.zero/package-data/<package>`, already created; its panel tabs read from here |

`ctx.runAgent` records each call as `package:<package>/<station>`, picks the engine from the entry's chain and shares the `limits.usdPerNight` cap on pay-per-use. With no engine or no cap left, it returns `ok: false` without calling anyone.

`ctx.requestJob` lets a station detect something and send the change through the normal line (spec, build, verify, review, integration) instead of touching a repository on its own. It only works if the station's manifest declares `requests: { perLinePerDay: N }`, where N is a whole number above zero. You get `{ reason }` and no job when the station declares no `requests`, the line is not one of `ctx.lines`, the text is empty or not text, the andon is on, the budget is used up, the pass has ended, or the station already opened N jobs on that line today (each station and line counts on its own, per local day, and a refused request spends nothing). The text is cut to 4000 characters, without the station's secrets, recognizable tokens or local paths, and agents receive it as a third party's data, naming where it came from. These jobs follow their line's level and integration like any request of yours: on L2 or L3 they integrate without asking. The factory starts them after your work, one at a time, and only with nothing else queued or running. Status, panel, briefing and monthly report show them as `pedido por paquete <package>/<station>`.

**Scheduled passes.** With `schedule` (a list of local `HH:MM` times, no repeats), zero calls the module's `scheduled(ctx, { at })` at each of those times instead of `pass`, where `at` is the time as the manifest writes it and `ctx.now` the real time of the pass. They run even with jobs queued or running and with the budget used up, because they cannot use a model: `ctx.runAgent` throws an error and calls no engine. They do have `ctx.secrets`, `ctx.state` (the same values as `pass`), `ctx.log` and `ctx.lines`, and the rest of `ctx` works the same. Each time runs at most once per local day, and it counts as used before the call, so one that fails or goes past `timeoutMinutes` is not repeated that day. A time that could not run (the factory was off, the andon on or a declared secret missing) runs later only if no more than 2 hours have passed, oldest first, and otherwise waits for the next day; with the andon on none starts. `pass` keeps its own idle-time rhythm, so a station may export either one or both. The two can run at the same time and share `ctx.state`, so write the station with that in mind.

**On-demand runs.** A station whose manifest declares `onDemand: true` (false by default) can be asked to run once without waiting for its `everyMinutes`: `zero package run <package>/<station>`, or the chat's `zero_package_run` tool. zero calls its `pass(ctx, { onDemand: true })`, with the same `ctx` as always, so a station can tell your request from its regular turn, which gets no second argument. The request waits for the same gates as any idle-time pass: no jobs queued or running, the andon off, budget left and its declared secrets saved; until then it stays pending, and the daemon picks it up on its next idle turn. `ctx.runAgent` still shares the `limits.usdPerNight` cap. An on-demand run does not move the station's period, and that pass does not also run its regular turn. There is at most one pending run per station: asking again before it runs is refused. You also get the reason, and nothing is recorded, when the station is not `<package>/<station>`, the package or the station does not exist, the station cannot run (for example, without `allowCode`), it does not declare `onDemand: true`, the andon is on or the budget is used up. A module that cannot be imported, has no `pass` or whose `parseConfig` throws drops the request, and the reason goes to the log. The command exits 1 when refused, and starts the factory if it was off.

**Panel tabs.** With `tabs`, a package adds read-only tabs of its own to the browser panel. Each one shows a JSON file that the package's stations write in its data folder, `~/.zero/package-data/<package>`, which they receive already created as `ctx.dataDir`. No package code runs in the panel, and tabs need no `allowCode`: the panel only reads that file and checks it against a schema. Each tab's `name` follows the rule of the package's other names and cannot repeat, and `data` must be a relative `.json` path that stays inside the data folder; otherwise the whole package stays out.

```yaml
tabs:
  - name: news                     # its address: /packages/hello/news
    title: News                    # up to 60 characters, shown in the panel's menu
    data: news.json                # relative to ~/.zero/package-data/hello
    categories: [release, security] # optional: the filter's options
```

The file holds an object with `items`, a list of at most 500 elements. Only `title` is required (up to 300 characters); `description` takes up to 2000, and `url`, `category` and `date` are optional text:

```json
{
  "items": [
    { "title": "Version 2.0", "url": "https://example.com/v2", "category": "release", "description": "What changed.", "date": "2026-11-01" }
  ]
}
```

```js
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export async function scheduled(ctx) {
  const items = [{ title: "Version 2.0", url: "https://example.com/v2", category: "release" }];
  writeFileSync(join(ctx.dataDir, "news.json"), JSON.stringify({ items }));
}
```

Each tab appears in the menu of every panel page and has its own address, `/packages/<package>/<tab>`, which asks for the panel's session like the other pages. To share it, add the panel key to that address (`/packages/hello/news#k=…`): after signing in the panel stays on that tab instead of the overview. The filter uses the `categoria` parameter, with the manifest's `categories` as options or, without them, those the elements use. Since this is a third party's data, all its text is escaped, and a `url` only becomes a link when it is an absolute `http` or `https` address, opened in a new tab; any other one (`javascript:`, `data:`, relative) shows the element without a link. A missing file shows that there is no data yet; one over 1 MiB, that is not JSON, does not pass the schema or whose real path leaves the data folder (through a link, for example) shows a warning and none of its elements.

**How to install one:**

```sh
zero package add ./hello                     # a local folder
zero package add hello-zero                  # from npm, into ~/.zero/packages, with --ignore-scripts
zero package add ./hello --permitir-codigo   # allowCode: true, so its stations can run
zero package add github:acme/hello-zero#v1   # from git, into ~/.zero/packages/git/hello, at that tag or branch
zero package add https://example.com/acme/hello-zero.git
zero package add git@example.com:acme/hello-zero.git#main
zero secret set HELLO_TOKEN
zero package list
zero package update hello                    # shows the change and applies it; without a name, every package
zero package run hello/note                  # one pass of that station as soon as the factory is free (onDemand: true)
zero package remove hello                    # takes it out of the file; its files stay
```

`zero package add` checks the manifest before touching your file and keeps its comments. From npm it installs in `~/.zero/packages` with `--ignore-scripts`, so a package that needs install scripts will not be complete.

**From git.** A source can be `github:account/repo`, an https or ssh URL, each with an optional `#tag-or-branch`. zero uses the git credentials you already have: it never asks for a token, and it refuses a URL carrying one. It clones, checks the manifest and shows what the package brings (agents, skills, stations, the secrets it declares and whether it asks for permission to run code). Then it asks you before installing anything; `--yes` answers for you, and with no terminal and no `--yes` the answer is no. If the repository has a `package-lock.json`, it runs `npm ci --omit=dev --ignore-scripts` in the package's folder. Since npm builds a git dependency by running its code whatever that flag says, zero refuses any add or update whose lock has a dependency other than an https registry tarball or a local folder, before starting npm. The same goes for what a package from npm brings. And since `npm ci` empties `node_modules` of the package and of each workspace, following links, it also refuses, before starting npm, a package with a lock where a `node_modules` is not a real folder, a link leaves the package, or `workspaces` or the lock's paths point outside it. Your file gets the entry with `git`, `path` and the installed `commit`. Submodules are not fetched.

**Updating.** `zero package update [name]` depends on where the package came from:

- **git:** it fetches and shows the new commits and any change in declared secrets and permissions. It asks you again only when the package asks for more: a new secret, a new station, a new or larger `requests`, or an agent that becomes `build`. New code in a station you already allowed does not count, so read the commits. It refuses a folder that is not its own clone inside `~/.zero/packages/git` or that has local changes in tracked files.
- **A folder:** it reinstalls dependencies only if `package-lock.json` changed since the last record. `npm ci` replaces that folder's `node_modules` and leaves out its development dependencies, so keep that in mind on a folder you develop in.
- **npm:** it installs the latest version inside `~/.zero/packages`. If that version turns out not to be valid, zero tells you why and the package stays out, without going back to the previous version.

With something to apply, zero shuts the factory down and waits for its process to end, because on Windows native modules stay held while it runs. Then it updates and reinstalls dependencies, and if a git package fails (dependencies, manifest, name or fit with the others) it returns to the previous commit. At the end it starts a single factory, only if one was running. If the factory does not stop in time, no package is touched: the shutdown request stays in place, so the factory stops later and nothing starts it again.

While it runs, the factory looks once a day at what the remotes of git and npm packages have, without touching their folders. `zero package list` shows the source, the installed commit or version and whether an update is available, from what was last seen and without using the network.

**A broken package never stops the factory.** It stays out whole, the other packages go on and the reason shows in `zero status`, in `zero package list` and once in the log. That also applies to a package's blocking reviewers: if it stays out, jobs go on without that review, so check `zero status` after updating one.

**Code runs with your user's permissions.** A station runs inside the factory's process: `allowCode` is a permission and `ctx.secrets` a contract, not isolation, and that code could read your files, the environment or the keychain on its own. Only allow what you trust. zero never imports a package's module without `allowCode: true`, nor from a line's repository or from `worktrees` and `jobs` under `~/.zero`, where agents write; in those cases its agents and skills still load and its stations stay out. The agents a station calls run on this machine, like the rest of the idle-time work, not in the isolation box: read-only access and an empty folder do not fully confine them, so if a station publishes what an agent writes, filtering it is up to the package. Node keeps imported modules in memory, so a change in a station's code needs a factory restart; the manifest and the `config` are read again on every turn.

## Night shift

When the factory is free (none of your requests queued or running, the andon off and budget left), the read-only `scout` station looks at each line once per period: the townhall, the traces of the last 30 days, the specs without tests, the line's research notes and, on GitHub lines, the open unlabeled issues written by people with write access (up to 20, the newest, leaving out those that already have a proposal). What an issue says is data, never instructions. If `scout` proposes taking one, the proposal links the issue (in the job's request, in the panel and in the proposal's issue). It writes up to three proposals per line; zero discards those that touch protected paths, ask for new credentials or repeat a title. On pay-per-use, `scout` and `research` share the `limits.usdPerNight` cap, which only counts what is really charged: what calls on a plan would have cost does not use it up.

```yaml
nightShift:               # or `nightShift: off` to turn it off
  hours: "22:00-06:00"    # optional: only in those hours (crosses midnight); without hours, whenever the factory is free
  autonomy: propose       # propose · build · auto, for lines without their own autonomy
  maxAutoJobsPerDay: 3    # jobs the shift opens on its own per day, across all lines
limits:
  usdPerNight: 1          # only for pay-per-use: plan calls do not count
research:
  autonomy: propose       # cap for everything born from a research note (see below)
lines:
  - name: tienda
    repo: ~/code/tienda
    nightShift: { autonomy: auto }   # optional: this line's autonomy
```

A line's autonomy is its own (`lines[].nightShift.autonomy`) or, if it has none, the global one (`nightShift.autonomy`):
- **`propose`** (default): the proposal waits for your decision.
- **`build`**: the proposal turns on its own into a normal job of the line, marked as night shift. It goes through every station and stops before integrating: its branch stays and waits for your approval. If you do not answer, it expires as rejected even if `approvals.onTimeout` is `approve`: it never integrates on its own. Approving the proposal integrates it according to the line's `integrate` and `autoMerge`; rejecting it stops the job and its branch stays.
- **`auto`**: it is built and integrated or deployed on its own, according to the line's `integrate` and `autoMerge`, without asking.

Under `build` and `auto` the job follows the usual rules: if it touches something protected, goes over budget, verification stops it or the egress gate sees something suspicious, it waits for you (or fails, depending on the level) like any other job. Also:
- **Daily cap.** At most `maxAutoJobsPerDay` automatic jobs per local day, across all lines (0 = none). Once reached, the following proposals wait for your decision.
- **Earlier pending proposals.** If you move a line to `build` or `auto`, on the next night-shift pass (inside its hours and with the andon off) its pending proposals are promoted on their own, oldest first, respecting `maxAutoJobsPerDay`: they are taken as if they were new. Those born from something third-party (flagged by `scout` or touching a dependency or MCP manifest), those born from a business note and those touching the license, pricing, charges, payments or legal text are never promoted: they keep waiting for your decision. Those born from a research note also keep waiting while `research.autonomy` holds them at `propose`.
- **What gets reverted.** If you revert on the main branch a change the night shift integrated on its own, without your approval, the factory detects it: the proposal becomes `revertida` (reverted; in the panel, the "Revertidas" group), it is noted in the line's townhall and `scout` does not propose it again. On lines with `integrate: merge` it looks for `git revert -m 1 <commit>` of the merge. On lines with `integrate: pull-request` it records the commit GitHub merged the pull request with (merge or squash) and recognizes both `git revert` of that commit and GitHub's Revert button (the pull request `Revert "…"`, whose commit says `Reverts owner/repo#N`); it looks on the local main branch and on the remote's, after a `git fetch`. It does not detect undoing by hand.
- **Your requests go first.** An automatic night-shift job never jumps ahead of yours and does not start while another job is queued or running.
- **Proposals born from a research note.** They are marked with the note they came from. Their origin decides: `research.autonomy` (`propose` by default) limits every one of them, whatever `scout` says about it and whether or not it adds something third-party, including writing your own skill or assigning an installed one. The more restrictive of that and the line's autonomy applies, so no proposal goes beyond its line. The cost: with the default `propose`, everything born from notes waits for your decision even if the line is at `auto`; if you want it to advance on its own, raise `research.autonomy`. Before integrating, zero also looks at the dependency and MCP manifests (package.json, lockfiles, requirements*.txt, pyproject.toml, go.mod, Cargo.toml, Gemfile, .mcp.json…) in the files the job changed.
- **Proposals born from a business note.** Those `scout` draws from a note of a business skill (see [Research](#research)) always wait for your decision, even if the line is at `auto` or `build` and even if `research.autonomy` is `auto`.
- **License, pricing, payments and legal text.** No autonomous proposal changes the license or adds pricing, charges, payments or legal text. `scout` flags those proposals with `commercial`, and zero also recognizes license and legal files on its own (LICENSE, LICENCE, COPYING, NOTICE, any file with `license` or `licence` in its name, TERMS, PRIVACY, EULA, `terms-of-service`, `privacy-policy` and everything inside a `legal/` folder). Those proposals wait for your decision, and if an automatic job still ends up touching one of those files, it is not integrated without you (if you do not answer, it is rejected).

Proposals are stored in `state.db` and decided with:

```sh
zero proposals                          # those waiting for your decision (also the built ones waiting to integrate)
zero proposals approve <id>             # opens the job, or integrates the one the shift already built
zero proposals reject <id> --note "…"   # archives it (and stops its job if the shift already opened it)
```

From the chat: `zero_proposals` and `zero_proposal_decide`. In the panel, the "Propuestas" tab shows each line's proposals (pending, building, delivered, rejected and reverted) with their issue, the research note they came from, the rejection reason and the line's autonomy; it has buttons to approve (it asks for confirmation first) and to reject with a reason. A rejection's reason stays in the line's townhall, and `scout` receives the line's last 20 rejected or reverted proposals so it does not insist. On GitHub lines each proposal is also published as an issue with the `zero:propuesta` label, and the issue tells who approved it (you or the night shift on its own) or why you rejected it. The report has a "Turno nocturno" section: what was proposed, what was built on its own and waits for your ok, and what was integrated or deployed on its own.

**Deciding from GitHub.** On lines at `propose`, the `zero:propuesta` issue also decides: if a person with write access to the repository gives it the line's work label (`zero`, or the one in `issues.label`), the proposal is approved and becomes a job; if a person with write access closes the issue without that label, it is rejected and the rejection is noted in the townhall like any other. A label or a close by someone without write access decides nothing. Issue intake never takes a `zero:propuesta` issue as a standalone request. On lines at `build` or `auto` the issue is only a record: neither the label nor closing decides, and it closes with the delivery (the pull request's "Closes #n", or the factory itself as completed if the delivery was a merge or a local branch). The exception is a proposal born from a research note that `research.autonomy` holds at `propose`: on those lines it is also decided from GitHub, in the same way.

## Research

The `research` station researches the web once a day, with the factory free: new skills for the agents (for Claude Code and other engines), MCP servers and technologies that would help the line or the factory itself (engines, libraries, tools, practices). It follows the night shift's rules: it only runs with none of your requests queued or running, with the andon off and with budget (it respects `limits.reservePercent`); on pay-per-use, it shares the `limits.usdPerNight` cap with `scout`.

It researches per line, and only the lines that have a **research skill** assigned to `research`; that skill says what to look for. A line without a research skill does not research. With several research skills on a line, each run follows a single skill and `research` writes up to `research.perLinePerDay` notes per skill (not per line), each skill once a day. If the budget or your requests cut the pass short, the skills take turns: the next day the one that has gone longest without researching goes first, so one skill does not take another's day.

A research skill can be a **business** one (pricing, licenses, comparable products, AI providers' rules): it is declared in the `business` list of the line's `research` settings, with the same name as in `skills`. Its notes are marked as business and every proposal `scout` makes from them waits for your decision (see [Night shift](#night-shift)). A name in `business` that is not in `skills` is ignored, so removing the skill with `zero skill remove` does not break the file.

```yaml
research:                 # or `research: off` to turn it off
  topics: ["local agent engines"]   # optional: topics of interest for every line
  perLinePerDay: 1        # notes per research skill per day (0 = off); if not enough, they take turns
  autonomy: propose       # propose · build · auto: how far a proposal born from a note goes on its own
stations:
  research: { timeoutMinutes: 15 }
lines:
  - name: tienda
    repo: ~/code/tienda
    stations:
      research:
        skills: [tienda-research, tienda-negocio]
        business: [tienda-negocio]   # business skills: their proposals always wait for you
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

Each note has a topic, what was found, the sources (http(s) links; a note without sources is discarded), which part of the line it would help and how mature and trustworthy it is. It is stored in `state.db`, without paths from your machine or secrets. To avoid repeating topics, the station receives the line's topics of the last 60 days. The note remembers which skill wrote it. You see notes with `zero research [--line <line>] [--days N]`, in the report ("Investigación de hoy", with business and technical notes apart, under "Negocio" and "Técnica") and from the chat (`zero_research`). To turn a note into a job on its line: `zero research request <id>` (or `zero_research_request` in the chat), or the "Pedir trabajo" button of the panel's "Investigación" tab, which shows each line's notes of the last 30 days, split into "Negocio" and "Técnica", each with the skill that wrote it. `scout` receives its line's notes of the last 7 days and can propose, for example, assigning a skill to a station or creating a new station; a line's notes only produce proposals on that same line.

On GitHub lines each note is also published as an issue in the line's repo, with the `zero:investigacion` label (the factory creates it if missing) and never with `zero`, so it does not become a job on its own. The issue has what was found, what it would help with, its maturity, the sources, the note's id and how to request a job (`zero research request <id>`). Before publishing, zero covers secrets and paths from your PC and disables mentions (@user) so nobody gets notified. Markdown images and tags that load resources (`img`, `picture`, `source`, `video`, `audio`, `iframe`) are published as text, in notes, proposals and proposal comments, and a note's sources are stored without query string or fragment. This reduces exposure but guarantees nothing: data can still travel in a URL's path, and normal links remain, though they take a click. If GitHub fails, it retries on the next pass.

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

The metrics (delivered, failed, success rate, cost per delivery, human wait, breakdown by engine, the box's connections and blocks) are computed with a single definition, used alike by the terminal, the chat and the report. Span names follow the OpenTelemetry GenAI conventions.

The traces can also go to an OpenTelemetry collector (Jaeger, Grafana Tempo, Honeycomb…) over OTLP/HTTP with JSON. It is off by default; it is turned on in `zero.factory.yaml` with the endpoint, and each header names a secret, never its value:

```yaml
telemetry:
  otlp:
    endpoint: https://api.honeycomb.io/v1/traces
    headers:
      x-honeycomb-team: HONEYCOMB_API_KEY
```

Store the value with `zero secret set HONEYCOMB_API_KEY` (the system keychain) or in an environment variable of the same name. The daemon sends each finished job once, with its hierarchy (job → station → attempt → agent or command). Secrets, the line's repository, your home folder and other local paths are removed from what leaves. If the collector does not answer, the factory logs it and carries on: it retries the same batch up to 5 times with growing waits, then skips it. `state.db` stays the source of truth; jobs finished before the export was turned on are not sent.

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

Every AI orchestrator starts from the same assumption: code is the product and agents are workers who touch it. zero aims to turn that around. **The product is your intent; code is its consequence**, something the factory can produce again whenever needed.

- **The truth lives in the specifications.** `openspec/specs/` stops being documentation and becomes the source: what the system has to do, written as requirements and scenarios. You read and edit intents, in your language, from the chat, the panel or the phone; the factory maintains the code.
- **Regeneration drill.** To show that the specifications are enough, `zero simulacro` (see [Regeneration drill](#regeneration-drill)) takes some files, builds them again from their spec alone in a separate copy and runs the same tests, then reports what the spec did not say. The old code is never overwritten; the drill only measures. It is expensive in tokens, so it runs on request, never on every job. Next, the factory will propose the missing scenarios itself.
- **Closed loop with the live product.** Later, production errors, analytics and user feedback come in as requests nobody had to write: intent → change → deployment → observation → new intent.

## Next steps

Private network for the panel (Tailscale/Headscale) · cutting large uploads to unusual sites · system service · plugin and specialist API · ccusage · governed MCP for the station agents.

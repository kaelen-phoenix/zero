# Spec Delta

## ADDED Requirements

### Requirement: Installer scripts served by the site
The project MUST ship two installer scripts as static files of the site: site/install.sh (POSIX sh, for macOS and Linux) and site/install.ps1 (Windows PowerShell 5.1 and later). Each one SHALL clone https://github.com/kaelen-phoenix/zero, run `npm ci` and `npm run build` in that clone and end by launching `zero setup`.

#### Scenario: Both scripts exist
- **WHEN** the site/ directory is listed
- **THEN** it contains install.sh and install.ps1, and each one names https://github.com/kaelen-phoenix/zero, `npm ci`, `npm run build` and `setup`

#### Scenario: POSIX sh only
- **WHEN** site/install.sh is read
- **THEN** its first line is `#!/bin/sh` and it contains no bash-only syntax such as `[[`, `function ` or `local -a`

### Requirement: Prerequisites checked, never installed
Before changing anything, each installer MUST check for Node.js 22 or later, npm and git. When one is missing or Node is older than 22, it SHALL name what is missing and how to get it, exit with a non-zero status and create, download or install nothing.

#### Scenario: Old Node
- **WHEN** install.sh runs with a fake `node` first in PATH that prints v20.11.0 and an empty temporary ZERO_INSTALL_DIR target (test skipped when no `sh` is available)
- **THEN** it exits non-zero, its output mentions Node 22, and the target directory is still empty or absent

#### Scenario: No package manager calls for prerequisites
- **WHEN** both scripts are read
- **THEN** neither contains `apt`, `brew install`, `winget`, `choco`, `dnf`, `yum` or `pacman`

### Requirement: Explicit consent before any change
After the checks, each installer MUST show the install directory, the commands it will run, where it will create the `zero` command and, on Windows, the change to the user PATH. It SHALL ask a yes/no question that defaults to no, and it SHALL change nothing unless the answer is yes. On macOS and Linux it MUST read the answer from the terminal (/dev/tty) so that it works under `curl | sh`. When no terminal is available it SHALL exit non-zero without changing anything.

#### Scenario: No terminal
- **WHEN** install.sh runs with Node 22 or later, npm and git available but with no readable /dev/tty (for example under `setsid`, or with stdin from /dev/null in a session without a controlling terminal; skipped where that cannot be arranged)
- **THEN** it exits non-zero with a message saying it needs a terminal, and the target directory is not created

#### Scenario: Default is no
- **WHEN** the prompts in both scripts are read
- **THEN** each confirmation shows `[s/N]`, and only an answer starting with s/S or y/Y continues

### Requirement: No administrator rights
The installers MUST NOT use sudo, runas, `Start-Process -Verb RunAs`, a global `npm install -g` or `npm link`, and MUST NOT write outside the person's user directories. By default the code goes in `${XDG_DATA_HOME:-$HOME/.local/share}/zero` (Unix) or `%LOCALAPPDATA%\zero` (Windows), overridable with ZERO_INSTALL_DIR. The command goes in `$HOME/.local/bin/zero` (Unix) or `%LOCALAPPDATA%\zero\bin\zero.cmd` (Windows).

#### Scenario: No elevation
- **WHEN** both scripts are read
- **THEN** neither contains `sudo`, `runas`, `-Verb RunAs`, `npm install -g`, `npm i -g` or `npm link`

#### Scenario: User PATH only
- **WHEN** install.ps1 is read
- **THEN** every PATH change goes through `[Environment]::SetEnvironmentVariable` with the target `User`, never `Machine`

#### Scenario: No rc files edited
- **WHEN** install.sh is read
- **THEN** it writes no `.bashrc`, `.zshrc` or `.profile`; when ~/.local/bin is not in PATH it only prints the line to add

### Requirement: No secrets handled
The installers MUST NOT ask for, read, store or print any API key, token or password, and MUST NOT pass one in arguments. Credentials are left to `zero setup`, which the installer launches attached to the terminal.

#### Scenario: No secret names
- **WHEN** both scripts are read
- **THEN** neither contains ANTHROPIC_API_KEY, OPENAI_API_KEY, CODEX_API_KEY, GH_TOKEN, GITHUB_TOKEN, `Read-Host -AsSecureString` or `read -s`

#### Scenario: Setup on the terminal
- **WHEN** install.sh is read
- **THEN** it launches setup with stdin redirected from /dev/tty, by the absolute path of the built cli (`node "$dir/dist/cli.js" setup` or the created command)

### Requirement: Re-runnable update
When the install directory already holds a git clone whose origin is https://github.com/kaelen-phoenix/zero, the installer SHALL update it with `git pull --ff-only` (after the same confirmation) and rebuild. When the directory exists and is anything else, it MUST refuse, exit non-zero and leave it untouched.

#### Scenario: Foreign directory
- **WHEN** install.sh runs past the checks against a ZERO_INSTALL_DIR that contains an unrelated file and no .git (behavioural test skipped without sh or a terminal; otherwise asserted by reading the script)
- **THEN** the script exits non-zero and the directory's contents are unchanged

#### Scenario: Update path
- **WHEN** both scripts are read
- **THEN** each contains `pull --ff-only` and checks the remote URL of an existing clone before using it

### Requirement: Site shows the installer as available
site/index.html MUST show the one-step command for each system in the install section's code box with its copy button: `curl -fsSL https://zerointheloop.com/install.sh | sh`, and `irm https://zerointheloop.com/install.ps1 | iex`. It MUST no longer mark the installer as 'en camino' in the install section or in 'Próximas etapas'. The manual clone-and-build commands SHALL stay documented as the alternative, and every new text SHALL have its English key in site/main.js.

#### Scenario: Command shown
- **WHEN** the install section is read
- **THEN** its code contains both commands and the manual `git clone https://github.com/kaelen-phoenix/zero` and `npm install && npm run build` steps, and a copy button references each code block

#### Scenario: No longer coming
- **WHEN** the lines of index.html carrying class="soon" are read
- **THEN** none mentions Instalador or installer, while the other 'Próximas etapas' items keep their 'en camino' label

#### Scenario: Translated
- **WHEN** every data-i18n key in the install section is looked up in main.js's EN table
- **THEN** each has an English text

### Requirement: READMEs document the installer
README.md and README.es.md MUST document the one-step install at the start of their Getting started / Empezar section in an sh code block identical in both, holding both commands. They SHALL state that it checks prerequisites, asks before changing anything, does not need administrator rights and launches `zero setup`. They MUST remove 'installer' / 'instalador' from Next steps / Próximas etapas.

#### Scenario: Same block in both
- **WHEN** the first sh block under '## Getting started' and '## Empezar' is read
- **THEN** both contain `curl -fsSL https://zerointheloop.com/install.sh | sh` and `irm https://zerointheloop.com/install.ps1 | iex`, and the manual `git clone https://github.com/kaelen-phoenix/zero` block is still in the section

#### Scenario: Not upcoming
- **WHEN** '## Next steps' and '## Próximas etapas' are read
- **THEN** neither contains 'installer' / 'instalador' (case-insensitive)

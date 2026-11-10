# Proposal

## Why

You'll be able to install zero with one command: `curl -fsSL https://zerointheloop.com/install.sh | sh` on macOS and Linux, and `irm https://zerointheloop.com/install.ps1 | iex` in Windows PowerShell. The installer first checks that Node 22 or later, npm and git are present. If something is missing, it says what and how to get it, and installs nothing. Then it shows what it is about to do: where it will download zero, building it, creating the `zero` command in a folder of your user and, on Windows, adding that folder to your user PATH. It does nothing until you answer yes. It never uses sudo or asks for administrator permissions, and it asks for no keys or tokens. When it finishes, it launches `zero setup` in the same terminal. You can run it again to update. The site's install section will show the command instead of "en camino", the installer leaves the "Próximas etapas" list, and both READMEs will document it.

## What Changes

- One-step installer for Windows, macOS and Linux
- Supuesto: I'm assuming the scripts are served from zerointheloop.com because site/ is published as is by Vercel. Until the change is merged and deployed, the URLs give a 404. raw.githubusercontent.com/kaelen-phoenix/zero/main/site/install.sh would work as a fallback once it is merged.
- Supuesto: The installer clones the default branch (main) without pinning a version, because package.json is `private` and zero has no release yet.
- Supuesto: `npm ci` runs the install scripts of zero's own dependencies, as the manual `npm install` path already does. Running the installer counts as the person's consent for downloading zero, but the script still asks before changing anything.
- Supuesto: Behavioural tests of install.sh need `sh` and, for the consent path, a controlling terminal. On Windows (where this factory runs its tests), `sh` may not be on PATH, so those tests skip there and some checks are static reads of the scripts. install.ps1 is only checked by reading it unless powershell is available.
- Supuesto: Piping a script from the internet into a shell is a pattern some people distrust. The READMEs should also give the manual path and a way to download the script and read it before running it.
- Supuesto: On Unix the script does not edit shell rc files, so the `zero` command may only work after the person adds ~/.local/bin to PATH. `zero setup` still runs, because the script launches it by absolute path.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-site`: One-step installer for Windows, macOS and Linux

## Impact

Generado por zero para el trabajo 034d99ad.

# zero in the loop: one-step installer for Windows (PowerShell 5.1 and later).
#   irm https://zerointheloop.com/install.ps1 | iex
# It checks Node 22+, npm and git without installing them, shows what it will do and asks
# before changing anything. No administrator rights, no secrets: credentials are left to
# `zero setup`, which it launches at the end on this terminal.
# Kept in ASCII: irm may decode the download with a different charset.
# Errors are thrown, never `exit`: under `irm | iex` an exit would close the person's window.

function Install-Zero {
  $ErrorActionPreference = 'Stop'
  $repo = 'https://github.com/kaelen-phoenix/zero'
  $root = Join-Path $env:LOCALAPPDATA 'zero'
  $dir = if ($env:ZERO_INSTALL_DIR) { $env:ZERO_INSTALL_DIR } else { $root }
  $binDir = Join-Path $root 'bin'
  $command = Join-Path $binDir 'zero.cmd'
  $mark = 'rem created by the zero installer'

  # 1. Prerequisites: checked, never installed.
  $missing = @()
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $version = ((& node --version) | Out-String).Trim().TrimStart('v')
    $major = 0
    if (-not [int]::TryParse($version.Split('.')[0], [ref]$major) -or $major -lt 22) {
      $missing += "  - Node 22 o posterior (tenes $version): https://nodejs.org"
    }
  } else {
    $missing += '  - Node 22 o posterior: https://nodejs.org'
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { $missing += '  - npm (viene con Node): https://nodejs.org' }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $missing += '  - git: https://git-scm.com/downloads' }
  if ($missing.Count -gt 0) {
    Write-Host 'zero: falta lo siguiente; instalalo y volve a correr este comando:'
    $missing | ForEach-Object { Write-Host $_ }
    throw 'zero: faltan requisitos. No se cambio nada.'
  }

  # 2. What is already there: only a clone of zero gets updated.
  $update = $false
  if (Test-Path -LiteralPath $dir) {
    $origin = ''
    if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
      # Redirected stderr turns into an error record in PowerShell 5.1, so a failing git is caught here.
      try { $origin = ((& git -C $dir remote get-url origin 2>$null) | Out-String).Trim() } catch { $origin = '' }
    }
    if (@($repo, "$repo.git", "$repo/") -contains $origin) {
      $update = $true
    } else {
      throw "zero: $dir ya existe y no es una copia de $repo; no se toco. Elegi otra carpeta con ZERO_INSTALL_DIR."
    }
  }
  if ((Test-Path -LiteralPath $command) -and -not (Select-String -LiteralPath $command -SimpleMatch $mark -Quiet)) {
    throw "zero: $command ya existe y no lo creo este instalador; no se toco."
  }
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($null -eq $userPath) { $userPath = '' }
  $inPath = @($userPath.Split(';') | Where-Object { $_.TrimEnd('\') -ieq $binDir }).Count -gt 0

  # 3. Consent.
  if ([Console]::IsInputRedirected) {
    throw 'zero: este instalador necesita una terminal para preguntarte antes de cambiar nada. No se cambio nada.'
  }
  Write-Host 'zero se va a instalar asi:'
  Write-Host "  carpeta:  $dir"
  Write-Host '  comandos:'
  if ($update) { Write-Host "    git -C `"$dir`" pull --ff-only" } else { Write-Host "    git clone $repo `"$dir`"" }
  Write-Host '    npm ci            (en esa carpeta)'
  Write-Host '    npm run build     (en esa carpeta)'
  Write-Host "  comando:  $command"
  if (-not $inPath) { Write-Host "  PATH:     agrega $binDir al PATH de tu usuario (no al del sistema)" }
  Write-Host 'Al final se abre zero setup. No hace falta ser administrador.'
  $answer = Read-Host 'Seguimos? [s/N]'
  if ($answer -notmatch '^[sSyY]') {
    Write-Host 'No se cambio nada.'
    return
  }

  # 4. Clone or update, then build.
  if ($update) {
    & git -C $dir pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "zero: no se pudo actualizar $dir." }
  } else {
    $parent = Split-Path -Parent $dir
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    & git clone $repo $dir
    if ($LASTEXITCODE -ne 0) { throw "zero: no se pudo clonar $repo." }
  }
  Push-Location -LiteralPath $dir
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "zero: fallo npm ci en $dir." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "zero: fallo npm run build en $dir." }
  } finally {
    Pop-Location
  }

  # 5. The zero command, in the user's own folder.
  if (-not (Test-Path -LiteralPath $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
  # With the default folder the command finds the cli next to itself, so no path with
  # characters cmd.exe might misread is written.
  $cli = if ($dir -eq $root) { '%~dp0..\dist\cli.js' } else { Join-Path $dir 'dist\cli.js' }
  $lines = @('@echo off', $mark, "node `"$cli`" %*")
  [IO.File]::WriteAllText($command, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
  Write-Host "Listo: $command"
  if (-not $inPath) {
    $newPath = if ($userPath) { "$($userPath.TrimEnd(';'));$binDir" } else { $binDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "Agregue $binDir al PATH de tu usuario; abri una terminal nueva para usar zero."
  }

  # 6. Setup on the terminal: engines, limits, isolation, panel and GitHub.
  & node (Join-Path $dir 'dist\cli.js') setup
}

Install-Zero

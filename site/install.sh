#!/bin/sh
# zero in the loop: one-step installer for macOS and Linux.
#   curl -fsSL https://zerointheloop.com/install.sh | sh
# It checks Node 22+, npm and git without installing them, shows what it will do and asks
# before changing anything. No administrator rights, no secrets: credentials are left to
# `zero setup`, which it launches at the end on the terminal.
set -u

REPO="https://github.com/kaelen-phoenix/zero"
DIR="${ZERO_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/zero}"
BIN_DIR="$HOME/.local/bin"
COMMAND="$BIN_DIR/zero"
MARK="# created by the zero installer"

say() { printf '%s\n' "$*"; }
fail() { printf 'zero: %s\n' "$*" >&2; exit 1; }

# 1. Prerequisites: checked, never installed.
missing=""
if command -v node >/dev/null 2>&1; then
  version=$(node --version 2>/dev/null | sed 's/^v//')
  major=${version%%.*}
  case "$major" in
    ''|*[!0-9]*) missing="$missing
  - Node 22 o posterior (no se pudo leer la versión de node): https://nodejs.org" ;;
    *) if [ "$major" -lt 22 ]; then missing="$missing
  - Node 22 o posterior (tenés $version): https://nodejs.org"; fi ;;
  esac
else
  missing="$missing
  - Node 22 o posterior: https://nodejs.org"
fi
command -v npm >/dev/null 2>&1 || missing="$missing
  - npm (viene con Node): https://nodejs.org"
command -v git >/dev/null 2>&1 || missing="$missing
  - git: https://git-scm.com/downloads"
if [ -n "$missing" ]; then
  printf 'zero: falta lo siguiente; instalalo y volvé a correr este comando:%s\n' "$missing" >&2
  say "No se cambió nada." >&2
  exit 1
fi

# 2. What is already there: only a clone of zero gets updated.
same_repo() {
  case "$1" in
    "$REPO"|"$REPO.git"|"$REPO/") return 0 ;;
    *) return 1 ;;
  esac
}
update=no
if [ -e "$DIR" ] || [ -L "$DIR" ]; then
  if [ -d "$DIR/.git" ] && origin=$(git -C "$DIR" remote get-url origin 2>/dev/null) && same_repo "$origin"; then
    update=yes
  else
    fail "$DIR ya existe y no es una copia de $REPO; no se tocó. Elegí otra carpeta con ZERO_INSTALL_DIR."
  fi
fi
if [ -e "$COMMAND" ] && ! grep -q "$MARK" "$COMMAND" 2>/dev/null; then
  fail "$COMMAND ya existe y no lo creó este instalador; no se tocó."
fi

# 3. Consent, read from the terminal so that it works under curl | sh.
if ! (: </dev/tty) 2>/dev/null; then
  fail "este instalador necesita una terminal para preguntarte antes de cambiar nada. No se cambió nada."
fi
say "zero se va a instalar así:"
say "  carpeta:  $DIR"
say "  comandos:"
if [ "$update" = yes ]; then
  say "    git -C \"$DIR\" pull --ff-only"
else
  say "    git clone $REPO \"$DIR\""
fi
say "    npm ci            (en esa carpeta)"
say "    npm run build     (en esa carpeta)"
say "  comando:  $COMMAND"
say "Al final se abre zero setup. No hace falta ser administrador."
printf '¿Seguimos? [s/N] '
answer=""
read -r answer </dev/tty || answer=""
case "$answer" in
  [sSyY]*) ;;
  *) say "No se cambió nada."; exit 1 ;;
esac

# 4. Clone or update, then build.
if [ "$update" = yes ]; then
  git -C "$DIR" pull --ff-only || fail "no se pudo actualizar $DIR."
else
  mkdir -p "$(dirname "$DIR")" || fail "no se pudo crear la carpeta de $DIR."
  git clone "$REPO" "$DIR" || fail "no se pudo clonar $REPO."
fi
(cd "$DIR" && npm ci && npm run build) || fail "falló la instalación de dependencias o la compilación en $DIR."

# 5. The zero command, in the user's own bin folder.
mkdir -p "$BIN_DIR" || fail "no se pudo crear $BIN_DIR."
quoted=$(printf '%s' "$DIR" | sed "s/'/'\\\\''/g")
printf '#!/bin/sh\n%s\nexec node '\''%s/dist/cli.js'\'' "$@"\n' "$MARK" "$quoted" >"$COMMAND" || fail "no se pudo crear $COMMAND."
chmod 755 "$COMMAND" || fail "no se pudo hacer ejecutable $COMMAND."
say "Listo: $COMMAND"
case ":${PATH:-}:" in
  *":$BIN_DIR:"*) ;;
  *)
    say "$BIN_DIR no está en tu PATH. Para usar zero desde cualquier terminal, agregá esta línea a la configuración de tu shell:"
    say "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

# 6. Setup on the terminal: engines, limits, isolation, panel and GitHub.
exec node "$DIR/dist/cli.js" setup </dev/tty

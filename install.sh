#!/usr/bin/env bash
# LibreHarnes installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/zouxtr/libreharnes/main/install.sh | bash
#
# Environment:
#   LIBREHARNES_DIR   install directory (default: ~/.libreharnes)
#   LIBREHARNES_BIN   command directory   (default: ~/.local/bin)
#   LIBREHARNES_SKIP_LLAMA=1   do not download llama.cpp

set -euo pipefail

REPO="zouxtr/libreharnes"
BRANCH="main"
INSTALL_DIR="${LIBREHARNES_DIR:-$HOME/.libreharnes}"
BIN_DIR="${LIBREHARNES_BIN:-$HOME/.local/bin}"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found."
}

say ""
say "LibreHarnes installer"
say "---------------------"

need curl
need tar
need node

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js 18 or newer is required (found $(node --version 2>/dev/null || echo 'none'))."
fi
say "Node.js $(node --version)"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/libreharnes.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

say "Downloading LibreHarnes…"
ARCHIVE="$TMP_DIR/libreharnes.tar.gz"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$ARCHIVE" \
  || fail "Could not download the LibreHarnes source archive."

mkdir -p "$TMP_DIR/src"
tar -xzf "$ARCHIVE" -C "$TMP_DIR/src"
SRC_DIR="$(find "$TMP_DIR/src" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -n "$SRC_DIR" ] || fail "The downloaded archive was empty."

mkdir -p "$INSTALL_DIR"
# Copy source files over the existing install, preserving models/, chats/,
# config.json and downloads.json from earlier installs.
cp -R "$SRC_DIR"/. "$INSTALL_DIR"/
say "Installed app files to $INSTALL_DIR"

if [ "${LIBREHARNES_SKIP_LLAMA:-0}" != "1" ]; then
  say ""
  say "Installing llama.cpp (CPU build)…"
  (cd "$INSTALL_DIR" && node scripts/setup-llama.js)
else
  say "Skipping llama.cpp download (LIBREHARNES_SKIP_LLAMA=1)."
fi

mkdir -p "$BIN_DIR"
LAUNCHER="$BIN_DIR/libreharnes"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/scripts/launch.js" "\$@"
EOF
chmod +x "$LAUNCHER"
say "Created command: $LAUNCHER"

# Desktop entry so LibreHarnes appears in the application menu on Linux.
if [ "$(uname -s)" = "Linux" ]; then
  APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$APPS_DIR"
  cat > "$APPS_DIR/libreharnes.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=LibreHarnes
Comment=Local AI on your CPU
Exec=$LAUNCHER
Terminal=false
Categories=Utility;Development;
StartupWMClass=LibreHarnes
EOF
  chmod +x "$APPS_DIR/libreharnes.desktop"
  say "Added desktop entry: $APPS_DIR/libreharnes.desktop"
fi

say ""
say "Done. Start LibreHarnes with:"
say ""
say "  libreharnes"
say ""
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say "Note: $BIN_DIR is not on your PATH. Add it with:"
    say ""
    say "  export PATH=\"$BIN_DIR:\$PATH\""
    say ""
    ;;
esac
say "The launcher window shows the app address. Models are downloaded from"
say "the Models page inside the app."
say ""

#!/usr/bin/env bash
# Install the extension into the user's extension directory.
# Usage:  ./install.sh
set -euo pipefail

UUID="claude-pet@gumer"
SOURCE="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Installing $UUID"
mkdir -p "$TARGET"
# --delete --delete-excluded: the target ends up exactly like the source.
rsync -a --delete --delete-excluded \
    --exclude '.git' \
    --exclude 'install.sh' \
    --exclude 'build_sprites.py' \
    --exclude 'import_art.py' \
    --exclude 'sprite_fuente.webp' \
    --exclude 'README.md' \
    --exclude 'hooks' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    "$SOURCE/" "$TARGET/"

# Compile the GSettings schema in place (needed by the preferences dialog).
if [ -d "$TARGET/schemas" ]; then
    glib-compile-schemas "$TARGET/schemas"
    echo "Schema compiled"
fi

echo "Installed into $TARGET"
echo "Enable it with:  gnome-extensions enable $UUID"
echo "On Wayland you must log out and back in for changes to load."

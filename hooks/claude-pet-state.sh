#!/usr/bin/env bash
# Tell Claude Pet what Claude Code is doing.
#
# Writes a single word to ~/.config/claude-pet/state; the extension watches that
# file and reacts: "working" -> cooking mode, "done" -> celebration,
# "error" -> worried. Removing the file means idle.
#
# Usage:  claude-pet-state.sh working|done|error|idle
#
# Wire it up in ~/.claude/settings.json (see hooks/README.md).
set -euo pipefail

STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/claude-pet"
STATE_FILE="$STATE_DIR/state"
mkdir -p "$STATE_DIR"

case "${1:-idle}" in
    working|done|error)
        printf '%s' "$1" > "$STATE_FILE"
        ;;
    idle|*)
        rm -f "$STATE_FILE"
        ;;
esac

# "done" and "error" are momentary: clear them after a few seconds so the pet
# goes back to its normal routine.
if [ "${1:-}" = "done" ] || [ "${1:-}" = "error" ]; then
    ( sleep 6; rm -f "$STATE_FILE" ) >/dev/null 2>&1 &
fi

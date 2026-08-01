# Claude Code integration

Let the pet react to what Claude Code is actually doing: cook while it works,
celebrate when a task finishes, look worried when something fails.

## How it works

`claude-pet-state.sh` writes one word to `~/.config/claude-pet/state`:

| Value     | The pet…                          |
|-----------|-----------------------------------|
| `working` | puts on the chef hat and cooks     |
| `done`    | jumps and throws stars 🎉          |
| `error`   | sweats and gets dizzy 😵           |
| *(no file)* | goes back to its normal routine |

The extension watches that file with a `GFileMonitor`, so it reacts instantly and
costs nothing while idle. `done` and `error` clear themselves after a few seconds.

## Setup

1. Make the script executable and put it somewhere stable:

```bash
chmod +x hooks/claude-pet-state.sh
mkdir -p ~/.local/bin
cp hooks/claude-pet-state.sh ~/.local/bin/
```

2. Add the hooks to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
                     "command": "~/.local/bin/claude-pet-state.sh working" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command",
                     "command": "~/.local/bin/claude-pet-state.sh done" } ] }
    ]
  }
}
```

If you already have a `hooks` section, merge these entries into it instead of
replacing the file.

3. Make sure **Claude Code integration** is enabled in the extension preferences
   (`gnome-extensions prefs claude-pet@gumer`).

## Trying it without Claude

```bash
~/.local/bin/claude-pet-state.sh working   # chef hat appears
~/.local/bin/claude-pet-state.sh done      # celebration
~/.local/bin/claude-pet-state.sh idle      # back to normal
```

# Claude Pet — desktop app (Windows, macOS, Linux)

A port of the GNOME Shell extension for people who are not on GNOME. Same
artwork, same personality; the runtime is a translucent always-on-top Qt window
instead of a shell actor.

> On GNOME, prefer the extension in the repository root: it can sit on the dock
> properly and float above windows without competing for stacking order.

## Install on Windows

You need [Python 3](https://www.python.org/downloads/) — during setup tick
**"Add python.exe to PATH"**.

1. Download the whole repository (green **Code** button → **Download ZIP**) and
   unzip it, or `git clone https://github.com/alu0101825465-creator/claude-pet.git`.
   Keep the folder intact: the app reads the sprites from `..\assets`.
2. Open the `desktop` folder and **double-click `run_windows.bat`**.

That is it. The script builds a private environment, installs everything and
starts the pet. It only does the setup once; later runs start immediately.

To start it automatically at login, press **Win+R**, type `shell:startup`, and
put a shortcut to `run_windows.bat` in the folder that opens.

### Manual install, if you prefer

```bat
cd desktop
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\pythonw claude_pet.py
```

`pythonw` starts it without a console window. Optionally add
`pip install winsdk` for music detection.

## Install on Linux or macOS

```bash
cd desktop
pip install -r requirements.txt
python3 claude_pet.py
```

## What it does

- Walks along the bottom of the screen, standing **on the taskbar** where the
  system can report one, and follows the taskbar's auto-hide.
- **Sits, looks around, scratches and somersaults** now and then instead of just
  pacing, with a **ground shadow** that shrinks as it hops.
- **Jumps** when an application opens, with app-specific props: 🎵 media players,
  🔍 browsers, 💬 chat apps.
- **Cooking mode** 👨‍🍳 (chef hat, pan, steam) while Claude or VS Code are open,
  or driven by the **Claude Code hooks** below.
- **Sleeps** when idle: stretches, lies down with a sleep cap and z's. Sooner at
  night.
- **Coffee** ☕ with steam whenever the machine is in the **performance** power
  mode — never at the same time as the chef hat.
- **Music notes** 🎶 in rotating colours while something is actually playing.
- **Sweats** when the battery is low or the CPU is pegged.
- **Interactive**: left-click to wave, click a few times for hearts, right-click
  to summon Claude, drag it around and it bounces back (and gets dizzy if you
  shake it).
- Everything is toggled from the **tray icon**, including size (48px - 160px) and the seasonal hat.

Settings live in `settings.json` next to the state file:

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\claude-pet\` |
| Linux | `~/.config/claude-pet/` |

## Claude Code hooks

The pet watches `state` in that same folder. Copy the script somewhere stable
and wire it into `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
                     "command": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"& 'C:\\tools\\claude-pet-state.ps1' working\"" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command",
                     "command": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"& 'C:\\tools\\claude-pet-state.ps1' done\"" } ] }
    ]
  }
}
```

Try it by hand:

```powershell
powershell -File hooks\claude-pet-state.ps1 working   # chef hat appears
powershell -File hooks\claude-pet-state.ps1 done      # celebration
powershell -File hooks\claude-pet-state.ps1 idle      # back to normal
```

## Artwork

The sprites are read from `../assets`, the same folder the extension uses, so
both versions always look identical. If you ship this folder on its own, copy
`assets/` next to `claude_pet.py`.

Redraw anything with the shared build tools in the repository root:

```bash
python3 ../import_art.py my_hat.png christmas
```

## Platform support

| Feature | Windows | Linux | macOS |
|---|---|---|---|
| Floating pet, walking, sleeping, dragging | ✅ | ✅ | ✅ |
| Stands on the taskbar / auto-hide | ✅ | ⚠️ screen edge | ⚠️ screen edge |
| App reactions, cooking mode | ✅ | ✅ | ❌ |
| Claude Code hooks | ✅ | ✅ | ✅ |
| Music detection | ✅ (needs `winsdk`) | ✅ (MPRIS) | ❌ |
| Power mode → coffee | ✅ | ✅ | ❌ |
| Battery / CPU sweat | ✅ | ✅ | ✅ |

Anything a platform cannot answer is simply skipped — the pet never breaks
because a backend returned nothing.

> **Tested on Linux and Windows.** On Windows, supports DPI scaling,
> taskbar placement/auto-hide, and in-memory power profile detection.

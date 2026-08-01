# Claude Pet 🐙👨‍🍳

A **GNOME Shell extension** (GNOME 45+, Wayland and X11) that puts an **animated
pixel-art pet** on top of your dock, always visible above your windows. It walks
around, reacts to what you do, and naps when you leave it alone.
**Fully local — no network access whatsoever.**

- **UUID:** `claude-pet@gumer`
- **Tested on:** GNOME Shell 50 (Fedora 44), Wayland.

## What it does

- **Walks** along the dock, moving its little legs, and turns around at the ends.
- **Follows the dock's auto-hide**: slides away when the dock hides, comes back
  with it. Works with Dash2Dock Animated, Dash to Dock, the Ubuntu dock, or no
  dock at all.
- **Jumps** when you launch or switch to an app, with **app-specific props**:
  🎵 media players, 🔍 browsers, 💬 chat apps.
- **Cooking mode** 👨‍🍳: chef hat, frying pan and steam while Claude Code or
  VS Code are running — or driven by real **Claude Code hooks** (see `hooks/`).
- **Sleeps** when idle: stretches, lies down with a sleep cap, moon and z's.
  Falls asleep sooner at night.
- **Interactive**: click to wave, pet it (a few clicks) for hearts, **drag it**
  anywhere and watch it bounce back.
- **Music notes** 🎶 in rotating colours while any player is actually playing.
- **System reactions** 🔋: breaks a sweat when the battery is low or the CPU is
  pegged.
- **Speech bubbles** and a **daily routine**: greetings, a morning coffee, and an
  optional seasonal hat that changes itself in October and December.
- **Light on resources**: the timers slow down while it sleeps and stop entirely
  while it is hidden.

## Requirements

- **GNOME Shell 45–50** (ESM format). It will not run on < 45; on 51+ add `"51"`
  to `shell-version` in `metadata.json`.
- **Optional:** a bottom dock. It is tuned for
  [Dash2Dock Animated](https://extensions.gnome.org/extension/4994/dash2dock-lite/),
  detects Dash to Dock and the Ubuntu dock, and otherwise falls back to sitting
  at the bottom-left of the screen.

## Install

### From source

```bash
git clone https://github.com/alu0101825465-creator/claude-pet.git
cd claude-pet
./install.sh
gnome-extensions enable claude-pet@gumer
```

Then **log out and back in** — on Wayland the shell cannot be reloaded in place.

### From a release zip

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/claude-pet@gumer
unzip -o claude-pet@gumer.zip -d ~/.local/share/gnome-shell/extensions/claude-pet@gumer/
gnome-extensions enable claude-pet@gumer     # after logging back in
```

> **Wayland note:** changes to **images** are not picked up by
> `disable`/`enable` — the shell caches textures per session. Log out and back in
> to see new artwork.

## Preferences

```bash
gnome-extensions prefs claude-pet@gumer
```

Size, walking speed, hat, and switches for every reaction: apps, click, cursor
following, sleep, music, system, speech bubbles, daily routine and Claude Code.

## Claude Code integration

See [`hooks/README.md`](hooks/README.md). In short: a small script writes
`working`, `done` or `error` into `~/.config/claude-pet/state`, and the extension
watches that file so the pet cooks while Claude works, celebrates when a task
finishes and looks worried on failures.

```bash
~/.local/bin/claude-pet-state.sh working   # try it by hand
```

## Draw your own hats and props

Use [Pixelorama](https://orama-interactive.itch.io/pixelorama)
(`flatpak install flathub com.orama_interactive.Pixelorama`) or
[LibreSprite](https://libresprite.github.io/).

1. Draw with a **transparent background** at any size (12×10 px is plenty).
2. Export to PNG.
3. Import it — the helper crops, scales without smoothing, squares the canvas and
   bottom-anchors hats for you:

```bash
python3 import_art.py my_hat.png christmas   # or halloween, birthday, chef,
                                             # pan, moon, zeta, steam, note,
                                             # lens, bubble, heart, sweat,
                                             # star, coffee
./install.sh
```
4. **Log out and back in.**

> Hats rest on the head by their **bottom edge**, so draw them touching the
> bottom of the canvas.

## Project layout

| Path | What it is |
|---|---|
| `extension.js` | The extension: state machine, overlays, dock discovery, timers. |
| `prefs.js` | Preferences dialog (libadwaita). |
| `schemas/` | GSettings schema (`install.sh` compiles it). |
| `assets/` | Every frame and overlay as PNG — already generated. |
| `hooks/` | Claude Code hook script and setup instructions. |
| `build_sprites.py` | Build tool: regenerates all art from `sprite_fuente.webp`. |
| `import_art.py` | Build tool: imports your own drawings. |

Regenerate the artwork after editing the grids:

```bash
python3 build_sprites.py ./sprite_fuente.webp --size 96
./install.sh
```

## Debugging

```bash
journalctl --user -b 0 -o cat /usr/bin/gnome-shell | grep -iE 'claude-pet|JS ERROR'
```

## Credits and licence

A learning project. The character artwork is the Claude Code pixel-art mascot.
Code released under the **MIT** licence (see `LICENSE`).

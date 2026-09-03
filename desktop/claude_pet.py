#!/usr/bin/env python3
"""Claude Pet — a cross-platform desktop pet (Windows, macOS, Linux).

A port of the GNOME Shell extension in the repository root. The artwork and the
build tools are shared; everything that touched GNOME had to be rewritten, so
this uses a translucent always-on-top Qt window instead of a shell actor.

    python3 claude_pet.py

Everything the machine can tell us lives behind platforms/, so the pet itself
never needs to know which OS it is standing on.
"""
import json
import math
import os
import random
import sys
import time
from pathlib import Path

from PySide6.QtCore import Qt, QTimer, QRect, QPoint
from PySide6.QtGui import (QPixmap, QPainter, QIcon, QAction, QActionGroup,
                           QCursor, QRegion)
from PySide6.QtWidgets import (QApplication, QWidget, QMenu, QSystemTrayIcon,
                               QInputDialog)

import platforms

# --- Geometry -------------------------------------------------------------
FOOT_PAD_RATIO = 19 / 96      # transparent padding below the feet in the PNG
HEAD_TOP_RATIO = 21 / 96      # where the head starts in the sprite
HAT_OVERLAP = 0.05
BAR_OVERLAP = 2               # how far the feet stand on the taskbar edge (2px resting on top)
FLOOR_MARGIN = 8              # gap from the screen edge when there is no bar
EDGE_INSET = 16

# --- Timing (ms unless stated) -------------------------------------------
TICK_MS = 40                  # ~25 fps
TICK_SLEEP_MS = 200
POLL_MS = 500
TURN_PAUSE_MS = 800
JUMP_MS = 340
WAVE_MS = 600
DIZZY_MS = 900
STRETCH_MS = 620
SIT_MS = 1500
LOOK_MS = 1200
FLIP_MS = 520
IDLE_TO_SLEEP_S = 5.0
NIGHT_SLEEP_S = 2.5
REACT_COOLDOWN_S = 0.4
DRAG_THRESHOLD = 8
Z_EVERY_S = 1.2
STEAM_EVERY_S = 1.0
NOTE_EVERY_S = 1.4
SYSTEM_EVERY_S = 10.0

# --- Look -----------------------------------------------------------------
JUMP_HEIGHT = 26
WAVE_ANGLE = 14
IDLE_ACTION_CHANCE = 0.45
SHADOW_RATIO = 0.62
HAT_RATIO = 0.68
COFFEE_X, COFFEE_Y = 1.02, 0.42
OVERLAY_RATIO = {
    'zeta': 15 / 96, 'moon': 48 / 96, 'steam': 30 / 96, 'chef': 42 / 96,
    'pan': 48 / 96, 'coffee': 32 / 96, 'heart': 28 / 96, 'sweat': 28 / 96,
    'star': 18 / 96, 'note': 40 / 96, 'lens': 42 / 96, 'bubble': 36 / 96,
}
NOTE_COLOURS = 6

FRAMES = {'idle': ['idle_0', 'idle_1'], 'walk': ['walk_0', 'walk_1',
                                                 'walk_2', 'walk_3']}
FRAME_HOLD = {'idle': 16, 'walk': 4}
HATS = {'none': None, 'christmas': 'hat_christmas',
        'halloween': 'hat_halloween', 'birthday': 'hat_birthday'}

COOKING_APPS = ('claude', 'code', 'code-oss', 'codium', 'devenv')
APP_PROPS = [
    (('spotify', 'vlc', 'rhythmbox', 'musicbee', 'foobar'), 'note'),
    (('brave', 'firefox', 'chrome', 'chromium', 'msedge'), 'lens'),
    (('discord', 'telegram', 'slack', 'element', 'teams'), 'bubble'),
]

DEFAULTS = {
    'size': 96, 'speed': 60, 'react_apps': True, 'interact': True,
    'follow_cursor': True, 'sleep': True, 'cooking': True, 'music': True,
    'system': True, 'routine': True, 'claude_hooks': True, 'hat': 'none',
}


def config_dir():
    if sys.platform.startswith('win'):
        base = os.environ.get('APPDATA') or Path.home()
    else:
        base = os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config'
    path = Path(base) / 'claude-pet'
    path.mkdir(parents=True, exist_ok=True)
    return path


def assets_dir():
    here = Path(__file__).resolve().parent
    for candidate in (here / 'assets', here.parent / 'assets'):
        if candidate.is_dir():
            return candidate
    raise SystemExit('Could not find the assets/ folder next to the script.')


class Effect:
    """A little sprite that drifts upwards and fades: notes, z's, steam…"""

    __slots__ = ('pix', 'x', 'y', 'vx', 'vy', 'age', 'ttl', 'alpha0')

    def __init__(self, pix, x, y, vx, vy, ttl, alpha0=1.0):
        self.pix, self.x, self.y = pix, x, y
        self.vx, self.vy, self.ttl, self.alpha0 = vx, vy, ttl, alpha0
        self.age = 0.0

    def step(self, dt):
        self.age += dt
        self.x += self.vx * dt
        self.y += self.vy * dt
        return self.age < self.ttl

    @property
    def alpha(self):
        return max(0.0, self.alpha0 * (1.0 - self.age / self.ttl))

    def rect(self):
        return QRect(int(self.x), int(self.y),
                     self.pix.width(), self.pix.height())


class Pet(QWidget):
    def __init__(self):
        super().__init__(None,
                         Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint |
                         Qt.Tool | Qt.NoDropShadowWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)

        self.platform = platforms.detect()
        self.settings = self._load_settings()
        self.state_path = config_dir() / 'state'

        self.size_px = int(self.settings['size'])
        self._load_sprites()

        # World state
        self.mode = 'walk'
        self.facing = 1
        self.frame = 0
        self.ticks = 0
        self.pause_ticks = 0
        self.pet_x = None
        self.range = None
        self.perch_y = None
        self.off_y = 0.0
        self.angle = 0.0
        self.scale_y = 1.0
        self.effects = []
        self.action = None
        self.last_activity = time.monotonic()
        self.last_react = 0.0
        self.last_z = 0.0
        self.last_steam = 0.0
        self.last_note = 0.0
        self.last_system = 0.0
        self.note_colour = 0
        self.cooking = False
        self.cook_until = 0.0
        self.playing = False
        self.profile = None
        self.apps = set()
        self.claude_state = ''
        self.state_mtime = 0
        self.dragging = False
        self.drag_distance = 0.0
        self.press_pos = None
        self.press_offset = None

        w = self.size_px * 3
        h = int(self.size_px * 2.4)
        self.resize(w, h)
        self.pet_local = QPoint((w - self.size_px) // 2,
                                h - self.size_px - int(self.size_px * 0.25))

        self._build_tray()
        self._reposition()

        self.tick_timer = QTimer(self)
        self.tick_timer.timeout.connect(self._tick)
        self.tick_timer.start(TICK_MS)
        self.poll_timer = QTimer(self)
        self.poll_timer.timeout.connect(self._poll)
        self.poll_timer.start(POLL_MS)
        self._poll()
        self.last_tick = time.monotonic()

    # ---------- Assets and settings ----------

    def _load_sprites(self):
        folder = assets_dir()
        self.pix = {}
        for png in folder.glob('*.png'):
            name = png.stem
            image = QPixmap(str(png))
            if image.isNull():
                continue
            ratio = OVERLAY_RATIO.get(name.split('_')[0] if name.startswith('note_')
                                      else name)
            if name.startswith('hat_'):
                target = int(self.size_px * HAT_RATIO)
            elif name == 'shadow':
                target = int(self.size_px * SHADOW_RATIO)
            elif ratio:
                target = int(self.size_px * ratio)
            else:
                target = self.size_px          # the character frames
            # Nearest-neighbour keeps the pixel art crisp at any size.
            self.pix[name] = image.scaled(target, target, Qt.KeepAspectRatio,
                                          Qt.FastTransformation)

    def _load_settings(self):
        path = config_dir() / 'settings.json'
        data = dict(DEFAULTS)
        try:
            data.update(json.loads(path.read_text()))
        except Exception:
            pass
        return data

    def _save_settings(self):
        try:
            (config_dir() / 'settings.json').write_text(
                json.dumps(self.settings, indent=2))
        except Exception:
            pass

    # ---------- Tray ----------

    def _build_tray(self):
        self.tray = QSystemTrayIcon(QIcon(self.pix['idle_0']), self)
        self.tray.setToolTip('Claude Pet')
        menu = QMenu()

        open_action = QAction('Open Claude', menu)
        open_action.triggered.connect(self._open_claude)
        menu.addAction(open_action)
        menu.addSeparator()

        labels = [
            ('react_apps', 'React to applications'),
            ('interact', 'Click and drag'),
            ('follow_cursor', 'Follow the cursor'),
            ('sleep', 'Sleep when idle'),
            ('cooking', 'Cooking mode'),
            ('music', 'Music notes'),
            ('system', 'System reactions'),
            ('routine', 'Daily routine'),
            ('claude_hooks', 'Claude Code hooks'),
        ]
        for key, text in labels:
            action = QAction(text, menu, checkable=True)
            action.setChecked(bool(self.settings[key]))
            action.toggled.connect(
                lambda checked, k=key: self._set_setting(k, checked))
            menu.addAction(action)

        size_menu = menu.addMenu('Size')
        size_group = QActionGroup(size_menu)
        self._size_actions = {}
        for s, label in [
            (48, '48 px (Tiny)'),
            (64, '64 px (Small)'),
            (80, '80 px (Medium)'),
            (96, '96 px (Default)'),
            (112, '112 px (Large)'),
            (128, '128 px (Extra large)'),
            (160, '160 px (Huge)'),
        ]:
            action = QAction(label, size_menu, checkable=True)
            action.setChecked(self.size_px == s)
            action.triggered.connect(lambda _c, val=s: self._set_size(val))
            size_group.addAction(action)
            size_menu.addAction(action)
            self._size_actions[s] = action

        size_menu.addSeparator()
        custom_size_action = QAction('Custom...', size_menu)
        custom_size_action.triggered.connect(self._prompt_custom_size)
        size_menu.addAction(custom_size_action)

        hat_menu = menu.addMenu('Hat')
        group = QActionGroup(hat_menu)
        for key, text in [('none', 'None'), ('christmas', 'Christmas'),
                          ('halloween', 'Halloween'), ('birthday', 'Birthday'),
                          ('auto', 'Automatic (by season)')]:
            action = QAction(text, hat_menu, checkable=True)
            action.setChecked(self.settings['hat'] == key)
            action.triggered.connect(lambda _c, k=key: self._set_setting('hat', k))
            group.addAction(action)
            hat_menu.addAction(action)

        menu.addSeparator()
        quit_action = QAction('Quit', menu)
        quit_action.triggered.connect(QApplication.instance().quit)
        menu.addAction(quit_action)

        self.tray.setContextMenu(menu)
        self._menu = menu
        self.tray.show()

    def _set_setting(self, key, value):
        self.settings[key] = value
        self._save_settings()

    def _set_size(self, size):
        size = max(48, min(160, int(size)))
        if size == self.size_px:
            return
        self.size_px = size
        self._set_setting('size', size)
        self._load_sprites()
        w = self.size_px * 3
        h = int(self.size_px * 2.4)
        self.resize(w, h)
        self.pet_local = QPoint((w - self.size_px) // 2,
                                h - self.size_px - int(self.size_px * 0.25))
        self._reposition()
        self._update_mask()
        self.update()
        if hasattr(self, '_size_actions'):
            for s, action in self._size_actions.items():
                action.setChecked(self.size_px == s)

    def _prompt_custom_size(self):
        val, ok = QInputDialog.getInt(
            self, 'Claude Pet Size',
            'Sprite size in pixels (48 - 160):',
            self.size_px, 48, 160, 4
        )
        if ok:
            self._set_size(val)

    # ---------- Placement ----------

    def _screen_geometry(self):
        screen = QApplication.screenAt(self.frameGeometry().center()) \
            or QApplication.primaryScreen()
        return screen.geometry()

    def _reposition(self):
        geo = self._screen_geometry()
        screen = QApplication.screenAt(self.frameGeometry().center()) \
            or QApplication.primaryScreen()
        dpr = screen.devicePixelRatio() if screen else 1.0
        foot_pad = int(self.size_px * FOOT_PAD_RATIO)
        hidden = self.platform.taskbar_hidden()
        bar = self.platform.taskbar_rect() if not hidden else None
        if bar and dpr and dpr != 1.0:
            bar = (bar[0] / dpr, bar[1] / dpr, bar[2] / dpr, bar[3] / dpr)

        if bar and bar[3] > 0 and bar[2] >= bar[3]:      # a horizontal bar
            x, y, w, h = bar
            top = y if y > geo.y() + geo.height() / 2 else y + h
            self.perch_y = top - self.size_px + foot_pad + BAR_OVERLAP
            self.range = (x + EDGE_INSET, x + w - self.size_px - EDGE_INSET)
        else:
            self.perch_y = (geo.y() + geo.height() - self.size_px + foot_pad
                            - FLOOR_MARGIN)
            self.range = (geo.x() + EDGE_INSET,
                          geo.x() + geo.width() - self.size_px - EDGE_INSET)
        if self.range[1] <= self.range[0]:
            self.range = (self.range[0], self.range[0] + 1)
        if self.pet_x is None:
            self.pet_x = float(self.range[0])
        self.pet_x = min(max(self.pet_x, self.range[0]), self.range[1])
        if self.mode != 'drag':
            self.move(int(self.pet_x) - self.pet_local.x(),
                      int(self.perch_y) - self.pet_local.y())

    # ---------- World poll ----------

    def _poll(self):
        self._reposition()
        self.apps = self.platform.running_apps() or set()
        if self.settings['music']:
            playing = self.platform.media_playing()
            if playing is not None:
                self.playing = playing
        else:
            self.playing = False
        if self.settings['system']:
            self.profile = self.platform.power_profile()
        self._read_claude_state()
        self._check_cooking()

    def _read_claude_state(self):
        if not self.settings['claude_hooks']:
            self.claude_state = ''
            return
        try:
            mtime = self.state_path.stat().st_mtime
        except OSError:
            self.claude_state = ''
            self.state_mtime = 0
            return
        if mtime == self.state_mtime:
            return
        self.state_mtime = mtime
        try:
            value = self.state_path.read_text().strip().lower()
        except OSError:
            return
        previous, self.claude_state = self.claude_state, value
        if value == previous:
            return
        if value == 'done':
            self._celebrate()
            QTimer.singleShot(6000, self._clear_momentary_state)
        elif value == 'error':
            self._sweat()
            self._start_dizzy()
            QTimer.singleShot(6000, self._clear_momentary_state)

    def _clear_momentary_state(self):
        try:
            if self.state_path.exists() and self.state_path.read_text().strip().lower() in ('done', 'error'):
                self.state_path.unlink()
        except OSError:
            pass
        self.claude_state = ''

    def _check_cooking(self):
        forced = time.monotonic() < self.cook_until
        working = self.claude_state == 'working'
        app = any(any(name.startswith(a) for a in COOKING_APPS)
                  for name in self.apps)
        self.cooking = bool(self.settings['cooking'] and
                            (forced or working or app))

    # ---------- Animation ----------

    def _tick(self):
        now = time.monotonic()
        dt = min(0.2, now - self.last_tick)
        self.last_tick = now
        self.ticks += 1

        self.effects = [e for e in self.effects if e.step(dt)]

        if self.action:
            self._advance_action(dt)
        elif self.mode == 'sleep':
            self._sleep_tick(now)
        elif self.mode == 'drag':
            pass
        else:
            self._walk_tick(now, dt)

        self._spawn_ambient(now)
        self._reposition()
        self._update_mask()
        self.update()

    def _advance_action(self, dt):
        act = self.action
        act['t'] += dt
        progress = min(1.0, act['t'] / act['dur'])
        act['fn'](progress)
        if progress >= 1.0:
            self.action = None
            self.off_y = 0.0
            self.angle = 0.0
            self.scale_y = 1.0
            done = act.get('done')
            if done:
                done()
            elif self.mode not in ('sleep', 'drag'):
                self.mode = 'walk'

    def _start_action(self, name, duration, fn, done=None):
        if self.mode in ('drag',):
            return
        self.mode = name
        self.action = {'t': 0.0, 'dur': duration / 1000.0, 'fn': fn,
                       'done': done}

    def _walk_tick(self, now, dt):
        threshold = NIGHT_SLEEP_S if self._is_night() else IDLE_TO_SLEEP_S
        if (self.settings['sleep'] and not self.cooking and
                self.mode in ('walk', 'idle') and
                now - self.last_activity > threshold):
            self._stretch()
            return

        if self.mode == 'idle':
            self.pause_ticks -= 1
            if self.pause_ticks <= 0:
                self.facing *= -1
                self.mode = 'walk'
                self.frame = 0
            elif self.ticks % FRAME_HOLD['idle'] == 0:
                self.frame = (self.frame + 1) % len(FRAMES['idle'])
            return

        target = self._cursor_target()
        step = self.settings['speed'] * dt
        standing = False
        if target is not None:
            self.last_activity = now
            delta = target - self.pet_x
            if abs(delta) > step:
                self.pet_x += math.copysign(step, delta)
                self.facing = 1 if delta > 0 else -1
            else:
                self.pet_x = target
                standing = True
        else:
            self.pet_x += self.facing * step
            if self.pet_x <= self.range[0] or self.pet_x >= self.range[1]:
                self.pet_x = min(max(self.pet_x, self.range[0]), self.range[1])
                self._turn_around()
                return
        if not standing and self.ticks % FRAME_HOLD['walk'] == 0:
            self.frame = (self.frame + 1) % len(FRAMES['walk'])
        self._standing = standing

    def _turn_around(self):
        if random.random() < IDLE_ACTION_CHANCE:
            random.choice([self._sit, self._look_around, self._scratch,
                           self.somersault])()
            return
        self.mode = 'idle'
        self.frame = 0
        self.pause_ticks = max(1, int(TURN_PAUSE_MS / TICK_MS))

    def _cursor_target(self):
        if not self.settings['follow_cursor'] or not self.range:
            return None
        if self.perch_y is None:
            return None
        pos = QCursor.pos()
        if pos.y() < self.perch_y - 28:
            return None
        if pos.x() < self.range[0] - 48 or pos.x() > self.range[1] + self.size_px + 48:
            return None
        return min(max(pos.x() - self.size_px / 2, self.range[0]), self.range[1])

    def _sleep_tick(self, now):
        if self._cursor_target() is not None:
            self._wake()
            return
        if now - self.last_z > Z_EVERY_S:
            self.last_z = now
            self._add_effect('zeta', 0.66, 0.06, vx=6, vy=-26, ttl=1.1)

    # ---------- Actions ----------

    def _stretch(self):
        def fn(p):
            self.scale_y = 1.0 + 0.18 * math.sin(math.pi * p)
        self._start_action('stretch', STRETCH_MS, fn, done=self._sleep)

    def _sleep(self):
        self.mode = 'sleep'
        self.tick_timer.setInterval(TICK_SLEEP_MS)

    def _wake(self):
        if self.mode == 'sleep':
            self.mode = 'walk'
            self.frame = 0
        self.tick_timer.setInterval(TICK_MS)
        self.last_activity = time.monotonic()

    def _jump(self):
        def fn(p):
            self.off_y = -JUMP_HEIGHT * math.sin(math.pi * p)
        self._start_action('react', JUMP_MS, fn)

    def _wave(self):
        def fn(p):
            self.angle = WAVE_ANGLE * math.sin(4 * math.pi * p)
        self._start_action('wave', WAVE_MS, fn)

    def _start_dizzy(self):
        for i in range(3):
            angle = i / 3 * 2 * math.pi
            self._add_effect('star', 0.5, -0.02,
                             vx=math.cos(angle) * 40,
                             vy=math.sin(angle) * 30 - 20, ttl=0.95)

        def fn(p):
            self.angle = 18 * math.sin(6 * math.pi * p) * (1 - p)
        self._start_action('dizzy', DIZZY_MS, fn)

    def _sit(self):
        def fn(p):
            self.scale_y = 1.0 - 0.18 * math.sin(math.pi * p) ** 0.4
        self._start_action('act', SIT_MS, fn, done=self._after_act)

    def _look_around(self):
        def fn(p):
            self.facing = 1 if int(p * 4) % 2 == 0 else -1
        self._start_action('act', LOOK_MS, fn, done=self._after_act)

    def _scratch(self):
        def fn(p):
            self.angle = 6 * math.sin(6 * math.pi * p)
        self._start_action('act', 700, fn, done=self._after_act)

    def somersault(self):
        def fn(p):
            self.angle = 360 * p * self.facing
            self.off_y = -self.size_px * 0.42 * math.sin(math.pi * p)
        self._start_action('act', FLIP_MS, fn, done=self._after_act)

    def _after_act(self):
        self.facing *= -1
        self.mode = 'walk'
        self.frame = 0

    def _celebrate(self):
        self.last_activity = time.monotonic()
        if self.mode not in ('drag',):
            self._jump()
        for i in range(3):
            angle = i / 3 * 2 * math.pi
            self._add_effect('star', 0.5, -0.02,
                             vx=math.cos(angle) * 45,
                             vy=math.sin(angle) * 30 - 25, ttl=1.0)

    def _hearts(self):
        for i in range(3):
            self._add_effect('heart', 0.32 + i * 0.18, -0.02,
                             vx=0, vy=-40 - i * 6, ttl=1.1 + i * 0.15)

    def _sweat(self):
        self._add_effect('sweat', 0.72, 0.10, vx=0, vy=24, ttl=0.9)

    # ---------- Ambient effects ----------

    def _spawn_ambient(self, now):
        if self.cooking and now - self.last_steam > STEAM_EVERY_S:
            self.last_steam = now
            self._add_effect('steam', 0.82, 0.30, vx=0, vy=-26, ttl=1.3, alpha=0.8)
        elif self._coffee_visible() and now - self.last_steam > STEAM_EVERY_S:
            self.last_steam = now
            self._add_effect('steam', COFFEE_X, COFFEE_Y - 0.20,
                             vx=0, vy=-26, ttl=1.3, alpha=0.8)
        if (self.settings['music'] and self.playing and
                now - self.last_note > NOTE_EVERY_S):
            self.last_note = now
            name = f'note_{self.note_colour}'
            self.note_colour = (self.note_colour + 1) % NOTE_COLOURS
            self._add_effect(name, 0.70 + random.uniform(-0.14, 0.14), 0.02,
                             vx=random.uniform(-10, 25), vy=-40, ttl=1.5)
        if self.settings['system'] and now - self.last_system > SYSTEM_EVERY_S:
            self.last_system = now
            if self._under_stress():
                self._sweat()

    def _under_stress(self):
        load = self.platform.cpu_load()
        if load is not None and load > 0.9:
            return True
        battery = self.platform.battery()
        if battery and battery[0] <= 15 and not battery[1]:
            return True
        return False

    def _add_effect(self, name, x_frac, y_frac, vx, vy, ttl, alpha=1.0):
        pix = self.pix.get(name)
        if not pix:
            return
        x = self.pet_local.x() + self.size_px * x_frac - pix.width() / 2
        y = self.pet_local.y() + self.size_px * y_frac - pix.height() / 2
        self.effects.append(Effect(pix, x, y, vx, vy, ttl, alpha))

    # ---------- Worn items ----------

    def _is_night(self):
        if not self.settings['routine']:
            return False
        hour = time.localtime().tm_hour
        return hour >= 23 or hour < 6

    def _current_hat(self):
        choice = self.settings['hat']
        if choice == 'auto':
            if not self.settings['routine']:
                return None
            now = time.localtime()
            if now.tm_mon == 12 or (now.tm_mon == 1 and now.tm_mday <= 6):
                return 'hat_christmas'
            if now.tm_mon == 10:
                return 'hat_halloween'
            return None
        return HATS.get(choice)

    def _coffee_visible(self):
        return bool(self.settings['system'] and not self.cooking and
                    self.profile == 'performance')

    # ---------- Painting ----------

    def _frame_pixmap(self):
        if self.mode == 'sleep':
            return self.pix.get('sleep_0')
        if self.mode in ('react', 'wave', 'drag'):
            return self.pix.get('jump_0')
        if self.mode == 'act':
            return self.pix.get('idle_0')
        if self.mode == 'idle' or getattr(self, '_standing', False):
            return self.pix.get(FRAMES['idle'][self.frame % 2])
        return self.pix.get(FRAMES['walk'][self.frame % 4])

    def paintEvent(self, _event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.SmoothPixmapTransform, False)

        px, py = self.pet_local.x(), self.pet_local.y()
        foot_pad = int(self.size_px * FOOT_PAD_RATIO)

        # Shadow stays on the ground and shrinks as the pet hops.
        shadow = self.pix.get('shadow')
        if shadow and self.mode != 'drag':
            lift = min(1.0, abs(self.off_y) / (self.size_px * 0.35))
            scale = 1 - 0.35 * lift
            w = int(shadow.width() * scale)
            h = int(shadow.height() * scale)
            if w > 0 and h > 0:
                painter.setOpacity(0.78 * (1 - 0.55 * lift))
                painter.drawPixmap(
                    int(px + self.size_px / 2 - w / 2),
                    int(py + self.size_px - foot_pad - h / 2), w, h,
                    shadow.scaled(w, h, Qt.IgnoreAspectRatio,
                                  Qt.FastTransformation))
        painter.setOpacity(1.0)

        body = self._frame_pixmap()
        painter.save()
        # Rotate and flip around the feet, like the shell version does.
        painter.translate(px + self.size_px / 2,
                          py + self.size_px + self.off_y)
        painter.rotate(self.angle)
        painter.scale(self.facing, self.scale_y)
        if body:
            painter.drawPixmap(int(-self.size_px / 2), int(-self.size_px), body)
        painter.restore()

        # Head slot: cooking wins over the decorative hat, they never stack.
        hat_name = 'chef' if self.cooking else self._current_hat()
        if hat_name:
            hat = self.pix.get(hat_name)
            if hat:
                base = py + self.off_y + self.size_px * (HEAD_TOP_RATIO +
                                                         HAT_OVERLAP)
                painter.drawPixmap(
                    int(px + self.size_px / 2 - hat.width() / 2),
                    int(base - hat.height()), hat)
        if self.cooking:
            self._draw_held(painter, 'pan', 0.82, 0.46)
        elif self._coffee_visible():
            self._draw_held(painter, 'coffee', COFFEE_X, COFFEE_Y)

        for effect in self.effects:
            painter.setOpacity(effect.alpha)
            painter.drawPixmap(int(effect.x), int(effect.y), effect.pix)
        painter.setOpacity(1.0)

    def _draw_held(self, painter, name, x_frac, y_frac):
        pix = self.pix.get(name)
        if not pix:
            return
        painter.drawPixmap(
            int(self.pet_local.x() + self.size_px * x_frac - pix.width() / 2),
            int(self.pet_local.y() + self.off_y + self.size_px * y_frac -
                pix.height() / 2), pix)

    def _update_mask(self):
        """Only the pet and its props catch the mouse; the rest clicks through."""
        px = self.pet_local.x()
        py = self.pet_local.y()
        off_y = int(self.off_y)

        top = max(0, py + off_y - int(self.size_px * 0.75))
        bottom = min(self.height(), py + max(0, off_y) + self.size_px + int(self.size_px * 0.2))
        left = max(0, px - int(self.size_px * 0.4))
        right = min(self.width(), px + self.size_px + int(self.size_px * 0.5))

        region = QRegion(QRect(left, top, right - left, bottom - top))
        for effect in self.effects:
            region = region.united(QRegion(effect.rect()))
        self.setMask(region)

    # ---------- Interaction ----------

    def mousePressEvent(self, event):
        if not self.settings['interact']:
            return
        if event.button() == Qt.RightButton:
            self._open_claude()
            return
        self.press_pos = event.globalPosition().toPoint()
        self.press_offset = self.press_pos - self.pos()
        self.dragging = False
        self.drag_distance = 0.0
        self._wake()

    def mouseMoveEvent(self, event):
        if self.press_pos is None:
            return
        pos = event.globalPosition().toPoint()
        if not self.dragging:
            delta = pos - self.press_pos
            if math.hypot(delta.x(), delta.y()) > DRAG_THRESHOLD:
                self.dragging = True
                self.mode = 'drag'
                self.action = None
        if self.dragging:
            self.drag_distance += 1
            self.move(pos - self.press_offset)
            self.last_activity = time.monotonic()

    def mouseReleaseEvent(self, _event):
        if self.press_pos is None:
            return
        self.press_pos = None
        if not self.dragging:
            self._pet_clicked()
            return
        self.dragging = False
        # Snap back onto the bar, and get dizzy if it was a rough ride.
        self.pet_x = min(max(self.x() + self.pet_local.x(), self.range[0]),
                         self.range[1])
        shaken = self.drag_distance > 60
        self.mode = 'walk'
        self._reposition()
        if shaken:
            self._start_dizzy()

    def _pet_clicked(self):
        now = time.monotonic()
        if now - getattr(self, '_last_click', 0) < 1.5:
            self._clicks = getattr(self, '_clicks', 0) + 1
        else:
            self._clicks = 1
        self._last_click = now
        if self._clicks >= 3:
            self._clicks = 0
            self._hearts()
        self.last_activity = now
        if self.mode not in ('react', 'wave', 'dizzy'):
            self._wave()

    def _open_claude(self):
        self._wake()
        # An explicit "I am about to work" signal: far more reliable than
        # sniffing around for a running agent.
        self.cook_until = time.monotonic() + 60
        self._check_cooking()
        self.platform.open_claude()

    # ---------- App reactions ----------

    def react_to_apps(self, new_apps):
        if not self.settings['react_apps']:
            return
        now = time.monotonic()
        for name in new_apps:
            for keys, prop in APP_PROPS:
                if any(k in name for k in keys):
                    self._add_effect(prop, 0.68, -0.05, vx=0, vy=-38, ttl=1.2)
                    break
            if now - self.last_react > REACT_COOLDOWN_S and \
                    self.mode in ('walk', 'idle'):
                self.last_react = now
                self.last_activity = now
                self._jump()
            break


def main():
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    pet = Pet()
    pet.show()

    # Notice apps appearing so the pet can react to them.
    seen = set(pet.apps)

    def watch_apps():
        nonlocal seen
        current = pet.apps
        fresh = current - seen
        seen = current
        if fresh:
            pet.react_to_apps(fresh)

    watcher = QTimer()
    watcher.timeout.connect(watch_apps)
    watcher.start(1000)

    sys.exit(app.exec())


if __name__ == '__main__':
    main()

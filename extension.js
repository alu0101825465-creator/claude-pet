// Claude Pet — a GNOME Shell extension (ESM, GNOME 45+).
//
// An animated pixel-art pet that lives on top of your dock, above every window.
//
// Behaviour
//   - Walks along the dock and follows the dock's own auto-hide.
//   - Jumps when apps launch or get focus; app-specific props (music notes,
//     magnifier, chat bubble).
//   - Cooking mode (chef hat, pan, steam) while Claude or VS Code are running,
//     or while a Claude Code hook writes ~/.config/claude-pet/state.
//   - Sleeps when idle: stretches, lies down with a sleep cap, moon and z's.
//   - Interactive: click to wave, pet it for hearts, drag it around.
//   - Speech bubbles and a daily routine (morning coffee, sleepier at night).
//
// Design notes
//   - Wayland has no "always on top"; floating is done by registering the actors
//     as chrome on Main.layoutManager.
//   - The dock is only ever READ, never patched, and through several fallbacks
//     so the pet also works with Dash to Dock, the Ubuntu dock, or no dock.
//   - Timers throttle themselves: they slow down while asleep and stop entirely
//     while hidden, so an idle desktop costs nothing.
//   - disable() removes every timer, monitor, signal and actor.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// --- Layout ---
const FOOT_PAD_RATIO = 19 / 96;   // transparent padding below the feet in the PNG
const HEAD_TOP_RATIO = 21 / 96;   // where the head starts in the sprite
const HAT_OVERLAP = 0.05;         // how far a hat sinks into the head
const EDGE_INSET = 16;            // margin inside the dock at each end
const DOCK_OVERLAP = 14;          // how far the feet stand on the dock edge
const FLOOR_MARGIN = 8;           // bottom margin when there is no dock

// --- Timing ---
const SLIDE_MS = 300;
const POLL_MS = 120;              // world polling while visible
const POLL_IDLE_MS = 500;         // world polling while hidden
const TICK_MS = 40;               // animation tick (~25 fps)
const TICK_SLEEP_MS = 200;        // animation tick while asleep
const TURN_PAUSE_MS = 800;
const JUMP_HEIGHT = 26;
const JUMP_MS = 170;
const REACT_COOLDOWN_US = 400000;
const WAVE_ANGLE = 14;
const WAVE_MS = 120;
const IDLE_TO_SLEEP_US = 5000000;
const NIGHT_SLEEP_US = 2500000;   // falls asleep sooner at night
const Z_EVERY = 28;
const DRAG_THRESHOLD = 8;
const FOLLOW_SLACK_X = 48;
const FOLLOW_SLACK_Y = 28;
const DROP_MS = 480;
const STEAM_EVERY = 8;
const NOTE_EVERY = 12;
const NOTE_MS = 1500;
const BUBBLE_MS = 3600;
const GREET_DELAY_US = 8000000;      // let the desktop settle before greeting
const COFFEE_EVERY_US = 720000000;   // a fresh coffee every 12 min in the morning
const CHATTER_EVERY_US = 360000000;  // the odd idle remark, every ~6 min

// --- Overlay sizes, as a fraction of the pet size ---
const OVERLAY_RATIO = {
    zeta: 15 / 96, moon: 48 / 96, steam: 30 / 96, chef: 42 / 96,
    pan: 48 / 96, coffee: 48 / 96,
};
const HAT_RATIO = 0.68;
const SWEAT_RATIO = 0.28;
const PARTICLE_RATIO = 0.28;
const STAR_RATIO = 0.18;
const NOTE_RATIO = 40 / 96;
const PROP_RATIO = {note: 48 / 96, lens: 42 / 96, bubble: 36 / 96};

// --- Content ---
const FRAMES = {
    idle: ['idle_0', 'idle_1'],
    walk: ['walk_0', 'walk_1', 'walk_2', 'walk_3'],
};
const FRAME_HOLD = {idle: 16, walk: 4};
const ALL_ICONS = [
    'idle_0', 'idle_1', 'walk_0', 'walk_1', 'walk_2', 'walk_3', 'jump_0', 'jump_1',
    'sleep_0', 'note', 'lens', 'bubble', 'heart', 'sweat', 'star', 'coffee',
    'hat_christmas', 'hat_halloween', 'hat_birthday', 'shadow',
    'note_0', 'note_1', 'note_2', 'note_3', 'note_4', 'note_5',
];
const SHADOW_RATIO = 0.62;        // shadow width relative to the pet
const IDLE_ACTION_CHANCE = 0.45;  // odds of a little idle act instead of a plain turn
const FLIP_MS = 520;              // somersault duration
// Desktop ids tried when opening the Claude app on right-click.
const CLAUDE_APP_IDS = [
    'com.anthropic.Claude.desktop', 'claude.desktop', 'Claude.desktop',
];
const NOTE_COLOURS = 6;
const NOTE_POOL = 3;

const HATS = {
    none: null, christmas: 'hat_christmas',
    halloween: 'hat_halloween', birthday: 'hat_birthday',
};
// Apps that put the pet in cooking mode, matched against the desktop id without
// the .desktop suffix. Exact-ish matching on purpose: a loose "code" substring
// would catch unrelated apps, and "claude-code-url-handler" is not an editor.
const COOKING_APP_IDS = [
    'com.anthropic.claude', 'claude', 'code', 'code-oss',
    'visual-studio-code', 'com.visualstudio.code', 'codium', 'vscodium',
];
// Per-app reactions: a gesture plus a floating prop.
const APP_REACTIONS = [
    {keys: ['spotify', 'vlc', 'rhythmbox'], prop: 'note'},
    {keys: ['brave', 'firefox', 'chrome', 'chromium'], prop: 'lens'},
    {keys: ['discord', 'telegram', 'slack', 'element'], prop: 'bubble'},
];

// Known docks, tried in order. Each entry knows how to read that dock's state.
const DOCK_EXTENSIONS = [
    'dash2dock-lite@icedman.github.com',
    'dash-to-dock@micxgx.gmail.com',
    'ubuntu-dock@ubuntu.com',
];

// Speech bubble lines.
const LINES = {
    morning: ['Good morning!', 'Coffee time ☕', 'Rise and shine!'],
    evening: ['Good evening!', 'Still going?', 'Long day, huh?'],
    night: ['It is late…', 'Time for bed?', 'Zzz soon…'],
    petted: ['Hehe!', 'That tickles!', '<3'],
    battery: ['Battery is low!', 'Plug me in… I mean, you!'],
    busy: ['Busy busy!', 'Cooking something…'],
    done: ['All done!', 'Task complete!', 'Nailed it!'],
    error: ['Uh oh…', 'Something broke!', 'That did not work.'],
    idle: ['Nice dock you have here.', 'Just stretching my legs.',
        'What are we building?', 'Beep boop.', 'I like it up here.',
        'Right-click me to summon Claude!'],
};

export default class ClaudePetExtension extends Extension {
    enable() {
        this._hidden = false;
        this._mode = 'walk';   // walk|idle|react|wave|drag|sleep|stretch|dizzy
        this._dir = 1;
        this._frame = 0;
        this._tick = 0;
        this._pause = 0;
        this._x = null;
        this._range = null;
        this._perchY = null;
        this._lastGeom = null;
        this._monitorIndex = Main.layoutManager.primaryIndex;
        this._lastReact = 0;
        this._lastActivity = GLib.get_monotonic_time();
        this._dragging = false;
        this._captureId = null;
        this._dragDistance = 0;
        this._steamTick = 0;
        this._noteTick = 0;
        this._sysTick = 0;
        this._musicTick = 0;
        this._playing = false;
        this._cooking = false;
        this._hatShown = false;
        this._clicks = 0;
        this._lastClick = 0;
        this._noteIndex = 0;
        this._noteColour = 0;
        this._greetedOn = null;
        this._startedAt = GLib.get_monotonic_time();
        this._lastCoffee = 0;
        this._lastChatter = 0;
        this._tickRate = 0;
        this._pollRate = 0;
        this._claudeState = '';
        this._statePath = GLib.build_filenamev(
            [GLib.get_user_config_dir(), 'claude-pet', 'state']);

        this._settings = this.getSettings();
        this._settings.connectObject('changed', () => this._readSettings(), this);

        this._icons = {};
        for (const n of ALL_ICONS)
            this._icons[n] = Gio.icon_new_for_string(`${this.path}/assets/${n}.png`);

        // Ground shadow — created BEFORE the pet so it stays underneath it.
        this._shadow = this._overlay('shadow');

        // Main actor.
        this._pet = new St.Icon({
            gicon: this._icons['idle_0'],
            icon_size: 96,
            reactive: true,
            can_focus: false,
            track_hover: false,
        });
        this._pet.set_pivot_point(0.5, 1.0);
        this._pet.connect('button-press-event', (_a, ev) => this._onPress(ev));
        Main.layoutManager.addChrome(this._pet, {
            affectsStruts: false, trackFullscreen: true,
        });

        // Overlays.
        this._zzz = this._overlay('zeta');
        this._moon = this._overlay('moon');
        this._steam = this._overlay('steam');
        this._chef = this._overlay('chef');
        this._pan = this._overlay('pan');
        this._prop = this._overlay('note');
        this._hat = this._overlay('hat_christmas');
        this._sweat = this._overlay('sweat');
        this._coffee = this._overlay('coffee');
        this._particles = [0, 1, 2].map(() => this._overlay('heart'));
        this._notes = Array.from({length: NOTE_POOL}, () => this._overlay('note_0'));
        this._bubble = this._speechBubble();

        // World signals.
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._reposition(), this);
        Main.overview.connectObject(
            'showing', () => this._sync(), 'hidden', () => this._sync(), this);
        Shell.AppSystem.get_default().connectObject(
            'app-state-changed', (_s, app) => {
                if (app.state === Shell.AppState.STARTING)
                    this._onApp(app);
            }, this);
        Shell.WindowTracker.get_default().connectObject(
            'notify::focus-app', () => {
                const app = Shell.WindowTracker.get_default().focus_app;
                if (app)
                    this._onApp(app);
            }, this);
        global.display.connectObject(
            'window-created', (_d, win) => {
                if (win?.get_window_type?.() === Meta.WindowType.NORMAL)
                    this._react();
            }, this);
        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this._somersault(), this);
        try {
            Main.messageTray.connectObject(
                'source-added', () => this._peek(), this);
        } catch (_e) {}

        this._watchClaudeState();

        this._readSettings();
        this._setPollRate(POLL_MS);
        this._setTickRate(TICK_MS);
        this._sync();
    }

    // ---------- Actors ----------

    _overlay(name) {
        const ic = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this.path}/assets/${name}.png`),
            icon_size: 24,
            reactive: false, can_focus: false, track_hover: false,
        });
        ic.opacity = 0;
        Main.layoutManager.addChrome(ic, {affectsStruts: false, trackFullscreen: true});
        return ic;
    }

    _speechBubble() {
        const label = new St.Label({
            text: '',
            style: 'background-color: rgba(22,22,26,0.94); color: #f2f2f4; ' +
                   'border: 2px solid rgba(255,255,255,0.16); border-radius: 10px; ' +
                   'padding: 6px 10px; font-size: 12px; font-weight: bold;',
        });
        label.opacity = 0;
        Main.layoutManager.addChrome(label, {
            affectsStruts: false, trackFullscreen: true,
        });
        return label;
    }

    _readSettings() {
        const s = this._settings;
        this._speed = s.get_int('speed');
        this._size = s.get_int('size');
        this._reactApps = s.get_boolean('react-apps');
        this._waveOnClick = s.get_boolean('wave-on-click');
        this._followCursor = s.get_boolean('follow-cursor');
        this._sleepOn = s.get_boolean('sleep');
        this._cookingOn = s.get_boolean('cooking');
        this._musicOn = s.get_boolean('music');
        this._systemOn = s.get_boolean('system-reactions');
        this._speechOn = s.get_boolean('speech');
        this._routineOn = s.get_boolean('daily-routine');
        this._hooksOn = s.get_boolean('claude-hooks');
        this._hatChoice = s.get_string('hat');
        this._footPad = Math.round(this._size * FOOT_PAD_RATIO);

        if (this._pet)
            this._pet.icon_size = this._size;
        for (const [name, actor] of [['zeta', this._zzz], ['moon', this._moon],
            ['steam', this._steam], ['chef', this._chef], ['pan', this._pan],
            ['coffee', this._coffee]]) {
            if (actor)
                actor.icon_size = Math.round(this._size * OVERLAY_RATIO[name]);
        }
        if (this._hat)
            this._hat.icon_size = Math.round(this._size * HAT_RATIO);
        if (this._shadow)
            this._shadow.icon_size = Math.round(this._size * SHADOW_RATIO);
        if (this._sweat)
            this._sweat.icon_size = Math.round(this._size * SWEAT_RATIO);
        for (const p of (this._particles ?? []))
            p.icon_size = Math.round(this._size * PARTICLE_RATIO);
        for (const n of (this._notes ?? []))
            n.icon_size = Math.round(this._size * NOTE_RATIO);

        if (!this._sleepOn && this._mode === 'sleep')
            this._wake();
        this._reposition();
    }

    // ---------- Timers (self-throttling) ----------

    _setTickRate(ms) {
        if (this._tickRate === ms)
            return;
        if (this._tickId) {
            GLib.Source.remove(this._tickId);
            this._tickId = null;
        }
        this._tickRate = ms;
        if (ms > 0) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._animate();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _setPollRate(ms) {
        if (this._pollRate === ms)
            return;
        if (this._pollId)
            GLib.Source.remove(this._pollId);
        this._pollRate = ms;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._sync();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // While hidden nothing needs animating; while asleep a slow tick is plenty.
    _tuneTimers() {
        if (this._hidden) {
            this._setTickRate(0);
            this._setPollRate(POLL_IDLE_MS);
        } else {
            this._setTickRate(this._mode === 'sleep' ? TICK_SLEEP_MS : TICK_MS);
            this._setPollRate(POLL_MS);
        }
    }

    // ---------- Dock discovery (read-only, several fallbacks) ----------

    _dockObject() {
        for (const uuid of DOCK_EXTENSIONS) {
            try {
                const state = Main.extensionManager.lookup(uuid)?.stateObj;
                if (!state)
                    continue;
                // dash2dock-lite
                if (Array.isArray(state.docks) && state.docks.length)
                    return {kind: 'd2da', docks: state.docks};
                // Dash to Dock / Ubuntu dock
                const all = state.dockManager?._allDocks;
                if (Array.isArray(all) && all.length)
                    return {kind: 'dtd', docks: all};
            } catch (_e) {}
        }
        return null;
    }

    // Last resort: find a dock-looking actor in the chrome and use its geometry.
    _genericDock() {
        const found = [];
        const scan = (actor, depth) => {
            if (depth > 2 || !actor?.get_children)
                return;
            for (const c of actor.get_children()) {
                try {
                    const name = (c.name || '').toLowerCase();
                    if (c.visible && c.width > 60 && c.height > 24 &&
                        (name.includes('dashtodock') || name.includes('dock')))
                        found.push(c);
                } catch (_e) {}
                scan(c, depth + 1);
            }
        };
        scan(Main.layoutManager.uiGroup, 0);
        for (const c of found) {
            const pos = c.get_transformed_position();
            if (!pos || pos[0] == null)
                continue;
            return {actor: c, rect: {x: pos[0], y: pos[1],
                width: c.width, height: c.height}};
        }
        return null;
    }

    // Returns {rect, hidden, monitorIndex} or null.
    _dockInfo() {
        const obj = this._dockObject();
        if (obj) {
            for (const d of obj.docks) {
                try {
                    const target = obj.kind === 'd2da' ? d.struts : (d._slider ?? d);
                    const pos = target?.get_transformed_position?.();
                    if (!pos || pos[0] == null || !(target.width > 0))
                        continue;
                    const rect = {x: pos[0], y: pos[1],
                        width: target.width, height: target.height};
                    const monitor = Main.layoutManager.primaryMonitor;
                    if (monitor && rect.width > monitor.width * 0.95)
                        continue;   // full-width strut: not the dock itself
                    const idx = d._monitorIndex ?? d.monitorIndex ??
                        Main.layoutManager.primaryIndex;
                    const hidden = obj.kind === 'd2da'
                        ? !!d._hidden
                        : this._looksHidden(rect, idx);
                    return {rect, hidden, monitorIndex: idx};
                } catch (_e) {}
            }
        }
        const generic = this._genericDock();
        if (generic) {
            const idx = Main.layoutManager.findIndexForActor
                ? Main.layoutManager.findIndexForActor(generic.actor)
                : Main.layoutManager.primaryIndex;
            return {rect: generic.rect, monitorIndex: idx,
                hidden: this._looksHidden(generic.rect, idx)};
        }
        return null;
    }

    // Generic hidden test: the dock has slid (mostly) past the bottom edge.
    _looksHidden(rect, idx) {
        const m = Main.layoutManager.monitors[idx] ??
            Main.layoutManager.primaryMonitor;
        if (!m)
            return false;
        return rect.y > m.y + m.height - rect.height * 0.35;
    }

    // Freeze the dock's auto-hide while the pet is being dragged, so it does not
    // slide away under the cursor. Only touches one flag, and puts it back.
    _freezeDock(freeze) {
        try {
            const obj = this._dockObject();
            const hider = obj?.docks?.[0]?.autohider;
            if (!hider)
                return;
            if (freeze) {
                if (this._dockFrozen)
                    return;
                this._dockWasEnabled = hider._enabled;
                hider._enabled = false;
                hider.show?.();
                this._dockFrozen = true;
            } else if (this._dockFrozen) {
                hider._enabled = this._dockWasEnabled ?? true;
                this._dockFrozen = false;
                hider._debounceCheckHide?.();
            }
        } catch (_e) {}
    }

    // ---------- Placement ----------

    _monitor() {
        return Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
    }

    _reposition() {
        if (!this._pet)
            return;
        const info = this._dockInfo();
        if (info && !info.hidden) {
            this._monitorIndex = info.monitorIndex;
            const t = this._size;
            const xMin = info.rect.x + EDGE_INSET;
            const xMax = info.rect.x + info.rect.width - t - EDGE_INSET;
            if (xMax > xMin) {
                this._lastGeom = {
                    top: info.rect.y - t + this._footPad + DOCK_OVERLAP,
                    xMin, xMax,
                };
            }
        }
        const m = this._monitor();
        if (!m)
            return;
        const t = this._size;
        const geom = this._lastGeom ?? {
            top: m.y + m.height - t + this._footPad - FLOOR_MARGIN,
            xMin: m.x + EDGE_INSET,
            xMax: m.x + m.width - t - EDGE_INSET,
        };
        this._range = {min: geom.xMin, max: geom.xMax};
        this._perchY = geom.top;
        if (this._x === null)
            this._x = geom.xMin;
        this._x = Math.max(geom.xMin, Math.min(geom.xMax, this._x));
        if (this._mode !== 'drag')
            this._pet.set_position(Math.round(this._x), Math.round(geom.top));
    }

    _raise() {
        // Body first (lowest of the group), overlays on top of it.
        for (const a of [this._shadow, this._pet, this._zzz, this._moon,
            this._steam, this._chef,
            this._pan, this._prop, this._hat, this._sweat, this._coffee,
            this._bubble, ...(this._notes ?? []), ...(this._particles ?? [])]) {
            const p = a?.get_parent?.();
            if (p)
                p.set_child_above_sibling(a, null);
        }
    }

    // ---------- World sync (poll) ----------

    _sync() {
        this._reposition();
        const info = this._dockInfo();
        const inOverview = Main.overview.visible;
        this._setHidden(!inOverview && info?.hidden === true);
        if (inOverview)
            this._raise();

        this._checkCooking();
        this._checkHat();
        this._checkMusic();
        this._checkSystem();
        this._checkRoutine();
        this._tuneTimers();
    }

    // ---------- Animation ----------

    _animate() {
        if (!this._pet)
            return;
        this._syncWorn();
        if (this._hidden)
            return;

        // Self-healing: a reaction may call remove_all_transitions() in the middle
        // of a fade, freezing opacity at 0 and leaving only the overlays visible.
        if (!this._pet.get_transition('opacity') && this._pet.opacity !== 255)
            this._pet.opacity = 255;
        if ((this._mode === 'walk' || this._mode === 'idle' ||
             this._mode === 'sleep') &&
            !this._pet.get_transition('translation-y') &&
            this._pet.translation_y !== 0)
            this._pet.translation_y = 0;

        if (['react', 'wave', 'drag', 'stretch', 'dizzy', 'act'].includes(this._mode))
            return;   // Clutter or the pointer drives these

        const now = GLib.get_monotonic_time();

        if (this._mode === 'sleep') {
            if (this._cursorTarget() !== null) {
                this._wake();
            } else {
                this._tick++;
                if (this._tick % Math.max(1, Math.round(
                    Z_EVERY * TICK_MS / this._tickRate)) === 0)
                    this._dropZ();
                this._floatMoon();
                return;
            }
        }

        const threshold = this._nightTime() ? NIGHT_SLEEP_US : IDLE_TO_SLEEP_US;
        if (this._sleepOn && !this._cooking &&
            (this._mode === 'walk' || this._mode === 'idle') &&
            now - this._lastActivity > threshold) {
            this._stretch();
            return;
        }

        this._tick++;

        if (this._mode === 'idle') {
            if (this._pause > 0 && --this._pause === 0) {
                this._dir *= -1;
                this._mode = 'walk';
                this._frame = 0;
            } else if (this._tick % FRAME_HOLD.idle === 0) {
                this._frame = (this._frame + 1) % FRAMES.idle.length;
                this._pet.gicon = this._icons[FRAMES.idle[this._frame]];
            }
            return;
        }

        if (!this._range)
            return;
        const step = this._speed * this._tickRate / 1000;
        const target = this._cursorTarget();
        let standing = false;

        if (target !== null) {
            this._noteActivity();
            const dx = target - this._x;
            if (Math.abs(dx) > step) {
                this._x += Math.sign(dx) * step;
                this._dir = Math.sign(dx) || 1;
            } else {
                this._x = target;
                standing = true;
            }
        } else {
            this._x += this._dir * step;
            if (this._x <= this._range.min || this._x >= this._range.max) {
                this._x = Math.max(this._range.min,
                    Math.min(this._range.max, this._x));
                this._pet.set_x(Math.round(this._x));
                this._turnAround();
                return;
            }
        }

        this._pet.set_x(Math.round(this._x));
        this._pet.scale_x = this._dir;   // shaded edge trails the movement
        if (standing)
            this._pet.gicon = this._icons['idle_0'];
        else if (this._tick % FRAME_HOLD.walk === 0) {
            this._frame = (this._frame + 1) % FRAMES.walk.length;
            this._pet.gicon = this._icons[FRAMES.walk[this._frame]];
        }
    }

    _turnAround() {
        // Sometimes do a little something instead of just turning on the spot.
        if (Math.random() < IDLE_ACTION_CHANCE) {
            this._idleAction();
            return;
        }
        this._mode = 'idle';
        this._frame = 0;
        this._pause = Math.round(TURN_PAUSE_MS / Math.max(1, this._tickRate));
        this._pet.gicon = this._icons[FRAMES.idle[0]];
    }

    // ---------- Idle repertoire ----------

    _idleAction() {
        const actions = [this._sit, this._lookAround, this._scratch,
            this._somersault];
        actions[Math.floor(Math.random() * actions.length)].call(this);
    }

    // Runs an "act": blocks the walk loop and turns around when finished.
    _act(run) {
        if (!this._pet || this._hidden ||
            ['react', 'wave', 'drag', 'stretch', 'dizzy', 'act'].includes(this._mode))
            return;
        this._mode = 'act';
        this._pet.remove_all_transitions();
        run(() => {
            if (!this._pet || this._mode !== 'act')
                return;
            this._pet.rotation_angle_z = 0;
            this._pet.set_scale(this._dir, 1);
            this._dir *= -1;
            this._mode = 'walk';
            this._frame = 0;
        });
    }

    _sit() {
        this._act(done => {
            this._pet.gicon = this._icons['idle_0'];
            this._pet.ease({scale_y: 0.82, duration: 260,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._pet)
                        return;
                    this._pet.gicon = this._icons['idle_1'];   // eyes shut, resting
                    this._pet.ease({scale_y: 1, duration: 320, delay: 900,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: done});
                }});
        });
    }

    _lookAround() {
        this._act(done => {
            this._pet.gicon = this._icons['idle_0'];
            const facings = [-this._dir, this._dir, -this._dir, this._dir];
            let i = 0;
            const step = () => {
                if (!this._pet)
                    return;
                if (i >= facings.length) {
                    done();
                    return;
                }
                this._pet.scale_x = facings[i++];
                this._pet.ease({scale_y: 1, duration: 300, onComplete: step});
            };
            step();
        });
    }

    _scratch() {
        this._act(done => {
            this._pet.gicon = this._icons['jump_0'];   // a paw up
            const wiggle = [6, -6, 6, -6, 0];
            let i = 0;
            const step = () => {
                if (!this._pet)
                    return;
                if (i >= wiggle.length) {
                    done();
                    return;
                }
                this._pet.ease({rotation_angle_z: wiggle[i++], duration: 110,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: step});
            };
            step();
        });
    }

    // A full somersault: hop up, spin once around the middle, land.
    _somersault() {
        this._act(done => {
            this._pet.gicon = this._icons['jump_0'];
            this._pet.set_pivot_point(0.5, 0.5);       // spin around the centre
            this._pet.rotation_angle_z = 0;
            const spin = 360 * (this._pet.scale_x < 0 ? -1 : 1);
            this._pet.ease({translation_y: -this._size * 0.42, duration: FLIP_MS / 2,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._pet)
                        return;
                    this._pet.ease({translation_y: 0, duration: FLIP_MS / 2,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD});
                }});
            this._pet.ease({rotation_angle_z: spin, duration: FLIP_MS,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: () => {
                    if (this._pet) {
                        this._pet.rotation_angle_z = 0;
                        this._pet.set_pivot_point(0.5, 1.0);   // back to the feet
                    }
                    done();
                }});
        });
    }

    _cursorTarget() {
        if (!this._followCursor || !this._range || this._perchY == null)
            return null;
        const [px, py] = global.get_pointer();
        const m = this._monitor();
        if (!m || py < this._perchY - FOLLOW_SLACK_Y || py > m.y + m.height)
            return null;
        if (px < this._range.min - FOLLOW_SLACK_X ||
            px > this._range.max + this._size + FOLLOW_SLACK_X)
            return null;
        return Math.max(this._range.min,
            Math.min(this._range.max, px - this._size / 2));
    }

    _noteActivity() {
        this._lastActivity = GLib.get_monotonic_time();
    }

    // ---------- Worn items (one head slot: cooking > hat) ----------

    _place(actor, xFrac, yFrac) {
        const s = actor.icon_size;
        const ty = this._pet.translation_y || 0;
        const cx = this._pet.x + this._size * xFrac;
        const cy = this._pet.y + ty + this._size * yFrac;
        const ax = cx - s / 2, ay = cy - s / 2;
        actor.set_position(Math.round(ax), Math.round(ay));
        const pivX = this._pet.x + this._size / 2;
        const pivY = this._pet.y + ty + this._size;
        actor.set_pivot_point((pivX - ax) / s, (pivY - ay) / s);
        actor.rotation_angle_z =
            this._pet.rotation_angle_z * Math.sign(this._pet.scale_x || 1);
    }

    // Hats sit on the head by their BOTTOM edge (their PNG is bottom-anchored).
    _placeHat(actor) {
        const s = actor.icon_size;
        const ty = this._pet.translation_y || 0;
        const cx = this._pet.x + this._size * 0.5;
        const base = this._pet.y + ty + this._size * (HEAD_TOP_RATIO + HAT_OVERLAP);
        const ax = cx - s / 2, ay = base - s;
        actor.set_position(Math.round(ax), Math.round(ay));
        const pivX = this._pet.x + this._size / 2;
        const pivY = this._pet.y + ty + this._size;
        actor.set_pivot_point((pivX - ax) / s, (pivY - ay) / s);
        actor.rotation_angle_z =
            this._pet.rotation_angle_z * Math.sign(this._pet.scale_x || 1);
    }

    // The shadow stays on the ground while the pet hops: the higher it is, the
    // smaller and fainter the shadow gets.
    _syncShadow() {
        if (!this._shadow || !this._pet)
            return;
        if (this._hidden || this._mode === 'drag') {
            this._shadow.opacity = 0;
            return;
        }
        const lift = Math.max(0, -(this._pet.translation_y || 0));
        const t = Math.min(1, lift / Math.max(1, this._size * 0.35));
        const ground = this._perchY != null
            ? this._perchY + this._size - this._footPad
            : this._pet.y + this._size - this._footPad;
        this._centre(this._shadow, this._pet.x + this._size * 0.5, ground);
        this._shadow.set_scale(1 - 0.35 * t, 1 - 0.35 * t);
        this._shadow.opacity = Math.round(200 * (1 - 0.55 * t));
    }

    _syncWorn() {
        this._syncShadow();
        if (this._hidden)
            return;
        if (this._cooking) {
            if (this._chef)
                this._placeHat(this._chef);
            if (this._pan)
                this._place(this._pan, 0.82, 0.46);
        } else if (this._hatShown && this._hat) {
            this._placeHat(this._hat);
        }
        if (this._bubble && this._bubble.opacity > 0)
            this._placeBubble();
    }

    _currentHat() {
        if (this._hatChoice === 'auto') {
            if (!this._routineOn)
                return null;
            const now = new Date();
            const month = now.getMonth() + 1, day = now.getDate();
            if (month === 12 || (month === 1 && day <= 6))
                return 'hat_christmas';
            if (month === 10)
                return 'hat_halloween';
            return null;
        }
        return HATS[this._hatChoice] ?? null;
    }

    _checkHat() {
        const icon = this._currentHat();
        const show = !!icon && !this._cooking && !this._hidden &&
            this._mode !== 'sleep' && this._mode !== 'stretch';
        if (show && this._hat && this._hat.gicon !== this._icons[icon])
            this._hat.gicon = this._icons[icon];
        if (show !== this._hatShown) {
            this._hatShown = show;
            this._fade(this._hat, show ? 255 : 0, 250);
        }
    }

    _fade(actor, opacity, ms) {
        if (!actor)
            return;
        actor.remove_all_transitions();
        actor.ease({opacity, duration: ms,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // ---------- Cooking (apps + Claude Code hooks) ----------

    _watchClaudeState() {
        try {
            const dir = GLib.path_get_dirname(this._statePath);
            GLib.mkdir_with_parents(dir, 0o755);
            this._stateFile = Gio.File.new_for_path(this._statePath);
            this._stateMonitor = this._stateFile.monitor_file(
                Gio.FileMonitorFlags.NONE, null);
            this._stateMonitor.connect('changed', () => this._readClaudeState());
            this._readClaudeState();
        } catch (_e) {}
    }

    // The hook writes a single word: working | done | error (missing = idle).
    _readClaudeState() {
        let value = '';
        try {
            if (GLib.file_test(this._statePath, GLib.FileTest.EXISTS)) {
                const [ok, data] = GLib.file_get_contents(this._statePath);
                if (ok)
                    value = new TextDecoder().decode(data).trim().toLowerCase();
            }
        } catch (_e) {}
        const previous = this._claudeState;
        this._claudeState = value;
        if (!this._hooksOn || value === previous)
            return;
        if (value === 'done') {
            this._celebrate();
            this._say(this._pick(LINES.done));
        } else if (value === 'error') {
            this._sweatDrop();
            this._dizzy();
            this._say(this._pick(LINES.error));
        } else if (value === 'working' && previous !== 'working') {
            this._say(this._pick(LINES.busy));
        }
    }

    // Right-click: bring up the Claude app (focuses it if it is already running)
    // and start cooking straight away — an explicit "I am about to work" signal,
    // far more reliable than sniffing for a running agent.
    _openClaude() {
        this._wake();
        const app = this._claudeApp();
        if (!app) {
            this._say('Claude is not installed?');
            return;
        }
        try {
            app.activate();          // launches it, or focuses the open window
        } catch (_e) {}
        this._startCooking();
        this._say(this._pick(LINES.busy));
    }

    _claudeApp() {
        const sys = Shell.AppSystem.get_default();
        for (const id of CLAUDE_APP_IDS) {
            const app = sys.lookup_app(id);
            if (app)
                return app;
        }
        try {   // fall back to any installed app that looks like Claude
            for (const info of Gio.AppInfo.get_all()) {
                const id = (info.get_id() || '').toLowerCase();
                if (id.includes('claude') && !id.includes('url-handler')) {
                    const app = sys.lookup_app(info.get_id());
                    if (app)
                        return app;
                }
            }
        } catch (_e) {}
        return null;
    }

    // Cook right now; the app check takes over once Claude is actually up.
    _startCooking() {
        this._cookUntil = GLib.get_monotonic_time() + 60000000;   // 60 s grace
        this._checkCooking();
    }

    _cookingApp() {
        try {
            for (const app of Shell.AppSystem.get_default().get_running()) {
                // An app with no windows left is just lingering in the tray or
                // in the background, so it does not count as "working".
                if (app.get_n_windows?.() === 0)
                    continue;
                const id = (app.get_id() || '').toLowerCase()
                    .replace(/\.desktop$/, '');
                if (COOKING_APP_IDS.includes(id))
                    return true;
            }
        } catch (_e) {}
        return false;
    }

    _checkCooking() {
        const forced = this._cookUntil &&
            GLib.get_monotonic_time() < this._cookUntil;
        const active = this._cookingOn && !this._hidden &&
            (forced || this._claudeState === 'working' || this._cookingApp());
        if (active !== this._cooking) {
            this._cooking = active;
            for (const a of [this._chef, this._pan])
                this._fade(a, active ? 255 : 0, 300);
        }
        if (!active) {
            this._fade(this._steam, 0, 0);
            return;
        }
        this._steamTick++;
        if (this._steamTick % STEAM_EVERY === 0)
            this._puffSteam();
    }

    _puffSteam() {
        if (!this._steam || !this._pet)
            return;
        this._steam.remove_all_transitions();
        this._centre(this._steam,
            this._pet.x + this._size * 0.82, this._pet.y + this._size * 0.30);
        this._steam.translation_y = 0;
        this._steam.opacity = 200;
        this._steam.ease({translation_y: -30, opacity: 0, duration: 1300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _centre(actor, cx, cy) {
        const s = actor.icon_size;
        actor.set_position(Math.round(cx - s / 2), Math.round(cy - s / 2));
    }

    // ---------- Music (MPRIS) ----------

    _checkMusic() {
        if (!this._musicOn) {
            this._playing = false;
            return;
        }
        this._musicTick = (this._musicTick + 1) % 16;
        if (this._musicTick === 0)
            this._queryMpris();
        if (this._playing) {
            this._noteTick++;
            if (this._noteTick % NOTE_EVERY === 0)
                this._dropNote();
        }
    }

    _queryMpris() {
        try {
            Gio.DBus.session.call(
                'org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'ListNames', null,
                new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null,
                (bus, res) => {
                    try {
                        const [names] = bus.call_finish(res).deepUnpack();
                        // Check EVERY player: a stopped one must not mask a
                        // playing one.
                        const players = names.filter(
                            n => n.startsWith('org.mpris.MediaPlayer2.'));
                        if (!players.length) {
                            this._setPlaying(false);
                            return;
                        }
                        let left = players.length;
                        let any = false;
                        for (const p of players) {
                            Gio.DBus.session.call(
                                p, '/org/mpris/MediaPlayer2',
                                'org.freedesktop.DBus.Properties', 'Get',
                                new GLib.Variant('(ss)',
                                    ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']),
                                new GLib.VariantType('(v)'),
                                Gio.DBusCallFlags.NONE, -1, null,
                                (b2, r2) => {
                                    try {
                                        // deepUnpack() does NOT unwrap the 'v';
                                        // recursiveUnpack() gives the string.
                                        const [status] =
                                            b2.call_finish(r2).recursiveUnpack();
                                        if (status === 'Playing')
                                            any = true;
                                    } catch (_e) {}
                                    if (--left === 0)
                                        this._setPlaying(any);
                                });
                        }
                    } catch (_e) {
                        this._setPlaying(false);
                    }
                });
        } catch (_e) {}
    }

    _setPlaying(playing) {
        const before = this._playing;
        this._playing = playing;
        if (playing && !before) {
            this._noteTick = 0;
            this._dropNote();
        }
    }

    _dropNote() {
        if (!this._notes || !this._pet || this._hidden)
            return;
        const n = this._notes[this._noteIndex];
        this._noteIndex = (this._noteIndex + 1) % this._notes.length;
        n.gicon = this._icons[`note_${this._noteColour}`];
        this._noteColour = (this._noteColour + 1) % NOTE_COLOURS;
        const jitter = (Math.random() - 0.5) * this._size * 0.28;
        n.remove_all_transitions();
        this._centre(n, this._pet.x + this._size * 0.70 + jitter,
            this._pet.y + this._size * 0.02);
        n.translation_x = 0;
        n.translation_y = 0;
        n.opacity = 255;
        n.ease({
            translation_x: (Math.random() - 0.3) * this._size * 0.3,
            translation_y: -this._size * (0.55 + Math.random() * 0.25),
            opacity: 0, duration: NOTE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // ---------- System reactions ----------

    _checkSystem() {
        if (!this._systemOn)
            return;
        this._sysTick = (this._sysTick + 1) % 80;
        if (this._sysTick !== 0)
            return;
        const stress = this._underStress();
        if (stress) {
            this._sweatDrop();
            if (stress === 'battery')
                this._say(this._pick(LINES.battery));
        }
    }

    _underStress() {
        try {
            const cores = GLib.get_num_processors();
            const [ok, data] = GLib.file_get_contents('/proc/loadavg');
            if (ok) {
                const load = parseFloat(new TextDecoder().decode(data).split(' ')[0]);
                if (load > cores * 0.9)
                    return 'cpu';
            }
        } catch (_e) {}
        for (const bat of ['BAT0', 'BAT1']) {
            try {
                const base = `/sys/class/power_supply/${bat}`;
                if (!GLib.file_test(`${base}/capacity`, GLib.FileTest.EXISTS))
                    continue;
                const [okc, cap] = GLib.file_get_contents(`${base}/capacity`);
                const [oks, st] = GLib.file_get_contents(`${base}/status`);
                if (okc && oks) {
                    const pct = parseInt(new TextDecoder().decode(cap));
                    const status = new TextDecoder().decode(st).trim();
                    if (pct <= 15 && status === 'Discharging')
                        return 'battery';
                }
            } catch (_e) {}
        }
        return null;
    }

    _sweatDrop() {
        if (!this._sweat || !this._pet || this._hidden)
            return;
        this._sweat.remove_all_transitions();
        this._centre(this._sweat,
            this._pet.x + this._size * 0.72, this._pet.y + this._size * 0.10);
        this._sweat.translation_y = 0;
        this._sweat.opacity = 220;
        this._sweat.ease({translation_y: this._size * 0.22, opacity: 0,
            duration: 900, mode: Clutter.AnimationMode.EASE_IN_QUAD});
    }

    // ---------- Daily routine ----------

    _nightTime() {
        if (!this._routineOn)
            return false;
        const h = new Date().getHours();
        return h >= 23 || h < 6;
    }

    _timeLines(h) {
        return h < 12 ? LINES.morning : h < 21 ? LINES.evening : LINES.night;
    }

    _checkRoutine() {
        if (!this._routineOn || this._hidden)
            return;
        const now = GLib.get_monotonic_time();
        // Do not greet in the first seconds after login: the desktop is still
        // settling and nobody would see it.
        if (now - this._startedAt < GREET_DELAY_US)
            return;

        const date = new Date();
        const today = date.toDateString();
        const h = date.getHours();

        if (this._greetedOn !== today && h >= 6) {
            this._greetedOn = today;
            this._say(this._pick(this._timeLines(h)));
            this._lastChatter = now;
            // Stagger the first coffee so it does not land on top of the hello.
            this._lastCoffee = now - COFFEE_EVERY_US + 20000000;
            return;
        }
        // A fresh coffee every so often through the morning, not once a day:
        // a single 4-second prop is far too easy to miss.
        if (h >= 7 && h < 12 && now - (this._lastCoffee ?? 0) > COFFEE_EVERY_US) {
            this._lastCoffee = now;
            this._showCoffee();
            return;
        }
        if (now - (this._lastChatter ?? 0) > CHATTER_EVERY_US &&
            ['walk', 'idle'].includes(this._mode)) {
            this._lastChatter = now;
            this._say(this._pick(LINES.idle));
        }
    }

    _showCoffee() {
        if (!this._coffee || !this._pet)
            return;
        this._coffee.remove_all_transitions();
        this._centre(this._coffee,
            this._pet.x + this._size * 0.82, this._pet.y + this._size * 0.42);
        this._coffee.opacity = 0;
        this._coffee.ease({opacity: 255, duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._coffee)
                    this._coffee.ease({opacity: 0, duration: 500, delay: 4000,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD});
            }});
    }

    // ---------- Speech bubbles ----------

    _pick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    _placeBubble() {
        const b = this._bubble;
        b.set_position(
            Math.round(this._pet.x + this._size / 2 - b.width / 2),
            Math.round(this._pet.y + (this._pet.translation_y || 0) -
                b.height - this._size * 0.06));
    }

    _say(text) {
        if (!this._speechOn || !this._bubble || !this._pet || this._hidden)
            return;
        this._bubble.text = text;
        this._bubble.remove_all_transitions();
        this._placeBubble();
        this._bubble.opacity = 0;
        this._bubble.ease({opacity: 255, duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._bubble)
                    this._bubble.ease({opacity: 0, duration: 350,
                        delay: BUBBLE_MS,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD});
            }});
    }

    // ---------- Reactions ----------

    _canReact() {
        if (!this._pet || this._hidden || !this._reactApps ||
            ['react', 'wave', 'drag', 'stretch', 'dizzy', 'act'].includes(this._mode))
            return false;
        const now = GLib.get_monotonic_time();
        if (now - this._lastReact < REACT_COOLDOWN_US)
            return false;
        this._lastReact = now;
        this._noteActivity();
        return true;
    }

    _onApp(app) {
        const id = (app.get_id() || '').toLowerCase();
        const rule = APP_REACTIONS.find(r => r.keys.some(k => id.includes(k)));
        if (rule) {
            if (!this._pet || this._hidden || !this._reactApps)
                return;
            this._floatProp(rule.prop);   // the prop always shows
            if (this._canReact())
                this._jump();
        } else {
            this._react();
        }
    }

    _react() {
        if (this._canReact())
            this._jump();
    }

    _jump() {
        this._mode = 'react';
        this._pet.gicon = this._icons['jump_0'];
        this._pet.remove_all_transitions();
        const down = () => {
            if (!this._pet)
                return;
            this._pet.ease({translation_y: 0, duration: JUMP_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._mode === 'react') {
                        this._mode = 'walk';
                        this._frame = 0;
                    }
                }});
        };
        this._pet.ease({translation_y: -JUMP_HEIGHT, duration: JUMP_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._pet && this._mode === 'react')
                    this._pet.gicon = this._icons['jump_1'];
                down();
            }});
    }

    _celebrate() {
        if (!this._pet || this._hidden)
            return;
        this._noteActivity();
        if (!['drag', 'wave'].includes(this._mode))
            this._jump();
        for (let i = 0; i < this._particles.length; i++) {
            const p = this._particles[i];
            p.gicon = this._icons['star'];
            p.icon_size = Math.round(this._size * STAR_RATIO);
            p.remove_all_transitions();
            const angle = (i / this._particles.length) * 2 * Math.PI;
            this._centre(p, this._pet.x + this._size * 0.5,
                this._pet.y - this._size * 0.02);
            p.translation_x = 0;
            p.translation_y = 0;
            p.opacity = 255;
            p.ease({
                translation_x: Math.cos(angle) * this._size * 0.45,
                translation_y: Math.sin(angle) * this._size * 0.3 - this._size * 0.2,
                opacity: 0, duration: 1000,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    _floatProp(name) {
        if (!this._prop)
            return;
        this._prop.gicon = this._icons[name];
        this._prop.icon_size = Math.round(this._size * (PROP_RATIO[name] ?? 0.4));
        this._prop.remove_all_transitions();
        this._centre(this._prop,
            this._pet.x + this._size * 0.68, this._pet.y - this._size * 0.05);
        this._prop.translation_y = 0;
        this._prop.opacity = 255;
        this._prop.ease({translation_y: -this._size * 0.5, opacity: 0,
            duration: 1200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _peek() {
        if (!this._pet || this._hidden ||
            (this._mode !== 'walk' && this._mode !== 'idle'))
            return;
        this._noteActivity();
        this._pet.remove_all_transitions();
        this._pet.ease({translation_y: -this._size * 0.14, duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._pet)
                    this._pet.ease({translation_y: 0, duration: 160,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD});
            }});
    }

    _wave() {
        if (!this._pet || this._hidden || !this._waveOnClick)
            return;
        const now = GLib.get_monotonic_time();
        this._clicks = now - this._lastClick < 1500000 ? this._clicks + 1 : 1;
        this._lastClick = now;
        if (this._clicks >= 3) {
            this._clicks = 0;
            this._hearts();
            this._say(this._pick(LINES.petted));
        }
        if (['react', 'wave', 'dizzy'].includes(this._mode))
            return;
        this._noteActivity();
        this._mode = 'wave';
        this._pet.gicon = this._icons['jump_0'];
        this._pet.remove_all_transitions();
        const angles = [WAVE_ANGLE, -WAVE_ANGLE, WAVE_ANGLE, -WAVE_ANGLE, 0];
        let i = 0;
        const step = () => {
            if (!this._pet)
                return;
            if (i >= angles.length) {
                this._pet.rotation_angle_z = 0;
                if (this._mode === 'wave') {
                    this._mode = 'walk';
                    this._frame = 0;
                }
                return;
            }
            this._pet.ease({rotation_angle_z: angles[i++], duration: WAVE_MS,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD, onComplete: step});
        };
        step();
    }

    _hearts() {
        for (let i = 0; i < this._particles.length; i++) {
            const p = this._particles[i];
            p.gicon = this._icons['heart'];
            p.icon_size = Math.round(this._size * PARTICLE_RATIO);
            p.remove_all_transitions();
            p.translation_x = 0;
            this._centre(p, this._pet.x + this._size * (0.32 + i * 0.18),
                this._pet.y - this._size * 0.02);
            p.translation_y = 0;
            p.opacity = 255;
            p.ease({translation_y: -this._size * (0.5 + 0.12 * i), opacity: 0,
                duration: 1100 + i * 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    _dizzy() {
        if (!this._pet || this._hidden)
            return;
        this._mode = 'dizzy';
        this._pet.gicon = this._icons['idle_0'];
        for (let i = 0; i < this._particles.length; i++) {
            const p = this._particles[i];
            p.gicon = this._icons['star'];
            p.icon_size = Math.round(this._size * STAR_RATIO);
            p.remove_all_transitions();
            const angle = (i / this._particles.length) * 2 * Math.PI;
            this._centre(p, this._pet.x + this._size * 0.5,
                this._pet.y - this._size * 0.02);
            p.translation_x = 0;
            p.translation_y = 0;
            p.opacity = 255;
            p.ease({
                translation_x: Math.cos(angle) * this._size * 0.4,
                translation_y: Math.sin(angle) * this._size * 0.3 - this._size * 0.15,
                opacity: 0, duration: 950,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        this._pet.remove_all_transitions();
        const angles = [18, -18, 14, -14, 8, -8, 0];
        let i = 0;
        const step = () => {
            if (!this._pet)
                return;
            if (i >= angles.length) {
                this._pet.rotation_angle_z = 0;
                if (this._mode === 'dizzy') {
                    this._mode = 'walk';
                    this._frame = 0;
                }
                return;
            }
            this._pet.ease({rotation_angle_z: angles[i++], duration: 110,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD, onComplete: step});
        };
        step();
    }

    // ---------- Sleep ----------

    _stretch() {
        this._mode = 'stretch';
        this._pet.gicon = this._icons['idle_0'];
        this._pet.remove_all_transitions();
        this._pet.ease({scale_y: 1.18, duration: 340,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._pet)
                    return;
                this._pet.ease({scale_y: 1, duration: 280,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        if (this._mode === 'stretch')
                            this._sleep();
                    }});
            }});
    }

    _sleep() {
        this._mode = 'sleep';
        this._frame = 0;
        this._tick = 0;
        this._pet.gicon = this._icons['sleep_0'];
        if (this._moon) {
            this._moon.remove_all_transitions();
            this._placeMoon();
            this._moon.translation_y = 0;
            this._fade(this._moon, 255, 400);
        }
        this._tuneTimers();
    }

    _placeMoon() {
        this._centre(this._moon, this._pet.x + this._size * 0.04,
            this._pet.y - this._size * 0.14);
    }

    _floatMoon() {
        if (!this._moon)
            return;
        this._placeMoon();
        this._moon.translation_y = Math.round(4 * Math.sin(this._tick / 5));
    }

    _wake() {
        if (this._mode === 'sleep') {
            this._mode = 'walk';
            this._frame = 0;
            this._pet.gicon = this._icons['idle_0'];
        }
        this._noteActivity();
        for (const a of [this._zzz, this._moon])
            this._fade(a, 0, 300);
        this._tuneTimers();
    }

    _dropZ() {
        if (!this._zzz || !this._pet)
            return;
        this._zzz.remove_all_transitions();
        this._centre(this._zzz, this._pet.x + this._size * 0.66,
            this._pet.y + this._size * 0.06);
        this._zzz.translation_y = 0;
        this._zzz.opacity = 220;
        this._zzz.ease({translation_y: -34, opacity: 0, duration: 1100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // ---------- Click and drag ----------

    _onPress(event) {
        if (this._hidden)
            return Clutter.EVENT_PROPAGATE;
        if (event?.get_button?.() === Clutter.BUTTON_SECONDARY) {
            this._openClaude();
            return Clutter.EVENT_STOP;
        }
        const [px, py] = global.get_pointer();
        this._pressAt = [px, py];
        this._pressOffset = [px - this._pet.x, py - this._pet.y];
        this._dragging = false;
        this._dragDistance = 0;
        this._lastDragAt = [px, py];
        this._wake();
        if (this._captureId)
            global.stage.disconnect(this._captureId);
        this._captureId = global.stage.connect(
            'captured-event', (_a, ev) => this._onCapture(ev));
        return Clutter.EVENT_STOP;
    }

    _onCapture(ev) {
        const type = ev.type();
        if (type === Clutter.EventType.MOTION) {
            const [px, py] = global.get_pointer();
            if (!this._dragging) {
                const [sx, sy] = this._pressAt;
                if (Math.hypot(px - sx, py - sy) > DRAG_THRESHOLD) {
                    this._dragging = true;
                    this._mode = 'drag';
                    this._freezeDock(true);
                    this._pet.remove_all_transitions();
                    this._pet.rotation_angle_z = 0;
                    this._pet.translation_y = 0;
                    this._pet.gicon = this._icons['jump_0'];
                }
            }
            if (this._dragging) {
                this._noteActivity();
                const [lx, ly] = this._lastDragAt;
                this._dragDistance += Math.hypot(px - lx, py - ly);
                this._lastDragAt = [px, py];
                this._pet.set_position(Math.round(px - this._pressOffset[0]),
                    Math.round(py - this._pressOffset[1]));
                // Propagate so the dock keeps seeing the pointer and stays up.
                return Clutter.EVENT_PROPAGATE;
            }
        } else if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._endDrag();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _endDrag() {
        if (this._captureId) {
            global.stage.disconnect(this._captureId);
            this._captureId = null;
        }
        this._freezeDock(false);
        if (!this._dragging) {
            this._wave();
            return;
        }
        this._dragging = false;
        this._noteActivity();
        const shaken = this._dragDistance > this._size * 6;
        const destX = Math.max(this._range.min,
            Math.min(this._range.max, this._pet.x));
        this._x = destX;
        this._pet.ease({x: destX, duration: DROP_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._pet.ease({y: this._perchY, duration: DROP_MS,
            mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
            onComplete: () => {
                if (this._mode !== 'drag')
                    return;
                if (shaken) {
                    this._dizzy();
                } else {
                    this._mode = 'walk';
                    this._frame = 0;
                }
            }});
    }

    // ---------- Show / hide with the dock ----------

    _setHidden(hidden) {
        if (!this._pet || hidden === this._hidden)
            return;
        this._hidden = hidden;
        if (hidden) {
            if (!['walk', 'idle'].includes(this._mode)) {
                this._mode = 'walk';
                this._frame = 0;
                this._pet.rotation_angle_z = 0;
                this._pet.scale_y = 1;
                this._pet.set_pivot_point(0.5, 1.0);
            }
            for (const a of [this._zzz, this._moon, this._chef, this._pan,
                this._hat, this._sweat, this._coffee, this._steam, this._bubble,
                ...(this._notes ?? [])]) {
                if (a) {
                    a.remove_all_transitions();
                    a.opacity = 0;
                }
            }
            this._hatShown = false;
        }
        const away = this._size + FLOOR_MARGIN + 40;
        this._pet.remove_all_transitions();
        this._pet.ease({
            translation_y: hidden ? away : 0,
            opacity: hidden ? 0 : 255,
            duration: SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._tuneTimers();
    }

    // ---------- Teardown ----------

    disable() {
        for (const id of ['_pollId', '_tickId']) {
            if (this[id]) {
                GLib.Source.remove(this[id]);
                this[id] = null;
            }
        }
        if (this._captureId) {
            global.stage.disconnect(this._captureId);
            this._captureId = null;
        }
        this._freezeDock(false);
        if (this._stateMonitor) {
            this._stateMonitor.cancel();
            this._stateMonitor = null;
        }
        this._stateFile = null;

        Main.layoutManager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.messageTray.disconnectObject(this);
        Shell.AppSystem.get_default().disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        this._settings?.disconnectObject(this);

        for (const a of [...(this._particles ?? []), ...(this._notes ?? [])]) {
            a.remove_all_transitions();
            Main.layoutManager.removeChrome(a);
            a.destroy();
        }
        this._particles = null;
        this._notes = null;
        for (const key of ['_zzz', '_moon', '_steam', '_chef', '_pan', '_prop',
            '_hat', '_sweat', '_coffee', '_bubble', '_shadow', '_pet']) {
            if (this[key]) {
                this[key].remove_all_transitions();
                Main.layoutManager.removeChrome(this[key]);
                this[key].destroy();
                this[key] = null;
            }
        }
        this._settings = null;
        this._icons = null;
        this._hidden = false;
        this._lastGeom = null;
        this._range = null;
        this._x = null;
        this._tickRate = 0;
        this._pollRate = 0;
    }
}

// Claude Pet — extensión de GNOME Shell (ESM, GNOME 45+).
//
// Comportamientos:
//  - Camina por encima del dock (ciclo de patas) y se sincroniza con su
//    auto-ocultado.
//  - SALTA (manos arriba + parpadeo) al abrir/activar apps o abrir ventanas.
//  - SALUDA (ondea) al hacer clic; se puede ARRASTRAR y cae de vuelta al dock.
//  - SIGUE el cursor cuando lo acercas a la zona del dock.
//  - Se DUERME (se acuesta con gorrito + luna) tras 5 s de inactividad.
//  - Profundidad: el borde trasero (según dirección) va más gris (scale_x flip).
//  - Modo COCINANDO (gorro de chef + vapor) mientras Claude o VSCode están en
//    marcha (o exista ~/.config/claude-pet/cocinando).
//  - Todo CONFIGURABLE por GSettings (prefs.js).
//
// Higiene: nada global, no se parchea a nadie; disable() elimina timeouts y
// grabs, desconecta señales y destruye los actores. Del dock solo se LEE.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// --- Ajustes fijos ---
const PAD_RATIO = 19 / 96;
const INSET_IZQ = 16;
const SOLAPE_DOCK = 14;
const MARGEN_ABAJO = 8;
const DURACION_ANIM = 300;
const INTERVALO_SONDEO = 120;
const INTERVALO_ANIM = 40;
const PAUSA_GIRO_MS = 800;
const ALTURA_SALTO = 26;
const DURACION_SALTO = 170;
const COOLDOWN_REACCION = 400000;
const ANG_SALUDO = 14;
const DUR_SALUDO = 120;
const INACTIVIDAD_US = 5000000;      // 5 s sin actividad -> siesta
const Z_INTERVALO = 28;              // ticks entre "z" dormido (~1.1 s)
const UMBRAL_ARRASTRE = 8;           // px de movimiento para pasar a arrastrar
const SEGUIR_MARGEN = 48;            // holgura horizontal de la banda del cursor
const SEGUIR_ARRIBA = 28;            // holgura vertical por encima del posadero
const DUR_CAIDA = 480;              // ms de la caída al soltar
const VAPOR_CADA_SONDEO = 8;         // sondeos entre bocanadas de vapor (~1 s)
const UUID_DOCK = 'dash2dock-lite@icedman.github.com';

// Overlays pixel-art (ratio icon_size respecto al tamaño del personaje; a tam=96
// coincide con el tamaño nativo del PNG -> nítido 1:1).
const OVERLAYS = {
    zeta: 15 / 96, moon: 48 / 96, steam: 30 / 96, chef: 42 / 96, pan: 48 / 96,
};
// Apps cuyo lanzamiento/uso activa el "modo cocinando".
const APPS_COCINA = ['claude', 'code'];
// Reacciones específicas al abrir ciertas apps: gesto + accesorio flotante.
const APPS_REACCION = [
    {k: ['spotify', 'vlc'], tipo: 'baile', ov: 'note'},
    {k: ['brave', 'firefox', 'chrome'], tipo: 'salto', ov: 'lens'},
    {k: ['discord', 'telegram', 'slack'], tipo: 'salto', ov: 'bubble'},
];
const ACC = {note: 48 / 96, lens: 42 / 96, bubble: 36 / 96};   // ratios de accesorios
// Sombreros de temporada (valor del ajuste -> fichero de icono).
const SOMBREROS = {
    ninguno: null, navidad: 'hat_navidad',
    halloween: 'hat_halloween', cumple: 'hat_cumple',
};
const RATIO_SOMBRERO = 0.60;
const RATIO_GOTITA = 0.28;
const RATIO_PARTICULA = 0.28;   // corazones
const RATIO_ESTRELLA = 0.18;    // mareo

const FRAMES = {
    idle: ['idle_0', 'idle_1'],
    paseo: ['walk_0', 'walk_1', 'walk_2', 'walk_3'],
};
const CADENCIA = {idle: 16, paseo: 4};
const TODOS_FRAMES = [
    'idle_0', 'idle_1', 'walk_0', 'walk_1', 'walk_2', 'walk_3', 'jump_0', 'jump_1',
    'sleep_0', 'note', 'lens', 'bubble',
    'hat_navidad', 'hat_halloween', 'hat_cumple', 'heart', 'sweat', 'star',
];

export default class ClaudePetExtension extends Extension {
    enable() {
        this._oculto = false;
        this._modo = 'paseo';           // paseo|idle|reaccion|saludo|arrastrando|durmiendo
        this._dir = 1;
        this._idxFrame = 0;
        this._tick = 0;
        this._pausa = 0;
        this._x = null;
        this._rango = null;
        this._perchY = null;
        this._refGeom = null;
        this._ultimaReaccion = 0;
        this._ultimaActividad = GLib.get_monotonic_time();
        this._arrastrando = false;
        this._idCaptura = null;
        this._vaporTick = 0;
        this._cocinando = false;
        this._rutaCocina = GLib.build_filenamev(
            [GLib.get_user_config_dir(), 'claude-pet', 'cocinando']);

        // Preferencias.
        this._settings = this.getSettings();
        this._settings.connectObject('changed', () => this._leerAjustes(), this);

        // Gicons.
        this._iconos = {};
        for (const n of TODOS_FRAMES)
            this._iconos[n] = Gio.icon_new_for_string(`${this.path}/assets/${n}.png`);

        // Actor principal.
        this._pet = new St.Icon({
            gicon: this._iconos['idle_0'],
            icon_size: 96,
            reactive: true,             // necesario para clic y arrastre
            can_focus: false,
            track_hover: false,
        });
        this._pet.set_pivot_point(0.5, 1.0);
        this._pet.connect('button-press-event', () => this._alPulsar());
        Main.layoutManager.addChrome(this._pet, {
            affectsStruts: false, trackFullscreen: true,
        });

        // Overlays pixel-art (z y luna de siesta; vapor y gorro de cocina).
        this._zzz = this._nuevoOverlay('zeta');
        this._luna = this._nuevoOverlay('moon');
        this._vapor = this._nuevoOverlay('steam');
        this._chef = this._nuevoOverlay('chef');
        this._sarten = this._nuevoOverlay('pan');
        this._accesorio = this._nuevoOverlay('note');   // gicon se cambia al reaccionar
        this._sombrero = this._nuevoOverlay('hat_navidad');   // gicon según ajuste
        this._gotita = this._nuevoOverlay('sweat');
        this._particulas = [0, 1, 2].map(() => this._nuevoOverlay('heart'));
        this._sombreroVisible = false;
        this._musicaSonando = false;
        this._musicaTick = 0;
        this._baileTick = 0;
        this._sisTick = 0;
        this._clics = 0;
        this._ultimoClic = 0;
        this._dragDist = 0;

        // Señales del entorno.
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._reposicionar(), this);
        Main.overview.connectObject(
            'showing', () => this._actualizar(),
            'hidden', () => this._actualizar(), this);
        Shell.AppSystem.get_default().connectObject(
            'app-state-changed', (_s, app) => {
                if (app.state === Shell.AppState.STARTING)
                    this._alAbrirApp(app);
            }, this);
        Shell.WindowTracker.get_default().connectObject(
            'notify::focus-app', () => {
                // Reacción específica también al ENTRAR en la ventana (foco),
                // no solo al abrirla por primera vez.
                const app = Shell.WindowTracker.get_default().focus_app;
                if (app)
                    this._alAbrirApp(app);
            }, this);
        global.display.connectObject(
            'window-created', (_d, win) => {
                if (win?.get_window_type?.() === Meta.WindowType.NORMAL)
                    this._reaccionar();
            }, this);
        // Asomarse cuando llega una notificación (defensivo por si cambia la API).
        try {
            Main.messageTray.connectObject(
                'source-added', () => this._asomarse(), this);
        } catch (_e) {}

        // Temporizadores.
        this._idSondeo = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVALO_SONDEO,
            () => { this._actualizar(); return GLib.SOURCE_CONTINUE; });
        this._idAnim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVALO_ANIM,
            () => { this._animar(); return GLib.SOURCE_CONTINUE; });

        this._leerAjustes();
        this._actualizar();
    }

    _nuevoOverlay(nombre) {
        const ic = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this.path}/assets/${nombre}.png`),
            icon_size: 24,          // se ajusta en _leerAjustes según el tamaño
            reactive: false, can_focus: false, track_hover: false,
        });
        ic.opacity = 0;
        Main.layoutManager.addChrome(ic, {affectsStruts: false, trackFullscreen: true});
        return ic;
    }

    _leerAjustes() {
        this._velocidad = this._settings.get_int('velocidad');
        this._tamano = this._settings.get_int('tamano');
        this._reaccionApps = this._settings.get_boolean('reaccion-apps');
        this._saludoClick = this._settings.get_boolean('saludo-click');
        this._dormirOn = this._settings.get_boolean('dormir');
        this._seguirOn = this._settings.get_boolean('seguir-cursor');
        this._cocinaOn = this._settings.get_boolean('cocina');
        this._musicaOn = this._settings.get_boolean('musica');
        this._sistemaOn = this._settings.get_boolean('sistema');
        this._sombreroSel = this._settings.get_string('sombrero');
        this._padInf = Math.round(this._tamano * PAD_RATIO);
        if (this._pet)
            this._pet.icon_size = this._tamano;
        for (const [nombre, actor] of [['zeta', this._zzz], ['moon', this._luna],
            ['steam', this._vapor], ['chef', this._chef], ['pan', this._sarten]]) {
            if (actor)
                actor.icon_size = Math.round(this._tamano * OVERLAYS[nombre]);
        }
        // Overlays de las funciones nuevas.
        const iconoHat = SOMBREROS[this._sombreroSel];
        if (this._sombrero && iconoHat) {
            this._sombrero.gicon = this._iconos[iconoHat];
            this._sombrero.icon_size = Math.round(this._tamano * RATIO_SOMBRERO);
        }
        if (this._gotita)
            this._gotita.icon_size = Math.round(this._tamano * RATIO_GOTITA);
        for (const p of (this._particulas ?? []))
            p.icon_size = Math.round(this._tamano * RATIO_PARTICULA);
        if (!this._dormirOn && this._modo === 'durmiendo')
            this._despertar();
        this._reposicionar();
    }

    _registrarActividad() {
        this._ultimaActividad = GLib.get_monotonic_time();
    }

    // --- Dock (solo lectura, defensivo) ---

    _dock() {
        try {
            const docks = Main.extensionManager.lookup(UUID_DOCK)?.stateObj?.docks;
            if (!docks || docks.length === 0)
                return null;
            const idx = Main.layoutManager.primaryIndex;
            return docks.find(d => d._monitorIndex === idx) ?? docks[0];
        } catch (_e) {
            return null;
        }
    }

    _dockOculto() {
        const d = this._dock();
        return d ? !!d._hidden : null;
    }

    // Congela el auto-ocultado del dock (mientras se arrastra la mascota) para que
    // no se esconda al alejar el ratón. Reversible; toca solo el flag _enabled.
    _congelarDock(congelar) {
        try {
            const ah = this._dock()?.autohider;
            if (!ah)
                return;
            if (congelar) {
                if (this._dockCongelado)
                    return;
                this._dockPrevEnabled = ah._enabled;
                ah._enabled = false;                 // _checkHide() deja de ocultar
                if (typeof ah.show === 'function')
                    ah.show();
                this._dockCongelado = true;
            } else if (this._dockCongelado) {
                ah._enabled = this._dockPrevEnabled ?? true;
                this._dockCongelado = false;
                if (typeof ah._debounceCheckHide === 'function')
                    ah._debounceCheckHide();
            }
        } catch (_e) {}
    }

    _dockRect() {
        const s = this._dock()?.struts;
        if (!s)
            return null;
        try {
            const pos = s.get_transformed_position();
            const w = s.width, h = s.height;
            if (!pos || pos[0] == null || !(w > 0 && h > 0))
                return null;
            const m = Main.layoutManager.primaryMonitor;
            if (m && w > m.width * 0.95)
                return null;
            return {x: pos[0], y: pos[1], width: w, height: h};
        } catch (_e) {
            return null;
        }
    }

    _geomDock() {
        const rect = this._dockRect();
        if (!rect)
            return null;
        const t = this._tamano;
        const yTop = rect.y - t + this._padInf + SOLAPE_DOCK;
        const xMin = rect.x + INSET_IZQ;
        const xMax = rect.x + rect.width - t - INSET_IZQ;
        if (xMax <= xMin)
            return null;
        return {yTop, xMin, xMax};
    }

    _reposicionar() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !this._pet)
            return;
        const t = this._tamano;

        const g = this._dockOculto() !== true ? this._geomDock() : null;
        if (g)
            this._refGeom = g;
        const ref = this._refGeom ?? {
            yTop: m.y + m.height - t + this._padInf - MARGEN_ABAJO,
            xMin: m.x + INSET_IZQ,
            xMax: m.x + m.width - t - INSET_IZQ,
        };
        this._rango = {min: ref.xMin, max: ref.xMax};
        this._perchY = ref.yTop;
        if (this._x === null)
            this._x = ref.xMin;
        this._x = Math.max(ref.xMin, Math.min(ref.xMax, this._x));
        // Mientras se arrastra o cae, no imponemos la posición (la lleva el ratón/ease).
        if (this._modo !== 'arrastrando')
            this._pet.set_position(Math.round(this._x), Math.round(ref.yTop));
    }

    _raise() {
        // El CUERPO primero (queda el más bajo del grupo) y luego los overlays
        // encima; así el gorro/luna/z/accesorios se ven sobre el cuerpo.
        for (const a of [this._pet, this._zzz, this._luna, this._vapor,
            this._chef, this._sarten, this._accesorio]) {
            const p = a?.get_parent?.();
            if (p)
                p.set_child_above_sibling(a, null);
        }
    }

    _actualizar() {
        this._reposicionar();

        // En el overview NUNCA la escondemos (debe verse sobre el dock). Fuera de
        // él, se sincroniza con el auto-ocultado del dock como siempre.
        const enOverview = Main.overview.visible;
        this._animarA(!enOverview && this._dockOculto() === true);
        if (enOverview)
            this._raise();               // por encima de la UI del overview

        this._revisarCocina();
        this._revisarSombrero();
        this._revisarMusica();
        this._revisarSistema();
    }

    // --- Sombrero de temporada ---

    _revisarSombrero() {
        const icono = SOMBREROS[this._sombreroSel];
        const mostrar = !!icono && !this._cocinando && !this._oculto &&
            this._modo !== 'durmiendo' && this._modo !== 'estirando';
        if (mostrar !== this._sombreroVisible) {
            this._sombreroVisible = mostrar;
            if (this._sombrero) {
                this._sombrero.remove_all_transitions();
                this._sombrero.ease({
                    opacity: mostrar ? 255 : 0, duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }
    }

    // --- Música (MPRIS por D-Bus) ---

    _revisarMusica() {
        if (!this._musicaOn) {
            this._musicaSonando = false;
            return;
        }
        this._musicaTick = (this._musicaTick + 1) % 16;   // consulta cada ~2 s
        if (this._musicaTick === 0)
            this._consultarMpris();
        if (this._musicaSonando) {
            this._baileTick++;
            if (this._baileTick % 40 === 0)               // baila cada ~5 s
                this._reaccionMusica();
        }
    }

    _consultarMpris() {
        try {
            Gio.DBus.session.call(
                'org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'ListNames', null,
                new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null,
                (bus, res) => {
                    try {
                        const [nombres] = bus.call_finish(res).deepUnpack();
                        const p = nombres.find(
                            n => n.startsWith('org.mpris.MediaPlayer2.'));
                        if (!p) {
                            this._musicaSonando = false;
                            return;
                        }
                        Gio.DBus.session.call(
                            p, '/org/mpris/MediaPlayer2',
                            'org.freedesktop.DBus.Properties', 'Get',
                            new GLib.Variant('(ss)',
                                ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']),
                            new GLib.VariantType('(v)'),
                            Gio.DBusCallFlags.NONE, -1, null,
                            (b2, r2) => {
                                try {
                                    const [estado] = b2.call_finish(r2).deepUnpack();
                                    this._musicaSonando = estado === 'Playing';
                                } catch (_e) {
                                    this._musicaSonando = false;
                                }
                            });
                    } catch (_e) {
                        this._musicaSonando = false;
                    }
                });
        } catch (_e) {}
    }

    _reaccionMusica() {
        if (!this._pet || this._oculto ||
            this._modo !== 'paseo' && this._modo !== 'idle')
            return;
        this._registrarActividad();
        this._flotarAccesorio('note');
        this._bailar();
    }

    // --- Reacciones de sistema (batería / CPU) ---

    _revisarSistema() {
        if (!this._sistemaOn)
            return;
        this._sisTick = (this._sisTick + 1) % 80;          // cada ~10 s
        if (this._sisTick === 0 && this._sistemaEstresado())
            this._sudar();
    }

    _sistemaEstresado() {
        try {
            const nproc = GLib.get_num_processors();
            const [ok, data] = GLib.file_get_contents('/proc/loadavg');
            if (ok) {
                const load = parseFloat(new TextDecoder().decode(data).split(' ')[0]);
                if (load > nproc * 0.9)
                    return true;
            }
        } catch (_e) {}
        for (const bat of ['BAT0', 'BAT1']) {
            try {
                const base = `/sys/class/power_supply/${bat}`;
                if (!GLib.file_test(`${base}/capacity`, GLib.FileTest.EXISTS))
                    continue;
                const [okc, cap] = GLib.file_get_contents(`${base}/capacity`);
                const [oks, est] = GLib.file_get_contents(`${base}/status`);
                if (okc && oks) {
                    const pct = parseInt(new TextDecoder().decode(cap));
                    const estado = new TextDecoder().decode(est).trim();
                    if (pct <= 15 && estado === 'Discharging')
                        return true;
                }
            } catch (_e) {}
        }
        return false;
    }

    _sudar() {
        if (!this._gotita || !this._pet || this._oculto)
            return;
        this._gotita.remove_all_transitions();
        this._centrar(this._gotita,
            this._pet.x + this._tamano * 0.72, this._pet.y + this._tamano * 0.10);
        this._gotita.translation_y = 0;
        this._gotita.opacity = 220;
        this._gotita.ease({                                // la gota resbala hacia abajo
            translation_y: this._tamano * 0.22, opacity: 0, duration: 900,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    // --- Emociones (corazones / mareo) ---

    _corazones() {
        for (let i = 0; i < this._particulas.length; i++) {
            const p = this._particulas[i];
            p.gicon = this._iconos['heart'];
            p.icon_size = Math.round(this._tamano * RATIO_PARTICULA);
            p.remove_all_transitions();
            p.translation_x = 0;
            this._centrar(p,
                this._pet.x + this._tamano * (0.32 + i * 0.18),
                this._pet.y - this._tamano * 0.02);
            p.translation_y = 0;
            p.opacity = 255;
            p.ease({
                translation_y: -this._tamano * (0.5 + 0.12 * i), opacity: 0,
                duration: 1100 + i * 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _mareo() {
        this._modo = 'mareo';
        this._pet.gicon = this._iconos['idle_0'];
        // estrellas que salen disparadas alrededor de la cabeza
        for (let i = 0; i < this._particulas.length; i++) {
            const p = this._particulas[i];
            p.gicon = this._iconos['star'];
            p.icon_size = Math.round(this._tamano * RATIO_ESTRELLA);
            p.remove_all_transitions();
            const ang = (i / this._particulas.length) * 2 * Math.PI;
            this._centrar(p,
                this._pet.x + this._tamano * 0.5, this._pet.y - this._tamano * 0.02);
            p.translation_x = 0;
            p.translation_y = 0;
            p.opacity = 255;
            p.ease({
                translation_x: Math.cos(ang) * this._tamano * 0.4,
                translation_y: Math.sin(ang) * this._tamano * 0.3 - this._tamano * 0.15,
                opacity: 0, duration: 950,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
        // bamboleo mareado
        this._pet.remove_all_transitions();
        const angs = [18, -18, 14, -14, 8, -8, 0];
        let i = 0;
        const paso = () => {
            if (!this._pet)
                return;
            if (i >= angs.length) {
                this._pet.rotation_angle_z = 0;
                if (this._modo === 'mareo') {
                    this._modo = 'paseo';
                    this._idxFrame = 0;
                }
                return;
            }
            this._pet.ease({
                rotation_angle_z: angs[i++], duration: 110,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD, onComplete: paso,
            });
        };
        paso();
    }

    // --- Bucle de animación ---

    _animar() {
        if (!this._pet)
            return;
        this._sincronizarAdornos();     // gorro/sartén o sombrero siguen al pet
        if (this._oculto)
            return;
        if (this._modo === 'reaccion' || this._modo === 'saludo' ||
            this._modo === 'arrastrando' || this._modo === 'baile' ||
            this._modo === 'estirando' || this._modo === 'mareo')
            return;                     // los mueve Clutter (ease) o el ratón

        const ahora = GLib.get_monotonic_time();

        if (this._modo === 'durmiendo') {
            if (this._objetivoCursor() !== null) {     // el ratón cerca despierta
                this._despertar();
            } else {
                this._tick++;
                if (this._tick % Z_INTERVALO === 0)
                    this._lanzarZ();
                this._flotarLuna();
                return;
            }
        }

        // ¿Hora de la siesta? (no si está cocinando) -> primero se estira.
        if (this._dormirOn && !this._cocinando &&
            (this._modo === 'paseo' || this._modo === 'idle') &&
            ahora - this._ultimaActividad > INACTIVIDAD_US) {
            this._estirar();
            return;
        }

        this._tick++;

        if (this._modo === 'idle') {
            if (this._pausa > 0 && --this._pausa === 0) {
                this._dir *= -1;
                this._modo = 'paseo';
                this._idxFrame = 0;
            } else if (this._tick % CADENCIA.idle === 0) {
                this._idxFrame = (this._idxFrame + 1) % FRAMES.idle.length;
                this._pet.gicon = this._iconos[FRAMES.idle[this._idxFrame]];
            }
            return;
        }

        // modo paseo
        if (!this._rango)
            return;
        const paso = this._velocidad * INTERVALO_ANIM / 1000;
        const objetivo = this._objetivoCursor();
        let quieto = false;

        if (objetivo !== null) {
            this._registrarActividad();
            const dx = objetivo - this._x;
            if (Math.abs(dx) > paso) {
                this._x += Math.sign(dx) * paso;
                this._dir = Math.sign(dx) || 1;
            } else {
                this._x = objetivo;
                quieto = true;
            }
        } else {
            this._x += this._dir * paso;
            if (this._x <= this._rango.min) {
                this._x = this._rango.min;
                this._pet.set_x(Math.round(this._x));
                this._pausarYGirar();
                return;
            }
            if (this._x >= this._rango.max) {
                this._x = this._rango.max;
                this._pet.set_x(Math.round(this._x));
                this._pausarYGirar();
                return;
            }
        }

        this._pet.set_x(Math.round(this._x));
        this._pet.scale_x = this._dir;   // borde con sombra hacia atrás (profundidad)
        if (quieto) {
            this._pet.gicon = this._iconos['idle_0'];   // parado mirando al ratón
        } else if (this._tick % CADENCIA.paseo === 0) {
            this._idxFrame = (this._idxFrame + 1) % FRAMES.paseo.length;
            this._pet.gicon = this._iconos[FRAMES.paseo[this._idxFrame]];
        }
    }

    _pausarYGirar() {
        this._modo = 'idle';
        this._idxFrame = 0;
        this._pausa = Math.round(PAUSA_GIRO_MS / INTERVALO_ANIM);
        this._pet.gicon = this._iconos[FRAMES.idle[0]];
    }

    // Objetivo X si el cursor está en la banda del dock (o null).
    _objetivoCursor() {
        if (!this._seguirOn || !this._rango || this._perchY == null)
            return null;
        const [px, py] = global.get_pointer();
        const m = Main.layoutManager.primaryMonitor;
        if (!m || py < this._perchY - SEGUIR_ARRIBA || py > m.y + m.height)
            return null;
        if (px < this._rango.min - SEGUIR_MARGEN ||
            px > this._rango.max + this._tamano + SEGUIR_MARGEN)
            return null;
        return Math.max(this._rango.min,
            Math.min(this._rango.max, px - this._tamano / 2));
    }

    // --- Siesta ---

    // Estiramiento/bostezo antes de acostarse (squash-stretch vertical).
    _estirar() {
        this._modo = 'estirando';
        this._pet.gicon = this._iconos['idle_0'];
        this._pet.remove_all_transitions();
        this._pet.ease({
            scale_y: 1.18, duration: 340,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._pet)
                    return;
                this._pet.ease({
                    scale_y: 1, duration: 280,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        if (this._modo === 'estirando')
                            this._dormir();
                    },
                });
            },
        });
    }

    _dormir() {
        this._modo = 'durmiendo';
        this._idxFrame = 0;
        this._tick = 0;
        this._pet.gicon = this._iconos['sleep_0'];   // ojos cerrados + gorrito
        if (this._luna) {
            this._luna.remove_all_transitions();
            this._colocarLuna();
            this._luna.translation_y = 0;
            this._luna.ease({
                opacity: 255, duration: 400,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _centrar(actor, cx, cy) {
        const s = actor.icon_size;
        actor.set_position(Math.round(cx - s / 2), Math.round(cy - s / 2));
    }

    _colocarLuna() {
        this._centrar(this._luna,
            this._pet.x + this._tamano * 0.04,
            this._pet.y - this._tamano * 0.14);
    }

    _flotarLuna() {
        if (!this._luna)
            return;
        this._colocarLuna();
        this._luna.translation_y = Math.round(4 * Math.sin(this._tick / 5));
    }

    _despertar() {
        if (this._modo === 'durmiendo') {
            this._modo = 'paseo';
            this._idxFrame = 0;
            this._pet.gicon = this._iconos['idle_0'];
        }
        this._registrarActividad();
        for (const a of [this._zzz, this._luna]) {
            if (a) {
                a.remove_all_transitions();
                a.ease({
                    opacity: 0, duration: 300,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }
    }

    _lanzarZ() {
        if (!this._zzz || !this._pet)
            return;
        this._zzz.remove_all_transitions();
        this._centrar(this._zzz,
            this._pet.x + this._tamano * 0.66,
            this._pet.y + this._tamano * 0.06);
        this._zzz.translation_y = 0;
        this._zzz.opacity = 220;
        this._zzz.ease({
            translation_y: -34, opacity: 0, duration: 1100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // --- Cocina ---

    _revisarCocina() {
        // Cocina si: está activado, no oculto, y (Claude/VSCode en marcha o el
        // fichero de estado existe).
        const nuevo = this._cocinaOn && !this._oculto &&
            (this._appCocinando() ||
             GLib.file_test(this._rutaCocina, GLib.FileTest.EXISTS));
        if (nuevo !== this._cocinando) {
            this._cocinando = nuevo;
            for (const a of [this._chef, this._sarten]) {   // gorro + sartén
                if (a) {
                    a.remove_all_transitions();
                    a.ease({
                        opacity: nuevo ? 255 : 0, duration: 300,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            }
        }
        if (!nuevo) {
            this._pararVapor();
            return;
        }
        this._vaporTick++;
        if (this._vaporTick % VAPOR_CADA_SONDEO === 0)
            this._lanzarVapor();
    }

    _appCocinando() {
        try {
            for (const app of Shell.AppSystem.get_default().get_running()) {
                const id = (app.get_id() || '').toLowerCase();
                if (APPS_COCINA.some(k => id.includes(k)))
                    return true;
            }
        } catch (_e) {}
        return false;
    }

    // Pega un overlay a una posición fija del pet, siguiendo su rotación (mismo
    // pivote que el pet) y su translación de salto -> se mueve con la ola/salto.
    _pegarAlPet(actor, cxFrac, cyFrac) {
        const hs = actor.icon_size;
        const ty = this._pet.translation_y || 0;
        const cx = this._pet.x + this._tamano * cxFrac;
        const cy = this._pet.y + ty + this._tamano * cyFrac;
        const ax = cx - hs / 2, ay = cy - hs / 2;
        actor.set_position(Math.round(ax), Math.round(ay));
        const pivX = this._pet.x + this._tamano / 2;      // centro-inferior del pet
        const pivY = this._pet.y + ty + this._tamano;
        actor.set_pivot_point((pivX - ax) / hs, (pivY - ay) / hs);
        actor.rotation_angle_z =
            this._pet.rotation_angle_z * Math.sign(this._pet.scale_x || 1);
    }

    _sincronizarAdornos() {
        if (this._oculto)
            return;
        if (this._cocinando) {                            // prioridad: cocina
            if (this._chef)
                this._pegarAlPet(this._chef, 0.50, 0.10);
            if (this._sarten)
                this._pegarAlPet(this._sarten, 0.82, 0.46);
        } else if (this._sombreroVisible) {               // si no, sombrero
            this._pegarAlPet(this._sombrero, 0.50, 0.02);
        }
    }

    _lanzarVapor() {
        if (!this._vapor || !this._pet)
            return;
        this._vapor.remove_all_transitions();
        this._centrar(this._vapor,                       // sube desde la sartén
            this._pet.x + this._tamano * 0.82,
            this._pet.y + this._tamano * 0.30);
        this._vapor.translation_y = 0;
        this._vapor.opacity = 200;
        this._vapor.ease({
            translation_y: -30, opacity: 0, duration: 1300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _pararVapor() {
        if (this._vapor) {
            this._vapor.remove_all_transitions();
            this._vapor.opacity = 0;
        }
    }

    // --- Reacciones ---

    // ¿Se puede reaccionar ahora? (guarda modo/cooldown; consume el cooldown)
    _reaccionListo() {
        if (!this._pet || this._oculto || !this._reaccionApps ||
            this._modo === 'reaccion' || this._modo === 'saludo' ||
            this._modo === 'arrastrando' || this._modo === 'baile' ||
            this._modo === 'estirando')
            return false;
        const now = GLib.get_monotonic_time();
        if (now - this._ultimaReaccion < COOLDOWN_REACCION)
            return false;
        this._ultimaReaccion = now;
        this._registrarActividad();
        return true;
    }

    _alAbrirApp(app) {
        const id = (app.get_id() || '').toLowerCase();
        const r = APPS_REACCION.find(e => e.k.some(k => id.includes(k)));
        if (r)
            this._reaccionApp(r);
        else
            this._reaccionar();
    }

    _reaccionar() {
        if (this._reaccionListo())
            this._saltar();
    }

    _reaccionApp(r) {
        if (!this._pet || this._oculto || !this._reaccionApps)
            return;
        this._flotarAccesorio(r.ov);        // el accesorio SIEMPRE aparece
        if (this._reaccionListo()) {         // el gesto solo si no está ocupado
            if (r.tipo === 'baile')
                this._bailar();
            else
                this._saltar();
        }
    }

    // Salto de alegría (manos arriba + parpadeo en el ápice).
    _saltar() {
        this._modo = 'reaccion';
        this._pet.gicon = this._iconos['jump_0'];
        this._pet.remove_all_transitions();
        const bajar = () => {
            if (!this._pet)
                return;
            this._pet.ease({
                translation_y: 0, duration: DURACION_SALTO,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._modo === 'reaccion') {
                        this._modo = 'paseo';
                        this._idxFrame = 0;
                    }
                },
            });
        };
        this._pet.ease({
            translation_y: -ALTURA_SALTO, duration: DURACION_SALTO,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._pet && this._modo === 'reaccion')
                    this._pet.gicon = this._iconos['jump_1'];
                bajar();
            },
        });
    }

    // Baile: varios botes seguidos (para música).
    _bailar() {
        this._modo = 'baile';
        this._pet.gicon = this._iconos['jump_0'];
        this._pet.remove_all_transitions();
        const sec = [-14, 0, -14, 0, -12, 0];
        let i = 0;
        const paso = () => {
            if (!this._pet)
                return;
            if (i >= sec.length) {
                this._pet.translation_y = 0;
                if (this._modo === 'baile') {
                    this._modo = 'paseo';
                    this._idxFrame = 0;
                }
                return;
            }
            this._pet.ease({
                translation_y: sec[i++], duration: 150,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD, onComplete: paso,
            });
        };
        paso();
    }

    // Accesorio pixel que sube y se desvanece junto a la cabeza.
    _flotarAccesorio(ov) {
        if (!this._accesorio)
            return;
        this._accesorio.gicon = this._iconos[ov];
        this._accesorio.icon_size = Math.round(this._tamano * (ACC[ov] ?? 0.4));
        this._accesorio.remove_all_transitions();
        this._centrar(this._accesorio,
            this._pet.x + this._tamano * 0.68,
            this._pet.y - this._tamano * 0.05);
        this._accesorio.translation_y = 0;
        this._accesorio.opacity = 255;
        this._accesorio.ease({
            translation_y: -this._tamano * 0.5, opacity: 0, duration: 1200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Pequeño respingo al llegar una notificación (no interrumpe el paseo).
    _asomarse() {
        if (!this._pet || this._oculto ||
            (this._modo !== 'paseo' && this._modo !== 'idle'))
            return;
        this._registrarActividad();
        this._pet.remove_all_transitions();
        this._pet.ease({
            translation_y: -this._tamano * 0.14, duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._pet)
                    this._pet.ease({
                        translation_y: 0, duration: 160,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    });
            },
        });
    }

    _saludar() {
        if (!this._pet || this._oculto || !this._saludoClick)
            return;
        // Caricias: 3 clics seguidos -> corazones (cuenta aunque esté ocupada).
        const now = GLib.get_monotonic_time();
        this._clics = now - this._ultimoClic < 1500000 ? this._clics + 1 : 1;
        this._ultimoClic = now;
        if (this._clics >= 3) {
            this._clics = 0;
            this._corazones();
        }
        if (this._modo === 'reaccion' || this._modo === 'saludo' ||
            this._modo === 'baile' || this._modo === 'mareo')
            return;                     // ya ocupada: el clic cuenta pero no re-saluda
        this._registrarActividad();
        this._modo = 'saludo';
        this._pet.gicon = this._iconos['jump_0'];
        this._pet.remove_all_transitions();
        const angulos = [ANG_SALUDO, -ANG_SALUDO, ANG_SALUDO, -ANG_SALUDO, 0];
        let i = 0;
        const paso = () => {
            if (!this._pet)
                return;
            if (i >= angulos.length) {
                this._pet.rotation_angle_z = 0;
                if (this._modo === 'saludo') {
                    this._modo = 'paseo';
                    this._idxFrame = 0;
                }
                return;
            }
            this._pet.ease({
                rotation_angle_z: angulos[i++], duration: DUR_SALUDO,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD, onComplete: paso,
            });
        };
        paso();
    }

    // --- Clic / arrastre ---

    _alPulsar() {
        if (this._oculto)
            return Clutter.EVENT_PROPAGATE;
        const [px, py] = global.get_pointer();
        this._pressPos = [px, py];
        this._pressOffset = [px - this._pet.x, py - this._pet.y];
        this._arrastrando = false;
        this._dragDist = 0;
        this._lastDragPos = [px, py];
        this._despertar();
        if (this._idCaptura)
            global.stage.disconnect(this._idCaptura);
        this._idCaptura = global.stage.connect(
            'captured-event', (_a, ev) => this._alCapturar(ev));
        return Clutter.EVENT_STOP;
    }

    _alCapturar(ev) {
        const t = ev.type();
        if (t === Clutter.EventType.MOTION) {
            const [px, py] = global.get_pointer();
            if (!this._arrastrando) {
                const [sx, sy] = this._pressPos;
                if (Math.hypot(px - sx, py - sy) > UMBRAL_ARRASTRE) {
                    this._arrastrando = true;
                    this._modo = 'arrastrando';
                    this._congelarDock(true);       // que el dock no se esconda
                    this._pet.remove_all_transitions();
                    this._pet.rotation_angle_z = 0;
                    this._pet.translation_y = 0;
                    this._pet.gicon = this._iconos['jump_0'];   // manos arriba al volar
                }
            }
            if (this._arrastrando) {
                this._registrarActividad();
                const [lx, ly] = this._lastDragPos;
                this._dragDist += Math.hypot(px - lx, py - ly);
                this._lastDragPos = [px, py];
                this._pet.set_position(
                    Math.round(px - this._pressOffset[0]),
                    Math.round(py - this._pressOffset[1]));
                // PROPAGAR (no STOP): el dock debe seguir recibiendo el movimiento
                // del ratón; si no, con autohide se esconde durante el arrastre.
                return Clutter.EVENT_PROPAGATE;
            }
        } else if (t === Clutter.EventType.BUTTON_RELEASE) {
            this._finArrastre();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _finArrastre() {
        if (this._idCaptura) {
            global.stage.disconnect(this._idCaptura);
            this._idCaptura = null;
        }
        this._congelarDock(false);      // el dock vuelve a su auto-ocultado
        if (!this._arrastrando) {
            this._saludar();            // fue un clic, no un arrastre
            return;
        }
        this._arrastrando = false;
        this._registrarActividad();
        // Cae de vuelta a su sitio sobre el dock, con rebote.
        const destinoX = Math.max(this._rango.min,
            Math.min(this._rango.max, this._pet.x));
        this._x = destinoX;
        this._pet.ease({x: destinoX, duration: DUR_CAIDA,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        const mareado = this._dragDist > this._tamano * 6;   // lo zarandeaste
        this._pet.ease({
            y: this._perchY, duration: DUR_CAIDA,
            mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
            onComplete: () => {
                if (this._modo !== 'arrastrando')
                    return;
                if (mareado) {
                    this._mareo();
                } else {
                    this._modo = 'paseo';
                    this._idxFrame = 0;
                }
            },
        });
    }

    _animarA(oculto) {
        if (!this._pet || oculto === this._oculto)
            return;
        this._oculto = oculto;
        if (oculto && this._modo !== 'paseo' && this._modo !== 'idle') {
            this._modo = 'paseo';
            this._idxFrame = 0;
            this._pet.rotation_angle_z = 0;
            this._pet.scale_y = 1;
        }
        if (oculto) {
            this._pararVapor();
            for (const a of [this._zzz, this._luna, this._chef, this._sarten,
                this._sombrero, this._gotita]) {
                if (a) {
                    a.remove_all_transitions();
                    a.opacity = 0;
                }
            }
            this._sombreroVisible = false;
        }
        const fuera = this._tamano + MARGEN_ABAJO + 40;
        this._pet.remove_all_transitions();
        this._pet.ease({
            translation_y: oculto ? fuera : 0,
            opacity: oculto ? 0 : 255,
            duration: DURACION_ANIM,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    disable() {
        for (const id of ['_idSondeo', '_idAnim']) {
            if (this[id]) {
                GLib.Source.remove(this[id]);
                this[id] = null;
            }
        }
        if (this._idCaptura) {
            global.stage.disconnect(this._idCaptura);
            this._idCaptura = null;
        }
        this._congelarDock(false);      // por si se desactiva a mitad de un arrastre
        Main.layoutManager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.messageTray.disconnectObject(this);
        Shell.AppSystem.get_default().disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        global.display.disconnectObject(this);
        this._settings?.disconnectObject(this);
        for (const p of (this._particulas ?? [])) {
            p.remove_all_transitions();
            Main.layoutManager.removeChrome(p);
            p.destroy();
        }
        this._particulas = null;
        for (const a of ['_zzz', '_luna', '_vapor', '_chef', '_sarten',
            '_accesorio', '_sombrero', '_gotita', '_pet']) {
            if (this[a]) {
                this[a].remove_all_transitions();
                Main.layoutManager.removeChrome(this[a]);
                this[a].destroy();
                this[a] = null;
            }
        }
        this._settings = null;
        this._iconos = null;
        this._oculto = false;
        this._refGeom = null;
        this._rango = null;
        this._x = null;
    }
}

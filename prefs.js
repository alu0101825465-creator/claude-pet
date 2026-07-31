// Panel de preferencias del Claude pet (libadwaita).
// Se abre con: gnome-extensions prefs claude-pet@gumer

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudePetPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Claude Pet',
            icon_name: 'applications-games-symbolic',
        });
        window.add(page);

        // --- Aspecto ---
        const gAspecto = new Adw.PreferencesGroup({title: 'Aspecto'});
        page.add(gAspecto);

        const filaTamano = new Adw.SpinRow({
            title: 'Tamaño',
            subtitle: 'Lado del sprite en píxeles',
            adjustment: new Gtk.Adjustment({
                lower: 48, upper: 160, step_increment: 4, page_increment: 16,
            }),
        });
        gAspecto.add(filaTamano);

        // --- Movimiento ---
        const gMov = new Adw.PreferencesGroup({title: 'Movimiento'});
        page.add(gMov);

        const filaVel = new Adw.SpinRow({
            title: 'Velocidad del paseo',
            subtitle: 'Píxeles por segundo',
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 200, step_increment: 5, page_increment: 20,
            }),
        });
        gMov.add(filaVel);

        // --- Reacciones ---
        const gReac = new Adw.PreferencesGroup({title: 'Reacciones'});
        page.add(gReac);

        const filaApps = new Adw.SwitchRow({
            title: 'Saltar al abrir o activar apps',
            subtitle: 'Salta al lanzar/activar una app o abrir una ventana',
        });
        gReac.add(filaApps);

        const filaSaludo = new Adw.SwitchRow({
            title: 'Saludar al hacer clic',
            subtitle: 'Ondea al pulsar sobre la mascota',
        });
        gReac.add(filaSaludo);

        const filaSeguir = new Adw.SwitchRow({
            title: 'Seguir el cursor',
            subtitle: 'Camina hacia el ratón cuando lo acercas al dock',
        });
        gReac.add(filaSeguir);

        const filaDormir = new Adw.SwitchRow({
            title: 'Dormirse tras inactividad',
            subtitle: 'Se echa una siesta (zzz) si pasa un rato sin actividad',
        });
        gReac.add(filaDormir);

        const filaCocina = new Adw.SwitchRow({
            title: 'Modo cocinando',
            subtitle: 'Vapor mientras exista ~/.config/claude-pet/cocinando',
        });
        gReac.add(filaCocina);

        // --- Enlaces con GSettings ---
        // Los SpinRow (valor double) los enlazamos manualmente con las claves int.
        filaTamano.set_value(settings.get_int('tamano'));
        filaVel.set_value(settings.get_int('velocidad'));
        filaTamano.connect('notify::value',
            () => settings.set_int('tamano', filaTamano.get_value()));
        filaVel.connect('notify::value',
            () => settings.set_int('velocidad', filaVel.get_value()));
        settings.connect('changed::tamano',
            () => filaTamano.set_value(settings.get_int('tamano')));
        settings.connect('changed::velocidad',
            () => filaVel.set_value(settings.get_int('velocidad')));

        settings.bind('reaccion-apps', filaApps, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('saludo-click', filaSaludo, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('seguir-cursor', filaSeguir, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('dormir', filaDormir, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('cocina', filaCocina, 'active',
            Gio.SettingsBindFlags.DEFAULT);
    }
}

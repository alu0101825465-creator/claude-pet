// Claude Pet preferences (libadwaita).
// Open with: gnome-extensions prefs claude-pet@gumer

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const HATS = ['none', 'christmas', 'halloween', 'birthday', 'auto'];
const HAT_LABELS = ['None', 'Christmas 🎅', 'Halloween 🎃', 'Birthday 🎂',
    'Automatic (by season)'];

export default class ClaudePetPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Claude Pet',
            icon_name: 'applications-games-symbolic',
        });
        window.add(page);

        // --- Appearance ---
        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        page.add(appearance);

        const sizeRow = new Adw.SpinRow({
            title: 'Size',
            subtitle: 'Sprite side length in pixels',
            adjustment: new Gtk.Adjustment({
                lower: 48, upper: 160, step_increment: 4, page_increment: 16,
            }),
        });
        appearance.add(sizeRow);

        const hatRow = new Adw.ComboRow({
            title: 'Hat',
            subtitle: 'Hidden automatically while cooking or asleep',
            model: Gtk.StringList.new(HAT_LABELS),
        });
        appearance.add(hatRow);

        // --- Movement ---
        const movement = new Adw.PreferencesGroup({title: 'Movement'});
        page.add(movement);

        const speedRow = new Adw.SpinRow({
            title: 'Walking speed',
            subtitle: 'Pixels per second',
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 200, step_increment: 5, page_increment: 20,
            }),
        });
        movement.add(speedRow);

        const followRow = new Adw.SwitchRow({
            title: 'Follow the cursor',
            subtitle: 'Walk towards the pointer when it comes near the dock',
        });
        movement.add(followRow);

        // --- Reactions ---
        const reactions = new Adw.PreferencesGroup({title: 'Reactions'});
        page.add(reactions);

        const appsRow = new Adw.SwitchRow({
            title: 'React to applications',
            subtitle: 'Jump when an app opens or gets focus',
        });
        reactions.add(appsRow);

        const clickRow = new Adw.SwitchRow({
            title: 'Wave when clicked',
            subtitle: 'Hearts when petted, dizzy when shaken around',
        });
        reactions.add(clickRow);

        const sleepRow = new Adw.SwitchRow({
            title: 'Sleep when idle',
            subtitle: 'Stretch and nap after a few seconds',
        });
        reactions.add(sleepRow);

        const musicRow = new Adw.SwitchRow({
            title: 'Music notes',
            subtitle: 'Colourful notes while a media player is playing',
        });
        reactions.add(musicRow);

        const systemRow = new Adw.SwitchRow({
            title: 'System reactions',
            subtitle: 'Sweat on low battery or CPU load, coffee in performance mode',
        });
        reactions.add(systemRow);

        // --- Personality ---
        const personality = new Adw.PreferencesGroup({title: 'Personality'});
        page.add(personality);

        const routineRow = new Adw.SwitchRow({
            title: 'Daily routine',
            subtitle: 'Sleepier at night and an automatic seasonal hat',
        });
        personality.add(routineRow);

        // --- Claude Code ---
        const claude = new Adw.PreferencesGroup({
            title: 'Claude Code',
            description: 'Cooks while Claude works, celebrates when a task ends. ' +
                'Reads ~/.config/claude-pet/state written by the hooks in hooks/.',
        });
        page.add(claude);

        const cookingRow = new Adw.SwitchRow({
            title: 'Cooking mode',
            subtitle: 'Chef hat, pan and steam while Claude or VS Code run',
        });
        claude.add(cookingRow);

        const hooksRow = new Adw.SwitchRow({
            title: 'React to Claude Code hooks',
            subtitle: 'Celebrate on success, look worried on errors',
        });
        claude.add(hooksRow);

        // --- Bindings ---
        sizeRow.set_value(settings.get_int('size'));
        speedRow.set_value(settings.get_int('speed'));
        sizeRow.connect('notify::value',
            () => settings.set_int('size', sizeRow.get_value()));
        speedRow.connect('notify::value',
            () => settings.set_int('speed', speedRow.get_value()));
        settings.connect('changed::size',
            () => sizeRow.set_value(settings.get_int('size')));
        settings.connect('changed::speed',
            () => speedRow.set_value(settings.get_int('speed')));

        hatRow.selected = Math.max(0, HATS.indexOf(settings.get_string('hat')));
        hatRow.connect('notify::selected',
            () => settings.set_string('hat', HATS[hatRow.selected]));
        settings.connect('changed::hat', () => {
            const i = HATS.indexOf(settings.get_string('hat'));
            if (i >= 0 && i !== hatRow.selected)
                hatRow.selected = i;
        });

        for (const [key, row] of [
            ['react-apps', appsRow], ['wave-on-click', clickRow],
            ['follow-cursor', followRow], ['sleep', sleepRow],
            ['music', musicRow], ['system-reactions', systemRow],
            ['daily-routine', routineRow],
            ['cooking', cookingRow], ['claude-hooks', hooksRow],
        ]) {
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        }
    }
}

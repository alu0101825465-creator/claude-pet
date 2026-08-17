"""Linux backend.

Mostly here so the app can be developed and smoke-tested on Linux; on GNOME the
shell extension in the repository root is the better home for the pet, because
it can sit on the dock properly and float above windows without a stacking war.
"""
import shutil
import subprocess

from .base import Platform

try:
    import psutil
except ImportError:
    psutil = None

PROFILE_IFACES = [
    ('org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles'),
    ('net.hadess.PowerProfiles', '/net/hadess/PowerProfiles'),
]


def _run(args, timeout=3):
    try:
        return subprocess.run(args, capture_output=True, text=True,
                              timeout=timeout).stdout
    except Exception:
        return ''


class LinuxPlatform(Platform):
    name = 'linux'

    def taskbar_rect(self):
        return None      # no portable way; the pet falls back to the screen edge

    def taskbar_hidden(self):
        return False

    # There is no cheap, portable way on Linux to tell whether a process owns a
    # window, so this is a plain process list. These names are command-line
    # tools that share a name with a desktop app; without dropping them the
    # `claude` CLI alone would keep the pet in cooking mode forever. (The GUI
    # build is `claude-desktop`, which is still reported.)
    CLI_ONLY = {'claude'}

    def running_apps(self):
        if not psutil:
            return set()
        names = set()
        try:
            for proc in psutil.process_iter(['name']):
                name = (proc.info.get('name') or '').lower()
                if name and name not in self.CLI_ONLY:
                    names.add(name)
        except Exception:
            pass
        return names

    def media_playing(self):
        if not shutil.which('gdbus'):
            return None
        out = _run(['gdbus', 'call', '--session', '--dest',
                    'org.freedesktop.DBus', '--object-path',
                    '/org/freedesktop/DBus', '--method',
                    'org.freedesktop.DBus.ListNames'])
        players = [chunk.strip(" '")
                   for chunk in out.split(',')
                   if 'org.mpris.MediaPlayer2.' in chunk]
        # Check every player: a paused one must not mask a playing one.
        for player in players:
            status = _run(['gdbus', 'call', '--session', '--dest', player,
                           '--object-path', '/org/mpris/MediaPlayer2',
                           '--method', 'org.freedesktop.DBus.Properties.Get',
                           'org.mpris.MediaPlayer2.Player', 'PlaybackStatus'])
            if 'Playing' in status:
                return True
        return False if players else None

    def power_profile(self):
        if shutil.which('powerprofilesctl'):
            out = _run(['powerprofilesctl', 'get']).strip()
            if out:
                return out
        if shutil.which('gdbus'):
            for name, path in PROFILE_IFACES:
                out = _run(['gdbus', 'call', '--system', '--dest', name,
                            '--object-path', path, '--method',
                            'org.freedesktop.DBus.Properties.Get',
                            name, 'ActiveProfile'])
                for profile in ('performance', 'balanced', 'power-saver'):
                    if profile in out:
                        return profile
        return None

    def battery(self):
        if not psutil:
            return None
        try:
            b = psutil.sensors_battery()
            return (int(b.percent), bool(b.power_plugged)) if b else None
        except Exception:
            return None

    def cpu_load(self):
        if not psutil:
            return None
        try:
            return psutil.cpu_percent(interval=None) / 100.0
        except Exception:
            return None

    def open_claude(self):
        for launcher in (['gtk-launch', 'com.anthropic.Claude'],
                         ['xdg-open', 'claude:']):
            if shutil.which(launcher[0]):
                try:
                    subprocess.Popen(launcher,
                                     stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
                    return True
                except Exception:
                    continue
        return False

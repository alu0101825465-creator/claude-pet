"""Windows backend: taskbar geometry, power mode, media playback, apps.

Uses ctypes against the Win32 API so the only hard dependency stays PySide6 +
psutil. Windows-only imports are all guarded: on any other OS this module simply
never gets selected.
"""
import ctypes
import ctypes.wintypes as wt
import subprocess

from .base import Platform

try:
    import psutil
except ImportError:
    psutil = None

# SHAppBarMessage
ABM_GETTASKBARPOS = 0x00000005
ABM_GETSTATE = 0x00000004
ABS_AUTOHIDE = 0x0000001

# Windows 11 "power mode" overlay GUIDs, and the classic power plans.
OVERLAY_PROFILES = {
    'ded574b5-45a0-4f42-8737-46345c09c238': 'performance',   # best performance
    '3af9b8d9-7c97-431d-ad78-34a8bfea439f': 'power-saver',   # best efficiency
    '00000000-0000-0000-0000-000000000000': 'balanced',      # recommended
}
PLAN_PROFILES = {
    '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': 'performance',
    '381b4222-f694-41f0-9685-ff5bb260df2e': 'balanced',
    'a1841308-3541-4fab-bc81-f71556f20b4a': 'power-saver',
}

CLAUDE_HINTS = ('claude',)


class APPBARDATA(ctypes.Structure):
    _fields_ = [
        ('cbSize', wt.DWORD),
        ('hWnd', wt.HWND),
        ('uCallbackMessage', wt.UINT),
        ('uEdge', wt.UINT),
        ('rc', wt.RECT),
        ('lParam', wt.LPARAM),
    ]


class GUID(ctypes.Structure):
    _fields_ = [('Data1', ctypes.c_ulong), ('Data2', ctypes.c_ushort),
                ('Data3', ctypes.c_ushort), ('Data4', ctypes.c_ubyte * 8)]

    def __str__(self):
        d4 = ''.join(f'{b:02x}' for b in self.Data4)
        return (f'{self.Data1:08x}-{self.Data2:04x}-{self.Data3:04x}-'
                f'{d4[:4]}-{d4[4:]}')


class WindowsPlatform(Platform):
    name = 'windows'

    def __init__(self):
        self._shell32 = ctypes.windll.shell32
        self._user32 = ctypes.windll.user32
        try:
            self._powrprof = ctypes.windll.powrprof
        except OSError:
            self._powrprof = None
        self._media = _MediaWatcher()
        self._declare_types()

    def _declare_types(self):
        """Spell out every signature we use.

        ctypes defaults integer arguments to C int, which silently truncates a
        64-bit HWND on 64-bit Windows and makes the call fail in confusing ways.
        """
        u = self._user32
        u.IsWindowVisible.argtypes = [wt.HWND]
        u.IsWindowVisible.restype = wt.BOOL
        u.GetWindowTextLengthW.argtypes = [wt.HWND]
        u.GetWindowTextLengthW.restype = ctypes.c_int
        u.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
        u.GetWindowTextW.restype = ctypes.c_int
        u.GetWindowThreadProcessId.argtypes = [wt.HWND,
                                               ctypes.POINTER(wt.DWORD)]
        u.GetWindowThreadProcessId.restype = wt.DWORD
        u.SetForegroundWindow.argtypes = [wt.HWND]
        u.SetForegroundWindow.restype = wt.BOOL
        u.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
        u.ShowWindow.restype = wt.BOOL
        u.GetCursorPos.argtypes = [ctypes.POINTER(wt.POINT)]
        u.GetCursorPos.restype = wt.BOOL
        u.EnumWindows.argtypes = [ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND,
                                                     wt.LPARAM), wt.LPARAM]
        u.EnumWindows.restype = wt.BOOL
        self._shell32.SHAppBarMessage.argtypes = [wt.DWORD,
                                                  ctypes.POINTER(APPBARDATA)]
        self._shell32.SHAppBarMessage.restype = ctypes.c_size_t
        if self._powrprof and hasattr(self._powrprof,
                                      'PowerGetActualOverlayScheme'):
            self._powrprof.PowerGetActualOverlayScheme.argtypes = [
                ctypes.POINTER(GUID)]
            self._powrprof.PowerGetActualOverlayScheme.restype = wt.DWORD

    # --- Taskbar --------------------------------------------------------

    def taskbar_rect(self):
        data = APPBARDATA()
        data.cbSize = ctypes.sizeof(APPBARDATA)
        if not self._shell32.SHAppBarMessage(ABM_GETTASKBARPOS,
                                             ctypes.byref(data)):
            return None
        r = data.rc
        return (r.left, r.top, r.right - r.left, r.bottom - r.top)

    def taskbar_hidden(self):
        data = APPBARDATA()
        data.cbSize = ctypes.sizeof(APPBARDATA)
        state = self._shell32.SHAppBarMessage(ABM_GETSTATE, ctypes.byref(data))
        if not state & ABS_AUTOHIDE:
            return False
        # With auto-hide on, the bar is only really up when the pointer is over
        # its band; SHAppBarMessage keeps reporting the expanded rectangle.
        rect = self.taskbar_rect()
        if not rect:
            return None
        x, y, w, h = rect
        pt = wt.POINT()
        self._user32.GetCursorPos(ctypes.byref(pt))
        return not (x <= pt.x <= x + w and y - 4 <= pt.y <= y + h)

    # --- Apps -----------------------------------------------------------

    def running_apps(self):
        names = set()
        # Only count processes that actually own a visible window: an app left
        # running in the tray is not "in use".
        pids = set()

        @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
        def collect(hwnd, _lparam):
            if self._user32.IsWindowVisible(hwnd):
                length = self._user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    pid = wt.DWORD()
                    self._user32.GetWindowThreadProcessId(
                        hwnd, ctypes.byref(pid))
                    pids.add(pid.value)
            return True

        self._user32.EnumWindows(collect, 0)
        if psutil:
            for pid in pids:
                try:
                    names.add(psutil.Process(pid).name().lower())
                except Exception:
                    pass
        return names

    def media_playing(self):
        return self._media.playing()

    # --- Power ----------------------------------------------------------

    def power_profile(self):
        # Windows 11 exposes the slider as an "overlay" on top of the plan.
        if self._powrprof and hasattr(self._powrprof,
                                      'PowerGetActualOverlayScheme'):
            guid = GUID()
            if self._powrprof.PowerGetActualOverlayScheme(
                    ctypes.byref(guid)) == 0:
                profile = OVERLAY_PROFILES.get(str(guid).lower())
                if profile:
                    return profile
        try:
            out = subprocess.run(['powercfg', '/getactivescheme'],
                                 capture_output=True, text=True, timeout=3).stdout
            for guid, profile in PLAN_PROFILES.items():
                if guid in out.lower():
                    return profile
        except Exception:
            pass
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

    # --- Claude ---------------------------------------------------------

    def open_claude(self):
        # Focus an existing window before launching a second copy.
        target = []

        @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
        def find(hwnd, _lparam):
            if not self._user32.IsWindowVisible(hwnd):
                return True
            length = self._user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            self._user32.GetWindowTextW(hwnd, buf, length + 1)
            if any(h in buf.value.lower() for h in CLAUDE_HINTS):
                target.append(hwnd)
                return False
            return True

        self._user32.EnumWindows(find, 0)
        if target:
            self._user32.ShowWindow(target[0], 9)      # SW_RESTORE
            self._user32.SetForegroundWindow(target[0])
            return True
        for command in (['cmd', '/c', 'start', '', 'claude:'],
                        ['cmd', '/c', 'start', '', 'Claude']):
            try:
                subprocess.Popen(command, shell=False)
                return True
            except Exception:
                continue
        return False


class _MediaWatcher:
    """Reads the Windows "now playing" session, when winsdk is available."""

    def __init__(self):
        self._manager = None
        try:
            from winsdk.windows.media.control import (
                GlobalSystemMediaTransportControlsSessionManager as Manager)
            self._Manager = Manager
        except Exception:
            self._Manager = None

    def playing(self):
        if not self._Manager:
            return None
        try:
            import asyncio
            from winsdk.windows.media.control import (
                GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status)

            async def query():
                manager = await self._Manager.request_async()
                for session in manager.get_sessions():
                    info = session.get_playback_info()
                    if info and info.playback_status == Status.PLAYING:
                        return True
                return False

            return asyncio.new_event_loop().run_until_complete(query())
        except Exception:
            return None

"""Pick the backend that matches the machine we are running on."""
import sys

from .base import Platform


def detect():
    if sys.platform.startswith('win'):
        try:
            from .windows import WindowsPlatform
            return WindowsPlatform()
        except Exception:
            pass
    elif sys.platform.startswith('linux'):
        try:
            from .linux import LinuxPlatform
            return LinuxPlatform()
        except Exception:
            pass
    return Platform()      # macOS and anything else: everything degrades to None

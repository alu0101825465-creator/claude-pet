"""What the pet needs to know about the machine it lives on.

Every backend returns plain Python values, so the pet itself never has to care
whether it is running on Windows, Linux or anything else. Anything a backend
cannot answer returns None and the pet degrades gracefully.
"""


class Platform:
    name = 'generic'

    # --- Where to stand -------------------------------------------------

    def taskbar_rect(self):
        """(x, y, w, h) of the taskbar / dock in screen pixels, or None."""
        return None

    def taskbar_hidden(self):
        """True if the bar is currently slid away, False if shown, None if
        unknown."""
        return None

    # --- What the user is doing ----------------------------------------

    def running_apps(self):
        """Lower-case names of user-facing apps that currently have windows."""
        return set()

    def media_playing(self):
        """True while something is actually playing, None if unknown."""
        return None

    # --- How the machine feels -----------------------------------------

    def power_profile(self):
        """'performance', 'balanced', 'power-saver', or None."""
        return None

    def battery(self):
        """(percent, plugged_in) or None."""
        return None

    def cpu_load(self):
        """0.0 – 1.0, or None."""
        return None

    # --- Extras ---------------------------------------------------------

    def open_claude(self):
        """Launch or focus the Claude desktop app. True if something happened."""
        return False

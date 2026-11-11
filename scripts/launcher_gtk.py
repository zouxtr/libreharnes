#!/usr/bin/env python3
"""Small native GTK launcher window for LibreHarnes.

Shows the address of the running app, lets the user open it, copy the link,
toggle access from other devices on the same network, or stop the server.
Falls back to the browser launcher page when GTK is not available (handled
by scripts/launch.js).
"""

import json
import sys
import urllib.request
import webbrowser

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402


def normalize_url(value: str) -> str:
    if not value:
        return "http://127.0.0.1:3030/"
    if not value.startswith(("http://", "https://")):
        value = "http://" + value
    if not value.endswith("/"):
        value += "/"
    return value


APP_URL = normalize_url(sys.argv[1] if len(sys.argv) > 1 else "")
BASE_URL = APP_URL.rstrip("/")


def fetch_config():
    try:
        with urllib.request.urlopen(BASE_URL + "/api/config", timeout=1.2) as res:
            if res.status != 200:
                return None
            return json.loads(res.read().decode("utf-8"))
    except Exception:
        return None


def server_ok() -> bool:
    return fetch_config() is not None


def post_host(host: str):
    try:
        req = urllib.request.Request(
            BASE_URL + "/api/config",
            data=json.dumps({"host": host}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as res:
            return json.loads(res.read().decode("utf-8"))
    except Exception:
        return None


def shutdown_server() -> None:
    try:
        req = urllib.request.Request(
            BASE_URL + "/api/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=1.5).read()
    except Exception:
        pass


CSS = b"""
.lh-window {
  background: #1a1a1a;
  color: #ececec;
}
.lh-title {
  font-size: 16px;
  font-weight: 700;
}
.lh-subtitle {
  font-size: 11px;
  color: #8b8b8b;
}
.lh-logo {
  background: #242424;
  border: 1px solid #333333;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 9px;
}
.lh-card {
  background: #141414;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 10px;
}
.lh-link {
  font-family: monospace;
  font-size: 12px;
  color: #ececec;
}
.lh-status {
  font-size: 11px;
  color: #8b8b8b;
}
.lh-primary {
  background: #ececec;
  color: #131313;
  border-radius: 7px;
  font-weight: 600;
  padding: 7px 12px;
}
.lh-secondary {
  background: transparent;
  color: #ececec;
  border: 1px solid #333333;
  border-radius: 7px;
  padding: 7px 12px;
}
.lh-danger {
  background: transparent;
  color: #8b8b8b;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 7px 12px;
}
.lh-danger:hover {
  color: #f87171;
  background: rgba(248, 113, 113, 0.08);
}
"""


class Launcher(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="dev.libreharnes.launcher")
        self.window = None
        self.status_label = None
        self.dot = None
        self.copy_button = None
        self.open_button = None
        self.link_label = None
        self.lan_switch = None
        self.lan_url = None
        self._syncing = False

    def do_activate(self):
        if self.window:
            self.window.present()
            return

        provider = Gtk.CssProvider()
        provider.load_from_data(CSS)
        display = Gdk.Display.get_default()
        if display is not None:
            Gtk.StyleContext.add_provider_for_display(
                display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            )

        win = Gtk.ApplicationWindow(application=self)
        win.set_title("LibreHarnes")
        win.set_default_size(430, 340)
        win.set_resizable(False)
        win.add_css_class("lh-window")
        win.connect("close-request", self.on_close)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
        outer.set_margin_top(20)
        outer.set_margin_bottom(20)
        outer.set_margin_start(20)
        outer.set_margin_end(20)
        win.set_child(outer)

        brand = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        logo = Gtk.Label(label="LH")
        logo.add_css_class("lh-logo")
        logo.set_valign(Gtk.Align.CENTER)
        brand.append(logo)

        titles = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        title = Gtk.Label(label="LibreHarnes")
        title.add_css_class("lh-title")
        title.set_xalign(0)
        subtitle = Gtk.Label(label="Local AI, on your hardware")
        subtitle.add_css_class("lh-subtitle")
        subtitle.set_xalign(0)
        titles.append(title)
        titles.append(subtitle)
        brand.append(titles)
        outer.append(brand)

        status_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=7)
        self.dot = Gtk.Label(label="●")
        self.dot.add_css_class("lh-status")
        self.status_label = Gtk.Label(label="Server running")
        self.status_label.add_css_class("lh-status")
        status_row.append(self.dot)
        status_row.append(self.status_label)
        outer.append(status_row)

        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        card.add_css_class("lh-card")
        self.link_label = Gtk.Label(label=APP_URL)
        self.link_label.add_css_class("lh-link")
        self.link_label.set_xalign(0)
        self.link_label.set_selectable(True)
        self.link_label.set_ellipsize(3)  # Pango.EllipsizeMode.END
        card.append(self.link_label)
        outer.append(card)

        lan_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        lan_label = Gtk.Label(label="Open from other devices on this network")
        lan_label.add_css_class("lh-status")
        lan_label.set_xalign(0)
        lan_label.set_hexpand(True)
        self.lan_switch = Gtk.Switch()
        self.lan_switch.set_valign(Gtk.Align.CENTER)
        self.lan_switch.connect("state-set", self.on_lan_toggle)
        lan_row.append(lan_label)
        lan_row.append(self.lan_switch)
        outer.append(lan_row)

        lan_hint = Gtk.Label(
            label="When on, anyone on your network can open LibreHarnes at "
            "the address above."
        )
        lan_hint.add_css_class("lh-subtitle")
        lan_hint.set_xalign(0)
        lan_hint.set_ellipsize(3)
        outer.append(lan_hint)

        actions = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.open_button = Gtk.Button(label="Open LibreHarnes")
        self.open_button.add_css_class("lh-primary")
        self.open_button.set_hexpand(True)
        self.open_button.connect("clicked", self.on_open)
        actions.append(self.open_button)

        self.copy_button = Gtk.Button(label="Copy link")
        self.copy_button.add_css_class("lh-secondary")
        self.copy_button.connect("clicked", self.on_copy)
        actions.append(self.copy_button)
        outer.append(actions)

        footer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        quit_button = Gtk.Button(label="Stop server & quit")
        quit_button.add_css_class("lh-danger")
        quit_button.connect("clicked", self.on_quit)
        footer.append(quit_button)
        outer.append(footer)

        self.window = win
        win.present()
        self.update_status()
        GLib.timeout_add_seconds(3, self.update_status)

    def current_url(self) -> str:
        if (
            self.lan_switch is not None
            and self.lan_switch.get_active()
            and self.lan_url
        ):
            return self.lan_url
        return APP_URL

    def apply_lan_state(self, cfg) -> None:
        enabled = cfg.get("host") == "0.0.0.0"
        lan = cfg.get("lanUrl")
        if lan:
            self.lan_url = lan
        if self.lan_switch is not None and self.lan_switch.get_active() != enabled:
            self._syncing = True
            self.lan_switch.set_active(enabled)
            self._syncing = False
        if self.link_label is not None:
            self.link_label.set_text(self.current_url())

    def refresh_once(self):
        self.update_status()
        return False

    def update_status(self):
        if not self.window:
            return False
        cfg = fetch_config()
        ok = cfg is not None
        if ok:
            self.apply_lan_state(cfg)
        if self.status_label is not None:
            self.status_label.set_text(
                "Server running at " + self.current_url()
                if ok
                else "Server is not responding"
            )
        if self.dot is not None:
            self.dot.set_text("●")
            self.dot.set_opacity(1.0 if ok else 0.4)
        return True

    def on_lan_toggle(self, switch, state):
        if self._syncing:
            return True
        cfg = post_host("0.0.0.0" if state else "127.0.0.1")
        if cfg is None:
            return False  # keep the previous switch state
        self.apply_lan_state(cfg)
        if self.status_label is not None:
            self.status_label.set_text("Server running at " + self.current_url())
        # The server re-binds a moment after replying; check back once.
        GLib.timeout_add(900, self.refresh_once)
        return True

    def on_open(self, _button):
        webbrowser.open(self.current_url())

    def on_copy(self, _button):
        display = Gdk.Display.get_default()
        if display is None:
            return
        clipboard = display.get_clipboard()
        clipboard.set(self.current_url())
        if self.copy_button is not None:
            self.copy_button.set_label("Copied")
            GLib.timeout_add(
                1400,
                lambda: self.copy_button.set_label("Copy link") or False,
            )

    def on_quit(self, _button):
        if self.status_label is not None:
            self.status_label.set_text("Stopping server…")
        shutdown_server()
        self.quit()

    def on_close(self, _window):
        shutdown_server()
        return False


def main() -> int:
    if not server_ok():
        print("LibreHarnes: server did not respond at", APP_URL, file=sys.stderr)
    app = Launcher()
    return app.run([])


if __name__ == "__main__":
    raise SystemExit(main())

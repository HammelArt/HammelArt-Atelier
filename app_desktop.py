"""
HammelArt Atelier Standalone Desktop Shell (WebView2)
=====================================================
Boots the local aiohttp gallery backend on a free localhost port in a background
thread and opens HammelArt Atelier inside a native theme-tinted WebView2 window.
"""

from __future__ import annotations

import argparse
import asyncio
import ctypes
from ctypes import wintypes
import json
import os
import socket
import sys
import threading
import time
import traceback
import uuid
from aiohttp import web
import webview

LAB_ROOT = os.path.dirname(os.path.abspath(__file__))
if LAB_ROOT not in sys.path:
    sys.path.insert(0, LAB_ROOT)

from fx_server import create_app, SESSION_STATE_PATH, USERDATA_DIR  # noqa: E402

ICON_PATH = os.path.join(LAB_ROOT, "assets", "hammelart_gallery.ico")

_LEGACY_PROFILE_DIR = os.path.join(LAB_ROOT, ".webview_profile")
PROFILE_DIR = os.path.join(USERDATA_DIR, "webview_profile")
if not os.path.exists(PROFILE_DIR) and os.path.isdir(_LEGACY_PROFILE_DIR):
    try:
        os.replace(_LEGACY_PROFILE_DIR, PROFILE_DIR)
    except OSError:
        PROFILE_DIR = _LEGACY_PROFILE_DIR

_LEGACY_WINDOW_STATE = os.path.join(LAB_ROOT, "desktop_window_state.json")
WINDOW_STATE_PATH = os.path.join(USERDATA_DIR, "desktop_window_state.json")
if not os.path.exists(WINDOW_STATE_PATH) and os.path.isfile(_LEGACY_WINDOW_STATE):
    try:
        os.replace(_LEGACY_WINDOW_STATE, WINDOW_STATE_PATH)
    except OSError:
        pass

_DEFAULT_W = 1480
_DEFAULT_H = 920
_MIN_W = 960
_MIN_H = 620


def _enumerate_monitor_work_rects_win32() -> list[tuple[int, int, int, int]]:
    """Returns list of (left, top, right, bottom) work areas across all active monitors."""
    if sys.platform != "win32":
        return []
    _ensure_win32_prototypes()
    rects: list[tuple[int, int, int, int]] = []
    try:
        user32 = ctypes.windll.user32
        MONITORENUMPROC = ctypes.WINFUNCTYPE(
            wintypes.BOOL,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.POINTER(wintypes.RECT),
            wintypes.LPARAM,
        )

        def _cb(hmon, _hdc, _lprc, _data):
            mi = _MONITORINFO()
            mi.cbSize = ctypes.sizeof(_MONITORINFO)
            if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
                w = mi.rcWork
                rects.append((int(w.left), int(w.top), int(w.right), int(w.bottom)))
            return True

        cb_fn = MONITORENUMPROC(_cb)
        user32.EnumDisplayMonitors(None, None, cb_fn, 0)
    except Exception:
        pass
    return rects


def _clamp_window_bounds(
    x: int | None, y: int | None, width: int, height: int
) -> tuple[int | None, int | None, int, int]:
    """Clamps saved desktop coordinates/size safely onto currently connected monitors."""
    w = max(_MIN_W, int(width))
    h = max(_MIN_H, int(height))
    monitors = _enumerate_monitor_work_rects_win32()
    if not monitors:
        return (x, y, w, h)

    if x is None or y is None or x <= -30000 or y <= -30000:
        ml, mt, mr, mb = monitors[0]
        return (None, None, min(w, max(_MIN_W, mr - ml)), min(h, max(_MIN_H, mb - mt)))

    # Pick monitor with largest intersection area; if none overlaps, fall back to primary work area center.
    best_mon = None
    best_area = 0
    for ml, mt, mr, mb in monitors:
        ix = max(0, min(x + w, mr) - max(x, ml))
        iy = max(0, min(y + h, mb) - max(y, mt))
        area = ix * iy
        if area > best_area:
            best_area = area
            best_mon = (ml, mt, mr, mb)

    if best_mon is None or best_area < 80 * 80:
        ml, mt, mr, mb = monitors[0]
        w = min(w, max(_MIN_W, mr - ml))
        h = min(h, max(_MIN_H, mb - mt))
        return (ml + max(0, (mr - ml - w) // 2), mt + max(0, (mb - mt - h) // 2), w, h)

    ml, mt, mr, mb = best_mon
    mw = max(_MIN_W, mr - ml)
    mh = max(_MIN_H, mb - mt)
    w = min(w, mw)
    h = min(h, mh)
    cx = max(ml, min(int(x), mr - w))
    cy = max(mt, min(int(y), mb - h))
    return (cx, cy, w, h)


def _load_window_state() -> dict:
    fallback = {"x": None, "y": None, "width": _DEFAULT_W, "height": _DEFAULT_H, "mode": "normal"}
    if not os.path.isfile(WINDOW_STATE_PATH):
        return fallback
    try:
        with open(WINDOW_STATE_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return fallback
        mode = raw.get("mode", "normal")
        if mode not in ("normal", "maximized", "fullscreen"):
            mode = "normal"
        rx = raw.get("x")
        ry = raw.get("y")
        rw = raw.get("width", _DEFAULT_W)
        rh = raw.get("height", _DEFAULT_H)
        x = int(rx) if isinstance(rx, (int, float)) else None
        y = int(ry) if isinstance(ry, (int, float)) else None
        w = int(rw) if isinstance(rw, (int, float)) else _DEFAULT_W
        h = int(rh) if isinstance(rh, (int, float)) else _DEFAULT_H
        cx, cy, cw, ch = _clamp_window_bounds(x, y, w, h)
        return {"x": cx, "y": cy, "width": cw, "height": ch, "mode": mode}
    except Exception:
        return fallback


def _write_window_state(payload: dict) -> None:
    tmp = f"{WINDOW_STATE_PATH}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp, WINDOW_STATE_PATH)
    except Exception:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass

_ACCENT_RGB: dict[str, tuple[int, int, int]] = {
    "cyber_violet": (168, 85, 247),
    "darkroom_emerald": (16, 185, 129),
    "midnight_cyan": (56, 189, 248),
    "solar_amber": (245, 158, 11),
    "stealth_obsidian": (148, 163, 184),
}


def _colorref(r: int, g: int, b: int) -> int:
    return ((b & 0xFF) << 16) | ((g & 0xFF) << 8) | (r & 0xFF)


def _blend_rgb(base: tuple[int, int, int], accent: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        int(round(base[0] * (1.0 - t) + accent[0] * t)),
        int(round(base[1] * (1.0 - t) + accent[1] * t)),
        int(round(base[2] * (1.0 - t) + accent[2] * t)),
    )


def _read_session_theme() -> tuple[str, str]:
    if os.path.isfile(SESSION_STATE_PATH):
        try:
            with open(SESSION_STATE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            st = data.get("storage") if isinstance(data, dict) else {}
            if isinstance(st, dict):
                stage = st.get("argon_cb_stage_mode_v1", "dark")
                accent = st.get("argon_cb_accent_id_v1", "cyber_violet")
                return ("light" if stage == "light" else "dark", accent)
        except Exception:
            pass
    return ("dark", "cyber_violet")


def _find_port(preferred: list[int]) -> int:
    for port in preferred:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class _MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", wintypes.RECT),
        ("rcWork", wintypes.RECT),
        ("dwFlags", wintypes.DWORD),
    ]


_WIN32_PROTOS_READY = False


def _ensure_win32_prototypes() -> None:
    global _WIN32_PROTOS_READY
    if _WIN32_PROTOS_READY or sys.platform != "win32":
        return
    try:
        user32 = ctypes.windll.user32
        dwmapi = ctypes.windll.dwmapi
        user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        user32.FindWindowW.restype = wintypes.HWND
        user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.GetWindowLongW.restype = ctypes.c_long
        user32.IsZoomed.argtypes = [wintypes.HWND]
        user32.IsZoomed.restype = wintypes.BOOL
        user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        user32.GetWindowRect.restype = wintypes.BOOL
        user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
        user32.MonitorFromWindow.restype = wintypes.HANDLE
        user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_MONITORINFO)]
        user32.GetMonitorInfoW.restype = wintypes.BOOL
        user32.LoadImageW.argtypes = [
            wintypes.HINSTANCE,
            wintypes.LPCWSTR,
            wintypes.UINT,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.UINT,
        ]
        user32.LoadImageW.restype = wintypes.HANDLE
        user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.SendMessageW.restype = ctypes.c_ssize_t
        user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.ShowWindow.restype = wintypes.BOOL
        user32.IsIconic.argtypes = [wintypes.HWND]
        user32.IsIconic.restype = wintypes.BOOL
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.restype = wintypes.BOOL
        user32.MessageBoxW.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT]
        user32.MessageBoxW.restype = ctypes.c_int
        dwmapi.DwmSetWindowAttribute.argtypes = [
            wintypes.HWND,
            wintypes.DWORD,
            ctypes.c_void_p,
            wintypes.DWORD,
        ]
        dwmapi.DwmSetWindowAttribute.restype = ctypes.HRESULT
    except Exception:
        pass
    _WIN32_PROTOS_READY = True


def _get_win32_window_state(
    title_hint: str = "HammelArt Atelier", hwnd: int = 0
) -> tuple[int, bool, bool]:
    """Returns (hwnd, is_borderless_fullscreen, is_maximized) cleanly via Win32."""
    if sys.platform != "win32":
        return (0, False, False)
    _ensure_win32_prototypes()
    try:
        user32 = ctypes.windll.user32
        target_hwnd = int(hwnd) if hwnd else int(user32.FindWindowW(None, title_hint) or 0)
        if not target_hwnd:
            return (0, False, False)
        GWL_STYLE = -16
        WS_CAPTION = 0x00C00000
        style = user32.GetWindowLongW(target_hwnd, GWL_STYLE)
        has_caption = bool(style & WS_CAPTION)
        is_maximized = bool(user32.IsZoomed(target_hwnd))

        rect = wintypes.RECT()
        user32.GetWindowRect(target_hwnd, ctypes.byref(rect))
        MONITOR_DEFAULTTONEAREST = 2
        hmon = user32.MonitorFromWindow(target_hwnd, MONITOR_DEFAULTTONEAREST)
        mi = _MONITORINFO()
        mi.cbSize = ctypes.sizeof(_MONITORINFO)
        covers_monitor = False
        if hmon and user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            m = mi.rcMonitor
            covers_monitor = (
                rect.left <= m.left + 2
                and rect.top <= m.top + 2
                and rect.right >= m.right - 2
                and rect.bottom >= m.bottom - 2
            )
        is_fullscreen = (not has_caption) and covers_monitor
        return (target_hwnd, is_fullscreen, is_maximized)
    except Exception:
        return (0, False, False)


def _apply_win32_chrome(
    title_hint: str = "HammelArt Atelier",
    stage_mode: str | None = None,
    accent_id: str | None = None,
    apply_icon: bool = True,
    is_fullscreen: bool = False,
    hwnd: int = 0,
) -> None:
    """Applies accent-matched Windows 11 titlebar, border glow & crisp .ico icon."""
    if sys.platform != "win32":
        return
    _ensure_win32_prototypes()
    try:
        user32 = ctypes.windll.user32
        dwmapi = ctypes.windll.dwmapi
        target_hwnd = int(hwnd) if hwnd else int(user32.FindWindowW(None, title_hint) or 0)
        if not target_hwnd:
            return

        if stage_mode is None or accent_id is None:
            saved_stage, saved_accent = _read_session_theme()
            stage_mode = stage_mode or saved_stage
            accent_id = accent_id or saved_accent

        rgb = _ACCENT_RGB.get(accent_id or "cyber_violet", _ACCENT_RGB["cyber_violet"])
        is_light = stage_mode == "light"

        dark = ctypes.c_int(1 if is_fullscreen else (0 if is_light else 1))
        # DWMWA_USE_IMMERSIVE_DARK_MODE = 20
        dwmapi.DwmSetWindowAttribute(target_hwnd, 20, ctypes.byref(dark), ctypes.sizeof(dark))

        if is_fullscreen:
            # Strip Windows 11 border completely in fullscreen (DWMWA_COLOR_NONE = 0xFFFFFFFE)
            no_border = ctypes.c_uint(0xFFFFFFFE)
            black_cap = ctypes.c_uint(0x00000000)
            dwmapi.DwmSetWindowAttribute(target_hwnd, 34, ctypes.byref(no_border), ctypes.sizeof(no_border))
            dwmapi.DwmSetWindowAttribute(target_hwnd, 35, ctypes.byref(black_cap), ctypes.sizeof(black_cap))
        else:
            # Windows 11 DWMWA_BORDER_COLOR (34), DWMWA_CAPTION_COLOR (35), DWMWA_TEXT_COLOR (36)
            caption_rgb = _blend_rgb((244, 244, 248) if is_light else (11, 11, 17), rgb, 0.14 if is_light else 0.24)
            border_rgb = _blend_rgb((210, 212, 224) if is_light else (24, 24, 34), rgb, 0.65 if is_light else 0.72)
            text_rgb = (20, 20, 28) if is_light else _blend_rgb((244, 244, 248), rgb, 0.18)

            c_cap = ctypes.c_uint(_colorref(*caption_rgb))
            c_brd = ctypes.c_uint(_colorref(*border_rgb))
            c_txt = ctypes.c_uint(_colorref(*text_rgb))
            dwmapi.DwmSetWindowAttribute(target_hwnd, 35, ctypes.byref(c_cap), ctypes.sizeof(c_cap))
            dwmapi.DwmSetWindowAttribute(target_hwnd, 34, ctypes.byref(c_brd), ctypes.sizeof(c_brd))
            dwmapi.DwmSetWindowAttribute(target_hwnd, 36, ctypes.byref(c_txt), ctypes.sizeof(c_txt))

        if apply_icon and os.path.isfile(ICON_PATH):
            IMAGE_ICON = 1
            LR_LOADFROMFILE = 0x0010
            WM_SETICON = 0x0080
            hicon_sm = user32.LoadImageW(None, ICON_PATH, IMAGE_ICON, 16, 16, LR_LOADFROMFILE)
            hicon_lg = user32.LoadImageW(None, ICON_PATH, IMAGE_ICON, 256, 256, LR_LOADFROMFILE)
            if hicon_sm:
                user32.SendMessageW(target_hwnd, WM_SETICON, 0, int(hicon_sm))
            if hicon_lg:
                user32.SendMessageW(target_hwnd, WM_SETICON, 1, int(hicon_lg))
            _apply_win32_taskbar_relaunch(target_hwnd)
    except Exception:
        pass


class _COMGUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", ctypes.c_ubyte * 8),
    ]

    @classmethod
    def from_str(cls, s: str) -> "_COMGUID":
        u = uuid.UUID(s)
        g = cls()
        g.Data1, g.Data2, g.Data3 = u.time_low, u.time_mid, u.time_hi_version
        for i, b in enumerate(u.bytes[8:]):
            g.Data4[i] = b
        return g


class _PROPERTYKEY(ctypes.Structure):
    _fields_ = [("fmtid", _COMGUID), ("pid", wintypes.DWORD)]


class _PROPVARIANT(ctypes.Structure):
    _fields_ = [
        ("vt", wintypes.USHORT),
        ("wReserved1", wintypes.WORD),
        ("wReserved2", wintypes.WORD),
        ("wReserved3", wintypes.WORD),
        ("pwszVal", wintypes.LPWSTR),
        ("_pad", ctypes.c_void_p),
    ]


def _apply_win32_taskbar_relaunch(hwnd: int) -> bool:
    """
    Sets Windows 11 HWND AppUserModel Relaunch metadata so pinning HammelArt Atelier
    to the Taskbar saves our custom .ico logo, name, and app_desktop.py launch command
    instead of pinning generic pythonw.exe.
    """
    if sys.platform != "win32" or not hwnd:
        return False
    ps = ctypes.c_void_p()
    ole32 = ctypes.windll.ole32
    did_com = False
    try:
        hr_com = ole32.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED
        did_com = hr_com in (0, 1)
        iid = _COMGUID.from_str("{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}")
        hr = ctypes.windll.shell32.SHGetPropertyStoreForWindow(
            wintypes.HWND(hwnd), ctypes.byref(iid), ctypes.byref(ps)
        )
        if hr != 0 or not ps.value:
            return False

        vtbl = ctypes.cast(
            ctypes.cast(ps, ctypes.POINTER(ctypes.c_void_p))[0],
            ctypes.POINTER(ctypes.c_void_p),
        )
        SetValueProto = ctypes.WINFUNCTYPE(
            ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(_PROPERTYKEY), ctypes.POINTER(_PROPVARIANT)
        )
        CommitProto = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p)
        ReleaseProto = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)
        set_value = SetValueProto(vtbl[6])
        commit = CommitProto(vtbl[7])
        release = ReleaseProto(vtbl[2])

        exe_dir = os.path.dirname(sys.executable)
        pythonw_exe = os.path.join(exe_dir, "pythonw.exe")
        launcher = pythonw_exe if os.path.isfile(pythonw_exe) else sys.executable
        desktop_py = os.path.join(LAB_ROOT, "app_desktop.py")
        relaunch_cmd = f'"{launcher}" "{desktop_py}"'

        fmtid = _COMGUID.from_str("{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}")
        props = [
            (5, "HammelArt.Atelier.Desktop"),  # PKEY_AppUserModel_ID
            (2, relaunch_cmd),                 # PKEY_AppUserModel_RelaunchCommand
            (3, f"{ICON_PATH},0"),             # PKEY_AppUserModel_RelaunchIconResource
            (4, "HammelArt Atelier"),          # PKEY_AppUserModel_RelaunchDisplayNameResource
        ]
        for pid, val in props:
            pk = _PROPERTYKEY(fmtid, pid)
            pv = _PROPVARIANT(vt=31, pwszVal=val)  # VT_LPWSTR
            set_value(ps, ctypes.byref(pk), ctypes.byref(pv))
        commit(ps)
        release(ps)
        return True
    except Exception:
        return False
    finally:
        if did_com:
            try:
                ole32.CoUninitialize()
            except Exception:
                pass


class _ServerThread(threading.Thread):
    def __init__(
        self,
        media_dir: str | None,
        port: int,
        on_theme_change=None,
        on_fullscreen_toggle=None,
        on_restart=None,
    ) -> None:
        super().__init__(daemon=True)
        self.media_dir = media_dir
        self.port = port
        self.on_theme_change = on_theme_change
        self.on_fullscreen_toggle = on_fullscreen_toggle
        self.on_restart = on_restart
        self.ready = threading.Event()
        self.error: BaseException | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self._stop_event: asyncio.Event | None = None

    def run(self) -> None:
        try:
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)
            self._stop_event = asyncio.Event()
            self.loop.run_until_complete(self._serve())
        except BaseException as exc:
            self.error = exc
            self.ready.set()

    async def _serve(self) -> None:
        app = create_app(
            self.media_dir,
            on_theme_change=self.on_theme_change,
            on_fullscreen_toggle=self.on_fullscreen_toggle,
            on_restart=self.on_restart,
        )
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, host="127.0.0.1", port=self.port)
        await site.start()
        self.ready.set()
        assert self._stop_event is not None
        await self._stop_event.wait()
        await runner.cleanup()

    def stop(self) -> None:
        if self.loop and self._stop_event:
            try:
                self.loop.call_soon_threadsafe(self._stop_event.set)
            except Exception:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(description="HammelArt Atelier Standalone Desktop")
    parser.add_argument("--dir", default=None, help="Optional initial media root directory")
    parser.add_argument("--port", type=int, default=0, help="Optional fixed localhost port")
    args = parser.parse_args()

    if sys.platform == "win32":
        _ensure_win32_prototypes()
        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
                "HammelArt.Atelier.Desktop"
            )
        except Exception:
            pass
        # If an Atelier window already owns PROFILE_DIR, restore & focus it instead of colliding on 0x800700AA
        try:
            existing_hwnd = ctypes.windll.user32.FindWindowW(None, "HammelArt Atelier")
            if existing_hwnd:
                sw_cmd = 9 if ctypes.windll.user32.IsIconic(existing_hwnd) else 5  # SW_RESTORE / SW_SHOW
                ctypes.windll.user32.ShowWindow(existing_hwnd, sw_cmd)
                ctypes.windll.user32.SetForegroundWindow(existing_hwnd)
                return
        except Exception:
            pass

    preferred = [args.port] if args.port > 0 else [8192, 8191, 8193, 8194]
    port = _find_port(preferred)

    saved_geo = _load_window_state()
    win_state: dict = {
        "win": None,
        "hwnd": 0,
        "lb_entered_fs": False,
        "saved": None,
        "os_fullscreen": saved_geo["mode"] == "fullscreen",
        "last_normal": {
            "x": saved_geo["x"],
            "y": saved_geo["y"],
            "width": saved_geo["width"],
            "height": saved_geo["height"],
        },
        "last_mode": saved_geo["mode"],
        "ready_to_track": False,
        "save_timer": None,
        "save_lock": threading.Lock(),
    }

    def _get_winforms_form(w):
        try:
            import webview.platforms.winforms as wf  # type: ignore

            return wf, wf.BrowserView.instances.get(w.uid)
        except Exception:
            return None, None

    def _run_on_form_ui(wf, form, fn) -> None:
        if form is None or getattr(form, "IsDisposed", False) or not getattr(form, "IsHandleCreated", True):
            return
        if form.InvokeRequired:
            form.Invoke(wf.Func[wf.Type](fn))
        else:
            fn()

    def _capture_and_save_window_state() -> None:
        w = win_state.get("win")
        if w is None:
            return
        wf, form = _get_winforms_form(w)
        if wf is None or form is None:
            return

        payload_box: list[dict] = []

        def _read_on_ui():
            try:
                WinForms = wf.WinForms
                normal = dict(win_state["last_normal"])
                mode = win_state["last_mode"]

                if win_state["lb_entered_fs"]:
                    saved = win_state.get("saved") or {}
                    saved_st = saved.get("state")
                    mode = "maximized" if saved_st == WinForms.FormWindowState.Maximized else "normal"
                    rb = saved.get("restore_bounds")
                    if rb and rb[2] >= _MIN_W and rb[3] >= _MIN_H:
                        normal = {"x": int(rb[0]), "y": int(rb[1]), "width": int(rb[2]), "height": int(rb[3])}
                else:
                    h_cur = int(form.Handle.ToInt64()) if form is not None else win_state.get("hwnd", 0)
                    _hwnd, is_fs_win32, _is_max_win32 = _get_win32_window_state("HammelArt Atelier", hwnd=h_cur)
                    is_fs = bool(getattr(form, "is_fullscreen", False) or is_fs_win32)
                    if is_fs:
                        mode = "fullscreen"
                    elif form.WindowState == WinForms.FormWindowState.Maximized:
                        mode = "maximized"
                        rb = form.RestoreBounds
                        if rb.X > -30000 and rb.Width >= _MIN_W and rb.Height >= _MIN_H:
                            normal = {"x": int(rb.X), "y": int(rb.Y), "width": int(rb.Width), "height": int(rb.Height)}
                    elif form.WindowState == WinForms.FormWindowState.Minimized:
                        rb = form.RestoreBounds
                        if rb.X > -30000 and rb.Width >= _MIN_W and rb.Height >= _MIN_H:
                            normal = {"x": int(rb.X), "y": int(rb.Y), "width": int(rb.Width), "height": int(rb.Height)}
                    else:
                        mode = "normal"
                        b = form.Bounds
                        if b.X > -30000 and b.Width >= _MIN_W and b.Height >= _MIN_H:
                            normal = {"x": int(b.X), "y": int(b.Y), "width": int(b.Width), "height": int(b.Height)}

                win_state["last_normal"] = normal
                win_state["last_mode"] = mode
                payload_box.append(
                    {
                        "x": normal.get("x"),
                        "y": normal.get("y"),
                        "width": normal.get("width", _DEFAULT_W),
                        "height": normal.get("height", _DEFAULT_H),
                        "mode": mode,
                    }
                )
            except Exception:
                pass

        try:
            _run_on_form_ui(wf, form, _read_on_ui)
            if payload_box:
                _write_window_state(payload_box[0])
        except Exception:
            pass

    def _schedule_save_window_state() -> None:
        if not win_state.get("ready_to_track"):
            return
        with win_state["save_lock"]:
            old = win_state.get("save_timer")
            if old is not None:
                old.cancel()
            t = threading.Timer(0.45, _capture_and_save_window_state)
            t.daemon = True
            win_state["save_timer"] = t
            t.start()

    def _on_theme_change(stage: str, accent: str) -> None:
        h_cur = win_state.get("hwnd", 0)
        _hwnd, is_fs_now, _is_max = _get_win32_window_state("HammelArt Atelier", hwnd=h_cur)
        _apply_win32_chrome(
            "HammelArt Atelier",
            stage_mode=stage,
            accent_id=accent,
            apply_icon=False,
            is_fullscreen=bool(win_state["os_fullscreen"] or is_fs_now),
            hwnd=h_cur,
        )

    def _on_fullscreen_toggle(want: bool | str | None) -> dict:
        w = win_state.get("win")
        if w is None:
            return {"ok": False, "fullscreen": False, "already_fullscreen": False}

        wf, form = _get_winforms_form(w)
        h_cur = win_state.get("hwnd", 0)
        hwnd, is_fs_now, is_max_now = _get_win32_window_state("HammelArt Atelier", hwnd=h_cur)
        cur_fs = bool(
            win_state["os_fullscreen"]
            or is_fs_now
            or (form is not None and getattr(form, "is_fullscreen", False))
        )
        if want == "status":
            return {"ok": True, "fullscreen": cur_fs, "already_fullscreen": cur_fs}

        is_app_toggle = want is None
        target = (not cur_fs) if is_app_toggle else bool(want)

        if target:
            if cur_fs:
                # Already fullscreen: keep existing temporary ownership intact so a nested
                # Screensaver/Lightbox call never traps an active Stage/Lightbox owner in OS fullscreen.
                _apply_win32_chrome("HammelArt Atelier", apply_icon=False, is_fullscreen=True, hwnd=hwnd)
                return {"ok": True, "fullscreen": True, "already_fullscreen": True}

            win_state["lb_entered_fs"] = not is_app_toggle
            if wf is not None and form is not None:
                def _enter():
                    WinForms = wf.WinForms
                    dwmapi = ctypes.windll.dwmapi
                    h = int(form.Handle.ToInt64())
                    win_state["hwnd"] = h
                    rb = form.RestoreBounds if form.WindowState != WinForms.FormWindowState.Normal else form.Bounds
                    win_state["saved"] = {
                        "state": form.WindowState,
                        "style": form.FormBorderStyle,
                        "location": form.Location,
                        "size": form.Size,
                        "restore_bounds": (int(rb.X), int(rb.Y), int(rb.Width), int(rb.Height)),
                    }
                    scr_bounds = WinForms.Screen.FromControl(form).Bounds
                    if form.WindowState != WinForms.FormWindowState.Normal:
                        form.WindowState = WinForms.FormWindowState.Normal
                    form.FormBorderStyle = getattr(WinForms.FormBorderStyle, "None")
                    form.Bounds = scr_bounds
                    form.is_fullscreen = True
                    c_round = ctypes.c_int(1)
                    no_border = ctypes.c_uint(0xFFFFFFFE)
                    black_cap = ctypes.c_uint(0x00000000)
                    dwmapi.DwmSetWindowAttribute(h, 33, ctypes.byref(c_round), ctypes.sizeof(c_round))
                    dwmapi.DwmSetWindowAttribute(h, 34, ctypes.byref(no_border), ctypes.sizeof(no_border))
                    dwmapi.DwmSetWindowAttribute(h, 35, ctypes.byref(black_cap), ctypes.sizeof(black_cap))

                _run_on_form_ui(wf, form, _enter)
            else:
                _apply_win32_chrome("HammelArt Atelier", apply_icon=False, is_fullscreen=True, hwnd=hwnd)
                w.toggle_fullscreen()

            win_state["os_fullscreen"] = True
            return {"ok": True, "fullscreen": True, "already_fullscreen": False}

        # Exiting Lightbox/Stage/Screensaver fullscreen (ignore want=False if user/boot owned app fullscreen)
        if not is_app_toggle and not win_state["lb_entered_fs"]:
            return {"ok": True, "fullscreen": cur_fs, "already_fullscreen": cur_fs}

        saved = win_state.get("saved")
        win_state["saved"] = None

        if wf is not None and form is not None:
            def _exit():
                WinForms = wf.WinForms
                dwmapi = ctypes.windll.dwmapi
                h = int(form.Handle.ToInt64())
                win_state["hwnd"] = h
                form.WindowState = WinForms.FormWindowState.Normal
                if saved is not None:
                    form.FormBorderStyle = saved["style"]
                    form.is_fullscreen = False
                    if saved["state"] == WinForms.FormWindowState.Maximized:
                        form.WindowState = WinForms.FormWindowState.Maximized
                    else:
                        form.Location = saved["location"]
                        form.Size = saved["size"]
                else:
                    ln = win_state.get("last_normal") or {}
                    nx = ln.get("x")
                    ny = ln.get("y")
                    nw = int(ln.get("width") or _DEFAULT_W)
                    nh = int(ln.get("height") or _DEFAULT_H)
                    form.FormBorderStyle = WinForms.FormBorderStyle.Sizable
                    form.is_fullscreen = False
                    if nx is not None and ny is not None:
                        form.SetBounds(int(nx), int(ny), nw, nh)
                    else:
                        form.Width = nw
                        form.Height = nh
                c_round = ctypes.c_int(0)
                dwmapi.DwmSetWindowAttribute(h, 33, ctypes.byref(c_round), ctypes.sizeof(c_round))

            _run_on_form_ui(wf, form, _exit)
            win_state["os_fullscreen"] = False
            win_state["lb_entered_fs"] = False
            _apply_win32_chrome("HammelArt Atelier", apply_icon=False, is_fullscreen=False, hwnd=win_state.get("hwnd", 0))
        else:
            if cur_fs:
                w.toggle_fullscreen()
            win_state["os_fullscreen"] = False
            win_state["lb_entered_fs"] = False
            _apply_win32_chrome("HammelArt Atelier", apply_icon=False, is_fullscreen=False, hwnd=h_cur)

        _schedule_save_window_state()
        return {"ok": True, "fullscreen": False, "already_fullscreen": False}

    def _on_restart() -> None:
        # Wait briefly in a detached helper so old WebView2 unlocks webview_profile cleanly
        vbs_path = os.path.join(LAB_ROOT, "Launch_HammelArt_Desktop.vbs")
        helper = (
            "import subprocess, time, sys\n"
            "time.sleep(1.5)\n"
        )
        if os.path.isfile(vbs_path):
            helper += f"subprocess.Popen(['wscript.exe', {vbs_path!r}], cwd={LAB_ROOT!r})\n"
        else:
            helper += f"subprocess.Popen([sys.executable, {os.path.abspath(__file__)!r}], cwd={LAB_ROOT!r})\n"
        cflags = 0x08000000 if sys.platform == "win32" else 0
        subprocess.Popen([sys.executable, "-c", helper], cwd=LAB_ROOT, creationflags=cflags)
        w = win_state.get("win")
        if w is not None:
            try:
                w.destroy()
            except Exception:
                os._exit(0)
        else:
            os._exit(0)

    srv = _ServerThread(
        args.dir,
        port,
        on_theme_change=_on_theme_change,
        on_fullscreen_toggle=_on_fullscreen_toggle,
        on_restart=_on_restart,
    )
    srv.start()
    ready_ok = srv.ready.wait(timeout=10.0)
    if not ready_ok or srv.error is not None:
        srv.stop()
        srv.join(timeout=2.0)
        raise RuntimeError(f"Local server failed to start on port {port}: {srv.error or 'startup timed out'}")

    os.makedirs(PROFILE_DIR, exist_ok=True)
    url = f"http://127.0.0.1:{port}/"

    create_kwargs: dict = {
        "width": saved_geo["width"],
        "height": saved_geo["height"],
        "min_size": (_MIN_W, _MIN_H),
        "maximized": saved_geo["mode"] == "maximized",
        "fullscreen": saved_geo["mode"] == "fullscreen",
        "background_color": "#09090c",
        "text_select": True,
    }
    if saved_geo["x"] is not None and saved_geo["y"] is not None:
        create_kwargs["x"] = saved_geo["x"]
        create_kwargs["y"] = saved_geo["y"]

    win = webview.create_window(
        "HammelArt Atelier",
        url,
        **create_kwargs,
    )
    win_state["win"] = win

    def on_shown() -> None:
        def _polish():
            time.sleep(0.12)
            wf, form = _get_winforms_form(win)
            h_cur = 0
            if wf is not None and form is not None:
                def _grab_hwnd():
                    try:
                        win_state["hwnd"] = int(form.Handle.ToInt64())
                    except Exception:
                        pass

                _run_on_form_ui(wf, form, _grab_hwnd)
                h_cur = win_state.get("hwnd", 0)
            _apply_win32_chrome(
                "HammelArt Atelier",
                apply_icon=True,
                is_fullscreen=bool(saved_geo["mode"] == "fullscreen"),
                hwnd=h_cur,
            )
            if sys.platform == "win32" and h_cur:
                try:
                    _ensure_win32_prototypes()
                    ctypes.windll.user32.ShowWindow(int(h_cur), 5)  # Safety net against SW_HIDE callers
                except Exception:
                    pass
            time.sleep(0.25)
            wf, form = _get_winforms_form(win)
            if wf is not None and form is not None:
                def _bind():
                    try:
                        win_state["hwnd"] = int(form.Handle.ToInt64())

                        def _on_geom(_sender, _args):
                            _schedule_save_window_state()

                        form.LocationChanged += _on_geom
                        form.SizeChanged += _on_geom
                    except Exception:
                        pass
                    win_state["ready_to_track"] = True

                _run_on_form_ui(wf, form, _bind)
            else:
                win_state["ready_to_track"] = True

        threading.Thread(target=_polish, daemon=True).start()

    def on_closing() -> None:
        with win_state["save_lock"]:
            old = win_state.get("save_timer")
            if old is not None:
                old.cancel()
                win_state["save_timer"] = None
        _capture_and_save_window_state()

    if win is not None:
        win.events.shown += on_shown
        win.events.closing += on_closing

    try:
        if sys.platform == "win32":
            import webview.platforms.winforms as wf  # type: ignore

            if getattr(wf, "renderer", "") != "edgechromium":
                raise RuntimeError(
                    "Microsoft Edge WebView2 Runtime is required to run HammelArt Atelier Desktop."
                )
        webview.start(
            gui="edgechromium",
            private_mode=False,
            storage_path=PROFILE_DIR,
            icon=ICON_PATH if os.path.isfile(ICON_PATH) else None,
        )
    finally:
        with win_state["save_lock"]:
            old = win_state.get("save_timer")
            if old is not None:
                old.cancel()
                win_state["save_timer"] = None
        srv.stop()
        srv.join(timeout=3.0)


def _show_fatal_desktop_error(exc: BaseException) -> None:
    log_path = os.path.join(USERDATA_DIR, "desktop_error.log")
    try:
        os.makedirs(USERDATA_DIR, exist_ok=True)
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
    except Exception:
        pass
    msg = (
        "HammelArt Atelier Desktop could not start.\n\n"
        f"Error: {exc}\n\n"
        "Fixes to try:\n"
        "1. Install Microsoft Edge WebView2 Runtime if on older Windows 10.\n"
        "2. Or run Launch_HammelArt_Browser.bat to open in your web browser.\n\n"
        f"Details saved to:\n{log_path}"
    )
    if sys.platform == "win32":
        try:
            _ensure_win32_prototypes()
            ctypes.windll.user32.MessageBoxW(None, msg, "HammelArt Atelier — Launch Error", 0x10)
            return
        except Exception:
            pass
    print(msg, file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        _show_fatal_desktop_error(exc)
        sys.exit(1)

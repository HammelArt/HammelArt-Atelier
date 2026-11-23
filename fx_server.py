"""
HammelArt Atelier Standalone Server (Port 8191)
===============================================
Serves the built React HammelArt Atelier UI (`dist/`) and local `/api/*`
media, indexer, metadata, folder-organization & Purgatory endpoints cleanly.
Zero dependency on ComfyUI installation directories.
"""

from __future__ import annotations

import argparse
import asyncio
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from urllib.parse import urlparse
import uuid
from aiohttp import web

LAB_ROOT = os.path.dirname(os.path.abspath(__file__))
if LAB_ROOT not in sys.path:
    sys.path.insert(0, LAB_ROOT)
DIST_DIR = os.path.join(LAB_ROOT, "dist")
USERDATA_DIR = os.path.join(LAB_ROOT, "userdata")
os.makedirs(USERDATA_DIR, exist_ok=True)


def _user_data_path(filename: str) -> str:
    """Returns path inside `userdata/`, seamlessly migrating legacy root JSON files."""
    target = os.path.join(USERDATA_DIR, filename)
    legacy = os.path.join(LAB_ROOT, filename)
    if not os.path.exists(target) and os.path.isfile(legacy):
        try:
            os.replace(legacy, target)
        except OSError:
            shutil.copy2(legacy, target)
    return target


ROOTS_CONFIG_PATH = _user_data_path("roots_config.json")
SESSION_STATE_PATH = _user_data_path("ui_session.json")
_SESSION_LOCK = threading.Lock()

from backend.indexer import GalleryIndexer, SUPPORTED_EXTS  # noqa: E402
from backend.updater import apply_update, check_updates  # noqa: E402


class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT),
        ("dwTime", wintypes.DWORD),
    ]


def get_windows_idle_ms() -> int:
    try:
        lii = _LASTINPUTINFO()
        lii.cbSize = ctypes.sizeof(_LASTINPUTINFO)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
            return -1
        now32 = ctypes.windll.kernel32.GetTickCount64() & 0xFFFFFFFF
        elapsed = (now32 - lii.dwTime) & 0xFFFFFFFF
        return int(elapsed)
    except Exception:
        return -1


class _SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("wFunc", ctypes.c_uint),
        ("pFrom", wintypes.LPCWSTR),
        ("pTo", wintypes.LPCWSTR),
        ("fFlags", ctypes.c_ushort),
        ("fAnyOperationsAborted", wintypes.BOOL),
        ("hNameMappings", ctypes.c_void_p),
        ("lpszProgressTitle", wintypes.LPCWSTR),
    ]


def send_to_recycle_bin(path: str) -> tuple[bool, int]:
    """Safely sends a file to the Windows Recycle Bin with zero UI prompt."""
    FO_DELETE = 3
    FOF_SILENT = 0x0004
    FOF_NOCONFIRMATION = 0x0010
    FOF_ALLOWUNDO = 0x0040
    FOF_NOERRORUI = 0x0400
    op = _SHFILEOPSTRUCTW()
    op.hwnd = None
    op.wFunc = FO_DELETE
    op.pFrom = os.path.normpath(path) + "\0\0"
    op.pTo = None
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
    op.fAnyOperationsAborted = False
    op.hNameMappings = None
    op.lpszProgressTitle = None
    rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    return (rc == 0 and not op.fAnyOperationsAborted, int(rc))


def permanent_delete_file(path: str) -> tuple[bool, str]:
    """Permanently deletes a file from disk (bypasses Windows Recycle Bin)."""
    try:
        norm = os.path.normpath(path)
        if not os.path.exists(norm):
            return (True, "already_missing")
        os.remove(norm)
        return (True, "")
    except Exception as exc:
        return (False, str(exc))


def reveal_in_explorer(path: str) -> bool:
    """Reveals & selects file in Windows Explorer natively via Win32 shell32 (no shell interpolation)."""
    norm_path = os.path.normpath(path)
    if sys.platform == "win32":
        ole32 = ctypes.windll.ole32
        shell32 = ctypes.windll.shell32
        ILCreateFromPathW = shell32.ILCreateFromPathW
        ILCreateFromPathW.argtypes = [wintypes.LPCWSTR]
        ILCreateFromPathW.restype = ctypes.c_void_p
        SHOpenFolderAndSelectItems = shell32.SHOpenFolderAndSelectItems
        SHOpenFolderAndSelectItems.argtypes = [
            ctypes.c_void_p,
            wintypes.UINT,
            ctypes.c_void_p,
            wintypes.DWORD,
        ]
        SHOpenFolderAndSelectItems.restype = ctypes.HRESULT
        ILFree = shell32.ILFree
        ILFree.argtypes = [ctypes.c_void_p]
        ILFree.restype = None

        hr_init = ole32.CoInitialize(None)
        did_com = hr_init in (0, 1)
        pidl = None
        try:
            pidl = ILCreateFromPathW(norm_path)
            if pidl:
                hr = SHOpenFolderAndSelectItems(pidl, 0, None, 0)
                if hr == 0:
                    return True
        except Exception:
            pass
        finally:
            if pidl:
                try:
                    ILFree(pidl)
                except Exception:
                    pass
            if did_com:
                try:
                    ole32.CoUninitialize()
                except Exception:
                    pass
    subprocess.Popen(["explorer.exe", f"/select,{norm_path}"])
    return True


def open_folder_in_explorer(dir_path: str) -> bool:
    """Opens a directory directly in Windows Explorer."""
    norm_dir = os.path.normpath(dir_path)
    subprocess.Popen(["explorer.exe", norm_dir])
    return True


def _make_root_id(path: str, is_first: bool = False, existing_roots: list | None = None) -> str:
    if is_first:
        return "root_1"
    abs_p = os.path.abspath(os.path.normpath(path))
    digest = hashlib.md5(abs_p.lower().encode("utf-8")).hexdigest()[:8]
    cand = f"r_{digest}"
    existing_ids = {r.get("id") for r in (existing_roots or [])}
    if cand not in existing_ids:
        return cand
    i = 2
    while f"{cand}_{i}" in existing_ids:
        i += 1
    return f"{cand}_{i}"


def _make_root_entry(path: str, root_id: str = "root_1", label: str | None = None) -> dict:
    abs_path = os.path.abspath(os.path.normpath(path))
    lbl = (label or "").strip() or os.path.basename(abs_path) or abs_path
    return {"id": root_id, "label": lbl, "path": abs_path}


def _canonical_item_key(root_id: str, subfolder: str, filename: str) -> str:
    clean_sub = (subfolder or "").replace("\\", "/").strip("/")
    if clean_sub == "(Root)":
        clean_sub = ""
    rel = f"{clean_sub}/{filename}"
    if root_id and root_id != "root_1":
        return f"{root_id}::{rel}"
    return rel


def _load_roots_config(default_dir: str | None) -> dict:
    """Loads persisted root config; seeds from default_dir on first launch if it exists."""
    if os.path.isfile(ROOTS_CONFIG_PATH):
        try:
            with open(ROOTS_CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                raw_roots = data.get("roots", [])
                roots = []
                seen_paths = set()
                if isinstance(raw_roots, list):
                    for i, entry in enumerate(raw_roots):
                        if not isinstance(entry, dict):
                            continue
                        p = str(entry.get("path", "")).strip()
                        if not p:
                            continue
                        abs_p = os.path.abspath(os.path.normpath(p))
                        norm_k = os.path.normcase(abs_p)
                        if norm_k in seen_paths:
                            continue
                        seen_paths.add(norm_k)
                        rid = str(entry.get("id") or _make_root_id(abs_p, is_first=(i == 0), existing_roots=roots))
                        lbl = str(entry.get("label") or os.path.basename(abs_p) or abs_p)
                        roots.append({"id": rid, "label": lbl, "path": abs_p})
                active_id = str(data.get("activeRootId") or (roots[0]["id"] if roots else ""))
                if roots and not any(r["id"] == active_id for r in roots):
                    active_id = roots[0]["id"]
                return {"roots": roots, "activeRootId": active_id}
        except Exception:
            pass

    if default_dir:
        candidate = os.path.abspath(os.path.normpath(default_dir))
        if os.path.isdir(candidate):
            cfg = {"roots": [_make_root_entry(candidate, "root_1")], "activeRootId": "root_1"}
            _save_roots_config(cfg)
            return cfg

    return {"roots": [], "activeRootId": ""}


def _save_roots_config(cfg: dict) -> None:
    tmp_path = f"{ROOTS_CONFIG_PATH}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        os.replace(tmp_path, ROOTS_CONFIG_PATH)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        raise


def _open_modern_folder_dialog_sync(initial_dir: str | None = None, title: str = "Select Folder for HammelArt Atelier") -> dict:
    """
    Opens the modern Windows 10/11 Explorer Folder Picker (`IFileOpenDialog` + `FOS_PICKFOLDERS`)
    directly in-process via COM in an STA thread — ZERO PowerShell / console window.
    """
    class _GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", wintypes.DWORD),
            ("Data2", wintypes.WORD),
            ("Data3", wintypes.WORD),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    ole32 = ctypes.windll.ole32
    shell32 = ctypes.windll.shell32
    user32 = ctypes.windll.user32

    ole32.CLSIDFromString.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(_GUID)]
    ole32.CLSIDFromString.restype = ctypes.c_long
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]

    CLSID_FileOpenDialog = _GUID()
    IID_IFileOpenDialog = _GUID()
    IID_IShellItem = _GUID()
    ole32.CLSIDFromString("{DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7}", ctypes.byref(CLSID_FileOpenDialog))
    ole32.CLSIDFromString("{D57C7288-D4AD-4768-BE02-9D969532D960}", ctypes.byref(IID_IFileOpenDialog))
    ole32.CLSIDFromString("{43826D1E-E718-42EE-BC55-A1E261C37BFE}", ctypes.byref(IID_IShellItem))

    hr_init = ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED
    did_init = hr_init in (0, 1)  # S_OK or S_FALSE
    p_dlg = ctypes.c_void_p()
    p_init_si = ctypes.c_void_p()
    p_res_si = ctypes.c_void_p()

    def _release(ptr):
        if ptr and ptr.value:
            vtbl = ctypes.cast(ctypes.cast(ptr, ctypes.POINTER(ctypes.c_void_p))[0], ctypes.POINTER(ctypes.c_void_p))
            ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtbl[2])(ptr)

    try:
        hr = ole32.CoCreateInstance(
            ctypes.byref(CLSID_FileOpenDialog),
            None,
            1,  # CLSCTX_INPROC_SERVER
            ctypes.byref(IID_IFileOpenDialog),
            ctypes.byref(p_dlg),
        )
        if hr != 0 or not p_dlg.value:
            return {"ok": False, "cancelled": False, "error": f"CoCreateInstance failed (0x{hr & 0xFFFFFFFF:08X})"}

        vtbl = ctypes.cast(ctypes.cast(p_dlg, ctypes.POINTER(ctypes.c_void_p))[0], ctypes.POINTER(ctypes.c_void_p))
        Show = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.HWND)(vtbl[3])
        SetOptions = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.DWORD)(vtbl[9])
        GetOptions = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD))(vtbl[10])
        SetFolder = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p)(vtbl[12])
        SetTitle = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.LPCWSTR)(vtbl[17])
        GetResult = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(vtbl[20])

        opts = wintypes.DWORD(0)
        GetOptions(p_dlg, ctypes.byref(opts))
        FOS_PICKFOLDERS = 0x00000020
        FOS_FORCEFILESYSTEM = 0x00000040
        SetOptions(p_dlg, opts.value | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
        SetTitle(p_dlg, title)

        if initial_dir and os.path.isdir(initial_dir):
            hr_si = shell32.SHCreateItemFromParsingName(
                os.path.abspath(initial_dir), None, ctypes.byref(IID_IShellItem), ctypes.byref(p_init_si)
            )
            if hr_si == 0 and p_init_si.value:
                SetFolder(p_dlg, p_init_si)

        hwnd_owner = user32.GetForegroundWindow()
        hr_show = Show(p_dlg, hwnd_owner)
        if hr_show in (-2147023673, 0x800704C7):  # HRESULT_FROM_WIN32(ERROR_CANCELLED)
            return {"ok": True, "cancelled": True, "path": ""}
        if hr_show != 0:
            return {"ok": False, "cancelled": False, "error": f"Folder dialog failed (0x{hr_show & 0xFFFFFFFF:08X})"}

        hr_res = GetResult(p_dlg, ctypes.byref(p_res_si))
        if hr_res != 0 or not p_res_si.value:
            return {"ok": True, "cancelled": True, "path": ""}

        si_vtbl = ctypes.cast(ctypes.cast(p_res_si, ctypes.POINTER(ctypes.c_void_p))[0], ctypes.POINTER(ctypes.c_void_p))
        GetDisplayName = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p))(si_vtbl[5])
        p_path_str = ctypes.c_void_p()
        SIGDN_FILESYSPATH = 0x80058000
        hr_dn = GetDisplayName(p_res_si, SIGDN_FILESYSPATH, ctypes.byref(p_path_str))
        if hr_dn == 0 and p_path_str.value:
            chosen = ctypes.wstring_at(p_path_str.value)
            ole32.CoTaskMemFree(p_path_str)
            if chosen and os.path.isdir(chosen):
                return {"ok": True, "cancelled": False, "path": os.path.abspath(chosen)}
        return {"ok": True, "cancelled": True, "path": ""}
    except Exception as exc:
        return {"ok": False, "cancelled": False, "error": str(exc)}
    finally:
        _release(p_res_si)
        _release(p_init_si)
        _release(p_dlg)
        if did_init:
            ole32.CoUninitialize()


def browse_windows_folder(initial_dir: str | None = None) -> dict:
    """Opens a silent modern Windows 11 Explorer Folder Picker inside an STA worker thread."""
    if sys.platform != "win32":
        return {"ok": False, "cancelled": False, "error": "Folder dialog only supported on Windows"}

    result_box: dict = {"result": None}

    def _run_sta():
        result_box["result"] = _open_modern_folder_dialog_sync(initial_dir)

    th = threading.Thread(target=_run_sta, daemon=True)
    th.start()
    th.join(timeout=180)
    if result_box["result"] is None:
        return {"ok": False, "cancelled": True, "error": "Folder dialog timed out"}
    return result_box["result"]


_RESERVED_WIN_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


def _is_reserved_win_name(name: str) -> bool:
    stem = os.path.splitext(name.strip())[0].upper()
    return stem in _RESERVED_WIN_NAMES


@web.middleware
async def _localhost_security_middleware(request: web.Request, handler):
    sockname = request.transport.get_extra_info("sockname") if request.transport else None
    bound_port = sockname[1] if isinstance(sockname, tuple) and len(sockname) >= 2 else None
    host_hdr = (request.headers.get("Host") or "").strip().lower()
    if not host_hdr:
        return web.json_response({"ok": False, "error": "Missing Host header"}, status=403)
    if bound_port is not None:
        allowed_hosts = {f"127.0.0.1:{bound_port}", f"localhost:{bound_port}"}
        if host_hdr not in allowed_hosts:
            return web.json_response({"ok": False, "error": "Forbidden Host"}, status=403)
    else:
        parsed_host = host_hdr.split(":", 1)[0]
        if parsed_host not in ("127.0.0.1", "localhost"):
            return web.json_response({"ok": False, "error": "Forbidden Host"}, status=403)

    if request.method not in ("GET", "HEAD", "OPTIONS"):
        sec_fetch = (request.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if sec_fetch and sec_fetch not in ("same-origin", "none"):
            return web.json_response({"ok": False, "error": "Forbidden cross-site request"}, status=403)
        origin = (request.headers.get("Origin") or "").strip()
        if origin:
            try:
                parsed = urlparse(origin)
                origin_ok = (
                    parsed.scheme == "http"
                    and (parsed.hostname or "").lower() in ("127.0.0.1", "localhost")
                    and (bound_port is None or parsed.port == bound_port)
                )
            except Exception:
                origin_ok = False
            if not origin_ok:
                return web.json_response({"ok": False, "error": "Forbidden Origin"}, status=403)

    return await handler(request)


def create_app(
    output_dir: str | None = None,
    on_theme_change=None,
    on_fullscreen_toggle=None,
    on_restart=None,
) -> web.Application:
    app = web.Application(
        middlewares=[_localhost_security_middleware],
        client_max_size=512 * 1024 * 1024,
    )
    cfg = _load_roots_config(output_dir)

    def _build_indexers(roots: list[dict]) -> dict[str, GalleryIndexer]:
        out: dict[str, GalleryIndexer] = {}
        for r in roots:
            rid = r.get("id", "")
            path = r.get("path", "")
            if rid and path and os.path.isdir(path):
                out[rid] = GalleryIndexer(output_dir=path, sandbox_readonly=True)
        return out

    state: dict = {
        "roots": cfg["roots"],
        "active_root_id": cfg["activeRootId"],
        "indexers": _build_indexers(cfg["roots"]),
        "warmup_task": None,
        "watcher_task": None,
        "watcher_baseline": None,
        "library_rev": 0,
        "event_queues": set(),
        "scan_status": {
            "active": False,
            "rootLabel": "",
            "scanned": 0,
            "total": 0,
            "phase": "idle",
        },
    }

    def _broadcast_library_change(added_count: int = 0, removed_count: int = 0) -> None:
        state["library_rev"] += 1
        payload = json.dumps(
            {
                "rev": state["library_rev"],
                "added": int(added_count),
                "removed": int(removed_count),
            }
        )
        dead: list[asyncio.Queue] = []
        for q in list(state["event_queues"]):
            try:
                if q.full():
                    try:
                        q.get_nowait()
                    except Exception:
                        pass
                q.put_nowait(("library-changed", payload))
            except Exception:
                dead.append(q)
        for q in dead:
            state["event_queues"].discard(q)

    def _snapshot_mounted_roots() -> tuple[dict[tuple[str, str], tuple[int, int]], set[tuple[str, str]]]:
        """Fast os.scandir snapshot of mounted roots for debounced change detection."""
        files: dict[tuple[str, str], tuple[int, int]] = {}
        dirs: set[tuple[str, str]] = set()
        for rid, idx in list(state["indexers"].items()):
            root_path = idx.output_dir
            if not root_path or not os.path.isdir(root_path):
                continue
            stack = [(root_path, "")]
            while stack:
                cur_dir, rel = stack.pop()
                try:
                    with os.scandir(cur_dir) as it:
                        for entry in it:
                            name = entry.name
                            if not name or name.startswith(".") or ".hm_tmp_" in name:
                                continue
                            if name.endswith((".tmp", ".part", ".crdownload")):
                                continue
                            rel_item = f"{rel}/{name}" if rel else name
                            if entry.is_dir(follow_symlinks=False):
                                dirs.add((rid, rel_item))
                                stack.append((entry.path, rel_item))
                            elif entry.is_file(follow_symlinks=False):
                                _, ext = os.path.splitext(name)
                                if ext.lower() not in SUPPORTED_EXTS:
                                    continue
                                st = entry.stat(follow_symlinks=False)
                                files[(rid, rel_item)] = (int(st.st_mtime_ns), int(st.st_size))
                except OSError:
                    continue
        return files, dirs

    def _check_changed_files_readable(changed_items: list[tuple[str, str]]) -> bool:
        """Verify newly created/modified media files are no longer exclusively write-locked."""
        for rid, rel_item in changed_items[:12]:
            idx = state["indexers"].get(rid)
            if not idx:
                continue
            full_path = os.path.join(idx.output_dir, rel_item.replace("/", os.sep))
            if not os.path.isfile(full_path):
                continue
            try:
                with open(full_path, "rb") as f:
                    f.read(1)
            except OSError:
                return False
        return True

    async def _sync_watcher_baseline() -> None:
        if state["event_queues"]:
            state["watcher_baseline"] = await asyncio.to_thread(_snapshot_mounted_roots)
        else:
            state["watcher_baseline"] = None

    async def _folder_watcher_loop() -> None:
        try:
            while True:
                await asyncio.sleep(2.0)
                if not state["event_queues"] or not state["indexers"] or state["scan_status"].get("active"):
                    if not state["event_queues"]:
                        state["watcher_baseline"] = None
                    continue
                try:
                    if state["watcher_baseline"] is None:
                        state["watcher_baseline"] = await asyncio.to_thread(_snapshot_mounted_roots)
                        continue
                    last_committed = state["watcher_baseline"]
                    curr = await asyncio.to_thread(_snapshot_mounted_roots)
                    if curr == last_committed:
                        continue

                    # Debounce & wait for active external writes (e.g. PNG/MP4 flushes) to settle
                    settled = False
                    prev_probe = curr
                    for _attempt in range(6):
                        await asyncio.sleep(0.55)
                        if state["scan_status"].get("active"):
                            break
                        next_probe = await asyncio.to_thread(_snapshot_mounted_roots)
                        if next_probe == prev_probe:
                            prev_files, _ = last_committed
                            cur_files, _ = next_probe
                            changed_keys = [
                                k for k, meta in cur_files.items() if prev_files.get(k) != meta
                            ]
                            if not changed_keys or await asyncio.to_thread(
                                _check_changed_files_readable, changed_keys
                            ):
                                curr = next_probe
                                settled = True
                                break
                        prev_probe = next_probe
                    if not settled:
                        curr = prev_probe

                    last_committed = state["watcher_baseline"] or last_committed
                    if curr == last_committed:
                        continue
                    prev_files, _ = last_committed
                    cur_files, _ = curr
                    added_cnt = sum(1 for k in cur_files if k not in prev_files)
                    removed_cnt = sum(1 for k in prev_files if k not in cur_files)
                    state["watcher_baseline"] = curr
                    _broadcast_library_change(added_cnt, removed_cnt)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    continue
        except asyncio.CancelledError:
            return

    def _schedule_warmup(idx_scans: list[tuple[GalleryIndexer, list[dict]]]) -> None:
        old_task = state.get("warmup_task")
        if old_task is not None and not old_task.done():
            old_task.cancel()

        candidates: list[tuple[float, GalleryIndexer, str, str]] = []
        for idx, images in idx_scans:
            if idx is None or not images:
                continue
            for it in images:
                fn = it.get("filename", "")
                if not fn:
                    continue
                sub = it.get("subfolder") or ""
                mtime = float(it.get("mtime", 0) or 0)
                candidates.append((mtime, idx, sub, fn))

        if not candidates:
            state["warmup_task"] = None
            return

        candidates.sort(key=lambda row: row[0], reverse=True)

        async def _warmup_runner() -> None:
            try:
                await asyncio.sleep(1.2)
                for mtime, idx, sub, fn in candidates:
                    if idx not in state["indexers"].values():
                        continue
                    if idx.has_cached_thumbnail(sub, fn, mtime, max_edge=360):
                        continue
                    while any(
                        active_idx._live_thumb_inflight > 0
                        or (time.monotonic() - active_idx._last_live_thumb_ts) < 0.85
                        for active_idx in list(state["indexers"].values())
                    ):
                        await asyncio.sleep(0.25)
                    if idx not in state["indexers"].values():
                        continue
                    try:
                        await idx.get_or_create_thumbnail(sub, fn, max_edge=360, live=False)
                    except Exception:
                        pass
                    await asyncio.sleep(0.015)
            except asyncio.CancelledError:
                return

        state["warmup_task"] = asyncio.create_task(_warmup_runner())

    def _begin_scan_status(label: str) -> None:
        state["scan_status"] = {
            "active": True,
            "rootLabel": label,
            "scanned": 0,
            "total": 0,
            "phase": "discovering",
        }

    def _update_scan_status(label: str, scanned: int, total: int) -> None:
        state["scan_status"] = {
            "active": True,
            "rootLabel": label,
            "scanned": int(scanned),
            "total": int(total),
            "phase": "indexing" if total > 0 else "discovering",
        }

    def _end_scan_status() -> None:
        state["scan_status"] = {
            "active": False,
            "rootLabel": "",
            "scanned": 0,
            "total": 0,
            "phase": "idle",
        }

    def _resolve_indexer(root_id: str | None = None) -> tuple[str, GalleryIndexer | None]:
        rid = (root_id or "").strip()
        if rid and rid in state["indexers"]:
            return rid, state["indexers"][rid]
        active_id = state["active_root_id"]
        if active_id and active_id in state["indexers"]:
            return active_id, state["indexers"][active_id]
        if state["roots"]:
            first_id = state["roots"][0]["id"]
            if first_id in state["indexers"]:
                return first_id, state["indexers"][first_id]
        for k, v in state["indexers"].items():
            return k, v
        return "", None

    def _active_root_path() -> str:
        _, idx = _resolve_indexer(None)
        if idx:
            return idx.output_dir
        rid = state["active_root_id"]
        hit = next((r for r in state["roots"] if r.get("id") == rid), None)
        return hit["path"] if hit else (state["roots"][0]["path"] if state["roots"] else "")

    def _persist_state() -> None:
        _save_roots_config({"roots": state["roots"], "activeRootId": state["active_root_id"]})

    def _load_session_snapshot_unlocked() -> dict[str, str]:
        if os.path.isfile(SESSION_STATE_PATH):
            try:
                with open(SESSION_STATE_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                raw = data.get("storage") if isinstance(data, dict) and isinstance(data.get("storage"), dict) else data
                if isinstance(raw, dict):
                    return {str(k): str(v) for k, v in raw.items() if isinstance(k, str) and isinstance(v, str)}
            except Exception:
                pass
        return {}

    def _load_session_state_sync() -> dict[str, str]:
        with _SESSION_LOCK:
            return _load_session_snapshot_unlocked()

    def _save_session_state_sync(storage: dict, replace: bool = False) -> dict:
        with _SESSION_LOCK:
            merged: dict[str, str] = {} if replace else _load_session_snapshot_unlocked()
            for k, v in (storage or {}).items():
                if not isinstance(k, str):
                    continue
                if v is None:
                    merged.pop(k, None)
                else:
                    merged[k] = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
            tmp_path = f"{SESSION_STATE_PATH}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
            try:
                with open(tmp_path, "w", encoding="utf-8") as f:
                    json.dump({"version": 1, "storage": merged}, f, indent=2, ensure_ascii=False)
                os.replace(tmp_path, SESSION_STATE_PATH)
            except Exception:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                raise
            return merged

    routes = web.RouteTableDef()

    @routes.get("/api/session-state")
    async def api_get_session_state(request: web.Request) -> web.Response:
        storage = await asyncio.to_thread(_load_session_state_sync)
        return web.json_response({"ok": True, "storage": storage})

    @routes.post("/api/session-state")
    async def api_save_session_state(request: web.Request) -> web.Response:
        try:
            raw_text = await request.text()
            body = json.loads(raw_text) if raw_text else {}
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        if not isinstance(body, dict):
            return web.json_response({"ok": False, "error": "Expected JSON object"}, status=400)
        storage = body.get("storage") if isinstance(body.get("storage"), dict) else body
        replace = bool(body.get("replace", False))
        saved = await asyncio.to_thread(_save_session_state_sync, storage, replace)
        if on_theme_change is not None and any(
            k in storage for k in ("argon_cb_accent_id_v1", "argon_cb_stage_mode_v1")
        ):
            try:
                on_theme_change(
                    saved.get("argon_cb_stage_mode_v1", "dark"),
                    saved.get("argon_cb_accent_id_v1", "cyber_violet"),
                )
            except Exception:
                pass
        return web.json_response({"ok": True, "count": len(saved)})

    @routes.get("/api/roots")
    async def api_get_roots(request: web.Request) -> web.Response:
        return web.json_response(
            {
                "ok": True,
                "roots": state["roots"],
                "activeRootId": state["active_root_id"],
                "activeRootPath": _active_root_path(),
                "needsSetup": len(state["roots"]) == 0 or len(state["indexers"]) == 0,
            }
        )

    @routes.get("/api/roots/scan-status")
    async def api_scan_status(request: web.Request) -> web.Response:
        return web.json_response({"ok": True, **state["scan_status"]})

    @routes.post("/api/roots/browse")
    async def api_browse_root(request: web.Request) -> web.Response:
        initial = _active_root_path() or (output_dir or "")
        try:
            body = await request.json()
            if isinstance(body, dict) and body.get("initialDir"):
                initial = str(body.get("initialDir"))
        except Exception:
            pass
        result = await asyncio.to_thread(browse_windows_folder, initial)
        return web.json_response(result)

    @routes.post("/api/roots/set-first")
    async def api_set_first_root(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        raw_path = str(body.get("path", "")).strip().strip('"')
        if not raw_path:
            return web.json_response({"ok": False, "error": "Please enter or browse to a folder path."}, status=400)
        abs_path = os.path.abspath(os.path.normpath(raw_path))
        if not await asyncio.to_thread(os.path.isdir, abs_path):
            return web.json_response({"ok": False, "error": f"Folder does not exist: {abs_path}"}, status=400)

        entry = _make_root_entry(abs_path, "root_1")
        existing_others = [
            r
            for r in state["roots"]
            if r.get("id") != "root_1" and os.path.normcase(r.get("path", "")) != os.path.normcase(abs_path)
        ]
        new_roots = [entry] + existing_others
        state["roots"] = new_roots
        state["active_root_id"] = "root_1"
        old_idx = state["indexers"].pop("root_1", None)
        if old_idx is not None:
            old_idx.close()
        state["indexers"]["root_1"] = GalleryIndexer(output_dir=abs_path, sandbox_readonly=True)
        await asyncio.to_thread(_persist_state)

        _begin_scan_status(entry["label"])
        try:
            scan = await state["indexers"]["root_1"].scan_and_index(
                progress_cb=lambda s, t: _update_scan_status(entry["label"], s, t)
            )
        finally:
            _end_scan_status()
        await _sync_watcher_baseline()
        _schedule_warmup([(state["indexers"]["root_1"], scan.get("images", []))])
        return web.json_response(
            {
                "ok": True,
                "roots": state["roots"],
                "activeRootId": state["active_root_id"],
                "activeRootPath": abs_path,
                "imageCount": len(scan.get("images", [])),
                "folderCount": len(scan.get("folders", [])),
            }
        )

    @routes.post("/api/roots/add")
    async def api_add_root(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        raw_path = str(body.get("path", "")).strip().strip('"')
        custom_label = str(body.get("label", "")).strip()
        if not raw_path:
            return web.json_response({"ok": False, "error": "Please choose or enter a valid folder path."}, status=400)
        abs_path = os.path.abspath(os.path.normpath(raw_path))
        if not await asyncio.to_thread(os.path.isdir, abs_path):
            return web.json_response({"ok": False, "error": f"Folder does not exist: {abs_path}"}, status=400)

        norm_target = os.path.normcase(abs_path)
        dup = next((r for r in state["roots"] if os.path.normcase(r.get("path", "")) == norm_target), None)
        if dup:
            return web.json_response(
                {"ok": False, "error": f"Folder is already mounted as '{dup['label']}'."},
                status=400,
            )

        rid = _make_root_id(abs_path, is_first=(len(state["roots"]) == 0), existing_roots=state["roots"])
        entry = _make_root_entry(abs_path, rid, label=custom_label or None)
        state["roots"].append(entry)
        if not state["active_root_id"]:
            state["active_root_id"] = rid
        idx = GalleryIndexer(output_dir=abs_path, sandbox_readonly=True)
        state["indexers"][rid] = idx
        await asyncio.to_thread(_persist_state)

        _begin_scan_status(entry["label"])
        try:
            scan = await idx.scan_and_index(
                progress_cb=lambda s, t: _update_scan_status(entry["label"], s, t)
            )
        finally:
            _end_scan_status()
        await _sync_watcher_baseline()
        _schedule_warmup([(idx, scan.get("images", []))])
        return web.json_response(
            {
                "ok": True,
                "root": entry,
                "roots": state["roots"],
                "activeRootId": state["active_root_id"],
                "activeRootPath": _active_root_path(),
                "imageCount": len(scan.get("images", [])),
                "folderCount": len(scan.get("folders", [])),
            }
        )

    @routes.post("/api/roots/remove")
    async def api_remove_root(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        rid = str(body.get("rootId", "")).strip()
        if not rid or not any(r.get("id") == rid for r in state["roots"]):
            return web.json_response({"ok": False, "error": "Root folder not found"}, status=404)

        state["roots"] = [r for r in state["roots"] if r.get("id") != rid]
        old_idx = state["indexers"].pop(rid, None)
        if old_idx is not None:
            old_idx.close()
        if state["active_root_id"] == rid:
            state["active_root_id"] = state["roots"][0]["id"] if state["roots"] else ""
        await asyncio.to_thread(_persist_state)
        await _sync_watcher_baseline()
        return web.json_response(
            {
                "ok": True,
                "removedRootId": rid,
                "roots": state["roots"],
                "activeRootId": state["active_root_id"],
                "activeRootPath": _active_root_path(),
            }
        )

    @routes.post("/api/roots/reorder")
    async def api_reorder_roots(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        root_ids = body.get("rootIds", [])
        if not isinstance(root_ids, list):
            return web.json_response({"ok": False, "error": "rootIds must be a list"}, status=400)
        by_id = {r["id"]: r for r in state["roots"]}
        reordered = [by_id[rid] for rid in root_ids if rid in by_id]
        seen = {r["id"] for r in reordered}
        for r in state["roots"]:
            if r["id"] not in seen:
                reordered.append(r)
        state["roots"] = reordered
        await asyncio.to_thread(_persist_state)
        return web.json_response({"ok": True, "roots": state["roots"]})

    @routes.get("/api/images")
    async def api_images(request: web.Request) -> web.Response:
        if not state["roots"] or not state["indexers"]:
            return web.json_response(
                {
                    "images": [],
                    "folders": [],
                    "folders_by_root": {},
                    "scoped_folders": [],
                    "roots": state["roots"],
                    "active_root_id": state["active_root_id"],
                    "active_root_path": _active_root_path(),
                    "needs_setup": True,
                }
            )

        active_entries = [
            (r, state["indexers"].get(r["id"]))
            for r in state["roots"]
            if state["indexers"].get(r["id"]) is not None
        ]
        _begin_scan_status(active_entries[0][0]["label"] if len(active_entries) == 1 else f"{len(active_entries)} root libraries")
        try:
            root_totals = {r["id"]: (0, 0) for r, _ in active_entries}

            def _make_cb(rid: str, rlabel: str):
                def _cb(s: int, t: int):
                    root_totals[rid] = (s, t)
                    tot_s = sum(v[0] for v in root_totals.values())
                    tot_t = sum(v[1] for v in root_totals.values())
                    _update_scan_status(rlabel, tot_s, tot_t)
                return _cb

            scans = await asyncio.gather(
                *(idx.scan_and_index(progress_cb=_make_cb(r["id"], r["label"])) for r, idx in active_entries)
            )
        finally:
            _end_scan_status()

        all_images: list[dict] = []
        folders_by_root: dict[str, list[str]] = {}
        scoped_folders: list[str] = []
        primary_folders: list[str] = []

        for i, ((root_entry, _idx), scan) in enumerate(zip(active_entries, scans)):
            rid = root_entry["id"]
            rlabel = root_entry["label"]
            rf = list(scan.get("folders", []))
            folders_by_root[rid] = rf
            if i == 0:
                primary_folders = rf
            for sub in rf:
                scoped_folders.append(f"{rid}::{sub}")
            for it in scan.get("images", []):
                rec = dict(it)
                rec["root_id"] = rid
                rec["root_label"] = rlabel
                sub = rec.get("subfolder") or ""
                rec["id"] = _canonical_item_key(rid, sub, rec["filename"])
                rec["scoped_subfolder"] = f"{rid}::{sub or '(Root)'}"
                all_images.append(rec)

        all_images.sort(key=lambda x: x.get("mtime", 0), reverse=True)
        await _sync_watcher_baseline()
        _schedule_warmup([
            (idx, scan.get("images", []))
            for (_root_entry, idx), scan in zip(active_entries, scans)
        ])
        return web.json_response(
            {
                "images": all_images,
                "folders": primary_folders,
                "folders_by_root": folders_by_root,
                "scoped_folders": scoped_folders,
                "roots": state["roots"],
                "active_root_id": state["active_root_id"],
                "active_root_path": _active_root_path(),
                "needs_setup": False,
            }
        )

    @routes.get("/api/thumbnail")
    async def api_thumbnail(request: web.Request) -> web.StreamResponse:
        root_id = request.rel_url.query.get("root_id", "")
        _, idx = _resolve_indexer(root_id)
        if idx is None:
            return web.Response(status=404)
        filename = request.rel_url.query.get("filename", "")
        subfolder = request.rel_url.query.get("subfolder", "")
        raw_max = request.rel_url.query.get("max", "")
        try:
            max_edge = int(raw_max) if raw_max else 640
        except Exception:
            max_edge = 640
        thumb_path = await idx.get_or_create_thumbnail(subfolder, filename, max_edge=max_edge, live=True)
        if thumb_path and os.path.exists(thumb_path):
            return web.FileResponse(thumb_path, headers={"Cache-Control": "public, max-age=86400"})
        return web.Response(status=404)

    @routes.get("/api/media")
    async def api_media(request: web.Request) -> web.StreamResponse:
        root_id = request.rel_url.query.get("root_id", "")
        _, idx = _resolve_indexer(root_id)
        if idx is None:
            return web.Response(status=404)
        filename = request.rel_url.query.get("filename", "")
        subfolder = request.rel_url.query.get("subfolder", "")
        full_path = idx.resolve_safe_path(subfolder, filename, require_supported_ext=True)
        if full_path and os.path.exists(full_path) and os.path.isfile(full_path):
            return web.FileResponse(full_path)
        return web.Response(status=404)

    @routes.post("/api/open-explorer")
    async def api_open_explorer(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        root_id = str(body.get("root_id", ""))
        _, idx = _resolve_indexer(root_id)
        if idx is None:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        filename = str(body.get("filename", ""))
        subfolder = str(body.get("subfolder", ""))
        full_path = idx.resolve_safe_path(subfolder, filename, require_supported_ext=True)
        if not full_path or not await asyncio.to_thread(os.path.isfile, full_path):
            return web.json_response({"ok": False, "error": "File not found"}, status=404)

        await asyncio.to_thread(reveal_in_explorer, full_path)
        return web.json_response({"ok": True})

    @routes.post("/api/delete")
    async def api_delete(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        root_id = str(body.get("root_id", ""))
        _, idx = _resolve_indexer(root_id)
        if idx is None:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        filename = str(body.get("filename", ""))
        subfolder = str(body.get("subfolder", ""))
        permanent = bool(body.get("permanent", False))
        full_path = idx.resolve_safe_path(subfolder, filename, require_supported_ext=True)
        if not full_path or not await asyncio.to_thread(os.path.isfile, full_path):
            return web.json_response({"ok": False, "error": "File not found"}, status=404)
        if permanent:
            ok, err = await asyncio.to_thread(permanent_delete_file, full_path)
            if not ok:
                return web.json_response({"ok": False, "error": f"Erase failed: {err}"}, status=500)
            await _sync_watcher_baseline()
            return web.json_response({"ok": True, "permanent": True})
        ok, rc = await asyncio.to_thread(send_to_recycle_bin, full_path)
        if not ok:
            return web.json_response({"ok": False, "error": f"SHFileOperation failed ({rc})"}, status=500)
        await _sync_watcher_baseline()
        return web.json_response({"ok": True, "recycled": True})

    @routes.post("/api/delete-batch")
    async def api_delete_batch(request: web.Request) -> web.Response:
        if not state["indexers"]:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        items = body.get("items", [])
        if not isinstance(items, list):
            return web.json_response({"ok": False, "error": "items must be a list"}, status=400)
        permanent = bool(body.get("permanent", True))
        deleted = []
        failed = []
        for entry in items:
            if not isinstance(entry, dict):
                continue
            rid, idx = _resolve_indexer(str(entry.get("root_id", "")))
            filename = str(entry.get("filename", ""))
            subfolder = str(entry.get("subfolder", ""))
            key = str(entry.get("key") or _canonical_item_key(rid, subfolder, filename))
            if idx is None:
                failed.append({"key": key, "error": "Root not mounted"})
                continue
            full_path = idx.resolve_safe_path(subfolder, filename, require_supported_ext=True)
            if not full_path:
                failed.append({"key": key, "error": "Invalid path"})
                continue
            if not await asyncio.to_thread(os.path.isfile, full_path):
                deleted.append(key)
                continue
            if permanent:
                ok, err = await asyncio.to_thread(permanent_delete_file, full_path)
                if ok:
                    deleted.append(key)
                else:
                    failed.append({"key": key, "error": err})
            else:
                ok, rc = await asyncio.to_thread(send_to_recycle_bin, full_path)
                if ok:
                    deleted.append(key)
                else:
                    failed.append({"key": key, "error": f"SHFileOperation ({rc})"})
        if deleted:
            await _sync_watcher_baseline()
        return web.json_response({"ok": len(failed) == 0 or len(deleted) > 0, "deleted": deleted, "failed": failed})

    def _clean_subfolder(raw_sub: str) -> str | None:
        s = str(raw_sub or "").replace("\\", "/").strip("/")
        if s in ("", "(Root)"):
            return ""
        parts = [p for p in s.split("/") if p]
        if any(p in (".", "..") or ":" in p or "\x00" in p for p in parts):
            return None
        return "/".join(parts)

    def _resolve_safe_dir(idx: GalleryIndexer | None, clean_sub: str) -> str | None:
        if idx is None:
            return None
        base_abs = os.path.abspath(idx.output_dir)
        if os.path.islink(base_abs):
            return None
        parts = [p for p in clean_sub.split("/") if p] if clean_sub else []
        cur = base_abs
        for p in parts:
            cur = os.path.join(cur, p)
            if os.path.islink(cur):
                return None
        base_real = os.path.normcase(os.path.realpath(base_abs))
        target_real = os.path.normcase(os.path.realpath(cur))
        try:
            if os.path.commonpath([base_real, target_real]) != base_real:
                return None
        except Exception:
            return None
        return os.path.realpath(cur) if os.path.exists(cur) else cur

    @routes.post("/api/create-folder")
    async def api_create_folder(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        rid, idx = _resolve_indexer(str(body.get("rootId") or body.get("root_id") or ""))
        if idx is None:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        parent = _clean_subfolder(body.get("parentSubfolder", ""))
        raw_name = str(body.get("name", "")).strip()
        safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", raw_name).strip(". ")
        if parent is None or not safe_name or safe_name in (".", "..") or _is_reserved_win_name(safe_name):
            return web.json_response({"ok": False, "error": "Invalid or reserved folder name"}, status=400)
        clean_sub = f"{parent}/{safe_name}" if parent else safe_name
        full_dir = _resolve_safe_dir(idx, clean_sub)
        if not full_dir:
            return web.json_response({"ok": False, "error": "Unsafe folder path"}, status=400)
        await asyncio.to_thread(os.makedirs, full_dir, exist_ok=True)
        await _sync_watcher_baseline()
        return web.json_response({"ok": True, "rootId": rid, "subfolder": clean_sub, "scopedSubfolder": f"{rid}::{clean_sub}"})

    @routes.post("/api/open-explorer-folder")
    async def api_open_explorer_folder(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        rid, idx = _resolve_indexer(str(body.get("rootId") or body.get("root_id") or ""))
        if idx is None:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        clean_sub = _clean_subfolder(body.get("subfolder", ""))
        if clean_sub is None:
            return web.json_response({"ok": False, "error": "Invalid folder path"}, status=400)
        full_dir = _resolve_safe_dir(idx, clean_sub)
        if not full_dir or not await asyncio.to_thread(os.path.isdir, full_dir):
            return web.json_response(
                {"ok": False, "notFound": True, "error": "Folder not found"}, status=404
            )
        await asyncio.to_thread(open_folder_in_explorer, full_dir)
        return web.json_response({"ok": True})

    @routes.post("/api/rename-folder")
    async def api_rename_folder(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        rid, idx = _resolve_indexer(str(body.get("rootId") or body.get("root_id") or ""))
        if idx is None:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        old_sub = _clean_subfolder(body.get("subfolder", ""))
        if not old_sub:
            return web.json_response({"ok": False, "error": "Cannot rename root folder"}, status=400)
        raw_name = str(body.get("newName") or body.get("name") or "").strip()
        safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", raw_name).strip(". ")
        if not safe_name or safe_name in (".", "..") or _is_reserved_win_name(safe_name):
            return web.json_response({"ok": False, "error": "Invalid or reserved folder name"}, status=400)
        parts = old_sub.split("/")
        parent = "/".join(parts[:-1])
        new_sub = f"{parent}/{safe_name}" if parent else safe_name
        if new_sub == old_sub:
            return web.json_response(
                {
                    "ok": True,
                    "rootId": rid,
                    "oldSubfolder": old_sub,
                    "newSubfolder": new_sub,
                    "oldScoped": f"{rid}::{old_sub}",
                    "newScoped": f"{rid}::{new_sub}",
                }
            )
        old_dir = _resolve_safe_dir(idx, old_sub)
        new_dir = _resolve_safe_dir(idx, new_sub)
        base_dir = os.path.realpath(idx.output_dir)
        if not old_dir or not new_dir or old_dir == base_dir or new_dir == base_dir:
            return web.json_response({"ok": False, "error": "Unsafe folder path"}, status=400)
        if not await asyncio.to_thread(os.path.isdir, old_dir):
            return web.json_response(
                {"ok": False, "notFound": True, "error": "Folder not found on disk"}, status=404
            )
        if os.path.exists(new_dir) and os.path.normcase(old_dir) != os.path.normcase(new_dir):
            return web.json_response({"ok": False, "error": f'Folder "{safe_name}" already exists'}, status=409)
        try:
            await asyncio.to_thread(os.rename, old_dir, new_dir)
        except Exception as exc:
            return web.json_response({"ok": False, "error": f"Rename failed: {exc}"}, status=500)
        await _sync_watcher_baseline()
        return web.json_response(
            {
                "ok": True,
                "rootId": rid,
                "oldSubfolder": old_sub,
                "newSubfolder": new_sub,
                "oldScoped": f"{rid}::{old_sub}",
                "newScoped": f"{rid}::{new_sub}",
            }
        )

    @routes.post("/api/delete-folder")
    async def api_delete_folder(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        rid, idx = _resolve_indexer(str(body.get("rootId") or body.get("root_id") or ""))
        if idx is None:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        clean_sub = _clean_subfolder(body.get("subfolder", ""))
        if not clean_sub:
            return web.json_response({"ok": False, "error": "Cannot delete root folder"}, status=400)
        full_dir = _resolve_safe_dir(idx, clean_sub)
        base_dir = os.path.realpath(idx.output_dir)
        if not full_dir or full_dir == base_dir:
            return web.json_response({"ok": False, "error": "Unsafe folder path"}, status=400)
        if not await asyncio.to_thread(os.path.isdir, full_dir):
            return web.json_response(
                {"ok": False, "notFound": True, "error": "Folder not found on disk"}, status=404
            )
        confirmed = bool(body.get("confirmed", False))
        entries = await asyncio.to_thread(os.listdir, full_dir)
        if len(entries) == 0:
            try:
                await asyncio.to_thread(os.rmdir, full_dir)
            except Exception as exc:
                return web.json_response({"ok": False, "error": f"Remove failed: {exc}"}, status=500)
            await _sync_watcher_baseline()
            return web.json_response(
                {"ok": True, "rootId": rid, "subfolder": clean_sub, "empty": True, "recycled": False}
            )
        if not confirmed:
            def _inspect_entries():
                dirs = 0
                files = 0
                for name in entries:
                    if os.path.isdir(os.path.join(full_dir, name)):
                        dirs += 1
                    else:
                        files += 1
                return dirs, files, entries[:4]

            dir_count, file_count, sample_entries = await asyncio.to_thread(_inspect_entries)
            return web.json_response(
                {
                    "ok": False,
                    "needsConfirm": True,
                    "entryCount": len(entries),
                    "dirCount": dir_count,
                    "fileCount": file_count,
                    "sampleEntries": sample_entries,
                    "error": "Folder is not empty",
                }
            )
        ok, rc = await asyncio.to_thread(send_to_recycle_bin, full_dir)
        if not ok:
            return web.json_response(
                {"ok": False, "error": f"Recycle Bin transfer failed ({rc})"}, status=500
            )
        await _sync_watcher_baseline()
        return web.json_response(
            {"ok": True, "rootId": rid, "subfolder": clean_sub, "empty": False, "recycled": True}
        )

    def _next_available_dst(dst_dir: str, filename: str, prefer_copy_suffix: bool = False) -> tuple[str, str]:
        base_name, ext = os.path.splitext(filename)
        dst_name = filename
        dst_path = os.path.join(dst_dir, dst_name)
        if not os.path.exists(dst_path):
            return dst_name, dst_path
        if prefer_copy_suffix:
            cand = f"{base_name}_copy{ext}"
            cand_path = os.path.join(dst_dir, cand)
            if not os.path.exists(cand_path):
                return cand, cand_path
            suffix = 2
            while os.path.exists(cand_path):
                cand = f"{base_name}_copy_{suffix}{ext}"
                cand_path = os.path.join(dst_dir, cand)
                suffix += 1
            return cand, cand_path
        suffix = 1
        while os.path.exists(dst_path):
            dst_name = f"{base_name}_{suffix}{ext}"
            dst_path = os.path.join(dst_dir, dst_name)
            suffix += 1
        return dst_name, dst_path

    def _safe_copy2_verified(src_path: str, dst_path: str) -> None:
        src_size = os.path.getsize(src_path)
        tmp_dst = f"{dst_path}.hm_tmp_{os.getpid()}_{uuid.uuid4().hex[:8]}"
        try:
            shutil.copy2(src_path, tmp_dst)
            if os.path.getsize(tmp_dst) != src_size:
                raise IOError("Copied size verification mismatch")
            os.replace(tmp_dst, dst_path)
        except Exception:
            if os.path.exists(tmp_dst):
                try:
                    os.remove(tmp_dst)
                except Exception:
                    pass
            raise

    @routes.post("/api/move-batch")
    async def api_move_batch(request: web.Request) -> web.Response:
        if not state["indexers"]:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        items = body.get("items", [])
        if not isinstance(items, list):
            return web.json_response({"ok": False, "error": "items must be a list"}, status=400)
        target_rid, target_idx = _resolve_indexer(str(body.get("targetRootId") or body.get("target_root_id") or ""))
        if target_idx is None:
            return web.json_response({"ok": False, "error": "Target root not mounted"}, status=400)
        clean_target = _clean_subfolder(body.get("targetSubfolder", ""))
        if clean_target is None:
            return web.json_response({"ok": False, "error": "Invalid target folder"}, status=400)
        dst_dir = _resolve_safe_dir(target_idx, clean_target)
        if not dst_dir:
            return web.json_response({"ok": False, "error": "Unsafe target directory"}, status=400)

        def _move_sync():
            os.makedirs(dst_dir, exist_ok=True)
            moved_list = []
            failed_list = []
            for entry in items:
                if not isinstance(entry, dict):
                    continue
                src_rid, src_idx = _resolve_indexer(str(entry.get("root_id", "")))
                filename = str(entry.get("filename", ""))
                raw_sub = str(entry.get("subfolder", ""))
                clean_src_sub = _clean_subfolder(raw_sub)
                old_key = str(entry.get("key") or _canonical_item_key(src_rid, clean_src_sub or "", filename))
                if clean_src_sub is None:
                    failed_list.append({"key": old_key, "error": "Invalid source subfolder"})
                    continue
                if src_idx is None:
                    failed_list.append({"key": old_key, "error": "Source root not mounted"})
                    continue
                src_path = src_idx.resolve_safe_path(clean_src_sub, filename, require_supported_ext=True)
                if not src_path or not os.path.isfile(src_path):
                    failed_list.append({"key": old_key, "error": "Source not found"})
                    continue
                safe_base = os.path.basename(src_path)
                if src_rid == target_rid and clean_src_sub.lower() == clean_target.lower():
                    continue
                dst_name, dst_path = _next_available_dst(dst_dir, safe_base, prefer_copy_suffix=False)
                try:
                    same_drive = os.path.splitdrive(src_path)[0].lower() == os.path.splitdrive(dst_path)[0].lower()
                    if src_rid == target_rid and same_drive:
                        shutil.move(src_path, dst_path)
                    else:
                        # Cross-SSD / cross-root safe copy-verify-unlink
                        _safe_copy2_verified(src_path, dst_path)
                        os.remove(src_path)
                    moved_list.append(
                        {
                            "oldKey": old_key,
                            "newKey": _canonical_item_key(target_rid, clean_target, dst_name),
                            "filename": dst_name,
                            "subfolder": clean_target,
                            "root_id": target_rid,
                        }
                    )
                except Exception as exc:
                    failed_list.append({"key": old_key, "error": str(exc)})
            return moved_list, failed_list

        moved, failed = await asyncio.to_thread(_move_sync)
        if moved:
            await _sync_watcher_baseline()
        return web.json_response(
            {
                "ok": len(failed) == 0 or len(moved) > 0,
                "targetRootId": target_rid,
                "targetSubfolder": clean_target,
                "moved": moved,
                "failed": failed,
            }
        )

    @routes.post("/api/copy-batch")
    async def api_copy_batch(request: web.Request) -> web.Response:
        if not state["indexers"]:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)
        items = body.get("items", [])
        if not isinstance(items, list):
            return web.json_response({"ok": False, "error": "items must be a list"}, status=400)
        has_explicit_target = "targetSubfolder" in body or "targetRootId" in body or "target_root_id" in body
        explicit_rid = str(body.get("targetRootId") or body.get("target_root_id") or "")
        explicit_sub = _clean_subfolder(body.get("targetSubfolder", "")) if "targetSubfolder" in body else None
        if "targetSubfolder" in body and explicit_sub is None:
            return web.json_response({"ok": False, "error": "Invalid target folder"}, status=400)
        prefer_copy_name = bool(body.get("preferCopySuffix", True))

        def _copy_sync():
            copied_list = []
            failed_list = []
            for entry in items:
                if not isinstance(entry, dict):
                    continue
                src_rid, src_idx = _resolve_indexer(str(entry.get("root_id", "")))
                filename = str(entry.get("filename", ""))
                clean_src_sub = _clean_subfolder(str(entry.get("subfolder", "")))
                src_key = str(entry.get("key") or _canonical_item_key(src_rid, clean_src_sub or "", filename))
                if clean_src_sub is None:
                    failed_list.append({"key": src_key, "error": "Invalid source subfolder"})
                    continue
                if src_idx is None:
                    failed_list.append({"key": src_key, "error": "Source root not mounted"})
                    continue
                src_path = src_idx.resolve_safe_path(clean_src_sub, filename, require_supported_ext=True)
                if not src_path or not os.path.isfile(src_path):
                    failed_list.append({"key": src_key, "error": "Source not found"})
                    continue
                safe_base = os.path.basename(src_path)

                if has_explicit_target:
                    dst_rid, dst_idx = _resolve_indexer(explicit_rid or src_rid)
                    dst_sub = explicit_sub if explicit_sub is not None else clean_src_sub
                else:
                    dst_rid, dst_idx = src_rid, src_idx
                    dst_sub = clean_src_sub

                dst_dir = _resolve_safe_dir(dst_idx, dst_sub)
                if not dst_dir:
                    failed_list.append({"key": src_key, "error": "Unsafe target directory"})
                    continue
                os.makedirs(dst_dir, exist_ok=True)

                is_same_place = (src_rid == dst_rid and clean_src_sub.lower() == dst_sub.lower())
                dst_name, dst_path = _next_available_dst(
                    dst_dir, safe_base, prefer_copy_suffix=(is_same_place or prefer_copy_name)
                )
                try:
                    _safe_copy2_verified(src_path, dst_path)
                    copied_list.append(
                        {
                            "sourceKey": src_key,
                            "newKey": _canonical_item_key(dst_rid, dst_sub, dst_name),
                            "filename": dst_name,
                            "subfolder": dst_sub,
                            "root_id": dst_rid,
                        }
                    )
                except Exception as exc:
                    failed_list.append({"key": src_key, "error": str(exc)})
            return copied_list, failed_list

        copied, failed = await asyncio.to_thread(_copy_sync)
        if copied:
            await _sync_watcher_baseline()
        return web.json_response(
            {
                "ok": len(failed) == 0 or len(copied) > 0,
                "copied": copied,
                "failed": failed,
            }
        )

    @routes.post("/api/import-files")
    async def api_import_files(request: web.Request) -> web.Response:
        if not state["indexers"]:
            return web.json_response({"ok": False, "error": "No root folder configured"}, status=400)
        try:
            reader = await request.multipart()
        except Exception:
            return web.json_response({"ok": False, "error": "Expected multipart form data"}, status=400)

        MAX_IMPORT_BYTES = 512 * 1024 * 1024
        target_rid_raw = ""
        target_sub_raw = ""
        saw_target_rid = False
        saw_target_sub = False
        total_bytes = 0
        pending_uploads: list[tuple[str, str]] = []
        skipped_list: list[dict] = []
        failed_list: list[dict] = []

        # Stream multipart fields to temporary files cleanly before moving into target dir
        import tempfile
        tmp_dir = tempfile.mkdtemp(prefix="hm_import_")
        try:
            while True:
                part = await reader.next()
                if part is None:
                    break
                field = (part.name or "").strip()
                if field == "targetRootId":
                    target_rid_raw = (await part.text()).strip()
                    saw_target_rid = True
                    continue
                if field == "targetSubfolder":
                    target_sub_raw = (await part.text()).strip()
                    saw_target_sub = True
                    continue
                if field not in ("files", "file"):
                    continue

                if saw_target_rid and target_rid_raw and target_rid_raw not in state["indexers"]:
                    return web.json_response({"ok": False, "error": "Target root not mounted"}, status=400)
                if saw_target_sub and _clean_subfolder(target_sub_raw) is None:
                    return web.json_response({"ok": False, "error": "Invalid target folder"}, status=400)

                raw_filename = part.filename or ""
                base_name = os.path.basename(raw_filename.replace("\\", "/"))
                safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", base_name).strip(". ")
                if not safe_name or safe_name in (".", "..") or _is_reserved_win_name(safe_name):
                    skipped_list.append({"filename": raw_filename or "(unnamed)", "reason": "Invalid or reserved filename"})
                    continue
                _, ext = os.path.splitext(safe_name)
                if ext.lower() not in SUPPORTED_EXTS:
                    skipped_list.append({"filename": safe_name, "reason": f"Unsupported format ({ext or 'none'})"})
                    continue

                tmp_part_path = os.path.join(tmp_dir, f"upload_{len(pending_uploads)}_{uuid.uuid4().hex[:6]}_{safe_name}")
                f = None
                try:
                    f = await asyncio.to_thread(open, tmp_part_path, "wb")
                    while True:
                        chunk = await part.read_chunk(1024 * 256)
                        if not chunk:
                            break
                        total_bytes += len(chunk)
                        if total_bytes > MAX_IMPORT_BYTES:
                            return web.json_response(
                                {"ok": False, "error": "Upload batch exceeds 512 MB limit"},
                                status=413,
                            )
                        await asyncio.to_thread(f.write, chunk)
                    pending_uploads.append((safe_name, tmp_part_path))
                except Exception as exc:
                    failed_list.append({"filename": safe_name, "error": str(exc)})
                finally:
                    if f is not None:
                        try:
                            await asyncio.to_thread(f.close)
                        except Exception:
                            pass

            target_rid, target_idx = _resolve_indexer(target_rid_raw)
            if target_idx is None:
                return web.json_response({"ok": False, "error": "Target root not mounted"}, status=400)
            clean_target = _clean_subfolder(target_sub_raw)
            if clean_target is None:
                return web.json_response({"ok": False, "error": "Invalid target folder"}, status=400)
            dst_dir = _resolve_safe_dir(target_idx, clean_target)
            if not dst_dir:
                return web.json_response({"ok": False, "error": "Unsafe target directory"}, status=400)

            def _commit_imports():
                os.makedirs(dst_dir, exist_ok=True)
                imported = []
                for safe_name, tmp_src in pending_uploads:
                    dst_name, dst_path = _next_available_dst(dst_dir, safe_name, prefer_copy_suffix=False)
                    tmp_dst = f"{dst_path}.hm_tmp_{os.getpid()}_{uuid.uuid4().hex[:8]}"
                    try:
                        # Write fresh copy so Windows file timestamp reflects exact moment of import
                        shutil.copyfile(tmp_src, tmp_dst)
                        os.replace(tmp_dst, dst_path)
                        imported.append(
                            {
                                "filename": dst_name,
                                "subfolder": clean_target,
                                "root_id": target_rid,
                                "key": _canonical_item_key(target_rid, clean_target, dst_name),
                            }
                        )
                    except Exception as exc:
                        if os.path.exists(tmp_dst):
                            try:
                                os.remove(tmp_dst)
                            except Exception:
                                pass
                        failed_list.append({"filename": safe_name, "error": str(exc)})
                return imported

            imported_list = await asyncio.to_thread(_commit_imports)
            if imported_list:
                await _sync_watcher_baseline()
            return web.json_response(
                {
                    "ok": len(imported_list) > 0 or (len(failed_list) == 0 and len(skipped_list) == 0),
                    "targetRootId": target_rid,
                    "targetSubfolder": clean_target,
                    "imported": imported_list,
                    "skipped": skipped_list,
                    "failed": failed_list,
                }
            )
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    @routes.get("/api/events")
    async def api_events(request: web.Request) -> web.StreamResponse:
        resp = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
        await resp.prepare(request)
        q: asyncio.Queue = asyncio.Queue(maxsize=32)
        state["event_queues"].add(q)
        try:
            await resp.write(f"event: ready\ndata: {json.dumps({'rev': state['library_rev']})}\n\n".encode("utf-8"))
            while True:
                try:
                    item = await asyncio.wait_for(q.get(), timeout=25.0)
                    if item is None:
                        break
                    ev_name, data_json = item
                    msg = f"event: {ev_name}\ndata: {data_json}\n\n".encode("utf-8")
                except asyncio.TimeoutError:
                    msg = b": keepalive\n\n"
                await resp.write(msg)
        except (asyncio.CancelledError, ConnectionError, RuntimeError):
            pass
        finally:
            state["event_queues"].discard(q)
        return resp

    @routes.get("/api/comfy-status")
    async def api_comfy_status(request: web.Request) -> web.Response:
        # Live ComfyUI probe is disabled until the opt-in ComfyUI Integration phase.
        return web.json_response({"online": False})

    @routes.get("/api/idle")
    async def api_idle(request: web.Request) -> web.Response:
        idle_ms = get_windows_idle_ms()
        return web.json_response({"supported": idle_ms >= 0, "idle_ms": idle_ms})

    @routes.get("/api/update/status")
    async def api_update_status(request: web.Request) -> web.Response:
        force = str(request.query.get("force", "")).lower() in ("1", "true", "yes")
        res = await asyncio.to_thread(check_updates, LAB_ROOT, USERDATA_DIR, force)
        return web.json_response(res)

    @routes.post("/api/update/apply")
    async def api_update_apply(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            body = {}
        zip_url = body.get("zipUrl") if isinstance(body, dict) else None
        res = await asyncio.to_thread(apply_update, LAB_ROOT, USERDATA_DIR, zip_url)
        return web.json_response(res)

    @routes.post("/api/restart")
    async def api_restart(request: web.Request) -> web.Response:
        if on_restart is not None:
            threading.Timer(0.18, on_restart).start()
            return web.json_response({"ok": True, "mode": "desktop"})

        port = request.url.port or 8191
        script_py = os.path.abspath(__file__)
        helper = (
            "import subprocess, time, sys\n"
            "time.sleep(1.2)\n"
            f"subprocess.Popen([sys.executable, {script_py!r}, '--port', {str(port)!r}, '--open'], cwd={LAB_ROOT!r})\n"
        )
        cflags = 0x08000000 if sys.platform == "win32" else 0
        subprocess.Popen([sys.executable, "-c", helper], cwd=LAB_ROOT, creationflags=cflags)
        threading.Timer(0.25, lambda: os._exit(0)).start()
        return web.json_response({"ok": True, "mode": "browser"})

    @routes.post("/api/desktop-fullscreen")
    async def api_desktop_fullscreen(request: web.Request) -> web.Response:
        if on_fullscreen_toggle is None:
            return web.json_response({"ok": False, "desktop": False})
        try:
            body = await request.json()
        except Exception:
            body = {}
        want = body.get("fullscreen") if isinstance(body, dict) else None
        try:
            res = await asyncio.to_thread(on_fullscreen_toggle, want)
            if isinstance(res, dict):
                return web.json_response({"desktop": True, **res})
            return web.json_response({"ok": True, "desktop": True, "fullscreen": bool(res)})
        except Exception:
            return web.json_response({"ok": False, "desktop": True})

    @routes.get("/assets/{filepath:.*}")
    async def serve_assets(request: web.Request) -> web.StreamResponse:
        rel = request.match_info.get("filepath", "")
        assets_dir = os.path.abspath(os.path.join(DIST_DIR, "assets"))
        target = os.path.abspath(os.path.join(assets_dir, rel))
        if os.path.islink(target):
            return web.Response(status=404)
        assets_real = os.path.normcase(os.path.realpath(assets_dir))
        target_real = os.path.normcase(os.path.realpath(target))
        try:
            inside = (
                os.path.commonpath([assets_real, target_real]) == assets_real
                and target_real != assets_real
            )
        except ValueError:
            inside = False
        if inside and os.path.isfile(target_real):
            return web.FileResponse(target_real, headers={"Cache-Control": "no-cache"})
        return web.Response(status=404)

    @routes.get("/")
    async def serve_index(request: web.Request) -> web.StreamResponse:
        idx = os.path.join(DIST_DIR, "index.html")
        if os.path.exists(idx):
            return web.FileResponse(idx, headers={"Cache-Control": "no-cache"})
        return web.Response(text="Run npm run build first.", status=404)

    async def _on_startup(_app: web.Application) -> None:
        state["watcher_task"] = asyncio.create_task(_folder_watcher_loop())

    async def _on_shutdown(_app: web.Application) -> None:
        for task_key in ("watcher_task", "warmup_task"):
            task = state.get(task_key)
            if task is not None and not task.done():
                task.cancel()
        for q in list(state["event_queues"]):
            try:
                if q.full():
                    try:
                        q.get_nowait()
                    except Exception:
                        pass
                q.put_nowait(None)
            except Exception:
                pass

    async def _on_cleanup(_app: web.Application) -> None:
        for task_key in ("watcher_task", "warmup_task"):
            task = state.get(task_key)
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        state["event_queues"].clear()
        for idx in list(state["indexers"].values()):
            idx.close()

    app.on_startup.append(_on_startup)
    app.on_shutdown.append(_on_shutdown)
    app.on_cleanup.append(_on_cleanup)
    app.add_routes(routes)
    return app


def _pick_server_port(preferred_port: int) -> int:
    import socket
    candidates = [preferred_port] if preferred_port > 0 else []
    for p in (8191, 8192, 8193, 8194):
        if p not in candidates:
            candidates.append(p)
    for cand in candidates:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", cand))
                return cand
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


if __name__ == "__main__":
    import webbrowser
    parser = argparse.ArgumentParser(description="HammelArt Atelier Standalone Server")
    parser.add_argument("--port", type=int, default=8191, help="Preferred HTTP port (0 = auto)")
    parser.add_argument("--dir", default=None, help="Optional initial media root folder")
    parser.add_argument("--open", action="store_true", help="Open default browser automatically on start")
    args = parser.parse_args()
    chosen_port = _pick_server_port(args.port)
    url = f"http://127.0.0.1:{chosen_port}/"
    print(f"[HammelArt Atelier] Serving {url}" + (f" (Initial Folder: {args.dir})" if args.dir else ""))
    if args.open:
        print("[HammelArt Atelier] Opening default browser — keep this window open while browsing.")
        threading.Timer(0.65, lambda: webbrowser.open(url)).start()
    try:
        web.run_app(create_app(args.dir), host="127.0.0.1", port=chosen_port, print=None)
    except OSError as exc:
        print(
            f"[HammelArt Atelier] Could not bind local server to 127.0.0.1:{chosen_port}: {exc}\n"
            "Try another port with --port or check Windows firewall / Hyper-V excluded port ranges."
        )
        sys.exit(1)

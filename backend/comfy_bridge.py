"""
HammelArt Atelier <-> ComfyUI Bridge Helper
===========================================
100% localhost (`127.0.0.1`) server-to-server bridge client, privacy-safe
ComfyUI path resolver, 1-click bridge deployer, Quick-Open folder actions,
and Win32 window-focus switcher.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import ctypes
from ctypes import wintypes
import json
import math
import os
import re
import shutil
import sys
from typing import Any, Dict, List, Optional, Tuple
import urllib.error
import urllib.request

DEFAULT_PROBE_URLS = ("http://127.0.0.1:8188", "http://127.0.0.1:8000")
BRIDGE_DIR_NAME = "ComfyUI-Atelier-Bridge"
_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_VERSION_RE = re.compile(r'BRIDGE_VERSION\s*=\s*["\']([^"\']+)["\']')


def sanitize_json_value(obj: Any) -> Any:
    """Recursively converts non-finite floats (NaN/Inf) to None so strict browser JSON.parse succeeds."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: sanitize_json_value(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_json_value(v) for v in obj]
    return obj


def get_bundled_bridge_dir(lab_root: str) -> str:
    return os.path.join(lab_root, "bridge", BRIDGE_DIR_NAME)


def read_bridge_version(bridge_dir: str) -> str:
    init_py = os.path.join(bridge_dir, "__init__.py")
    if not os.path.isfile(init_py):
        return ""
    try:
        with open(init_py, "r", encoding="utf-8", errors="ignore") as f:
            head = f.read(2048)
        m = _VERSION_RE.search(head)
        return m.group(1).strip() if m else ""
    except OSError:
        return ""


def normalize_comfy_url(raw_url: str) -> str:
    url = str(raw_url or "").strip().rstrip("/")
    if not url or url.lower() == "auto":
        return ""
    if not (url.startswith("http://") or url.startswith("https://")):
        url = f"http://{url}"
    return url.rstrip("/")


def _http_json(
    method: str,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 0.8,
) -> Tuple[bool, int, Any]:
    data: Optional[bytes] = None
    headers: Dict[str, str] = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with _NO_PROXY_OPENER.open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except Exception:
                parsed = raw
            return True, int(getattr(resp, "status", 200) or 200), parsed
    except urllib.error.HTTPError as err:
        try:
            raw = err.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {}
        return False, int(getattr(err, "code", 500) or 500), parsed
    except Exception:
        return False, 0, None


def _probe_single_target(base_url: str) -> Dict[str, Any]:
    ok_ping, status_ping, ping_data = _http_json("GET", f"{base_url}/atelier/ping", timeout=0.75)
    if ok_ping and isinstance(ping_data, dict) and ping_data.get("bridge") == "atelier":
        return {
            "state": "ready",
            "url": base_url,
            "bridge_version": str(ping_data.get("version") or ""),
            "clients": int(ping_data.get("clients") or 0),
            "active_sid": ping_data.get("active_sid"),
            "capabilities": list(ping_data.get("capabilities") or ["open_workflow"]),
            "system_stats": None,
        }

    ok_sys, status_sys, sys_data = _http_json("GET", f"{base_url}/system_stats", timeout=0.75)
    if ok_sys and status_sys == 200 and isinstance(sys_data, dict) and "system" in sys_data:
        return {
            "state": "no_bridge",
            "url": base_url,
            "bridge_version": "",
            "clients": 0,
            "active_sid": None,
            "capabilities": [],
            "system_stats": sys_data,
        }

    return {
        "state": "offline",
        "url": base_url,
        "bridge_version": "",
        "clients": 0,
        "active_sid": None,
        "capabilities": [],
        "system_stats": None,
    }


def _derive_paths_from_live_comfy(
    base_url: str,
    system_stats: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    custom_nodes_path = ""
    root_path = ""

    ok_fp, _, fp_data = _http_json("GET", f"{base_url}/internal/folder_paths", timeout=0.8)
    if ok_fp and isinstance(fp_data, dict):
        cn_list = fp_data.get("custom_nodes")
        if isinstance(cn_list, list):
            for candidate in cn_list:
                if isinstance(candidate, str) and os.path.isdir(candidate):
                    custom_nodes_path = os.path.abspath(candidate)
                    parent = os.path.dirname(custom_nodes_path)
                    if parent and os.path.isdir(parent):
                        root_path = parent
                    break

    if not system_stats:
        ok_sys, _, sys_data = _http_json("GET", f"{base_url}/system_stats", timeout=0.75)
        if ok_sys and isinstance(sys_data, dict):
            system_stats = sys_data

    if isinstance(system_stats, dict):
        argv = system_stats.get("system", {}).get("argv")
        if isinstance(argv, list):
            for idx, arg in enumerate(argv):
                if arg == "--base-directory" and idx + 1 < len(argv):
                    cand = os.path.abspath(str(argv[idx + 1]))
                    if os.path.isdir(cand):
                        root_path = cand
                        break
                if isinstance(arg, str) and arg.startswith("--base-directory="):
                    cand = os.path.abspath(arg.split("=", 1)[1])
                    if os.path.isdir(cand):
                        root_path = cand
                        break
            if not root_path and argv:
                first_arg = str(argv[0] or "")
                if first_arg.lower().endswith("main.py") and os.path.isfile(first_arg):
                    cand = os.path.dirname(os.path.abspath(first_arg))
                    if os.path.isdir(cand):
                        root_path = cand

    if root_path and not custom_nodes_path:
        cn_cand = os.path.join(root_path, "custom_nodes")
        if os.path.isdir(cn_cand):
            custom_nodes_path = cn_cand

    workflows_path = (
        os.path.join(root_path, "user", "default", "workflows") if root_path else ""
    )
    return {
        "rootPath": root_path,
        "customNodesPath": custom_nodes_path,
        "workflowsPath": workflows_path,
    }


def _describe_folder_map(root_path: str, custom_nodes_path: str = "") -> Dict[str, Dict[str, Any]]:
    folders: Dict[str, Dict[str, Any]] = {}
    candidates = {
        "workflows": os.path.join(root_path, "user", "default", "workflows") if root_path else "",
        "output": os.path.join(root_path, "output") if root_path else "",
        "input": os.path.join(root_path, "input") if root_path else "",
        "custom_nodes": custom_nodes_path or (os.path.join(root_path, "custom_nodes") if root_path else ""),
        "models": os.path.join(root_path, "models") if root_path else "",
        "root": root_path or "",
    }
    for key, path in candidates.items():
        clean = os.path.abspath(path) if path else ""
        exists = bool(clean and os.path.isdir(clean))
        # Allow opening `user/default` or `user` if workflows folder isn't created yet
        openable = exists
        if not openable and key == "workflows" and root_path:
            user_dir = os.path.join(root_path, "user")
            if os.path.isdir(user_dir):
                openable = True
        folders[key] = {"path": clean, "exists": exists, "openable": openable}
    return folders


def probe_comfy_status(
    lab_root: str,
    custom_url: str = "auto",
    remembered_root: str = "",
    remembered_custom_nodes: str = "",
) -> Dict[str, Any]:
    bundled_dir = get_bundled_bridge_dir(lab_root)
    bundled_version = read_bridge_version(bundled_dir)

    explicit = normalize_comfy_url(custom_url)
    targets: List[str] = [explicit] if explicit else list(DEFAULT_PROBE_URLS)

    results: List[Dict[str, Any]] = []
    if len(targets) == 1:
        results = [_probe_single_target(targets[0])]
    else:
        with ThreadPoolExecutor(max_workers=len(targets)) as pool:
            results = list(pool.map(_probe_single_target, targets))

    chosen = next((r for r in results if r["state"] == "ready"), None)
    if chosen is None:
        chosen = next((r for r in results if r["state"] == "no_bridge"), None)
    if chosen is None:
        chosen = results[0]

    detected_paths = {"rootPath": "", "customNodesPath": "", "workflowsPath": ""}
    if chosen["state"] in ("ready", "no_bridge"):
        detected_paths = _derive_paths_from_live_comfy(
            chosen["url"], chosen.get("system_stats")
        )

    clean_rem_root = os.path.abspath(remembered_root) if remembered_root and os.path.isdir(remembered_root) else ""
    clean_rem_cn = (
        os.path.abspath(remembered_custom_nodes)
        if remembered_custom_nodes and os.path.isdir(remembered_custom_nodes)
        else ""
    )

    root_path = detected_paths["rootPath"] or clean_rem_root
    custom_nodes_path = detected_paths["customNodesPath"] or clean_rem_cn
    if root_path and not custom_nodes_path:
        cn_cand = os.path.join(root_path, "custom_nodes")
        if os.path.isdir(cn_cand):
            custom_nodes_path = cn_cand
    if custom_nodes_path and not root_path:
        parent = os.path.dirname(custom_nodes_path)
        if parent and os.path.isdir(parent):
            root_path = parent

    workflows_path = (
        detected_paths["workflowsPath"]
        or (os.path.join(root_path, "user", "default", "workflows") if root_path else "")
    )

    installed_dir = os.path.join(custom_nodes_path, BRIDGE_DIR_NAME) if custom_nodes_path else ""
    installed_on_disk = bool(installed_dir and os.path.isfile(os.path.join(installed_dir, "__init__.py")))
    installed_disk_version = read_bridge_version(installed_dir) if installed_on_disk else ""
    live_version = str(chosen.get("bridge_version") or "")
    update_available = bool(
        bundled_version
        and installed_on_disk
        and installed_disk_version
        and installed_disk_version != bundled_version
    )

    return {
        "ok": True,
        "online": chosen["state"] in ("ready", "no_bridge"),
        "state": chosen["state"],  # "ready" | "no_bridge" | "offline"
        "url": chosen["url"] if chosen["state"] != "offline" else "",
        "clients": int(chosen.get("clients") or 0),
        "capabilities": list(chosen.get("capabilities") or []),
        "bundled_version": bundled_version,
        "bridge_version": live_version or installed_disk_version,
        "installed_on_disk": installed_on_disk,
        "installed_disk_version": installed_disk_version,
        "restart_needed": bool(installed_on_disk and chosen["state"] == "no_bridge"),
        "update_available": update_available,
        "rootPath": root_path,
        "customNodesPath": custom_nodes_path,
        "workflowsPath": workflows_path,
        "folders": _describe_folder_map(root_path, custom_nodes_path),
    }


def install_bridge_to_comfy(
    lab_root: str,
    target_custom_nodes: str = "",
    target_root: str = "",
) -> Dict[str, Any]:
    src_dir = get_bundled_bridge_dir(lab_root)
    if not os.path.isfile(os.path.join(src_dir, "__init__.py")):
        return {"ok": False, "error": f"Bundled bridge source not found at {src_dir}"}

    cn_dir = str(target_custom_nodes or "").strip()
    root_dir = str(target_root or "").strip()
    if not cn_dir and root_dir:
        cand_cn = os.path.join(os.path.abspath(root_dir), "custom_nodes")
        if os.path.isdir(cand_cn):
            cn_dir = cand_cn
        elif os.path.basename(os.path.abspath(root_dir)).lower() == "custom_nodes":
            cn_dir = os.path.abspath(root_dir)

    if not cn_dir or not os.path.isdir(cn_dir):
        return {
            "ok": False,
            "error": "Could not locate ComfyUI's custom_nodes folder yet. Start ComfyUI once or pick your ComfyUI folder manually.",
        }

    # If user picked a ComfyUI root folder instead of custom_nodes, step into custom_nodes automatically
    if os.path.basename(os.path.abspath(cn_dir)).lower() != "custom_nodes":
        inner_cn = os.path.join(os.path.abspath(cn_dir), "custom_nodes")
        if os.path.isdir(inner_cn):
            cn_dir = inner_cn

    dest_dir = os.path.join(os.path.abspath(cn_dir), BRIDGE_DIR_NAME)
    web_dest = os.path.join(dest_dir, "web")
    os.makedirs(web_dest, exist_ok=True)

    for rel in ("__init__.py", "README.md", os.path.join("web", "atelier_bridge.js")):
        src_file = os.path.join(src_dir, rel)
        dst_file = os.path.join(dest_dir, rel)
        if os.path.isfile(src_file):
            shutil.copy2(src_file, dst_file)

    ver = read_bridge_version(dest_dir)
    return {
        "ok": True,
        "installed_path": dest_dir,
        "customNodesPath": os.path.abspath(cn_dir),
        "bridge_version": ver,
        "restart_recommended": True,
    }


def sync_installed_bridge_if_needed(
    lab_root: str,
    target_custom_nodes: str = "",
    target_root: str = "",
) -> Dict[str, Any]:
    """Updates ComfyUI-Atelier-Bridge ONLY if already installed on disk and outdated."""
    bundled_dir = get_bundled_bridge_dir(lab_root)
    bundled_ver = read_bridge_version(bundled_dir)
    if not bundled_ver:
        return {"ok": True, "updated": False, "reason": "no_bundled_bridge"}

    cn_dir = str(target_custom_nodes or "").strip()
    root_dir = str(target_root or "").strip()
    if not cn_dir and root_dir:
        cand_cn = os.path.join(os.path.abspath(root_dir), "custom_nodes")
        if os.path.isdir(cand_cn):
            cn_dir = cand_cn

    if not cn_dir or not os.path.isdir(cn_dir):
        return {"ok": True, "updated": False, "reason": "no_custom_nodes_dir"}

    installed_dir = os.path.join(os.path.abspath(cn_dir), BRIDGE_DIR_NAME)
    if not os.path.isfile(os.path.join(installed_dir, "__init__.py")):
        return {"ok": True, "updated": False, "reason": "not_installed"}

    installed_ver = read_bridge_version(installed_dir)
    if installed_ver == bundled_ver:
        return {"ok": True, "updated": False, "reason": "up_to_date", "version": installed_ver}

    res = install_bridge_to_comfy(lab_root, cn_dir, root_dir)
    if not res.get("ok"):
        return {"ok": False, "updated": False, "error": res.get("error")}
    return {
        "ok": True,
        "updated": True,
        "from_version": installed_ver,
        "to_version": res.get("bridge_version") or bundled_ver,
        "installed_path": res.get("installed_path"),
    }


def uninstall_bridge_from_comfy(target_custom_nodes: str = "", target_root: str = "") -> Dict[str, Any]:
    cn_dir = str(target_custom_nodes or "").strip()
    if not cn_dir and target_root:
        cand_cn = os.path.join(os.path.abspath(target_root), "custom_nodes")
        if os.path.isdir(cand_cn):
            cn_dir = cand_cn

    if not cn_dir or not os.path.isdir(cn_dir):
        return {"ok": False, "error": "ComfyUI custom_nodes folder not found"}

    dest_dir = os.path.join(os.path.abspath(cn_dir), BRIDGE_DIR_NAME)
    if os.path.basename(dest_dir) != BRIDGE_DIR_NAME:
        return {"ok": False, "error": "Invalid target directory"}
    if not os.path.exists(dest_dir):
        return {"ok": True, "removed": False}

    shutil.rmtree(dest_dir)
    return {"ok": True, "removed": True, "removed_path": dest_dir}


def focus_comfy_window_windows() -> bool:
    if sys.platform != "win32":
        return False
    try:
        user32 = ctypes.windll.user32
        matched_hwnd = wintypes.HWND(0)

        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def _enum_cb(hwnd: wintypes.HWND, _lparam: wintypes.LPARAM) -> bool:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value or ""
            low = title.lower()
            if "comfyui" in low and "hammelart atelier" not in low:
                nonlocal matched_hwnd
                matched_hwnd = hwnd
                return False
            return True

        user32.EnumWindows(WNDENUMPROC(_enum_cb), 0)
        if not matched_hwnd:
            return False

        if user32.IsIconic(matched_hwnd):
            user32.ShowWindow(matched_hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(matched_hwnd)
        return True
    except Exception:
        return False


def open_workflow_in_comfy(
    target_url: str,
    workflow: Optional[Dict[str, Any]],
    prompt_graph: Optional[Dict[str, Any]],
    name: str,
    focus_on_open: bool = True,
) -> Dict[str, Any]:
    clean_url = normalize_comfy_url(target_url)
    if not clean_url:
        return {"ok": False, "error": "ComfyUI Bridge is not connected"}

    has_wf = isinstance(workflow, dict) and bool(workflow)
    has_pr = isinstance(prompt_graph, dict) and bool(prompt_graph)
    if not has_wf and not has_pr:
        return {"ok": False, "error": "This item does not contain an embedded ComfyUI workflow"}

    ok, status, data = _http_json(
        "POST",
        f"{clean_url}/atelier/open-workflow",
        payload={
            "workflow": sanitize_json_value(workflow) if has_wf else None,
            "prompt": sanitize_json_value(prompt_graph) if (has_pr and not has_wf) else None,
            "name": name or "Atelier Workflow",
        },
        timeout=2.5,
    )
    if not ok or not isinstance(data, dict) or not data.get("ok"):
        err = data.get("error") if isinstance(data, dict) else None
        return {
            "ok": False,
            "error": err or f"ComfyUI Bridge returned HTTP {status or 'offline'}",
        }

    delivered = bool(data.get("delivered"))
    focused = False
    if delivered and focus_on_open and sys.platform == "win32":
        focused = focus_comfy_window_windows()

    return {
        "ok": True,
        "url": clean_url,
        "delivered": delivered,
        "queued_for_open": bool(data.get("queued_for_open")),
        "clients": int(data.get("clients") or 0),
        "focused": focused,
    }


def open_comfy_folder_explorer(
    folder_key: str,
    root_path: str = "",
    custom_nodes_path: str = "",
) -> Dict[str, Any]:
    if sys.platform != "win32":
        return {"ok": False, "error": "Opening folders is only supported on Windows"}

    clean_key = str(folder_key or "").strip().lower()
    folders = _describe_folder_map(root_path, custom_nodes_path)
    info = folders.get(clean_key)
    if not info:
        return {"ok": False, "error": f"Unknown ComfyUI folder key: {clean_key}"}

    target = info.get("path") or ""
    if clean_key == "workflows" and target and not os.path.isdir(target):
        user_default = os.path.join(root_path, "user", "default")
        user_dir = os.path.join(root_path, "user")
        if os.path.isdir(user_default):
            target = user_default
        elif os.path.isdir(user_dir):
            target = user_dir

    if not target or not os.path.isdir(target):
        return {"ok": False, "error": f"ComfyUI folder not found: {clean_key}"}

    try:
        os.startfile(target)
        return {"ok": True, "path": target}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def inspect_picked_comfy_folder(picked_path: str, lab_root: str = "") -> Dict[str, Any]:
    clean = os.path.abspath(str(picked_path or "").strip())
    if not clean or not os.path.isdir(clean):
        return {"ok": False, "error": "Selected directory does not exist"}

    base_low = os.path.basename(clean).lower()
    if base_low == BRIDGE_DIR_NAME.lower() and os.path.basename(os.path.dirname(clean)).lower() == "custom_nodes":
        cn_path = os.path.dirname(clean)
        root_path = os.path.dirname(cn_path)
    elif base_low == "custom_nodes":
        cn_path = clean
        root_path = os.path.dirname(clean)
    else:
        root_path = clean
        cand_cn = os.path.join(clean, "custom_nodes")
        cn_path = cand_cn if os.path.isdir(cand_cn) else ""

    workflows_path = os.path.join(root_path, "user", "default", "workflows") if root_path else ""
    installed_dir = os.path.join(cn_path, BRIDGE_DIR_NAME) if cn_path else ""
    installed_on_disk = bool(installed_dir and os.path.isfile(os.path.join(installed_dir, "__init__.py")))
    installed_ver = read_bridge_version(installed_dir) if installed_on_disk else ""
    bundled_ver = read_bridge_version(get_bundled_bridge_dir(lab_root)) if lab_root else ""

    return {
        "ok": True,
        "rootPath": root_path,
        "customNodesPath": cn_path,
        "workflowsPath": workflows_path,
        "installed_on_disk": installed_on_disk,
        "installed_disk_version": installed_ver,
        "bundled_version": bundled_ver,
        "folders": _describe_folder_map(root_path, cn_path),
    }


def _open_save_workflow_dialog_sync(default_filename: str, initial_dir: str = "") -> Dict[str, Any]:
    if sys.platform != "win32":
        return {"ok": False, "cancelled": False, "error": "Save dialog only supported on Windows"}

    class _GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", wintypes.DWORD),
            ("Data2", wintypes.WORD),
            ("Data3", wintypes.WORD),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    class _COMDLG_FILTERSPEC(ctypes.Structure):
        _fields_ = [
            ("pszName", wintypes.LPCWSTR),
            ("pszSpec", wintypes.LPCWSTR),
        ]

    ole32 = ctypes.windll.ole32
    shell32 = ctypes.windll.shell32
    user32 = ctypes.windll.user32

    ole32.CLSIDFromString.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(_GUID)]
    ole32.CLSIDFromString.restype = ctypes.c_long
    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    ole32.CoInitializeEx.restype = ctypes.c_long
    ole32.CoCreateInstance.argtypes = [
        ctypes.POINTER(_GUID),
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(_GUID),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    ole32.CoCreateInstance.restype = ctypes.c_long
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    shell32.SHCreateItemFromParsingName.argtypes = [
        wintypes.LPCWSTR,
        ctypes.c_void_p,
        ctypes.POINTER(_GUID),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    shell32.SHCreateItemFromParsingName.restype = ctypes.c_long

    CLSID_FileSaveDialog = _GUID()
    IID_IFileSaveDialog = _GUID()
    IID_IShellItem = _GUID()
    ole32.CLSIDFromString("{C0B4E2F3-BA21-4773-8DBA-335EC946EB8B}", ctypes.byref(CLSID_FileSaveDialog))
    ole32.CLSIDFromString("{84BCCD23-5FDE-4CDB-AEA4-AF64B83D78AB}", ctypes.byref(IID_IFileSaveDialog))
    ole32.CLSIDFromString("{43826D1E-E718-42EE-BC55-A1E261C37BFE}", ctypes.byref(IID_IShellItem))

    hr_init = ole32.CoInitializeEx(None, 0x2)
    did_init = hr_init in (0, 1)
    p_dlg = ctypes.c_void_p()
    p_init_si = ctypes.c_void_p()
    p_res_si = ctypes.c_void_p()

    def _release(ptr: ctypes.c_void_p) -> None:
        if ptr and ptr.value:
            vtbl = ctypes.cast(
                ctypes.cast(ptr, ctypes.POINTER(ctypes.c_void_p))[0],
                ctypes.POINTER(ctypes.c_void_p),
            )
            ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtbl[2])(ptr)

    try:
        hr = ole32.CoCreateInstance(
            ctypes.byref(CLSID_FileSaveDialog),
            None,
            1,
            ctypes.byref(IID_IFileSaveDialog),
            ctypes.byref(p_dlg),
        )
        if hr != 0 or not p_dlg.value:
            return {"ok": False, "cancelled": False, "error": f"CoCreateInstance failed (0x{hr & 0xFFFFFFFF:08X})"}

        vtbl = ctypes.cast(
            ctypes.cast(p_dlg, ctypes.POINTER(ctypes.c_void_p))[0],
            ctypes.POINTER(ctypes.c_void_p),
        )
        Show = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.HWND)(vtbl[3])
        SetFileTypes = ctypes.WINFUNCTYPE(
            ctypes.c_long, ctypes.c_void_p, wintypes.UINT, ctypes.POINTER(_COMDLG_FILTERSPEC)
        )(vtbl[4])
        SetFileTypeIndex = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.UINT)(vtbl[5])
        SetOptions = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.DWORD)(vtbl[9])
        GetOptions = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD))(vtbl[10])
        SetFolder = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p)(vtbl[12])
        SetFileName = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.LPCWSTR)(vtbl[15])
        SetTitle = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.LPCWSTR)(vtbl[17])
        GetResult = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(vtbl[20])
        SetDefaultExtension = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.LPCWSTR)(vtbl[22])

        filters = (_COMDLG_FILTERSPEC * 1)(_COMDLG_FILTERSPEC("ComfyUI Workflow (*.json)", "*.json"))
        SetFileTypes(p_dlg, 1, filters)
        SetFileTypeIndex(p_dlg, 1)
        SetDefaultExtension(p_dlg, "json")

        opts = wintypes.DWORD(0)
        GetOptions(p_dlg, ctypes.byref(opts))
        FOS_OVERWRITEPROMPT = 0x00000002
        FOS_FORCEFILESYSTEM = 0x00000040
        SetOptions(p_dlg, opts.value | FOS_OVERWRITEPROMPT | FOS_FORCEFILESYSTEM)
        SetTitle(p_dlg, "Save ComfyUI Workflow (.json)")
        SetFileName(p_dlg, default_filename)

        if initial_dir:
            target_init = os.path.abspath(initial_dir)
            if not os.path.isdir(target_init):
                parent_def = os.path.dirname(target_init)
                if os.path.isdir(parent_def):
                    os.makedirs(target_init, exist_ok=True)
            if os.path.isdir(target_init):
                hr_si = shell32.SHCreateItemFromParsingName(
                    target_init, None, ctypes.byref(IID_IShellItem), ctypes.byref(p_init_si)
                )
                if hr_si == 0 and p_init_si.value:
                    SetFolder(p_dlg, p_init_si)

        hwnd_owner = user32.GetForegroundWindow()
        hr_show = Show(p_dlg, hwnd_owner)
        if hr_show in (-2147023673, 0x800704C7):
            return {"ok": True, "cancelled": True, "path": ""}
        if hr_show != 0:
            return {"ok": False, "cancelled": False, "error": f"Save dialog failed (0x{hr_show & 0xFFFFFFFF:08X})"}

        hr_res = GetResult(p_dlg, ctypes.byref(p_res_si))
        if hr_res != 0 or not p_res_si.value:
            return {"ok": True, "cancelled": True, "path": ""}

        si_vtbl = ctypes.cast(
            ctypes.cast(p_res_si, ctypes.POINTER(ctypes.c_void_p))[0],
            ctypes.POINTER(ctypes.c_void_p),
        )
        GetDisplayName = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p))(si_vtbl[5])
        p_path_str = ctypes.c_void_p()
        hr_dn = GetDisplayName(p_res_si, 0x80058000, ctypes.byref(p_path_str))
        if hr_dn == 0 and p_path_str.value:
            chosen = ctypes.wstring_at(p_path_str.value)
            ole32.CoTaskMemFree(p_path_str)
            if chosen:
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


def save_workflow_windows_dialog(
    workflow_data: Dict[str, Any],
    default_filename: str,
    initial_dir: str = "",
) -> Dict[str, Any]:
    if sys.platform != "win32":
        return {"ok": False, "cancelled": False, "error": "Save dialog only supported on Windows"}
    import threading

    result_box: Dict[str, Any] = {"result": None}

    def _run_sta() -> None:
        result_box["result"] = _open_save_workflow_dialog_sync(default_filename, initial_dir)

    th = threading.Thread(target=_run_sta, daemon=True)
    th.start()
    th.join(timeout=180)
    res = result_box.get("result")
    if not isinstance(res, dict):
        return {"ok": False, "cancelled": True, "error": "Save dialog timed out"}
    if not res.get("ok") or res.get("cancelled") or not res.get("path"):
        return res

    target_path = res["path"]
    if not target_path.lower().endswith(".json"):
        target_path += ".json"
    try:
        clean_wf = sanitize_json_value(workflow_data)
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(clean_wf, f, indent=2, ensure_ascii=False, allow_nan=False)
        return {"ok": True, "cancelled": False, "path": target_path}
    except Exception as exc:
        return {"ok": False, "cancelled": False, "error": str(exc)}


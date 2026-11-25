"""HammelArt Atelier update checker and safe self-updater (Git + Portable ZIP)."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from typing import Any

REPO_SLUG = "HammelArt/HammelArt-Atelier"
GITHUB_REPO_URL = f"https://github.com/{REPO_SLUG}"
GITHUB_RELEASES_URL = f"{GITHUB_REPO_URL}/releases"
GITHUB_RELEASES_API = f"https://api.github.com/repos/{REPO_SLUG}/releases?per_page=15"
GITHUB_TAGS_API = f"https://api.github.com/repos/{REPO_SLUG}/tags?per_page=15"
_CACHE_TTL_SEC = 6 * 3600
_PROTECTED_TOP_DIRS = frozenset({"userdata", "python_runtime", "node_modules", ".git"})
_ALLOWED_ZIP_HOSTS = (
    "https://github.com/",
    "https://api.github.com/",
    "https://objects.githubusercontent.com/",
    "https://codeload.github.com/",
    "https://release-assets.githubusercontent.com/",
)

_SUBPROCESS_FLAGS = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW


def normalize_version(raw: str | None) -> str:
    txt = str(raw or "").strip()
    if txt.lower().startswith("v") and len(txt) > 1 and txt[1].isdigit():
        txt = txt[1:]
    return txt


def parse_version_tuple(raw: str | None) -> tuple[int, int, int, int, str, int]:
    """Converts semver strings like `0.9.1-beta` or `v1.0.0` into a sortable tuple."""
    clean = normalize_version(raw)
    m = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?", clean)
    if not m:
        return (0, 0, 0, 0, "", 0)
    maj = int(m.group(1) or 0)
    minor = int(m.group(2) or 0)
    patch = int(m.group(3) or 0)
    pre = (m.group(4) or "").lower()
    if not pre:
        return (maj, minor, patch, 1, "", 0)
    pre_m = re.match(r"^([a-z-]+)\.?(\d+)?", pre)
    pre_label = pre_m.group(1) if pre_m else pre
    pre_num = int(pre_m.group(2) or 0) if pre_m and pre_m.group(2) else 0
    return (maj, minor, patch, 0, pre_label, pre_num)


def is_newer_version(candidate: str | None, current: str | None) -> bool:
    return parse_version_tuple(candidate) > parse_version_tuple(current)


def get_local_version(app_root: str) -> str:
    pkg_path = os.path.join(app_root, "package.json")
    try:
        with open(pkg_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        ver = normalize_version(data.get("version"))
        if ver:
            return ver
    except Exception:
        pass
    return "0.9.0-beta"


def get_install_mode(app_root: str) -> str:
    return "git" if os.path.isdir(os.path.join(app_root, ".git")) else "zip"


def _http_get_json(url: str, timeout: float = 6.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "HammelArt-Atelier-Updater",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _pick_zip_asset(release_obj: dict[str, Any]) -> str:
    assets = release_obj.get("assets") or []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name") or "").lower()
        dl = str(asset.get("browser_download_url") or "")
        if name.endswith(".zip") and dl:
            return dl
    return str(release_obj.get("zipball_url") or "")


def _cache_file_path(userdata_dir: str) -> str:
    return os.path.join(userdata_dir, "update_cache.json")


def _clear_cache(userdata_dir: str) -> None:
    try:
        p = _cache_file_path(userdata_dir)
        if os.path.isfile(p):
            os.remove(p)
    except Exception:
        pass


def _read_local_changelog_releases(app_root: str, current_ver: str) -> list[dict[str, Any]]:
    """Parses local CHANGELOG.md sections as offline fallback release history."""
    changelog_path = os.path.join(app_root, "CHANGELOG.md")
    if not os.path.isfile(changelog_path):
        return []
    try:
        with open(changelog_path, "r", encoding="utf-8") as f:
            raw = f.read()
    except Exception:
        return []

    heading_re = re.compile(
        r"^##\s+\[?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s*[-—]\s*(\d{4}-\d{2}-\d{2}))?(?:\s*[-—]\s*(.+))?$"
    )
    entries: list[dict[str, Any]] = []
    cur_entry: dict[str, Any] | None = None
    body_lines: list[str] = []

    def _flush() -> None:
        nonlocal cur_entry, body_lines
        if cur_entry is None:
            return
        cur_entry["body"] = "\n".join(body_lines).strip()
        entries.append(cur_entry)
        cur_entry = None
        body_lines = []

    for line in raw.replace("\r\n", "\n").split("\n"):
        m = heading_re.match(line.strip())
        if m:
            _flush()
            raw_tag = m.group(1)
            ver = normalize_version(raw_tag)
            tag = raw_tag if raw_tag.startswith("v") else f"v{ver}"
            date_str = (m.group(2) or "").strip()
            title_extra = (m.group(3) or "").strip()
            name = f"{tag} — {title_extra}" if title_extra else tag
            cur_entry = {
                "tag": tag,
                "version": ver,
                "name": name,
                "body": "",
                "publishedAt": f"{date_str}T00:00:00Z" if date_str else "",
                "url": f"{GITHUB_REPO_URL}/releases/tag/{tag}",
                "prerelease": "-" in ver,
                "isNewer": is_newer_version(ver, current_ver),
                "fromLocal": True,
            }
        elif cur_entry is not None:
            body_lines.append(line)

    _flush()
    return entries


def check_updates(app_root: str, userdata_dir: str, force: bool = False) -> dict[str, Any]:
    current_ver = get_local_version(app_root)
    install_mode = get_install_mode(app_root)
    cache_path = _cache_file_path(userdata_dir)
    now = int(time.time())

    if not force and os.path.isfile(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if (
                isinstance(cached, dict)
                and cached.get("currentVersion") == current_ver
                and isinstance(cached.get("releases"), list)
                and (now - int(cached.get("checkedAt") or 0)) < _CACHE_TTL_SEC
            ):
                cached["installMode"] = install_mode
                cached["cached"] = True
                return cached
        except Exception:
            pass

    latest_ver = ""
    latest_tag = ""
    release_name = ""
    patch_notes = ""
    published_at = ""
    release_url = GITHUB_RELEASES_URL
    zip_url = f"{GITHUB_REPO_URL}/archive/refs/heads/main.zip"
    releases_list: list[dict[str, Any]] = []
    unreachable = False
    status_note = ""

    try:
        releases = _http_get_json(GITHUB_RELEASES_API)
        candidates = [
            r for r in (releases if isinstance(releases, list) else [])
            if isinstance(r, dict) and not r.get("draft") and r.get("tag_name")
        ]
        if candidates:
            candidates.sort(key=lambda r: parse_version_tuple(r.get("tag_name")), reverse=True)
            for rel in candidates:
                r_tag = str(rel.get("tag_name") or "")
                r_ver = normalize_version(r_tag)
                releases_list.append({
                    "tag": r_tag,
                    "version": r_ver,
                    "name": str(rel.get("name") or r_tag),
                    "body": str(rel.get("body") or "").strip(),
                    "publishedAt": str(rel.get("published_at") or ""),
                    "url": str(rel.get("html_url") or GITHUB_RELEASES_URL),
                    "prerelease": bool(rel.get("prerelease")),
                    "isNewer": bool(r_ver and is_newer_version(r_ver, current_ver)),
                })
            top = candidates[0]
            latest_tag = str(top.get("tag_name") or "")
            latest_ver = normalize_version(latest_tag)
            release_name = str(top.get("name") or latest_tag)
            patch_notes = str(top.get("body") or "").strip()
            published_at = str(top.get("published_at") or "")
            release_url = str(top.get("html_url") or GITHUB_RELEASES_URL)
            found_zip = _pick_zip_asset(top)
            if found_zip:
                zip_url = found_zip
        else:
            tags = _http_get_json(GITHUB_TAGS_API)
            tag_items = [t for t in (tags if isinstance(tags, list) else []) if isinstance(t, dict) and t.get("name")]
            if tag_items:
                tag_items.sort(key=lambda t: parse_version_tuple(t.get("name")), reverse=True)
                top_tag = tag_items[0]
                latest_tag = str(top_tag.get("name") or "")
                latest_ver = normalize_version(latest_tag)
                release_name = latest_tag
                release_url = f"{GITHUB_REPO_URL}/releases/tag/{latest_tag}"
                zip_url = str(top_tag.get("zipball_url") or zip_url)
    except urllib.error.HTTPError as exc:
        unreachable = True
        if exc.code == 404:
            status_note = "Repository is private or has no public releases yet."
        elif exc.code == 403:
            status_note = "GitHub API rate limit reached — open GitHub directly or try again shortly."
        else:
            status_note = f"GitHub returned HTTP {exc.code}."
    except Exception:
        unreachable = True
        status_note = "Unable to reach GitHub right now (offline or timed out)."

    if not releases_list:
        local_entries = _read_local_changelog_releases(app_root, current_ver)
        if local_entries:
            releases_list = local_entries
            if not patch_notes:
                patch_notes = local_entries[0].get("body") or ""
                if not release_name:
                    release_name = local_entries[0].get("name") or ""
                if not published_at:
                    published_at = local_entries[0].get("publishedAt") or ""

    update_available = bool(latest_ver and is_newer_version(latest_ver, current_ver))
    if not patch_notes:
        if update_available:
            patch_notes = f"Release {latest_tag or latest_ver} is ready on GitHub."
        elif not unreachable:
            patch_notes = f"You are running the latest version (v{current_ver})."

    payload: dict[str, Any] = {
        "ok": True,
        "currentVersion": current_ver,
        "latestVersion": latest_ver or current_ver,
        "latestTag": latest_tag or f"v{current_ver}",
        "releaseName": release_name or f"v{current_ver}",
        "patchNotes": patch_notes,
        "releases": releases_list,
        "publishedAt": published_at,
        "releaseUrl": release_url,
        "repoUrl": GITHUB_REPO_URL,
        "zipUrl": zip_url,
        "installMode": install_mode,
        "updateAvailable": update_available,
        "unreachable": unreachable,
        "statusNote": status_note,
        "checkedAt": now,
        "cached": False,
    }

    if not unreachable:
        try:
            os.makedirs(userdata_dir, exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

    return payload


def _refresh_python_deps(app_root: str) -> str:
    ps_script = os.path.join(app_root, "scripts", "bootstrap_runtime.ps1")
    if sys.platform != "win32" or not os.path.isfile(ps_script):
        return ""
    res = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            ps_script,
            "-CheckOnly",
        ],
        cwd=app_root,
        capture_output=True,
        text=True,
        timeout=180,
        creationflags=_SUBPROCESS_FLAGS,
    )
    return (res.stdout or "") + ("\n" + res.stderr if res.stderr else "")


def _apply_git_update(app_root: str, userdata_dir: str) -> dict[str, Any]:
    before_ver = get_local_version(app_root)
    logs: list[str] = []

    fetch_res = subprocess.run(
        ["git", "fetch", "--tags", "origin"],
        cwd=app_root,
        capture_output=True,
        text=True,
        timeout=60,
        creationflags=_SUBPROCESS_FLAGS,
    )
    if fetch_res.stdout:
        logs.append(fetch_res.stdout.strip())
    if fetch_res.stderr:
        logs.append(fetch_res.stderr.strip())
    if fetch_res.returncode != 0:
        return {
            "ok": False,
            "mode": "git",
            "updated": False,
            "message": "Could not reach origin via git fetch.",
            "log": "\n".join(logs),
        }

    pull_res = subprocess.run(
        ["git", "pull", "--ff-only", "origin", "main"],
        cwd=app_root,
        capture_output=True,
        text=True,
        timeout=90,
        creationflags=_SUBPROCESS_FLAGS,
    )
    pull_out = (pull_res.stdout or "").strip()
    pull_err = (pull_res.stderr or "").strip()
    if pull_out:
        logs.append(pull_out)
    if pull_err:
        logs.append(pull_err)
    if pull_res.returncode != 0:
        return {
            "ok": False,
            "mode": "git",
            "updated": False,
            "message": "git pull could not fast-forward cleanly. Check local repo changes.",
            "log": "\n".join(logs),
        }

    dep_out = _refresh_python_deps(app_root).strip()
    if dep_out:
        logs.append(dep_out)

    _clear_cache(userdata_dir)
    after_ver = get_local_version(app_root)
    already_current = "already up to date" in pull_out.lower() or "bereits aktuell" in pull_out.lower()
    return {
        "ok": True,
        "mode": "git",
        "updated": not already_current,
        "alreadyCurrent": already_current,
        "previousVersion": before_ver,
        "currentVersion": after_ver,
        "restartRequired": not already_current,
        "message": (
            f"Already on latest version (v{after_ver})."
            if already_current
            else f"Updated cleanly to v{after_ver}! Restart Atelier to apply."
        ),
        "log": "\n".join(logs),
    }


def _apply_zip_update(app_root: str, userdata_dir: str, zip_url: str | None) -> dict[str, Any]:
    before_ver = get_local_version(app_root)
    target_url = str(zip_url or "").strip()
    if not target_url:
        status = check_updates(app_root, userdata_dir, force=True)
        target_url = str(status.get("zipUrl") or "")
    if not target_url.startswith(_ALLOWED_ZIP_HOSTS):
        return {
            "ok": False,
            "mode": "zip",
            "updated": False,
            "message": "Blocked non-GitHub update archive URL.",
            "log": target_url,
        }

    os.makedirs(userdata_dir, exist_ok=True)
    tmp_zip = os.path.join(userdata_dir, "_update_pkg.zip")
    req = urllib.request.Request(target_url, headers={"User-Agent": "HammelArt-Atelier-Updater"})
    try:
        with urllib.request.urlopen(req, timeout=90) as resp, open(tmp_zip, "wb") as out_f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                out_f.write(chunk)

        app_real = os.path.realpath(app_root)
        extracted_count = 0
        with zipfile.ZipFile(tmp_zip, "r") as zf:
            names = [n for n in zf.namelist() if n and not n.endswith("/")]
            first_segments = {n.split("/", 1)[0] for n in names if "/" in n}
            strip_prefix = f"{next(iter(first_segments))}/" if len(first_segments) == 1 else ""

            for member in names:
                rel = member[len(strip_prefix):] if strip_prefix and member.startswith(strip_prefix) else member
                rel = rel.lstrip("/\\")
                if not rel:
                    continue
                parts = [p for p in re.split(r"[/\\]+", rel) if p]
                if not parts or ".." in parts or parts[0] in _PROTECTED_TOP_DIRS:
                    continue
                dest = os.path.abspath(os.path.join(app_real, *parts))
                if os.path.commonpath([app_real, os.path.realpath(os.path.dirname(dest))]) != app_real:
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with zf.open(member, "r") as src_f, open(dest, "wb") as dst_f:
                    dst_f.write(src_f.read())
                extracted_count += 1

        dep_out = _refresh_python_deps(app_root).strip()
        _clear_cache(userdata_dir)
        after_ver = get_local_version(app_root)
        return {
            "ok": True,
            "mode": "zip",
            "updated": True,
            "previousVersion": before_ver,
            "currentVersion": after_ver,
            "restartRequired": True,
            "message": f"Updated {extracted_count} files cleanly (v{after_ver})! Restart Atelier to apply.",
            "log": dep_out or f"Extracted {extracted_count} files from {target_url}",
        }
    except Exception as exc:
        return {
            "ok": False,
            "mode": "zip",
            "updated": False,
            "message": f"ZIP update failed: {exc}",
            "log": str(exc),
        }
    finally:
        try:
            if os.path.isfile(tmp_zip):
                os.remove(tmp_zip)
        except Exception:
            pass


def apply_update(app_root: str, userdata_dir: str, zip_url: str | None = None) -> dict[str, Any]:
    if get_install_mode(app_root) == "git":
        return _apply_git_update(app_root, userdata_dir)
    return _apply_zip_update(app_root, userdata_dir, zip_url)

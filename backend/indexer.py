r"""
core/indexer.py
===============
High-speed Incremental `os.scandir` Media Indexer, Thumbnail Engine, and Non-Destructive Cache Manager.

Key Architectural Upgrades:
1. Zero-Pollution Storage: All index caches, thumbnails, favorites, and hidden states are stored
   inside `userdata/cache/<dir_hash>/`, leaving the user's media root folders 100% untouched.
2. Fast `os.scandir` Delta Walk: Uses Windows `DirEntry.stat()` in-memory attributes so scanning
   thousands of files takes <15ms once cached.
3. Aspect-Preserving HD Thumbnails (640px max edge, JPEG Q88) for both images and videos (OpenCV / FFmpeg).
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Set, Tuple
from PIL import Image

from .metadata_engine import extract_media_metadata

SUPPORTED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
SUPPORTED_VIDEO_EXTS = {".mp4", ".webm", ".mov"}
SUPPORTED_EXTS = SUPPORTED_IMAGE_EXTS | SUPPORTED_VIDEO_EXTS

PACKAGE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
USERDATA_ROOT = os.path.join(PACKAGE_ROOT, "userdata")
_LEGACY_CACHE_ROOT = os.path.join(PACKAGE_ROOT, ".cache")
CACHE_ROOT = os.path.join(USERDATA_ROOT, "cache")

os.makedirs(USERDATA_ROOT, exist_ok=True)
if not os.path.exists(CACHE_ROOT) and os.path.isdir(_LEGACY_CACHE_ROOT):
    try:
        os.replace(_LEGACY_CACHE_ROOT, CACHE_ROOT)
    except OSError:
        CACHE_ROOT = _LEGACY_CACHE_ROOT


class GalleryIndexer:
    def __init__(self, output_dir: str, sandbox_readonly: bool = True):
        self.output_dir = os.path.abspath(output_dir)
        self.sandbox_readonly = sandbox_readonly
        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="hm_gallery_worker")
        self._warm_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hm_warm_worker")
        self._live_thumb_inflight = 0
        self._last_live_thumb_ts = 0.0
        self._thumb_lock_guard = threading.Lock()
        self._thumb_locks: Dict[str, threading.Lock] = {}

        dir_hash = hashlib.md5(self.output_dir.lower().encode("utf-8")).hexdigest()[:10]
        self.storage_dir = os.path.join(CACHE_ROOT, f"workspace_{dir_hash}")
        self.thumb_dir = os.path.join(self.storage_dir, "thumbnails")
        self.index_file = os.path.join(self.storage_dir, "gallery_index_v2.json")
        self.favorites_file = os.path.join(self.storage_dir, "favorites.json")
        self.hidden_file = os.path.join(self.storage_dir, "hidden.json")
        self.muted_folders_file = os.path.join(self.storage_dir, "muted_folders.json")

        os.makedirs(self.thumb_dir, exist_ok=True)

        self._index: Dict[str, Dict[str, Any]] = self._load_json(self.index_file, {})
        self._favorites: Set[str] = set(self._load_json(self.favorites_file, []))
        self._hidden: Set[str] = set(self._load_json(self.hidden_file, []))
        self._muted_folders: List[str] = self._load_json(self.muted_folders_file, [])

    @staticmethod
    def _load_json(path: str, default: Any) -> Any:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return default
        return default

    @staticmethod
    def _save_json(path: str, data: Any) -> None:
        tmp_path = f"{path}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, path)
        except Exception as exc:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            print(f"[HammelArt Atelier] Cache write note ({os.path.basename(path)}): {exc}")

    def close(self) -> None:
        for pool in (getattr(self, "executor", None), getattr(self, "_warm_executor", None)):
            if pool is not None:
                try:
                    pool.shutdown(wait=False, cancel_futures=True)
                except Exception:
                    pass

    def set_output_dir(self, new_dir: str, sandbox_readonly: Optional[bool] = None) -> None:
        self.close()
        if sandbox_readonly is not None:
            self.sandbox_readonly = sandbox_readonly
        self.__init__(new_dir, self.sandbox_readonly)

    def resolve_safe_path(
        self, subfolder: str, filename: str, require_supported_ext: bool = False
    ) -> Optional[str]:
        if not filename or not isinstance(filename, str):
            return None
        if any(ch in filename for ch in ("/", "\\", ":", "\x00")) or os.path.basename(filename) != filename:
            return None
        if filename in (".", ".."):
            return None
        if require_supported_ext:
            _, ext = os.path.splitext(filename)
            if ext.lower() not in SUPPORTED_EXTS:
                return None

        sub_norm = (subfolder or "").replace("\\", "/").strip("/")
        if sub_norm == "(Root)":
            sub_norm = ""
        parts = [p for p in sub_norm.split("/") if p]
        if any(p in (".", "..") or ":" in p or "\x00" in p for p in parts):
            return None

        cur = os.path.abspath(self.output_dir)
        if os.path.islink(cur):
            return None
        for p in parts:
            cur = os.path.join(cur, p)
            if os.path.islink(cur):
                return None
        candidate = os.path.join(cur, filename)
        if os.path.islink(candidate):
            return None

        root_real = os.path.normcase(os.path.realpath(self.output_dir))
        cand_real = os.path.normcase(os.path.realpath(candidate))
        try:
            if os.path.commonpath([root_real, cand_real]) != root_real or cand_real == root_real:
                return None
        except ValueError:
            return None
        return os.path.realpath(candidate)

    @staticmethod
    def make_file_key(subfolder: str, filename: str) -> str:
        clean_sub = (subfolder or "").replace("\\", "/").strip("/")
        return f"{clean_sub}/{filename}" if clean_sub else filename

    def _scan_directory_fast(self) -> Tuple[List[Tuple[str, str, str, float, int]], List[str]]:
        """
        Recursively scans `self.output_dir` using `os.scandir` for zero-overhead `DirEntry.stat()`.
        Returns (entries, folder_list) where each entry is (rel_key, subfolder, filename, mtime, size_bytes).
        """
        results: List[Tuple[str, str, str, float, int]] = []
        folders_set: Set[str] = set()

        if not os.path.exists(self.output_dir):
            return results, []

        def _walk(current_dir: str, rel_prefix: str) -> None:
            try:
                with os.scandir(current_dir) as it:
                    for entry in it:
                        name = entry.name
                        if name.startswith("."):
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            sub_rel = f"{rel_prefix}/{name}" if rel_prefix else name
                            folders_set.add(sub_rel)
                            _walk(entry.path, sub_rel)
                        elif entry.is_file(follow_symlinks=False):
                            ext = os.path.splitext(name)[1].lower()
                            if ext in SUPPORTED_EXTS:
                                st = entry.stat(follow_symlinks=False)
                                rel_key = f"{rel_prefix}/{name}" if rel_prefix else name
                                results.append((rel_key, rel_prefix, name, round(st.st_mtime, 3), st.st_size))
            except Exception as exc:
                print(f"[HammelArt Atelier] Scandir warning in {current_dir}: {exc}")

        _walk(self.output_dir, "")
        return results, sorted(folders_set)

    def scan_and_index_sync(self, progress_cb=None) -> Dict[str, Any]:
        t0 = time.perf_counter()
        raw_entries, all_folders = self._scan_directory_fast()
        dirty = False
        seen_keys: Set[str] = set()
        items: List[Dict[str, Any]] = []
        total_entries = len(raw_entries)

        if progress_cb:
            progress_cb(0, total_entries)

        for idx_num, (rel_key, subfolder, filename, mtime, size_bytes) in enumerate(raw_entries):
            seen_keys.add(rel_key)
            cached = self._index.get(rel_key)
            if (
                cached
                and cached.get("mtime") == mtime
                and cached.get("file_size_bytes") == size_bytes
                and "width" in cached
            ):
                record = dict(cached)
            else:
                full_path = os.path.join(self.output_dir, subfolder.replace("/", os.sep), filename)
                meta = extract_media_metadata(full_path)
                # Omit full heavy workflow dict from the list index payload to keep JSON ultra-compact
                meta_light = {k: v for k, v in meta.items() if k != "workflow"}
                prompt_snip = (meta.get("raw_prompt") or "")[:260]
                search_blob = " ".join(
                    [
                        filename.lower(),
                        subfolder.lower(),
                        (meta.get("model") or "").lower(),
                        (meta.get("dialect") or "").lower(),
                        str(meta.get("seed") or "").lower(),
                        (meta.get("sampler") or "").lower(),
                        (meta.get("raw_prompt") or "").lower(),
                        " ".join(meta.get("tags") or []),
                    ]
                )
                record = {
                    "id": rel_key,
                    "file_key": rel_key,
                    "filename": filename,
                    "subfolder": subfolder,
                    "mtime": mtime,
                    **meta_light,
                    "prompt_snippet": prompt_snip,
                    "search_blob": search_blob,
                }
                self._index[rel_key] = record
                dirty = True
                if progress_cb and ((idx_num + 1) % 8 == 0 or idx_num + 1 == total_entries):
                    progress_cb(idx_num + 1, total_entries)

            record["is_favorite"] = rel_key in self._favorites
            record["is_hidden"] = rel_key in self._hidden
            items.append(record)

        if progress_cb:
            progress_cb(total_entries, total_entries)

        # Prune deleted files from index cache
        stale_keys = [k for k in self._index if k not in seen_keys]
        if stale_keys:
            for k in stale_keys:
                del self._index[k]
            dirty = True

        if dirty:
            self._save_json(self.index_file, self._index)
            self._prune_orphan_thumbnails(seen_keys)

        items.sort(key=lambda x: x["mtime"], reverse=True)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

        # Build folder counts including recursive child counts
        folder_counts: Dict[str, int] = {"all": len(items), "root": 0}
        for f in all_folders:
            folder_counts[f] = 0
        for item in items:
            sf = item["subfolder"]
            if not sf:
                folder_counts["root"] = folder_counts.get("root", 0) + 1
            else:
                parts = sf.split("/")
                for idx in range(1, len(parts) + 1):
                    prefix = "/".join(parts[:idx])
                    folder_counts[prefix] = folder_counts.get(prefix, 0) + 1

        return {
            "images": items,
            "folders": all_folders,
            "folder_counts": folder_counts,
            "muted_folders": self._muted_folders,
            "output_dir": self.output_dir,
            "sandbox_readonly": self.sandbox_readonly,
            "scan_ms": elapsed_ms,
        }

    async def scan_and_index(self, progress_cb=None) -> Dict[str, Any]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self.executor, self.scan_and_index_sync, progress_cb)

    def _prune_orphan_thumbnails(self, seen_keys: Set[str]) -> int:
        """Removes cached thumbnails whose source file was deleted, moved, or modified."""
        valid_prefixes: Set[str] = set()
        for rel_key in seen_keys:
            rec = self._index.get(rel_key)
            if not rec:
                continue
            mtime_int = int(rec.get("mtime") or 0)
            key_hash = hashlib.md5(rel_key.encode("utf-8")).hexdigest()[:12]
            valid_prefixes.add(f"{mtime_int}_{key_hash}_")

        removed = 0
        try:
            with os.scandir(self.thumb_dir) as it:
                for entry in it:
                    name = entry.name
                    if not name.endswith(".jpg"):
                        continue
                    parts = name.split("_", 2)
                    if len(parts) < 3 or f"{parts[0]}_{parts[1]}_" not in valid_prefixes:
                        try:
                            os.remove(entry.path)
                            removed += 1
                        except Exception:
                            pass
        except Exception:
            pass
        return removed

    @staticmethod
    def _normalize_thumb_tier(max_edge: int = 640) -> int:
        if max_edge <= 400:
            return 360
        if max_edge <= 700:
            return 640
        return 960

    def _thumb_cache_path(self, subfolder: str, filename: str, mtime: int, max_edge: int = 640) -> str:
        tier = self._normalize_thumb_tier(max_edge)
        rel_key = self.make_file_key(subfolder, filename)
        key_hash = hashlib.md5(rel_key.encode("utf-8")).hexdigest()[:12]
        safe_name = os.path.splitext(filename)[0][:40]
        tier_tag = "" if tier == 640 else f"_{tier}"
        return os.path.join(self.thumb_dir, f"{mtime}_{key_hash}{tier_tag}_{safe_name}.jpg")

    def has_cached_thumbnail(self, subfolder: str, filename: str, mtime: float, max_edge: int = 360) -> bool:
        try:
            return os.path.exists(self._thumb_cache_path(subfolder, filename, int(mtime), max_edge=max_edge))
        except Exception:
            return True

    def _get_thumb_lock(self, thumb_path: str) -> threading.Lock:
        with self._thumb_lock_guard:
            lock = self._thumb_locks.get(thumb_path)
            if lock is None:
                # Keep lock map bounded on huge sessions without invalidating active waiters
                if len(self._thumb_locks) > 4096:
                    self._thumb_locks = {k: v for k, v in self._thumb_locks.items() if v.locked()}
                lock = threading.Lock()
                self._thumb_locks[thumb_path] = lock
            return lock

    @staticmethod
    def _safe_replace_thumb(tmp_path: str, thumb_path: str) -> str:
        """Atomically promote tmp_path -> thumb_path, retrying transient Windows AV/reader locks."""
        last_exc: Optional[Exception] = None
        for attempt in range(8):
            try:
                os.replace(tmp_path, thumb_path)
                return thumb_path
            except PermissionError as exc:
                last_exc = exc
                # Another thread or reader may already hold the completed target file
                if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
                    try:
                        if os.path.exists(tmp_path):
                            os.remove(tmp_path)
                    except OSError:
                        pass
                    return thumb_path
                time.sleep(0.02 * (attempt + 1))
        if last_exc is not None:
            raise last_exc
        return thumb_path

    def get_or_create_thumbnail_sync(self, subfolder: str, filename: str, max_edge: int = 640) -> Optional[str]:
        full_path = self.resolve_safe_path(subfolder, filename, require_supported_ext=True)
        if not full_path or not os.path.exists(full_path):
            return None

        tier = self._normalize_thumb_tier(max_edge)
        mtime = int(os.path.getmtime(full_path))
        thumb_path = self._thumb_cache_path(subfolder, filename, mtime, max_edge=tier)

        if os.path.exists(thumb_path):
            return thumb_path

        ext = os.path.splitext(filename)[1].lower()
        is_video = ext in SUPPORTED_VIDEO_EXTS
        thumb_lock = self._get_thumb_lock(thumb_path)

        with thumb_lock:
            if os.path.exists(thumb_path):
                return thumb_path

            tmp_path = f"{thumb_path}.tmp_{os.getpid()}_{time.monotonic_ns()}"
            try:
                img: Optional[Image.Image] = None
                if is_video:
                    # 1. Try OpenCV fast first-frame grab
                    try:
                        import cv2
                        cap = cv2.VideoCapture(full_path)
                        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                        if total_frames > 10:
                            cap.set(cv2.CAP_PROP_POS_FRAMES, min(5, total_frames // 4))
                        ok, frame = cap.read()
                        cap.release()
                        if ok and frame is not None:
                            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                            img = Image.fromarray(frame_rgb)
                    except Exception:
                        img = None

                    # 2. Fallback to ffmpeg single frame extraction
                    if img is None:
                        try:
                            creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                            subprocess.run(
                                [
                                    "ffmpeg", "-y", "-ss", "0.2", "-i", full_path,
                                    "-vframes", "1", "-vf", f"scale={tier}:{tier}:force_original_aspect_ratio=decrease",
                                    "-q:v", "4" if tier < 640 else "3", "-f", "image2", tmp_path,
                                ],
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                                timeout=6,
                                check=True,
                                creationflags=creation_flags,
                            )
                            if os.path.exists(tmp_path):
                                return self._safe_replace_thumb(tmp_path, thumb_path)
                        except Exception:
                            if os.path.exists(tmp_path):
                                try:
                                    os.remove(tmp_path)
                                except Exception:
                                    pass

                    if img is None:
                        img = Image.new("RGB", (tier, int(tier * 9 / 16)), color=(24, 24, 30))
                else:
                    img = Image.open(full_path)

                resample = getattr(Image, "Resampling", Image).LANCZOS
                img.thumbnail((tier, tier), resample)
                if img.mode != "RGB":
                    img = img.convert("RGB")
                img.save(tmp_path, format="JPEG", quality=(82 if tier < 640 else 88), optimize=True)
                img.close()
                return self._safe_replace_thumb(tmp_path, thumb_path)
            except Exception as exc:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                print(f"[HammelArt Atelier] Thumbnail error for {filename}: {exc}")
                return None

    async def get_or_create_thumbnail(self, subfolder: str, filename: str, max_edge: int = 640, live: bool = True) -> Optional[str]:
        loop = asyncio.get_running_loop()
        if live:
            self._live_thumb_inflight += 1
            self._last_live_thumb_ts = time.monotonic()
            try:
                return await loop.run_in_executor(
                    self.executor, self.get_or_create_thumbnail_sync, subfolder, filename, max_edge
                )
            finally:
                self._live_thumb_inflight = max(0, self._live_thumb_inflight - 1)
                self._last_live_thumb_ts = time.monotonic()
        return await loop.run_in_executor(
            self._warm_executor, self.get_or_create_thumbnail_sync, subfolder, filename, max_edge
        )

    def get_full_metadata_sync(self, subfolder: str, filename: str) -> Optional[Dict[str, Any]]:
        full_path = self.resolve_safe_path(subfolder, filename, require_supported_ext=True)
        if not full_path or not os.path.exists(full_path):
            return None
        meta = extract_media_metadata(full_path)
        rel_key = self.make_file_key(subfolder, filename)
        meta["file_key"] = rel_key
        meta["filename"] = filename
        meta["subfolder"] = subfolder
        meta["is_favorite"] = rel_key in self._favorites
        meta["is_hidden"] = rel_key in self._hidden
        return meta

    async def get_full_metadata(self, subfolder: str, filename: str) -> Optional[Dict[str, Any]]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self.executor, self.get_full_metadata_sync, subfolder, filename)

    def get_clean_png_bytes_sync(self, subfolder: str, filename: str) -> Optional[bytes]:
        full_path = self.resolve_safe_path(subfolder, filename, require_supported_ext=True)
        if not full_path or not os.path.exists(full_path):
            return None
        ext = os.path.splitext(filename)[1].lower()
        if ext in SUPPORTED_VIDEO_EXTS:
            return None
        with Image.open(full_path) as img:
            clean = Image.new(img.mode, img.size)
            clean.paste(img)
            buf = io.BytesIO()
            clean.save(buf, format="PNG")
            return buf.getvalue()

    async def get_clean_png_bytes(self, subfolder: str, filename: str) -> Optional[bytes]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self.executor, self.get_clean_png_bytes_sync, subfolder, filename)

    def toggle_favorite(self, file_key: str) -> bool:
        if file_key in self._favorites:
            self._favorites.remove(file_key)
            state = False
        else:
            self._favorites.add(file_key)
            state = True
        self._save_json(self.favorites_file, sorted(self._favorites))
        return state

    def toggle_hidden(self, file_key: str) -> bool:
        if file_key in self._hidden:
            self._hidden.remove(file_key)
            state = False
        else:
            self._hidden.add(file_key)
            state = True
        self._save_json(self.hidden_file, sorted(self._hidden))
        return state

    def set_muted_folders(self, folders: List[str]) -> List[str]:
        self._muted_folders = sorted(set(folders))
        self._save_json(self.muted_folders_file, self._muted_folders)
        return self._muted_folders

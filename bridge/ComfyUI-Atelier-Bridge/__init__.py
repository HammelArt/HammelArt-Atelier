"""
ComfyUI-Atelier-Bridge
Zero-node lightweight companion extension allowing HammelArt Atelier
to open embedded workflows directly in a new ComfyUI tab.
"""

from __future__ import annotations

import math
import time
from typing import Any, Dict, Optional

from aiohttp import web

BRIDGE_VERSION = "0.9.6.1"


def _sanitize_json_value(obj: Any) -> Any:
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _sanitize_json_value(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_json_value(v) for v in obj]
    return obj

# Empty node mappings + WEB_DIRECTORY loads web/atelier_bridge.js cleanly across
# every ComfyUI tab without adding any dummy nodes or skip warnings.
NODE_CLASS_MAPPINGS: Dict[str, Any] = {}
NODE_DISPLAY_NAME_MAPPINGS: Dict[str, str] = {}
WEB_DIRECTORY = "./web"

_PENDING_TTL_SECONDS = 30.0
_last_active_sid: Optional[str] = None
_pending_workflow: Optional[Dict[str, Any]] = None


def _get_sockets(ps: Any) -> Dict[str, Any]:
    sockets = getattr(ps, "sockets", None)
    return sockets if isinstance(sockets, dict) else {}


def _get_target_sid(ps: Any) -> Optional[str]:
    sockets = _get_sockets(ps)
    if not sockets:
        return None
    if _last_active_sid and _last_active_sid in sockets:
        return _last_active_sid
    try:
        return list(sockets.keys())[-1]
    except Exception:
        return None


def _register_routes() -> None:
    try:
        import server  # type: ignore
    except Exception:
        return

    ps = getattr(server, "PromptServer", None)
    instance = getattr(ps, "instance", None) if ps is not None else None
    routes = getattr(instance, "routes", None) if instance is not None else None
    if instance is None or routes is None:
        return

    @routes.get("/atelier/ping")
    async def atelier_ping(request: web.Request) -> web.Response:
        sockets = _get_sockets(instance)
        return web.json_response(
            {
                "ok": True,
                "bridge": "atelier",
                "version": BRIDGE_VERSION,
                "clients": len(sockets),
                "active_sid": _get_target_sid(instance),
                "capabilities": ["open_workflow"],
            }
        )

    @routes.post("/atelier/heartbeat")
    async def atelier_heartbeat(request: web.Request) -> web.Response:
        global _last_active_sid
        try:
            body = await request.json()
        except Exception:
            body = {}
        client_id = str(body.get("clientId") or "").strip() if isinstance(body, dict) else ""
        if client_id:
            _last_active_sid = client_id
        sockets = _get_sockets(instance)
        return web.json_response({"ok": True, "clients": len(sockets)})

    @routes.post("/atelier/open-workflow")
    async def atelier_open_workflow(request: web.Request) -> web.Response:
        global _pending_workflow
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "Invalid JSON body"}, status=400)

        if not isinstance(body, dict):
            return web.json_response({"ok": False, "error": "Expected JSON object"}, status=400)

        workflow = body.get("workflow")
        prompt = body.get("prompt")
        has_wf = isinstance(workflow, dict) and bool(workflow)
        has_pr = isinstance(prompt, dict) and bool(prompt)
        if not has_wf and not has_pr:
            return web.json_response(
                {"ok": False, "error": "No workflow or prompt graph supplied"},
                status=400,
            )

        name = str(body.get("name") or "Atelier Workflow").strip() or "Atelier Workflow"
        payload = {
            "workflow": _sanitize_json_value(workflow) if has_wf else None,
            "prompt": _sanitize_json_value(prompt) if (has_pr and not has_wf) else None,
            "name": name,
        }

        sockets = _get_sockets(instance)
        target_sid = _get_target_sid(instance)
        if target_sid is not None:
            instance.send_sync("atelier.open_workflow", payload, sid=target_sid)
            return web.json_response(
                {
                    "ok": True,
                    "delivered": True,
                    "queued_for_open": False,
                    "sid": target_sid,
                    "clients": len(sockets),
                }
            )

        _pending_workflow = {
            "payload": payload,
            "expires_at": time.monotonic() + _PENDING_TTL_SECONDS,
        }
        return web.json_response(
            {
                "ok": True,
                "delivered": False,
                "queued_for_open": True,
                "clients": 0,
            }
        )

    @routes.get("/atelier/pending")
    async def atelier_pending(request: web.Request) -> web.Response:
        global _pending_workflow
        entry = _pending_workflow
        _pending_workflow = None
        if not entry or time.monotonic() > float(entry.get("expires_at", 0)):
            return web.json_response({"ok": True, "pending": None})
        return web.json_response({"ok": True, "pending": entry.get("payload")})


_register_routes()

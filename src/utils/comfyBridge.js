import { useEffect, useState } from "react";

export const COMFY_STORAGE_KEY = "argon_cb_comfy_cfg_v1";

export const DEFAULT_COMFY_CFG = {
  enabled: false,
  url: "auto",
  focusOnOpen: true,
  rootPath: "",
  customNodesPath: "",
  workflowsPath: "",
};

const OFFLINE_STATUS = {
  ok: true,
  online: false,
  state: "offline",
  url: "",
  clients: 0,
  capabilities: [],
  bundled_version: "",
  bridge_version: "",
  installed_on_disk: false,
  installed_disk_version: "",
  restart_needed: false,
  update_available: false,
  rootPath: "",
  customNodesPath: "",
  workflowsPath: "",
  folders: {},
};

export function loadComfyCfg() {
  try {
    const raw = window.localStorage.getItem(COMFY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COMFY_CFG };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_COMFY_CFG };
    return {
      ...DEFAULT_COMFY_CFG,
      ...parsed,
      enabled: Boolean(parsed.enabled),
      focusOnOpen: parsed.focusOnOpen !== undefined ? Boolean(parsed.focusOnOpen) : true,
      url: String(parsed.url || "auto").trim() || "auto",
      rootPath: String(parsed.rootPath || ""),
      customNodesPath: String(parsed.customNodesPath || ""),
      workflowsPath: String(parsed.workflowsPath || ""),
    };
  } catch {
    return { ...DEFAULT_COMFY_CFG };
  }
}

export function saveComfyCfg(nextOrUpdater) {
  const prev = loadComfyCfg();
  const next =
    typeof nextOrUpdater === "function" ? nextOrUpdater(prev) : { ...prev, ...(nextOrUpdater || {}) };
  try {
    window.localStorage.setItem(COMFY_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("hm:comfy-cfg-sync", { detail: next }));
  } catch {}
  return next;
}

export function deriveComfyUiState(cfg, status) {
  const enabled = Boolean(cfg?.enabled);
  const st = status?.state || "offline";
  if (st === "no_bridge") return "needs_bridge";
  if (st === "ready") return enabled ? "connected" : "detected";
  return enabled ? "sleeping" : "off";
}

export async function fetchComfyStatus(cfg = null) {
  const cur = cfg || loadComfyCfg();
  const qs = new URLSearchParams();
  if (cur.url) qs.set("url", cur.url);
  if (cur.rootPath) qs.set("root", cur.rootPath);
  if (cur.customNodesPath) qs.set("custom_nodes", cur.customNodesPath);
  try {
    const res = await fetch(`/api/comfy-status?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, online: false, state: "offline" };
    return await res.json();
  } catch {
    return { ok: false, online: false, state: "offline" };
  }
}

export async function fetchWorkflowJsonRequest(item) {
  if (!item?.filename) return { ok: false, error: "Invalid item" };
  const qs = new URLSearchParams({
    root_id: item.root_id || "",
    subfolder: item.subfolder || "",
    filename: item.filename || "",
  });
  try {
    const res = await fetch(`/api/workflow?${qs.toString()}`, { cache: "no-store" });
    return await res.json();
  } catch {
    return { ok: false, error: "Failed to fetch workflow JSON" };
  }
}

export async function openWorkflowInComfyRequest(item, cfg = null) {
  if (!item?.filename) return { ok: false, error: "Invalid item" };
  const cur = cfg || loadComfyCfg();
  try {
    const res = await fetch("/api/comfy/open-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root_id: item.root_id || "",
        subfolder: item.subfolder || "",
        filename: item.filename || "",
        url: cur.url || "auto",
        focusOnOpen: cur.focusOnOpen !== false,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "Request failed" }));
    if (data?.ok && data.queued_for_open && data.url) {
      window.open(data.url, "_blank", "noopener");
    }
    return data;
  } catch {
    return { ok: false, error: "Could not reach Atelier server" };
  }
}

export async function saveWorkflowToComfyDialogRequest(item, cfg = null) {
  if (!item?.filename) return { ok: false, error: "Invalid item" };
  const cur = cfg || loadComfyCfg();
  try {
    const res = await fetch("/api/comfy/save-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root_id: item.root_id || "",
        subfolder: item.subfolder || "",
        filename: item.filename || "",
        workflowsPath: cur.workflowsPath || "",
      }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Save dialog request failed" };
  }
}

export async function installComfyBridgeRequest(paths = {}) {
  try {
    const res = await fetch("/api/comfy/install-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paths),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Install request failed" };
  }
}

export async function uninstallComfyBridgeRequest(paths = {}) {
  try {
    const res = await fetch("/api/comfy/uninstall-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paths),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Remove request failed" };
  }
}

export async function browseComfyFolderRequest(initialPath = "") {
  try {
    const res = await fetch("/api/comfy/browse-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initialPath }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Browse request failed" };
  }
}

export async function openComfyFolderRequest(folderKey, cfg = null) {
  const cur = cfg || loadComfyCfg();
  try {
    const res = await fetch("/api/comfy/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: folderKey,
        rootPath: cur.rootPath || "",
        customNodesPath: cur.customNodesPath || "",
      }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Open folder request failed" };
  }
}

let _sharedSnapshot = {
  cfg: typeof window !== "undefined" ? loadComfyCfg() : { ...DEFAULT_COMFY_CFG },
  status: OFFLINE_STATUS,
  uiState: "off",
};

export function getComfyStateSnapshot() {
  return _sharedSnapshot;
}

export function publishComfyState(cfg, status) {
  const cleanCfg = cfg || loadComfyCfg();
  const cleanStatus = status || OFFLINE_STATUS;
  const uiState = deriveComfyUiState(cleanCfg, cleanStatus);
  _sharedSnapshot = { cfg: cleanCfg, status: cleanStatus, uiState };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hm:comfy-state-sync", { detail: _sharedSnapshot }));
  }
  return _sharedSnapshot;
}

export function requestComfyRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hm:comfy-refresh-request"));
  }
}

export function useComfyBridgeState() {
  const [snap, setSnap] = useState(() => getComfyStateSnapshot());

  useEffect(() => {
    setSnap(getComfyStateSnapshot());
    const onSync = (ev) => {
      if (ev?.detail) setSnap(ev.detail);
      else setSnap(getComfyStateSnapshot());
    };
    window.addEventListener("hm:comfy-state-sync", onSync);
    return () => window.removeEventListener("hm:comfy-state-sync", onSync);
  }, []);

  return snap;
}


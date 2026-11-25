/**
 * Shared cross-instance workspace persistence between localStorage and backend
 * `ui_session.json` (`/api/session-state`). Keeps folder selection, sort order,
 * mode, theme, presets, combos, wall layout, curation, and lightbox settings
 * identical across browser tabs, standalone desktop shortcut launches, and port switches.
 */

export const SYNCED_STORAGE_KEYS = [
  "argon_cb_app_mode_v4",
  "argon_cb_stage_mode_v1",
  "argon_cb_accent_id_v1",
  "argon_cb_btn_theme_v1",
  "argon_cb_btn_crisp_v1",
  "argon_cb_folder_filter_v4",
  "argon_cb_sort_by_v4",
  "argon_cb_single_v4",
  "argon_cb_wall_tree_v3",
  "argon_cb_wall_gap_v3",
  "argon_cb_drawer_side_v4",
  "argon_cb_drawer_sec_map_v1",
  "argon_cb_folder_sidebar_v1",
  "argon_cb_folder_sb_width_v1",
  "argon_cb_folder_sb_metric_v1",
  "argon_cb_hidden_folders_v1",
  "argon_cb_drop_action_v1",
  "argon_cb_welcome_dismissed_v1",
  "argon_cb_user_presets_v2",
  "argon_cb_wall_presets_v3",
  "argon_cb_folder_combos_v4",
  "argon_cb_screensaver_min_v1",
  "argon_cb_screensaver_src_v1",
  "argon_cb_purgatory_cfg_v1",
  "argon_cb_perma_pins_v1",
  "argon_cb_lightbox_cfg_v1",
  "argon_cb_saved_filters_v1",
  "hm_curation_v1",
];

const SYNCED_SET = new Set(SYNCED_STORAGE_KEYS);

let pendingPatch = {};
let flushTimer = null;
let bridgeInstalled = false;

function readLocalSnapshot() {
  const out = {};
  for (const key of SYNCED_STORAGE_KEYS) {
    try {
      const val = window.localStorage.getItem(key);
      if (val !== null) out[key] = val;
    } catch {}
  }
  return out;
}

async function flushSessionPatchNow(useBeacon = false) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = pendingPatch;
  pendingPatch = {};
  if (!batch || Object.keys(batch).length === 0) return;
  const payload = JSON.stringify({ storage: batch });
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/session-state", new Blob([payload], { type: "text/plain" }));
      return;
    }
    await fetch("/api/session-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
  } catch {}
}

function scheduleSessionSync(key, valueOrNull) {
  pendingPatch[key] = valueOrNull;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushSessionPatchNow(false);
  }, 240);
}

function installStorageBridge() {
  if (bridgeInstalled || typeof window === "undefined") return;
  bridgeInstalled = true;

  const proto = window.Storage?.prototype;
  if (proto) {
    const origSetItem = proto.setItem;
    const origRemoveItem = proto.removeItem;
    proto.setItem = function (key, value) {
      origSetItem.call(this, key, value);
      if (this === window.localStorage && SYNCED_SET.has(String(key))) {
        scheduleSessionSync(String(key), String(value));
      }
    };
    proto.removeItem = function (key) {
      origRemoveItem.call(this, key);
      if (this === window.localStorage && SYNCED_SET.has(String(key))) {
        scheduleSessionSync(String(key), null);
      }
    };
  }

  window.addEventListener("pagehide", () => {
    flushSessionPatchNow(true);
  });
  window.addEventListener("beforeunload", () => {
    flushSessionPatchNow(true);
  });
}

/**
 * Pulls shared workspace state from the backend before React hydrates so every
 * port / browser / desktop window starts in the exact same folder & layout.
 * If the backend store is empty on first boot, seeds it from existing localStorage.
 */
export async function hydrateSharedSessionState() {
  if (typeof window === "undefined") return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1100);
    const res = await fetch("/api/session-state", {
      cache: "no-store",
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      const data = await res.json();
      const serverStorage = data?.storage;
      if (serverStorage && typeof serverStorage === "object") {
        const entries = Object.entries(serverStorage);
        if (entries.length > 0) {
          for (const [k, v] of entries) {
            if (!SYNCED_SET.has(k) || typeof v !== "string") continue;
            try {
              window.localStorage.setItem(k, v);
            } catch {}
          }
        } else {
          const initialLocal = readLocalSnapshot();
          if (Object.keys(initialLocal).length > 0) {
            await fetch("/api/session-state", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ storage: initialLocal }),
            }).catch(() => {});
          }
        }
      }
    }
  } catch {
    // Offline/timeout fallback uses localStorage seamlessly
  } finally {
    installStorageBridge();
  }
}

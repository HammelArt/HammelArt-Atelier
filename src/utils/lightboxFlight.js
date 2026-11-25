/**
 * Helpers for capturing live card flight geometry/tilt from any gallery engine,
 * computing exact full-viewport destination frames, and managing persistent
 * Lightbox behavior preferences.
 */

export const LIGHTBOX_SETTINGS_KEY = "argon_cb_lightbox_cfg_v1";

export const DEFAULT_STYLE_PARAMS = {
  glide: { durationMs: 420, cushionSlap: true },
  spin: { durationMs: 560, cushionSlap: true, cardBackStyle: "white", showBackLogo: true },
  teleport: { durationMs: 680, teleportHoloRim: true },
  venom: { durationMs: 760, intensity: 100 },
  cloth: { durationMs: 640, intensity: 100 },
};

export const DEFAULT_EXIT_STYLE_PARAMS = {
  silk: { durationMs: 210 },
  drift: { durationMs: 230 },
  tuck: { durationMs: 220 },
  iris: { durationMs: 230 },
};

export const DEFAULT_LIGHTBOX_CFG = {
  entryStyle: "spin", // "instant" | "glide" | "spin" | "teleport" | "venom" | "cloth"
  styleParams: {
    glide: { ...DEFAULT_STYLE_PARAMS.glide },
    spin: { ...DEFAULT_STYLE_PARAMS.spin },
    teleport: { ...DEFAULT_STYLE_PARAMS.teleport },
    venom: { ...DEFAULT_STYLE_PARAMS.venom },
    cloth: { ...DEFAULT_STYLE_PARAMS.cloth },
  },
  exitStyle: "silk", // "silk" | "drift" | "tuck" | "iris" | "instant"
  exitStyleParams: {
    silk: { ...DEFAULT_EXIT_STYLE_PARAMS.silk },
    drift: { ...DEFAULT_EXIT_STYLE_PARAMS.drift },
    tuck: { ...DEFAULT_EXIT_STYLE_PARAMS.tuck },
    iris: { ...DEFAULT_EXIT_STYLE_PARAMS.iris },
  },
  ambientGlow: true,
  autoHideHud: true,
  filmstripOpen: false,
  inspectorOpen: true,
  edgePadding: 14,
  videoDefault1to1: true,
  inspectorFields: {
    resolution: true,
    fileSize: true,
    model: true,
    seed: true,
    sampler: true,
    scheduler: true,
    steps: true,
    cfg: true,
    guidance: true,
    denoise: false,
    shift: false,
    vae: true,
    clip: true,
    loras: true,
    negativePrompt: true,
  },
};

export function getStyleParams(cfg, styleId) {
  const key = DEFAULT_STYLE_PARAMS[styleId] ? styleId : "spin";
  return {
    ...DEFAULT_STYLE_PARAMS[key],
    ...(cfg?.styleParams?.[key] || {}),
  };
}

export function getExitStyleParams(cfg, exitStyleId) {
  const key = DEFAULT_EXIT_STYLE_PARAMS[exitStyleId] ? exitStyleId : "silk";
  return {
    ...DEFAULT_EXIT_STYLE_PARAMS[key],
    ...(cfg?.exitStyleParams?.[key] || {}),
  };
}

export function loadLightboxCfg() {
  try {
    const raw = localStorage.getItem(LIGHTBOX_SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_LIGHTBOX_CFG,
        styleParams: {
          glide: { ...DEFAULT_STYLE_PARAMS.glide },
          spin: { ...DEFAULT_STYLE_PARAMS.spin },
          teleport: { ...DEFAULT_STYLE_PARAMS.teleport },
          venom: { ...DEFAULT_STYLE_PARAMS.venom },
          cloth: { ...DEFAULT_STYLE_PARAMS.cloth },
        },
      };
    }
    const parsed = JSON.parse(raw);
    const mergedStyleParams = {};
    for (const k of Object.keys(DEFAULT_STYLE_PARAMS)) {
      mergedStyleParams[k] = {
        ...DEFAULT_STYLE_PARAMS[k],
        ...(parsed.styleParams?.[k] || {}),
      };
      if (Number.isFinite(mergedStyleParams[k].intensity)) {
        mergedStyleParams[k].intensity = Math.max(25, Math.min(150, mergedStyleParams[k].intensity));
      }
    }
    const mergedExitStyleParams = {};
    for (const k of Object.keys(DEFAULT_EXIT_STYLE_PARAMS)) {
      mergedExitStyleParams[k] = {
        ...DEFAULT_EXIT_STYLE_PARAMS[k],
        ...(parsed.exitStyleParams?.[k] || {}),
      };
      if (Number.isFinite(mergedExitStyleParams[k].durationMs)) {
        mergedExitStyleParams[k].durationMs = Math.max(
          120,
          Math.min(500, mergedExitStyleParams[k].durationMs)
        );
      }
    }
    // Clean migration if upgrading from earlier single-slider saved config
    if (!parsed.styleParams) {
      if (Number.isFinite(parsed.flightDurationMs)) {
        for (const k of Object.keys(mergedStyleParams)) {
          mergedStyleParams[k].durationMs = parsed.flightDurationMs;
        }
      }
      if (typeof parsed.cushionSlap === "boolean") {
        mergedStyleParams.glide.cushionSlap = parsed.cushionSlap;
        mergedStyleParams.spin.cushionSlap = parsed.cushionSlap;
      }
      if (parsed.cardBackStyle) mergedStyleParams.spin.cardBackStyle = parsed.cardBackStyle;
      if (typeof parsed.showBackLogo === "boolean") mergedStyleParams.spin.showBackLogo = parsed.showBackLogo;
      if (typeof parsed.teleportHoloRim === "boolean") mergedStyleParams.teleport.teleportHoloRim = parsed.teleportHoloRim;
      if (Number.isFinite(parsed.membraneIntensity)) {
        mergedStyleParams.venom.intensity = parsed.membraneIntensity;
        mergedStyleParams.cloth.intensity = parsed.membraneIntensity;
      }
    }

    const merged = {
      ...DEFAULT_LIGHTBOX_CFG,
      ...parsed,
      styleParams: mergedStyleParams,
      exitStyleParams: mergedExitStyleParams,
      inspectorFields: {
        ...DEFAULT_LIGHTBOX_CFG.inspectorFields,
        ...(parsed.inspectorFields || {}),
      },
    };
    if (!parsed.entryStyle && typeof parsed.spin360 === "boolean") {
      merged.entryStyle = parsed.spin360 ? "spin" : "glide";
    }
    return merged;
  } catch {
    return {
      ...DEFAULT_LIGHTBOX_CFG,
      inspectorFields: { ...DEFAULT_LIGHTBOX_CFG.inspectorFields },
      styleParams: {
        glide: { ...DEFAULT_STYLE_PARAMS.glide },
        spin: { ...DEFAULT_STYLE_PARAMS.spin },
        teleport: { ...DEFAULT_STYLE_PARAMS.teleport },
        venom: { ...DEFAULT_STYLE_PARAMS.venom },
        cloth: { ...DEFAULT_STYLE_PARAMS.cloth },
      },
      exitStyleParams: {
        silk: { ...DEFAULT_EXIT_STYLE_PARAMS.silk },
        drift: { ...DEFAULT_EXIT_STYLE_PARAMS.drift },
        tuck: { ...DEFAULT_EXIT_STYLE_PARAMS.tuck },
        iris: { ...DEFAULT_EXIT_STYLE_PARAMS.iris },
      },
    };
  }
}

export function saveLightboxCfg(cfg) {
  try {
    localStorage.setItem(LIGHTBOX_SETTINGS_KEY, JSON.stringify(cfg));
  } catch {}
}

/**
 * Extracts true screen center, unrotated layout dimensions (avoiding AABB diagonal
 * bloat on tilted cards), and Z rotation angle for any gallery tile or tabletop card.
 */
export function getElementTrueRectAndAngle(el) {
  if (!el || !el.getBoundingClientRect) return null;
  const rect = el.getBoundingClientRect();
  if (!rect || rect.width <= 4 || rect.height <= 4) return null;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let rz = 0;

  const attrRot = el.getAttribute?.("data-lb-rot");
  if (attrRot !== null && attrRot !== "") {
    const parsed = Number(attrRot);
    if (Number.isFinite(parsed)) rz = parsed;
  } else if (typeof window !== "undefined") {
    try {
      const tf = window.getComputedStyle(el).transform;
      if (tf && tf !== "none") {
        const m = new DOMMatrix(tf);
        rz = (Math.atan2(m.m12, m.m11) * 180) / Math.PI;
      }
    } catch {}
  }

  // Unrotated offsetWidth/offsetHeight prevents bounding-box inflation on rotated cards
  const useLayoutBox = Math.abs(rz) > 0.25 && el.offsetWidth > 12 && el.offsetHeight > 12;
  const w = useLayoutBox ? el.offsetWidth : rect.width;
  const h = useLayoutBox ? el.offsetHeight : rect.height;

  return {
    left: cx - w / 2,
    top: cy - h / 2,
    width: w,
    height: h,
    cx,
    cy,
    rz,
  };
}

/**
 * Extracts live screen bounding rect + current 2D/3D rotation angles from
 * the clicked card DOM element across Classic, Conveyor, and Slideshow / Table Pile.
 */
export function captureInspectPayload(targetEl, item, items = [], extra = {}) {
  let origin = null;
  let originEl = null;
  if (targetEl) {
    const cardEl = targetEl.classList?.contains?.("cb-tile-fx")
      ? targetEl
      : targetEl.querySelector?.(".cb-tile-fx") || targetEl;
    originEl = cardEl;
    const trueBox = getElementTrueRectAndAngle(cardEl);
    let rz = Number.isFinite(extra.rz) ? extra.rz : trueBox?.rz || 0;

    if (trueBox) {
      origin = {
        cx: trueBox.cx,
        cy: trueBox.cy,
        w: trueBox.width,
        h: trueBox.height,
        rx: Number.isFinite(extra.rx) ? extra.rx : 0,
        ry: Number.isFinite(extra.ry) ? extra.ry : 0,
        rz,
      };
    }
  }

  return {
    item,
    items: Array.isArray(items) && items.length ? items : item ? [item] : [],
    sourceLabel: extra.sourceLabel || "",
    origin,
    originEl,
  };
}

/**
 * Computes the exact stage bounds & Fit image rectangle for a given viewport,
 * item aspect ratio, inspector drawer state, and filmstrip visibility.
 */
export function computeLightboxDestRect(
  vw,
  vh,
  itemAspect,
  inspectorOpen = false,
  filmstripOpen = false,
  edgePadding = 14,
  opts = {}
) {
  const inspectorW = inspectorOpen && vw > 920 ? 372 : 0;
  const filmstripH = filmstripOpen ? 88 : 0;
  const pad = Math.max(0, Number(edgePadding) || 0);

  const stageW = Math.max(240, vw - inspectorW - pad * 2);
  const stageH = Math.max(200, vh - filmstripH - pad * 2);
  const stageCx = pad + stageW / 2;
  const stageCy = pad + stageH / 2;

  const ar = Number(itemAspect) > 0.1 ? Number(itemAspect) : 1;
  let w = stageW;
  let h = w / ar;
  if (h > stageH) {
    h = stageH;
    w = h * ar;
  }

  const capW = Number(opts?.capWidth) || 0;
  const capH = Number(opts?.capHeight) || 0;
  if (capW > 0 && capH > 0) {
    const capScale = Math.min(1, capW / w, capH / h);
    w *= capScale;
    h *= capScale;
  }

  return {
    stageW,
    stageH,
    stageCx,
    stageCy,
    w: Math.max(40, w),
    h: Math.max(40, h),
    inspectorW,
    filmstripH,
  };
}

/**
 * Generates curved-flight glowing energy shards for the Lightbox Teleport FX.
 */
export function createTeleportParticles(origin, dest, count = 148) {
  const oLeft = origin.cx - origin.w * 0.5;
  const oTop = origin.cy - origin.h * 0.5;
  const dLeft = dest.stageCx - dest.w * 0.5;
  const dTop = dest.stageCy - dest.h * 0.5;

  const particles = [];
  for (let i = 0; i < count; i++) {
    const u0 = Math.random();
    const v0 = Math.random();
    const u1 = Math.random();
    const v1 = Math.random();
    particles.push({
      ox: oLeft + u0 * origin.w,
      oy: oTop + v0 * origin.h,
      dx: dLeft + u1 * dest.w,
      dy: dTop + v1 * dest.h,
      startT: u0 * 0.40,
      arriveT: 0.42 + u1 * 0.52,
      arcX: (Math.random() - 0.5) * 140,
      arcY: (Math.random() - 0.5) * 180,
      size: 2.2 + Math.random() * 4.4,
      bright: Math.random() > 0.42,
    });
  }
  return particles;
}

/**
 * Canonical item identifier shared between gallery tiles and the lightbox.
 * Primary root (`root_1`) keeps legacy `subfolder/filename` keys for backward compat;
 * additional roots namespace cleanly as `rootId::subfolder/filename`.
 */
export function itemKey(item) {
  if (!item) return "";
  const rel = `${item.subfolder || ""}/${item.filename}`;
  if (item.root_id && item.root_id !== "root_1") {
    return `${item.root_id}::${rel}`;
  }
  return rel;
}

export function getMediaUrl(item) {
  if (!item) return "";
  const rootQ = item.root_id ? `&root_id=${encodeURIComponent(item.root_id)}` : "";
  return `/api/media?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(
    item.subfolder || ""
  )}${rootQ}`;
}

export function getThumbnailUrl(item, { maxEdge = 640 } = {}) {
  if (!item) return "";
  const rootQ = item.root_id ? `&root_id=${encodeURIComponent(item.root_id)}` : "";
  const maxQ = maxEdge && maxEdge !== 640 ? `&max=${Math.round(maxEdge)}` : "";
  return `/api/thumbnail?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(
    item.subfolder || ""
  )}${rootQ}${maxQ}`;
}

/**
 * Locates the visible `.cb-tile-fx` socket element for any gallery item within
 * the active stage so Quiet Tuck & socket lifting stay live across A/D browsing.
 */
export function findVisibleTileForItem(item, originEl) {
  const key = itemKey(item);
  if (!key || typeof document === "undefined") return null;

  if (originEl?.isConnected && originEl.getAttribute("data-lb-key") === key) {
    return originEl;
  }

  const stage = originEl?.closest?.(".cb-stage") || document;

  const bounds =
    stage !== document && stage.getBoundingClientRect
      ? stage.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

  const candidates = stage.querySelectorAll(".cb-tile-fx[data-lb-key]");
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (el.getAttribute("data-lb-key") !== key) continue;
    const r = el.getBoundingClientRect();
    if (
      r.width > 12 &&
      r.height > 12 &&
      r.right > bounds.left + 8 &&
      r.left < bounds.right - 8 &&
      r.bottom > bounds.top + 8 &&
      r.top < bounds.bottom - 8
    ) {
      return el;
    }
  }
  return null;
}

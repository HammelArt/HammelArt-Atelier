/**
 * Global Deletion & Purgatory Teleport FX Utilities
 * --------------------------------------------------
 * Two-tier visual feedback:
 *  - Tier 1 ("zap"): Fixed, crisp sci-fi theme beam when staging into Purgatory.
 *  - Tier 2 (Global Delete FX): Selectable permanent SSD destruction finishers
 *    ("ember" | "lightning" | "poof" | "instant").
 */

export const DELETE_FX_OPTIONS = [
  {
    id: "ember",
    label: "Ember Burn",
    hint: "Charred fire edge consumes the print with rising sparks",
  },
  {
    id: "lightning",
    label: "Lightning",
    hint: "Forked bolt strike, micro-shake & quick vapor smoke puff",
  },
  {
    id: "poof",
    label: "Magic Poof",
    hint: "Snappy shrink into a glowing pinpoint sparkle burst",
  },
  {
    id: "instant",
    label: "Instant",
    hint: "Zero animation delay for ultra-fast culling",
  },
];

function findCardMediaElement(rootEl) {
  if (!rootEl) return null;
  const fullLoaded = rootEl.querySelector?.(".lb-img-layer.full.is-loaded");
  if (fullLoaded && fullLoaded.complete && fullLoaded.naturalWidth > 0) return fullLoaded;
  const thumb = rootEl.querySelector?.(".lb-img-layer.thumb");
  if (thumb && thumb.complete && thumb.naturalWidth > 0) return thumb;
  const img = rootEl.querySelector?.("img");
  if (img && img.complete && img.naturalWidth > 0) return img;
  const vid = rootEl.querySelector?.("video");
  if (vid && vid.readyState >= 2) return vid;
  return img || vid || null;
}

/**
 * Captures screen-space geometry + bitmap source for a single card or Lightbox hero
 * right before removing/hiding its DOM node.
 */
export function captureTileFxTarget(key, explicitEl = null) {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;

  let el = explicitEl;
  if (!el && key) {
    const nodes = document.querySelectorAll(".cb-tile-fx[data-lb-key]");
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.getAttribute("data-lb-key") !== key) continue;
      const r = node.getBoundingClientRect();
      if (r.width > 12 && r.height > 12 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh) {
        el = node;
        break;
      }
    }
  }
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 8 || rect.height <= 8) return null;
  if (rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh) return null;

  let radius = 10;
  try {
    radius = parseFloat(window.getComputedStyle(el).borderTopLeftRadius) || 10;
  } catch {}

  const imgEl = findCardMediaElement(el);
  return {
    key,
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height,
    cx: rect.left + rect.width * 0.5,
    cy: rect.top + rect.height * 0.5,
    radius: Math.min(radius, Math.min(rect.width, rect.height) * 0.5),
    imgEl,
  };
}

/**
 * Procedural forked lightning bolt generator (adapted from StealthLightningCrest).
 */
export function buildForkedBolt(startX, startY, endX, endY, depth = 0) {
  const segs = [];
  const dist = Math.hypot(endX - startX, endY - startY);
  const steps = depth === 0 ? Math.max(9, Math.min(18, Math.round(dist / 42))) : 6;
  let prevX = startX;
  let prevY = startY;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const amp = depth === 0 ? Math.min(54, Math.max(18, dist * 0.085)) : 16;
    const jitter = (1 - t * 0.35) * amp;
    const nx =
      i === steps
        ? endX
        : startX + (endX - startX) * t + (Math.random() - 0.5) * jitter;
    const ny =
      i === steps
        ? endY
        : startY + (endY - startY) * t + (Math.random() - 0.5) * jitter * 0.5;

    segs.push({ x1: prevX, y1: prevY, x2: nx, y2: ny, depth });

    if (depth === 0 && i > 1 && i < steps - 1 && Math.random() < 0.38) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const bLen = Math.max(32, Math.min(110, dist * 0.22));
      const bEndX = nx + side * (bLen * (0.5 + Math.random() * 0.6));
      const bEndY = ny + bLen * (0.45 + Math.random() * 0.65);
      segs.push(...buildForkedBolt(nx, ny, bEndX, bEndY, 1));
    }

    prevX = nx;
    prevY = ny;
  }
  return segs;
}

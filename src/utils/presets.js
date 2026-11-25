import { matchesFolderSpec } from "./folderTree";
import { itemKey } from "./lightboxFlight";
import { buildDefaultStyleParamsMap, SLIDESHOW_STYLES } from "./slideshowStyles";
import { countActiveAdvancedFilters, matchesAdvancedFilter } from "./advancedFilter";

export const DEFAULT_CONVEYOR = {
  flowMode: "snake", // snake | parallel
  axis: "horizontal",
  turnStyle: "split",
  lanes: 3,
  laneFill: 100,
  tileShape: "natural",
  gap: 12,
  cornerRadius: 12,
  bend: 0,
  autoSpeed: 54,
  paused: false,
  cursorSteer: true,
  hoverBrake: true,
  edgeFade: true,
  showGuideWire: true,
  showMetadata: true,
  hoverFX: "pop_tilt",
  uncropHover: false,
};

export const DEFAULT_CLASSIC = {
  layoutStyle: "masonry", // grid | masonry
  cols: 7,
  sizeFill: 100,
  tileShape: "natural",
  ratioTame: 0, // 0 = full true aspect, 100 = pulled to square
  wideSpan: false, // 2-col span for widescreen shots in Masonry
  gap: 14,
  cornerRadius: 12,
  autoSpeed: 0,
  paused: false,
  edgeFX: "fade", // fade | tilt | pop | curtain
  cursorSteer: true,
  hoverBrake: true,
  loopWrap: false,
  edgeFade: true,
  showMetadata: true,
  hoverFX: "pop_tilt",
  uncropHover: false,
};

export const DEFAULT_SLIDESHOW = {
  styleId: "table_pile",
  holdSec: 5,
  shuffle: true,
  ambientHalo: true,
  haloStrength: 55,
  cornerRadius: 12,
  showTimerBar: false,
  hoverControls: true,
  paused: false,
  styleParams: buildDefaultStyleParamsMap(),
};

export function normalizeSlideshowCfg(raw = {}) {
  const defaults = buildDefaultStyleParamsMap();
  const rawParams = raw && typeof raw.styleParams === "object" && raw.styleParams ? raw.styleParams : {};
  const mergedParams = {};
  for (let i = 0; i < SLIDESHOW_STYLES.length; i++) {
    const s = SLIDESHOW_STYLES[i];
    mergedParams[s.id] = {
      ...defaults[s.id],
      ...(rawParams[s.id] && typeof rawParams[s.id] === "object" ? rawParams[s.id] : {}),
    };
  }
  return {
    ...DEFAULT_SLIDESHOW,
    ...(raw && typeof raw === "object" ? raw : {}),
    styleParams: mergedParams,
  };
}

export const BUILTIN_PRESETS = [
  {
    id: "snake_studio",
    label: "🐍 Snake Split",
    engineMode: "conveyor",
    cfg: { ...DEFAULT_CONVEYOR, flowMode: "snake", lanes: 3, laneFill: 100, showGuideWire: true },
  },
  {
    id: "parallel_streams",
    label: "🌊 Parallel Independent",
    engineMode: "conveyor",
    cfg: {
      ...DEFAULT_CONVEYOR,
      flowMode: "parallel",
      turnStyle: "split",
      lanes: 3,
      laneFill: 100,
      autoSpeed: 48,
      showGuideWire: false,
    },
  },
  {
    id: "filmstrip",
    label: "🎬 32% Filmstrip",
    engineMode: "conveyor",
    cfg: {
      ...DEFAULT_CONVEYOR,
      flowMode: "parallel",
      lanes: 1,
      laneFill: 32,
      autoSpeed: 50,
      showGuideWire: false,
    },
  },
  {
    id: "circular_bowl",
    label: "🎡 Circular Gallery",
    engineMode: "conveyor",
    cfg: {
      ...DEFAULT_CONVEYOR,
      flowMode: "parallel",
      lanes: 1,
      laneFill: 68,
      bend: -4.2,
      autoSpeed: 48,
      showGuideWire: false,
    },
  },
  {
    id: "vertical_duo",
    label: "↕️ Vertical Cascade",
    engineMode: "conveyor",
    cfg: {
      ...DEFAULT_CONVEYOR,
      axis: "vertical",
      flowMode: "snake",
      turnStyle: "split",
      lanes: 7,
      autoSpeed: 48,
      showGuideWire: true,
    },
  },
  {
    id: "classic_explorer",
    label: "📋 Classic Explorer",
    engineMode: "classic",
    cfg: { ...DEFAULT_CLASSIC, layoutStyle: "grid", cols: 7, autoSpeed: 0, edgeFX: "fade" },
  },
  {
    id: "classic_waterfall",
    label: "🏛️ Masonry Auto-Cruise",
    engineMode: "classic",
    cfg: {
      ...DEFAULT_CLASSIC,
      layoutStyle: "masonry",
      cols: 5,
      autoSpeed: 32,
      edgeFX: "tilt",
      hoverFX: "bounce",
    },
  },
  {
    id: "slideshow_pile",
    label: "🃏 Tabletop Photo Pile",
    engineMode: "slideshow",
    cfg: normalizeSlideshowCfg({ styleId: "table_pile", holdSec: 5, shuffle: true, ambientHalo: true }),
  },
  {
    id: "slideshow_silk",
    label: "🎞️ Silk Exhibition",
    engineMode: "slideshow",
    cfg: normalizeSlideshowCfg({ styleId: "silk_crossfade", holdSec: 6, shuffle: true, ambientHalo: true }),
  },
  {
    id: "slideshow_cinema",
    label: "🎥 Cinema Pan & Zoom",
    engineMode: "slideshow",
    cfg: normalizeSlideshowCfg({ styleId: "cinema_drift", holdSec: 7, shuffle: true, ambientHalo: true }),
  },
  {
    id: "slideshow_velvet",
    label: "🖼️ Velvet Glide",
    engineMode: "slideshow",
    cfg: normalizeSlideshowCfg({ styleId: "velvet_glide", holdSec: 6, shuffle: true, ambientHalo: true }),
  },
  {
    id: "slideshow_louvre",
    label: "💎 Louvre Glass Flip",
    engineMode: "slideshow",
    cfg: normalizeSlideshowCfg({ styleId: "louvre_flip", holdSec: 6, shuffle: true, ambientHalo: true }),
  },
];

export function getBaseDefaults(mode) {
  if (mode === "classic") return DEFAULT_CLASSIC;
  if (mode === "slideshow") return DEFAULT_SLIDESHOW;
  return DEFAULT_CONVEYOR;
}

function shallowOrNestedEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!shallowOrNestedEqual(a[k], b[k])) return false;
  }
  return true;
}

export function isPresetMatched(preset, engineMode, conveyorCfg, classicCfg, slideshowCfg) {
  if (!preset || preset.engineMode !== engineMode) return false;
  if (engineMode === "slideshow") {
    const cur = normalizeSlideshowCfg(slideshowCfg);
    const snap = normalizeSlideshowCfg(preset.cfg);
    return Object.keys(DEFAULT_SLIDESHOW).every((k) => shallowOrNestedEqual(cur[k], snap[k]));
  }
  const base = getBaseDefaults(engineMode);
  const activeCfg = engineMode === "classic" ? classicCfg : conveyorCfg;
  const cur = { ...base, ...activeCfg };
  const snap = { ...base, ...preset.cfg };
  return Object.keys(base).every((k) => cur[k] === snap[k]);
}

export function filterAndSortItems(
  rawItems,
  folderFilter,
  search,
  sortBy,
  shuffleSeed,
  folderCombos = [],
  curationOpts = {}
) {
  const {
    favSet = null,
    pinSet = null,
    purgatorySet = null,
    notesMap = null,
    favoritesOnly = false,
    searchAllFolders = false,
    advancedFilter = null,
  } = curationOpts;

  const q = (search || "").trim().toLowerCase();
  const effectiveSpec = searchAllFolders ? "ALL" : folderFilter;
  const wantsPurgatory = effectiveSpec === "__PURGATORY__";
  const hasAdv = Boolean(advancedFilter && countActiveAdvancedFilters(advancedFilter) > 0);
  const nowSec = hasAdv ? Date.now() / 1000 : 0;

  let list = rawItems.filter((it) => {
    const key = itemKey(it);
    const isFav = Boolean(favSet && favSet.has(key));
    const isPurg = Boolean(purgatorySet && purgatorySet.has(key));
    if (wantsPurgatory) {
      if (!isPurg) return false;
    } else {
      if (isPurg) return false;
      if (favoritesOnly && !isFav) return false;
      if (!matchesFolderSpec(it.subfolder, effectiveSpec, folderCombos, isFav, isPurg, it.root_id || "root_1"))
        return false;
    }
    if (hasAdv && !matchesAdvancedFilter(it, advancedFilter, { key, pinSet, notesMap }, nowSec)) {
      return false;
    }
    if (q) {
      const note = notesMap?.[key] || "";
      const blob = `${it.filename} ${it.search_blob || ""} ${it.raw_prompt || ""} ${
        it.model || ""
      } ${it.model_short || ""} ${it.seed || ""} ${note}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });

  list = [...list];
  if (sortBy === "newest") list.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  else if (sortBy === "oldest") list.sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
  else if (sortBy === "size") list.sort((a, b) => (b.file_size_bytes || 0) - (a.file_size_bytes || 0));
  else if (sortBy === "aspect") list.sort((a, b) => (a.aspect_ratio || 1) - (b.aspect_ratio || 1));
  else if (sortBy === "name") list.sort((a, b) => (a.filename || "").localeCompare(b.filename || ""));
  else if (sortBy === "shuffle") {
    list.sort((a, b) => {
      const ha = Math.sin((a.filename || "").length * 91.7 + shuffleSeed * 13.3);
      const hb = Math.sin((b.filename || "").length * 91.7 + shuffleSeed * 13.3);
      return ha - hb;
    });
  }

  // Float pinned items cleanly to the top regardless of active sort
  if (pinSet && pinSet.size > 0 && list.length > 1) {
    const pinned = [];
    const rest = [];
    for (let i = 0; i < list.length; i++) {
      if (pinSet.has(itemKey(list[i]))) pinned.push(list[i]);
      else rest.push(list[i]);
    }
    if (pinned.length > 0) return [...pinned, ...rest];
  }
  return list;
}

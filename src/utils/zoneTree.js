import {
  DEFAULT_CONVEYOR,
  DEFAULT_CLASSIC,
  DEFAULT_SLIDESHOW,
  BUILTIN_PRESETS,
  normalizeSlideshowCfg,
} from "./presets";

const LEGACY_PRESET_MIGRATION = {
  horizon_arc: "slideshow_silk",
  horizon_concave: "slideshow_cinema",
  horizon_convex: "slideshow_louvre",
};

export const MAX_ZONES = 8;
export const MIN_SPLIT_RATIO = 0.14;
export const MAX_SPLIT_RATIO = 0.86;

let uidCounter = 1;
export function nextUid(prefix = "z") {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter}`;
}

export function createZone(overrides = {}) {
  return {
    type: "zone",
    id: overrides.id || nextUid("z"),
    folderFilter: null, // null = follow Global top bar folder
    sortBy: null, // null = follow Global top bar sort
    engineMode: "conveyor",
    conveyorCfg: { ...DEFAULT_CONVEYOR },
    classicCfg: { ...DEFAULT_CLASSIC },
    slideshowCfg: normalizeSlideshowCfg(),
    activePresetId: "snake_studio",
    lastUserPresetId: null,
    ...overrides,
    type: "zone",
  };
}

export function applyPresetObjectToZone(zone, preset) {
  if (!preset) return zone;
  const mode = preset.engineMode || "conveyor";
  const next = {
    ...zone,
    engineMode: mode,
    activePresetId: preset.id,
  };
  if (mode === "classic") {
    next.classicCfg = { ...DEFAULT_CLASSIC, ...preset.cfg };
  } else if (mode === "slideshow") {
    next.slideshowCfg = normalizeSlideshowCfg(preset.cfg);
  } else {
    next.conveyorCfg = { ...DEFAULT_CONVEYOR, ...preset.cfg };
  }
  return next;
}

export function zoneFromPresetId(presetId, customPresets = [], overrides = {}) {
  const all = [...BUILTIN_PRESETS, ...customPresets];
  const found = all.find((p) => p.id === presetId) || BUILTIN_PRESETS[0];
  const isCustom = customPresets.some((p) => p.id === found.id);
  const base = createZone({
    ...overrides,
    lastUserPresetId: isCustom ? found.id : null,
  });
  return applyPresetObjectToZone(base, found);
}

export function countZones(node) {
  if (!node) return 0;
  if (node.type === "zone") return 1;
  return countZones(node.a) + countZones(node.b);
}

export function listZones(node, acc = []) {
  if (!node) return acc;
  if (node.type === "zone") {
    acc.push(node);
    return acc;
  }
  listZones(node.a, acc);
  listZones(node.b, acc);
  return acc;
}

export function findZone(node, id) {
  if (!node) return null;
  if (node.type === "zone") return node.id === id ? node : null;
  return findZone(node.a, id) || findZone(node.b, id);
}

export function updateZone(node, id, updater) {
  if (!node) return node;
  if (node.type === "zone") {
    return node.id === id ? updater(node) : node;
  }
  const nextA = updateZone(node.a, id, updater);
  const nextB = updateZone(node.b, id, updater);
  if (nextA === node.a && nextB === node.b) return node;
  return { ...node, a: nextA, b: nextB };
}

/**
 * Splits a target zone along one of its 4 edges ("left" | "right" | "top" | "bottom").
 * Returns { tree, newZoneId } cleanly without breaking rectangle parity.
 */
export function splitZone(root, targetId, edge, customPresets = []) {
  if (countZones(root) >= MAX_ZONES) {
    return { tree: root, newZoneId: null };
  }
  let createdId = null;

  const recurse = (node) => {
    if (!node) return node;
    if (node.type === "zone") {
      if (node.id !== targetId) return node;
      // Pick an inviting contrasting preset for newly spawned zones
      const existingCount = countZones(root);
      const cyclePresets = ["parallel_streams", "classic_waterfall", "slideshow_pile", "filmstrip"];
      const pickedPresetId = cyclePresets[(existingCount - 1) % cyclePresets.length];
      const sibling = zoneFromPresetId(pickedPresetId, customPresets, {
        id: nextUid("z"),
        folderFilter: "__EMPTY_ZONE__",
        sortBy: node.sortBy,
      });
      createdId = sibling.id;

      const dir = edge === "left" || edge === "right" ? "row" : "col";
      const newFirst = edge === "left" || edge === "top";
      return {
        type: "split",
        id: nextUid("s"),
        dir,
        ratio: 0.5,
        a: newFirst ? sibling : node,
        b: newFirst ? node : sibling,
      };
    }
    const nextA = recurse(node.a);
    const nextB = recurse(node.b);
    if (nextA === node.a && nextB === node.b) return node;
    return { ...node, a: nextA, b: nextB };
  };

  return { tree: recurse(root), newZoneId: createdId };
}

export function removeZone(root, targetId) {
  if (countZones(root) <= 1) return root;

  const recurse = (node) => {
    if (!node || node.type === "zone") return node;
    if (node.a.type === "zone" && node.a.id === targetId) return node.b;
    if (node.b.type === "zone" && node.b.id === targetId) return node.a;
    const nextA = recurse(node.a);
    const nextB = recurse(node.b);
    if (nextA === node.a && nextB === node.b) return node;
    return { ...node, a: nextA, b: nextB };
  };

  return recurse(root);
}

export function updateSplitRatio(root, splitId, nextRatio) {
  const clamped = Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, nextRatio));
  const recurse = (node) => {
    if (!node || node.type === "zone") return node;
    if (node.id === splitId) {
      return { ...node, ratio: Number(clamped.toFixed(4)) };
    }
    const nextA = recurse(node.a);
    const nextB = recurse(node.b);
    if (nextA === node.a && nextB === node.b) return node;
    return { ...node, a: nextA, b: nextB };
  };
  return recurse(root);
}

export function swapZones(root, idA, idB) {
  if (!idA || !idB || idA === idB) return root;
  const zoneA = findZone(root, idA);
  const zoneB = findZone(root, idB);
  if (!zoneA || !zoneB) return root;

  const recurse = (node) => {
    if (!node) return node;
    if (node.type === "zone") {
      if (node.id === idA) return { ...zoneB, id: idA };
      if (node.id === idB) return { ...zoneA, id: idB };
      return node;
    }
    return { ...node, a: recurse(node.a), b: recurse(node.b) };
  };
  return recurse(root);
}

export function migrateZoneNode(node) {
  if (!node) return node;
  if (node.type === "zone") {
    const rawMode = node.engineMode === "horizon" ? "slideshow" : node.engineMode || "conveyor";
    const migratedPreset =
      LEGACY_PRESET_MIGRATION[node.activePresetId] || node.activePresetId || null;
    return {
      ...node,
      engineMode: rawMode,
      conveyorCfg: { ...DEFAULT_CONVEYOR, ...node.conveyorCfg },
      classicCfg: { ...DEFAULT_CLASSIC, ...node.classicCfg },
      slideshowCfg: normalizeSlideshowCfg(node.slideshowCfg),
      activePresetId: migratedPreset,
    };
  }
  return {
    ...node,
    a: migrateZoneNode(node.a),
    b: migrateZoneNode(node.b),
  };
}

export function cloneTreeWithFreshIds(node) {
  if (!node) return node;
  if (node.type === "zone") {
    return {
      ...node,
      id: nextUid("z"),
      engineMode: node.engineMode === "horizon" ? "slideshow" : node.engineMode,
      conveyorCfg: { ...DEFAULT_CONVEYOR, ...node.conveyorCfg },
      classicCfg: { ...DEFAULT_CLASSIC, ...node.classicCfg },
      slideshowCfg: normalizeSlideshowCfg(node.slideshowCfg),
    };
  }
  return {
    ...node,
    id: nextUid("s"),
    a: cloneTreeWithFreshIds(node.a),
    b: cloneTreeWithFreshIds(node.b),
  };
}

export function buildBuiltinWallPresets() {
  return [
    {
      id: "wall_single",
      label: "Single Canvas",
      seamGap: 0,
      buildTree: () => zoneFromPresetId("snake_studio", [], { id: "z_main" }),
    },
    {
      id: "wall_dual_split",
      label: "Dual 50 / 50",
      seamGap: 8,
      buildTree: () => ({
        type: "split",
        id: "s_dual",
        dir: "row",
        ratio: 0.56,
        a: zoneFromPresetId("classic_waterfall", [], { id: "z_left" }),
        b: zoneFromPresetId("parallel_streams", [], { id: "z_right" }),
      }),
    },
    {
      id: "wall_cockpit_21_9",
      label: "21:9 Cockpit (3 Zones)",
      seamGap: 8,
      buildTree: () => ({
        type: "split",
        id: "s_cockpit_root",
        dir: "row",
        ratio: 0.58,
        a: zoneFromPresetId("classic_explorer", [], { id: "z_work" }),
        b: {
          type: "split",
          id: "s_cockpit_r",
          dir: "col",
          ratio: 0.62,
          a: zoneFromPresetId("slideshow_silk", [], { id: "z_slideshow" }),
          b: zoneFromPresetId("filmstrip", [], { id: "z_strip" }),
        },
      }),
    },
    {
      id: "wall_triple_strip",
      label: "Triple Mosaic Strips",
      seamGap: 6,
      buildTree: () => ({
        type: "split",
        id: "s_tri_1",
        dir: "col",
        ratio: 0.34,
        a: zoneFromPresetId("parallel_streams", [], { id: "z_top" }),
        b: {
          type: "split",
          id: "s_tri_2",
          dir: "col",
          ratio: 0.5,
          a: zoneFromPresetId("classic_waterfall", [], { id: "z_mid" }),
          b: zoneFromPresetId("slideshow_cinema", [], { id: "z_bot" }),
        },
      }),
    },
  ];
}

export function canonicalTree(node) {
  if (!node) return null;
  if (node.type === "zone") {
    return {
      type: "zone",
      folderFilter: node.folderFilter || null,
      sortBy: node.sortBy || null,
      engineMode: node.engineMode,
      conveyorCfg: node.conveyorCfg,
      classicCfg: node.classicCfg,
      slideshowCfg: node.slideshowCfg,
      activePresetId: node.activePresetId || null,
    };
  }
  return {
    type: "split",
    dir: node.dir,
    ratio: Number(node.ratio.toFixed(3)),
    a: canonicalTree(node.a),
    b: canonicalTree(node.b),
  };
}

export function areTreesEquivalent(a, b) {
  return JSON.stringify(canonicalTree(a)) === JSON.stringify(canonicalTree(b));
}

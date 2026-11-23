import { itemKey } from "./lightboxFlight";

/**
 * Multi-root hierarchical folder tree builder & zero-snowball filtering helpers.
 * Supports:
 * - "ALL" | null | { type: "all" } -> every render across ALL mounted roots
 * - "rootId::*" -> all folders + loose (Root) files inside that single root
 * - "rootId::(Root)" or "(Root)" -> loose files directly inside that root
 * - "rootId::subfolder" or "subfolder" -> folder + descendants inside that root
 * - { type: "custom", paths: string[] } -> exact selected scoped folder paths across any roots
 * - { type: "combo", comboId: string } -> dynamic link to a saved Folder Combo preset
 */

export const EMPTY_ZONE_FILTER = "__EMPTY_ZONE__";

export function formatCompactFolderSize(mb) {
  const val = Number(mb) || 0;
  if (val <= 0) return "0MB";
  if (val < 1) return "<1MB";
  if (val < 1024) return `${Math.round(val)}MB`;
  const gb = val / 1024;
  if (gb < 10) return `${gb.toFixed(1).replace(/\.0$/, "")}GB`;
  if (gb < 1024) return `${Math.round(gb)}GB`;
  const tb = gb / 1024;
  return `${tb < 10 ? tb.toFixed(1).replace(/\.0$/, "") : Math.round(tb)}TB`;
}

export function normalizeSubfolder(rawSub) {
  if (!rawSub || rawSub === "(Root)") return "(Root)";
  return String(rawSub).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "(Root)";
}

export function parseScopedFolderPath(specStr, defaultRootId = "root_1") {
  if (typeof specStr !== "string" || !specStr) {
    return {
      rootId: defaultRootId,
      subfolder: "(Root)",
      isRootAll: false,
      scoped: `${defaultRootId}::(Root)`,
    };
  }
  const idx = specStr.indexOf("::");
  if (idx > 0) {
    const rootId = specStr.slice(0, idx);
    const rawSub = specStr.slice(idx + 2);
    if (rawSub === "*") {
      return { rootId, subfolder: "*", isRootAll: true, scoped: `${rootId}::*` };
    }
    const sf = normalizeSubfolder(rawSub);
    return { rootId, subfolder: sf, isRootAll: false, scoped: `${rootId}::${sf}` };
  }
  const sf = normalizeSubfolder(specStr);
  return { rootId: defaultRootId, subfolder: sf, isRootAll: false, scoped: `${defaultRootId}::${sf}` };
}

export function toScopedPath(pathOrScoped, defaultRootId = "root_1") {
  return parseScopedFolderPath(pathOrScoped, defaultRootId).scoped;
}

export function formatScopedFolderPath(rootId = "root_1", subfolder = "(Root)") {
  if (subfolder === "*") return `${rootId}::*`;
  return `${rootId}::${normalizeSubfolder(subfolder)}`;
}

function injectEmptyFoldersIntoTree(tree, extraFolders = [], rootId = null) {
  if (!extraFolders?.length) return tree;
  const { rootNode, nodesByPath, allPaths } = tree;
  for (let i = 0; i < extraFolders.length; i++) {
    const clean = String(extraFolders[i] || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!clean || clean === "(Root)" || nodesByPath.has(clean)) continue;
    const parts = clean.split("/").filter(Boolean);
    let acc = "";
    for (let p = 0; p < parts.length; p++) {
      const prev = acc;
      acc = acc ? `${acc}/${parts[p]}` : parts[p];
      if (!nodesByPath.has(acc)) {
        const node = {
          name: parts[p],
          path: acc,
          scopedPath: rootId ? `${rootId}::${acc}` : acc,
          rootId: rootId || "root_1",
          directCount: 0,
          totalCount: 0,
          directSizeMb: 0,
          totalSizeMb: 0,
          children: [],
          isVirtualRoot: false,
        };
        nodesByPath.set(acc, node);
        if (prev) {
          nodesByPath.get(prev).children.push(node);
          nodesByPath.get(prev).children.sort((a, b) => a.name.localeCompare(b.name));
        } else {
          rootNode.children.push(node);
          rootNode.children.sort((a, b) => a.name.localeCompare(b.name));
        }
        allPaths.push(node.scopedPath);
      }
    }
  }
  return tree;
}

/**
 * Builds a sorted directory tree from `rawItems`, tracking both
 * `directCount` (files directly inside that folder) and `totalCount` (subtree).
 */
export function buildDirectoryTree(rawItems = [], rootId = null, extraFolders = []) {
  const effectiveRootId = rootId || "root_1";
  const counts = new Map();
  const sizesMb = new Map();
  rawItems.forEach((it) => {
    const sf = normalizeSubfolder(it.subfolder);
    counts.set(sf, (counts.get(sf) || 0) + 1);
    const sz = Number(it?.file_size_mb) || 0;
    if (sz > 0) sizesMb.set(sf, (sizesMb.get(sf) || 0) + sz);
  });

  const nodesByPath = new Map();
  const rootNode = {
    name: "(Root)",
    path: "(Root)",
    scopedPath: `${effectiveRootId}::(Root)`,
    rootId: effectiveRootId,
    directCount: counts.get("(Root)") || 0,
    totalCount: 0,
    directSizeMb: sizesMb.get("(Root)") || 0,
    totalSizeMb: 0,
    children: [],
    isVirtualRoot: true,
  };
  nodesByPath.set("(Root)", rootNode);

  for (const [sf, count] of counts.entries()) {
    if (sf === "(Root)") continue;
    const parts = sf.split("/").filter(Boolean);
    let accPath = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const prevPath = accPath;
      accPath = accPath ? `${accPath}/${part}` : part;
      if (!nodesByPath.has(accPath)) {
        const node = {
          name: part,
          path: accPath,
          scopedPath: `${effectiveRootId}::${accPath}`,
          rootId: effectiveRootId,
          directCount: 0,
          totalCount: 0,
          directSizeMb: 0,
          totalSizeMb: 0,
          children: [],
          isVirtualRoot: false,
        };
        nodesByPath.set(accPath, node);
        if (prevPath) {
          nodesByPath.get(prevPath).children.push(node);
        } else {
          rootNode.children.push(node);
        }
      }
      if (i === parts.length - 1) {
        const leaf = nodesByPath.get(accPath);
        leaf.directCount = count;
        leaf.directSizeMb = sizesMb.get(sf) || 0;
      }
    }
  }

  const sortAndSum = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    let countSum = node.directCount;
    let sizeSum = node.directSizeMb || 0;
    for (const child of node.children) {
      const childTotals = sortAndSum(child);
      countSum += childTotals.count;
      sizeSum += childTotals.sizeMb;
    }
    node.totalCount = countSum;
    node.totalSizeMb = sizeSum;
    return { count: countSum, sizeMb: sizeSum };
  };
  sortAndSum(rootNode);

  const allPaths = [];
  const collectPaths = (node) => {
    if (!node.isVirtualRoot || node.directCount > 0) {
      allPaths.push(rootId ? node.scopedPath : node.path);
    }
    for (const child of node.children) collectPaths(child);
  };
  collectPaths(rootNode);

  const tree = { rootNode, nodesByPath, allPaths };
  return extraFolders?.length
    ? injectEmptyFoldersIntoTree(tree, extraFolders, rootId ? effectiveRootId : null)
    : tree;
}

/**
 * Groups items & extra empty folders by mounted root, returning one tree section per root.
 */
export function buildMultiRootTrees(rawItems = [], roots = [], extraFoldersByRoot = {}) {
  const effectiveRoots =
    Array.isArray(roots) && roots.length > 0
      ? roots
      : rawItems.length > 0
      ? [{ id: "root_1", label: "Output", path: "" }]
      : [];

  const itemsByRoot = new Map();
  effectiveRoots.forEach((r) => itemsByRoot.set(r.id, []));
  const fallbackRootId = effectiveRoots[0]?.id || "root_1";

  rawItems.forEach((it) => {
    const rid = it?.root_id || fallbackRootId;
    if (!itemsByRoot.has(rid)) itemsByRoot.set(rid, []);
    itemsByRoot.get(rid).push(it);
  });

  return effectiveRoots.map((root) => {
    const items = itemsByRoot.get(root.id) || [];
    const extras = extraFoldersByRoot?.[root.id] || [];
    const tree = buildDirectoryTree(items, root.id, extras);
    return {
      root,
      tree,
      allScopedPaths: tree.allPaths,
      totalCount: tree.rootNode.totalCount,
      totalSizeMb: tree.rootNode.totalSizeMb,
    };
  });
}

export function getBranchPaths(node, includeEmpty = false, scoped = false) {
  const out = [];
  const walk = (n) => {
    if (includeEmpty || n.directCount > 0) {
      out.push(scoped && n.scopedPath ? n.scopedPath : n.path);
    }
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

export function resolveComboObject(spec, folderCombos = []) {
  if (!spec || typeof spec !== "object" || spec.type !== "combo") return null;
  return folderCombos.find((c) => c.id === spec.comboId) || null;
}

export function extractSelectedPathsFromSpec(spec, allScopedPaths = [], folderCombos = [], defaultRootId = "root_1") {
  if (spec === EMPTY_ZONE_FILTER) return [];
  if (!spec || spec === "ALL" || spec === "__FAVORITES__" || spec === "__PURGATORY__") {
    return [...allScopedPaths];
  }
  if (typeof spec === "string") {
    const parsed = parseScopedFolderPath(spec, defaultRootId);
    const rootPrefix = `${parsed.rootId}::`;
    if (parsed.isRootAll) {
      return allScopedPaths.filter((p) => p.startsWith(rootPrefix));
    }
    if (parsed.subfolder === "(Root)") {
      const target = `${parsed.rootId}::(Root)`;
      return allScopedPaths.includes(target) ? [target] : [];
    }
    const exact = `${parsed.rootId}::${parsed.subfolder}`;
    const childPrefix = `${exact}/`;
    return allScopedPaths.filter((p) => p === exact || p.startsWith(childPrefix));
  }
  if (spec.type === "all") return [...allScopedPaths];
  if (spec.type === "custom" && Array.isArray(spec.paths)) {
    return spec.paths.map((p) => toScopedPath(p, defaultRootId));
  }
  if (spec.type === "combo") {
    const found = resolveComboObject(spec, folderCombos);
    return found && Array.isArray(found.paths)
      ? found.paths.map((p) => toScopedPath(p, defaultRootId))
      : [...allScopedPaths];
  }
  return [...allScopedPaths];
}

export function matchesFolderSpec(
  rawSubfolderOrItem,
  spec,
  folderCombos = [],
  isFav = false,
  isPurg = false,
  itemRootId = "root_1"
) {
  if (!spec || spec === "ALL" || spec?.type === "all") return true;
  if (spec === EMPTY_ZONE_FILTER) return false;
  if (spec === "__PURGATORY__") return Boolean(isPurg);
  if (spec === "__FAVORITES__") return Boolean(isFav);

  const subRaw =
    rawSubfolderOrItem && typeof rawSubfolderOrItem === "object"
      ? rawSubfolderOrItem.subfolder
      : rawSubfolderOrItem;
  const rid =
    (rawSubfolderOrItem && typeof rawSubfolderOrItem === "object"
      ? rawSubfolderOrItem.root_id
      : itemRootId) || "root_1";

  const sf = normalizeSubfolder(subRaw);
  const scopedSf = `${rid}::${sf}`;

  if (typeof spec === "string") {
    const parsed = parseScopedFolderPath(spec, "root_1");
    if (parsed.rootId !== rid) return false;
    if (parsed.isRootAll) return true;
    if (parsed.subfolder === "(Root)") return sf === "(Root)";
    return sf === parsed.subfolder || sf.startsWith(`${parsed.subfolder}/`);
  }
  if (spec.type === "custom" && Array.isArray(spec.paths)) {
    if (spec.favoritesOnly && !isFav) return false;
    return spec.paths.some((p) => toScopedPath(p, "root_1") === scopedSf);
  }
  if (spec.type === "combo") {
    const found = resolveComboObject(spec, folderCombos);
    if (!found || !Array.isArray(found.paths)) return true;
    if ((spec.favoritesOnly || found.favoritesOnly) && !isFav) return false;
    return found.paths.some((p) => toScopedPath(p, "root_1") === scopedSf);
  }
  return true;
}

export function getFolderSpecLabel(spec, folderCombos = [], roots = []) {
  if (!spec || spec === "ALL" || spec?.type === "all") return "All Folders";
  if (spec === EMPTY_ZONE_FILTER) return "Choose Folder…";
  if (spec === "__FAVORITES__") return "Favorites";
  if (spec === "__PURGATORY__") return "Purgatory";
  const multi = Array.isArray(roots) && roots.length > 1;
  const rootLabelFor = (rid) => {
    const found = roots?.find((r) => r.id === rid);
    if (found) return found.label;
    return Array.isArray(roots) && roots.length > 0 ? "Unmounted" : rid;
  };

  if (typeof spec === "string") {
    const idx = spec.indexOf("::");
    if (idx > 0) {
      const rid = spec.slice(0, idx);
      const sub = spec.slice(idx + 2);
      const rLabel = rootLabelFor(rid);
      if (sub === "*") return `All in ${rLabel}`;
      return multi ? `${rLabel} · ${sub}` : sub;
    }
    return spec;
  }
  if (spec.type === "combo") {
    const found = resolveComboObject(spec, folderCombos);
    if (!found) return "All Folders";
    return found.favoritesOnly ? `${found.label} ★` : found.label;
  }
  if (spec.type === "custom") {
    const count = spec.paths?.length || 0;
    const base =
      count === 0
        ? "No Folders"
        : count === 1
        ? getFolderSpecLabel(spec.paths[0], folderCombos, roots)
        : `${count} Folders Mix`;
    return spec.favoritesOnly ? `${base} ★` : base;
  }
  return "All Folders";
}

export function arePathListsEqual(a = [], b = [], defaultRootId = "root_1") {
  if (a.length !== b.length) return false;
  const sa = a.map((p) => toScopedPath(p, defaultRootId)).sort();
  const sb = b.map((p) => toScopedPath(p, defaultRootId)).sort();
  return sa.every((v, idx) => v === sb[idx]);
}

function zoneSpecReferencesRoot(spec, rootId, deletedComboIdsSet) {
  if (!spec || typeof spec !== "object") {
    if (typeof spec === "string" && spec !== "ALL" && spec !== "__FAVORITES__" && spec !== "__PURGATORY__") {
      return parseScopedFolderPath(spec, "root_1").rootId === rootId;
    }
    return false;
  }
  if (spec.type === "custom" && Array.isArray(spec.paths)) {
    return spec.paths.some((p) => parseScopedFolderPath(p, "root_1").rootId === rootId);
  }
  if (spec.type === "combo") {
    return Boolean(deletedComboIdsSet?.has(spec.comboId));
  }
  return false;
}

function countZonesReferencingRoot(node, rootId, affectedComboIdsSet) {
  if (!node) return false;
  if (node.type === "zone") {
    return zoneSpecReferencesRoot(node.folderFilter, rootId, affectedComboIdsSet);
  }
  if (node.type === "split" && Array.isArray(node.children)) {
    return node.children.some((c) => countZonesReferencingRoot(c, rootId, affectedComboIdsSet));
  }
  return false;
}

/**
 * Inspects Folder Combos & saved Wall Presets before unmounting a root folder.
 * Distinguishes exclusive combos (must be deleted) from cross-root combos (can strip or delete).
 */
export function analyzeRootRemovalImpact(rootId, folderCombos = [], userWallPresets = []) {
  const exclusiveCombos = [];
  const mixedCombos = [];

  for (const c of folderCombos || []) {
    const paths = Array.isArray(c?.paths) ? c.paths : [];
    const scoped = paths.map((p) => parseScopedFolderPath(p, "root_1"));
    const hasRemoved = scoped.some((x) => x.rootId === rootId);
    if (!hasRemoved) continue;
    const hasOther = scoped.some((x) => x.rootId !== rootId);
    if (hasOther) {
      mixedCombos.push(c);
    } else {
      exclusiveCombos.push(c);
    }
  }

  const allAffectedComboIds = new Set([...exclusiveCombos, ...mixedCombos].map((c) => c.id));
  const affectedWallPresets = (userWallPresets || []).filter((wp) =>
    countZonesReferencingRoot(wp?.tree, rootId, allAffectedComboIds)
  );

  return { exclusiveCombos, mixedCombos, affectedWallPresets };
}

const PERMA_PINS_KEY = "argon_cb_perma_pins_v1";

export function permaPinBelongsToRoot(entry, rootId) {
  if (!entry || !rootId) return false;
  const itemRootId = entry.item?.root_id;
  if (itemRootId) return itemRootId === rootId;
  const k = typeof entry.key === "string" ? entry.key : "";
  if (k.includes("::")) return k.startsWith(`${rootId}::`);
  return rootId === "root_1";
}

export function getRootPermaPins(rootId) {
  if (!rootId || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PERMA_PINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => permaPinBelongsToRoot(entry, rootId));
  } catch {
    return [];
  }
}

export function removeRootPermaPins(rootId) {
  if (!rootId || typeof localStorage === "undefined") return 0;
  try {
    const raw = localStorage.getItem(PERMA_PINS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    const next = parsed.filter((entry) => !permaPinBelongsToRoot(entry, rootId));
    if (next.length !== parsed.length) {
      localStorage.setItem(PERMA_PINS_KEY, JSON.stringify(next));
      return parsed.length - next.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

function cleanZoneNodeForRootRemoval(node, rootId, deletedComboIdsSet) {
  if (!node) return node;
  if (node.type === "zone") {
    const ff = node.folderFilter;
    if (zoneSpecReferencesRoot(ff, rootId, deletedComboIdsSet)) {
      if (ff && typeof ff === "object" && ff.type === "custom" && Array.isArray(ff.paths)) {
        const remaining = ff.paths.filter((p) => parseScopedFolderPath(p, "root_1").rootId !== rootId);
        return {
          ...node,
          folderFilter: remaining.length > 0 ? { ...ff, paths: remaining } : "ALL",
        };
      }
      return { ...node, folderFilter: "ALL" };
    }
    return node;
  }
  if (node.type === "split" && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map((c) => cleanZoneNodeForRootRemoval(c, rootId, deletedComboIdsSet)),
    };
  }
  return node;
}

function cleanLiveWallNodeForRootRemoval(node, rootId) {
  if (!node) return node;
  if (node.type === "zone") {
    const ff = node.folderFilter;
    if (ff && typeof ff === "object" && ff.type === "custom" && Array.isArray(ff.paths)) {
      const remaining = ff.paths.filter((p) => parseScopedFolderPath(p, "root_1").rootId !== rootId);
      if (remaining.length > 0 && remaining.length < ff.paths.length) {
        return { ...node, folderFilter: { ...ff, paths: remaining } };
      }
    }
    return node;
  }
  if (node.type === "split" && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map((c) => cleanLiveWallNodeForRootRemoval(c, rootId)),
    };
  }
  return node;
}

export function isFolderSpecUnmountedRoot(spec, roots = [], folderCombos = []) {
  if (!Array.isArray(roots) || roots.length === 0) return false;
  const mountedIds = new Set(roots.map((r) => r.id));
  if (!spec || spec === "ALL" || spec === EMPTY_ZONE_FILTER || spec === "__FAVORITES__" || spec === "__PURGATORY__") {
    return false;
  }
  if (typeof spec === "string") {
    if (spec.startsWith("__COMBO__:")) {
      const cid = spec.slice("__COMBO__:".length);
      return !(folderCombos || []).some((c) => c.id === cid);
    }
    const { rootId } = parseScopedFolderPath(spec, roots[0]?.id || "root_1");
    return Boolean(rootId && !mountedIds.has(rootId));
  }
  if (typeof spec === "object") {
    if (spec.type === "combo") {
      return !(folderCombos || []).some((c) => c.id === spec.comboId);
    }
    if (spec.type === "custom" && Array.isArray(spec.paths)) {
      if (spec.paths.length === 0) return false;
      return !spec.paths.some((p) => mountedIds.has(parseScopedFolderPath(p, roots[0]?.id || "root_1").rootId));
    }
  }
  return false;
}

export function applyRootRemovalToState(
  rootId,
  { folderCombos = [], userWallPresets = [], wallTree = null, folderFilter = "ALL" },
  mixedPolicy = "strip" // "strip" | "delete"
) {
  const { exclusiveCombos, mixedCombos } = analyzeRootRemovalImpact(rootId, folderCombos, userWallPresets);
  const deleteIds = new Set(exclusiveCombos.map((c) => c.id));
  if (mixedPolicy === "delete") {
    mixedCombos.forEach((c) => deleteIds.add(c.id));
  }

  const nextCombos = (folderCombos || [])
    .filter((c) => !deleteIds.has(c.id))
    .map((c) => {
      if (mixedPolicy === "strip" && mixedCombos.some((m) => m.id === c.id)) {
        return {
          ...c,
          paths: (c.paths || []).filter((p) => parseScopedFolderPath(p, "root_1").rootId !== rootId),
        };
      }
      return c;
    });

  const nextWallPresets = (userWallPresets || []).map((wp) => ({
    ...wp,
    tree: cleanZoneNodeForRootRemoval(wp.tree, rootId, deleteIds),
  }));

  // Preserve live Wall Mode zone references so zones pointing to an unmounted root pause
  // cleanly with a "+ Add Folder" empty state instead of unexpectedly dumping All Folders.
  const nextWallTree = cleanLiveWallNodeForRootRemoval(wallTree, rootId);

  let nextFolderFilter = folderFilter;
  if (zoneSpecReferencesRoot(folderFilter, rootId, deleteIds)) {
    if (folderFilter && typeof folderFilter === "object" && folderFilter.type === "custom" && Array.isArray(folderFilter.paths)) {
      const remaining = folderFilter.paths.filter((p) => parseScopedFolderPath(p, "root_1").rootId !== rootId);
      nextFolderFilter = remaining.length > 0 ? { ...folderFilter, paths: remaining } : "ALL";
    } else {
      nextFolderFilter = "ALL";
    }
  }

  return { nextCombos, nextWallPresets, nextWallTree, nextFolderFilter };
}

/**
 * Flattens the directory tree into hierarchical Quick Folder entries:
 * supports both single-root and stacked multi-root displays.
 */
export function flattenQuickFolderEntries(
  rawItems = [],
  favSet = null,
  purgatorySet = null,
  roots = [],
  extraFoldersByRoot = {}
) {
  const hasPurg = Boolean(purgatorySet && purgatorySet.size > 0);
  const liveItems = hasPurg
    ? rawItems.filter((it) => !purgatorySet.has(itemKey(it)))
    : rawItems;

  const favCount =
    favSet && favSet.size > 0
      ? liveItems.filter((it) => favSet.has(itemKey(it))).length
      : 0;
  const purgCount = rawItems.length - liveItems.length;

  const rootSections = buildMultiRootTrees(liveItems, roots, extraFoldersByRoot);
  const multi = rootSections.length > 1;

  const out = [
    {
      value: "__FAVORITES__",
      label: "Favorites",
      menuLabel: "Favorites",
      depth: 0,
      totalCount: favCount,
      isFavorites: true,
    },
    {
      value: "__PURGATORY__",
      label: "Purgatory",
      menuLabel: "Purgatory",
      depth: 0,
      totalCount: purgCount,
      isPurgatory: true,
    },
    {
      value: "ALL",
      label: multi ? "All Folders (All Roots)" : "All Folders",
      menuLabel: multi ? "All Folders (All Roots)" : "All Folders",
      depth: 0,
      totalCount: liveItems.length,
    },
  ];

  const walk = (nodes, depth, rootLabel, rootId) => {
    for (const node of nodes) {
      out.push({
        value: node.scopedPath || `${rootId}::${node.path}`,
        label: multi ? `${rootLabel} · ${node.path}` : node.path,
        menuLabel: node.name,
        depth,
        totalCount: node.totalCount,
      });
      if (node.children?.length) {
        walk(node.children, depth + 1, rootLabel, rootId);
      }
    }
  };

  for (const sec of rootSections) {
    if (multi) {
      out.push({
        value: `${sec.root.id}::*`,
        label: `All in ${sec.root.label}`,
        menuLabel: sec.root.label,
        depth: 0,
        totalCount: sec.totalCount,
        isRootHeader: true,
      });
    }
    walk(sec.tree.rootNode.children, multi ? 1 : 0, sec.root.label, sec.root.id);
  }

  return out;
}

export function remapSubfolderPrefix(sub, oldSub, nextSub) {
  const clean = normalizeSubfolder(sub);
  if (clean === "(Root)" || !oldSub) return sub;
  if (clean === oldSub) return nextSub;
  if (clean.startsWith(`${oldSub}/`)) {
    return `${nextSub}${clean.slice(oldSub.length)}`;
  }
  return sub;
}

export function remapFolderSpecForTreeOp(
  spec,
  rootId,
  oldSub,
  nextSubOrNull,
  fallbackRootId = "root_1"
) {
  if (!spec || typeof spec === "string") {
    if (
      !spec ||
      spec === "ALL" ||
      spec === "__FAVORITES__" ||
      spec === "__PURGATORY__" ||
      spec === EMPTY_ZONE_FILTER
    ) {
      return spec;
    }
    const parsed = parseScopedFolderPath(spec, fallbackRootId);
    if (parsed.rootId !== rootId || parsed.isRootAll || parsed.subfolder === "(Root)") {
      return spec;
    }
    const isMatch = parsed.subfolder === oldSub || parsed.subfolder.startsWith(`${oldSub}/`);
    if (!isMatch) return spec;
    if (nextSubOrNull) {
      return `${rootId}::${nextSubOrNull}${parsed.subfolder.slice(oldSub.length)}`;
    }
    if (oldSub.includes("/")) {
      return `${rootId}::${oldSub.slice(0, oldSub.lastIndexOf("/"))}`;
    }
    return "ALL";
  }

  if (spec && typeof spec === "object" && spec.type === "custom" && Array.isArray(spec.paths)) {
    const nextPaths = [];
    for (const p of spec.paths) {
      const parsed = parseScopedFolderPath(p, fallbackRootId);
      if (parsed.rootId !== rootId || parsed.isRootAll || parsed.subfolder === "(Root)") {
        nextPaths.push(p);
        continue;
      }
      const isMatch = parsed.subfolder === oldSub || parsed.subfolder.startsWith(`${oldSub}/`);
      if (!isMatch) {
        nextPaths.push(p);
        continue;
      }
      if (nextSubOrNull) {
        nextPaths.push(`${rootId}::${nextSubOrNull}${parsed.subfolder.slice(oldSub.length)}`);
      }
    }
    if (nextPaths.length === 0) return nextSubOrNull ? spec : "ALL";
    return { ...spec, paths: nextPaths };
  }

  return spec;
}

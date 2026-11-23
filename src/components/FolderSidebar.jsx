import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  ChevronRight,
  ChevronDown,
  Search,
  Sparkles,
  Flame,
  Pin,
  PinOff,
  RefreshCw,
  X,
  SlidersHorizontal,
  HardDrive,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Check,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  buildMultiRootTrees,
  formatCompactFolderSize,
  parseScopedFolderPath,
  toScopedPath,
} from "../utils/folderTree";
import { itemKey } from "../utils/lightboxFlight";
import { FavMark, useCuration } from "../utils/curation";

function MetricToggleChip({ metricMode, count, sizeMb, onToggle }) {
  return (
    <button
      type="button"
      className={`hm-sb-count is-interactive ${metricMode === "size" ? "is-size" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      title={
        metricMode === "size"
          ? `${formatCompactFolderSize(sizeMb)} (${count} renders) — click to show count (#)`
          : `${count} renders (${formatCompactFolderSize(sizeMb)}) — click to show disk size`
      }
      aria-label="Toggle between folder render count and disk size"
    >
      {metricMode === "size" ? formatCompactFolderSize(sizeMb) : count}
    </button>
  );
}

const HIDDEN_FOLDERS_KEY = "argon_cb_hidden_folders_v1";

function loadHiddenFoldersSet() {
  try {
    const raw = window.localStorage.getItem(HIDDEN_FOLDERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    }
  } catch {}
  return new Set();
}

function countHiddenNodes(nodes = [], hiddenSet) {
  if (!hiddenSet || hiddenSet.size === 0 || !nodes?.length) return 0;
  let total = 0;
  for (const n of nodes) {
    const key = n.scopedPath || n.path;
    if (hiddenSet.has(key)) total += 1;
    if (n.children?.length) total += countHiddenNodes(n.children, hiddenSet);
  }
  return total;
}

function SidebarTreeNode({
  node,
  depth,
  metricMode = "count",
  onToggleMetricMode,
  activeScopedSpec,
  expandedSet,
  filterText,
  staticDroppable,
  isDraggingFiles,
  dragHoverTarget,
  onToggleExpand,
  onSelectFolder,
  createTarget = null,
  renderCreateForm,
  renamingNode = null,
  renameValue = "",
  onChangeRenameValue,
  onCommitRename,
  onCancelRename,
  ctxTargetKey = "",
  onOpenContextMenu,
  hiddenSet = null,
  showHidden = false,
  parentHidden = false,
}) {
  const nodeKey = node.scopedPath || node.path;
  const isHiddenSelf = Boolean(hiddenSet && hiddenSet.has(nodeKey));
  const isHiddenNode = isHiddenSelf || parentHidden;
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpanded = expandedSet.has(nodeKey) || Boolean(filterText.trim());
  const isExactActive = activeScopedSpec === nodeKey;
  const isDropHot = staticDroppable && isDraggingFiles && dragHoverTarget === nodeKey;
  const isCreatingChildHere =
    Boolean(createTarget) &&
    createTarget.rootId === node.rootId &&
    createTarget.parentSub === node.path;
  const isRenamingThis =
    Boolean(renamingNode) &&
    renamingNode.rootId === node.rootId &&
    renamingNode.path === node.path;
  const isCtxTarget = ctxTargetKey === nodeKey;

  const q = filterText.trim().toLowerCase();
  const visible = useMemo(() => {
    if (isHiddenNode && !showHidden) return false;
    if (!q) return true;
    const check = (n, inheritedHidden) => {
      const nKey = n.scopedPath || n.path;
      const nHidden = inheritedHidden || Boolean(hiddenSet && hiddenSet.has(nKey));
      if (nHidden && !showHidden) return false;
      return (
        n.name.toLowerCase().includes(q) ||
        n.path.toLowerCase().includes(q) ||
        Boolean(n.children && n.children.some((c) => check(c, nHidden)))
      );
    };
    return check(node, parentHidden);
  }, [node, q, isHiddenNode, showHidden, hiddenSet, parentHidden]);

  if (!visible) return null;

  return (
    <div className="hm-sb-branch">
      <div
        className={`hm-sb-row ${isExactActive ? "active" : ""} ${
          isDropHot ? "is-drop-hot" : ""
        } ${isCtxTarget ? "is-ctx-target" : ""} ${isHiddenNode ? "is-hidden-folder" : ""}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        data-drop-folder={staticDroppable ? nodeKey : undefined}
        onContextMenu={(e) => {
          if (!onOpenContextMenu) return;
          e.preventDefault();
          e.stopPropagation();
          onOpenContextMenu(e.clientX, e.clientY, node);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="hm-sb-chevron"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(nodeKey);
            }}
            title={isExpanded ? "Collapse subfolders" : "Expand subfolders"}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="hm-sb-chevron-gap" />
        )}

        {isRenamingThis ? (
          <form
            className="hm-sb-rename-form"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCommitRename?.();
            }}
          >
            <Folder size={13} className="hm-sb-ficon" />
            <input
              type="text"
              autoFocus
              value={renameValue}
              onFocus={(e) => e.target.select()}
              onChange={(e) => onChangeRenameValue?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  onCancelRename?.();
                }
              }}
              aria-label={`Rename folder ${node.name}`}
            />
            <button type="submit" className="hm-sb-rename-btn ok" title="Save folder name (Enter)">
              <Check size={11} />
            </button>
            <button
              type="button"
              className="hm-sb-rename-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCancelRename?.();
              }}
              title="Cancel rename (Esc)"
            >
              <X size={11} />
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              className="hm-sb-row-btn"
              onClick={() => onSelectFolder(nodeKey)}
              title={`${node.path} (${node.totalCount} renders • ${formatCompactFolderSize(node.totalSizeMb)})`}
            >
              {isExpanded && hasChildren ? (
                <FolderOpen size={13} className="hm-sb-ficon" />
              ) : (
                <Folder size={13} className="hm-sb-ficon" />
              )}
              <span className="hm-sb-name">{node.name}</span>
              {isHiddenSelf && showHidden && (
                <EyeOff size={10} className="hm-sb-hidden-mark" title="Hidden in tree" />
              )}
            </button>

            <MetricToggleChip
              metricMode={metricMode}
              count={node.totalCount}
              sizeMb={node.totalSizeMb}
              onToggle={onToggleMetricMode}
            />
          </>
        )}
      </div>

      {(isCreatingChildHere || (hasChildren && isExpanded)) && (
        <div className="hm-sb-children">
          {isCreatingChildHere && renderCreateForm?.(depth + 1)}
          {hasChildren &&
            isExpanded &&
            node.children.map((child) => (
              <SidebarTreeNode
                key={child.scopedPath || child.path}
                node={child}
                depth={depth + 1}
                metricMode={metricMode}
                onToggleMetricMode={onToggleMetricMode}
                activeScopedSpec={activeScopedSpec}
                expandedSet={expandedSet}
                filterText={filterText}
                staticDroppable={staticDroppable}
                isDraggingFiles={isDraggingFiles}
                dragHoverTarget={dragHoverTarget}
                onToggleExpand={onToggleExpand}
                onSelectFolder={onSelectFolder}
                createTarget={createTarget}
                renderCreateForm={renderCreateForm}
                renamingNode={renamingNode}
                renameValue={renameValue}
                onChangeRenameValue={onChangeRenameValue}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                ctxTargetKey={ctxTargetKey}
                onOpenContextMenu={onOpenContextMenu}
                hiddenSet={hiddenSet}
                showHidden={showHidden}
                parentHidden={isHiddenNode}
              />
            ))}
        </div>
      )}
    </div>
  );
}

const SB_WIDTH_KEY = "argon_cb_folder_sb_width_v1";
const SB_METRIC_KEY = "argon_cb_folder_sb_metric_v1";
const SB_DEFAULT_W = 248;
const SB_MIN_W = 190;
const SB_MAX_W = 420;

export default function FolderSidebar({
  mode = "off", // "off" | "hover" | "static"
  side = "left", // "left" | "right"
  hidden = false,
  appMode = "classic",
  purgatoryOpen = false,
  rawItems = [],
  roots = [],
  extraFoldersByRoot = {},
  singleFolderSpec = "ALL",
  zones = [],
  activeZoneId = null,
  folderCombos = [],
  purgatoryCount = 0,
  isDraggingFiles = false,
  dragHoverTarget = null,
  onSelectSpec,
  onSelectZone,
  onHoverZone,
  onToggleMode,
  onOpenTreeModal,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenFolderExplorer,
  onRefresh,
  refreshing = false,
  activeRootPath = "",
  onOpenAddRootModal,
  onRequestRemoveRoot,
}) {
  const curation = useCuration();
  const favSet = curation?.favSet;
  const purgatorySet = curation?.purgatorySet;
  const favIcon = curation?.favIcon || "star";

  const [hoverOpen, setHoverOpen] = useState(false);
  const [metricMode, setMetricMode] = useState(() => {
    try {
      return localStorage.getItem(SB_METRIC_KEY) === "size" ? "size" : "count";
    } catch {
      return "count";
    }
  });
  const [sbWidth, setSbWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(SB_WIDTH_KEY);
      if (!raw) return SB_DEFAULT_W;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.max(SB_MIN_W, Math.min(SB_MAX_W, n)) : SB_DEFAULT_W;
    } catch {
      return SB_DEFAULT_W;
    }
  });
  const [resizing, setResizing] = useState(false);
  const resizeCleanupRef = useRef(null);
  const [filterText, setFilterText] = useState("");
  const [expandedSet, setExpandedSet] = useState(() => new Set());
  const [collapsedRoots, setCollapsedRoots] = useState(() => new Set());
  const [hiddenFolders, setHiddenFolders] = useState(loadHiddenFoldersSet);
  const [showHiddenRoots, setShowHiddenRoots] = useState(() => new Set());
  const [createTarget, setCreateTarget] = useState(null); // { rootId, parentSub }
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderFormRef = useRef(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, node }
  const [renamingNode, setRenamingNode] = useState(null); // { rootId, path, origName }
  const [renameValue, setRenameValue] = useState("");
  const [pendingDeleteNode, setPendingDeleteNode] = useState(null); // { node, entryCount }
  const [deletingFolder, setDeletingFolder] = useState(false);
  const ctxMenuRef = useRef(null);
  const hoverLockRef = useRef(false);
  hoverLockRef.current = Boolean(ctxMenu || renamingNode || pendingDeleteNode || createTarget);
  const hoverTimerRef = useRef(null);
  const expandTimerRef = useRef(null);
  const asideRef = useRef(null);
  const sensorRef = useRef(null);
  const hoverOpenRef = useRef(false);
  hoverOpenRef.current = hoverOpen;

  const isStatic = mode === "static";
  const isHover = mode === "hover";
  const isWall = !purgatoryOpen && appMode === "wall";
  const selectedZone = zones.find((z) => z.id === activeZoneId) || zones[0];
  const activeZoneNum = Math.max(1, zones.findIndex((z) => z.id === selectedZone?.id) + 1);
  const activeSpec = purgatoryOpen
    ? "__PURGATORY__"
    : isWall
    ? selectedZone?.folderFilter || "ALL"
    : singleFolderSpec || "ALL";

  const liveItems = useMemo(() => {
    if (!purgatorySet || purgatorySet.size === 0) return rawItems;
    return rawItems.filter((it) => !purgatorySet.has(itemKey(it)));
  }, [rawItems, purgatorySet]);

  const { favCount, favSizeMb, liveSizeMb, purgatorySizeMb } = useMemo(() => {
    let lSize = 0;
    let fCount = 0;
    let fSize = 0;
    for (const it of liveItems) {
      const sz = Number(it?.file_size_mb) || 0;
      lSize += sz;
      if (favSet && favSet.has(itemKey(it))) {
        fCount += 1;
        fSize += sz;
      }
    }
    let pSize = 0;
    if (purgatorySet && purgatorySet.size > 0) {
      for (const it of rawItems) {
        if (purgatorySet.has(itemKey(it))) {
          pSize += Number(it?.file_size_mb) || 0;
        }
      }
    }
    return { favCount: fCount, favSizeMb: fSize, liveSizeMb: lSize, purgatorySizeMb: pSize };
  }, [liveItems, rawItems, favSet, purgatorySet]);

  const rootSections = useMemo(
    () => buildMultiRootTrees(liveItems, roots, extraFoldersByRoot),
    [liveItems, roots, extraFoldersByRoot]
  );

  const defaultRootId = roots[0]?.id || rootSections[0]?.root?.id || "root_1";

  const activeScopedSpec = useMemo(() => {
    if (typeof activeSpec !== "string") return "";
    if (
      activeSpec === "ALL" ||
      activeSpec === "__FAVORITES__" ||
      activeSpec === "__PURGATORY__"
    ) {
      return activeSpec;
    }
    return toScopedPath(activeSpec, defaultRootId);
  }, [activeSpec, defaultRootId]);

  useEffect(() => {
    try {
      localStorage.setItem(SB_WIDTH_KEY, String(sbWidth));
    } catch {}
  }, [sbWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(SB_METRIC_KEY, metricMode);
    } catch {}
  }, [metricMode]);

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_FOLDERS_KEY, JSON.stringify([...hiddenFolders]));
    } catch {}
  }, [hiddenFolders]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
      resizeCleanupRef.current?.();
    };
  }, []);

  // Auto-expand collapsed parent folder / root if hovering while holding dragged prints in Static mode
  useEffect(() => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    if (!isStatic || !isDraggingFiles || !dragHoverTarget) return;
    if (dragHoverTarget === "__PURGATORY__") return;
    const parsed = parseScopedFolderPath(dragHoverTarget, defaultRootId);
    if (collapsedRoots.has(parsed.rootId)) {
      expandTimerRef.current = setTimeout(() => {
        setCollapsedRoots((prev) => {
          const next = new Set(prev);
          next.delete(parsed.rootId);
          return next;
        });
      }, 360);
      return;
    }
    if (parsed.subfolder === "(Root)" || parsed.isRootAll) return;
    if (expandedSet.has(dragHoverTarget)) return;
    const sec = rootSections.find((s) => s.root.id === parsed.rootId);
    const node = sec?.tree?.nodesByPath?.get(parsed.subfolder);
    if (!node || !node.children?.length) return;
    expandTimerRef.current = setTimeout(() => {
      setExpandedSet((prev) => {
        const next = new Set(prev);
        next.add(dragHoverTarget);
        return next;
      });
    }, 420);
  }, [isStatic, isDraggingFiles, dragHoverTarget, rootSections, expandedSet, collapsedRoots, defaultRootId]);

  // Reset hover/create state cleanly whenever mode changes
  useEffect(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (mode !== "hover") setHoverOpen(false);
    if (mode !== "static") setCreateTarget(null);
  }, [mode]);

  // Hover-Edge geometry tracker
  useEffect(() => {
    if (mode !== "hover" || hidden) return undefined;

    const clearTimer = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };

    const scheduleClose = (delay = 160) => {
      if (hoverTimerRef.current) return;
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null;
        setHoverOpen(false);
      }, delay);
    };

    const onPointerMove = (e) => {
      const cx = e.clientX;
      const cy = e.clientY;
      const sensorRect = sensorRef.current?.getBoundingClientRect();
      const asideRect = asideRef.current?.getBoundingClientRect();

      const inSensor = sensorRect
        ? cx >= sensorRect.left - 4 &&
          cx <= sensorRect.right + 4 &&
          cy >= sensorRect.top &&
          cy <= sensorRect.bottom
        : false;

      if (!hoverOpenRef.current) {
        if (inSensor) {
          clearTimer();
          setHoverOpen(true);
        }
        return;
      }

      const inAside = asideRect
        ? (side === "left" ? cx <= asideRect.right + 14 : cx >= asideRect.left - 14) &&
          cy >= asideRect.top - 10 &&
          cy <= asideRect.bottom + 10
        : false;

      if (inAside || inSensor || hoverLockRef.current) {
        clearTimer();
      } else {
        scheduleClose(160);
      }
    };

    const onPointerDown = (e) => {
      if (!hoverOpenRef.current || hoverLockRef.current) return;
      if (
        asideRef.current?.contains(e.target) ||
        sensorRef.current?.contains(e.target) ||
        ctxMenuRef.current?.contains(e.target)
      ) {
        return;
      }
      clearTimer();
      setHoverOpen(false);
    };

    const onDocLeave = () => {
      if (hoverOpenRef.current && !hoverLockRef.current) scheduleClose(220);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mouseleave", onDocLeave);
    return () => {
      clearTimer();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mouseleave", onDocLeave);
    };
  }, [mode, side, hidden]);

  useEffect(() => {
    if (!ctxMenu) return undefined;
    const onDown = (e) => {
      if (ctxMenuRef.current?.contains(e.target)) return;
      setCtxMenu(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setCtxMenu(null);
      }
    };
    const onClose = () => setCtxMenu(null);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!pendingDeleteNode) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !deletingFolder) {
        e.stopPropagation();
        setPendingDeleteNode(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pendingDeleteNode, deletingFolder]);

  useEffect(() => {
    if (!createTarget) return;
    const id = requestAnimationFrame(() => {
      newFolderFormRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [createTarget]);

  if (mode === "off" || hidden) return null;

  const scheduleHoverOpen = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverOpen(true);
  };

  const scheduleHoverClose = () => {
    if (hoverLockRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      if (!hoverLockRef.current) setHoverOpen(false);
    }, 160);
  };

  const openContextMenu = (clientX, clientY, node) => {
    const menuW = 204;
    const menuH = 224;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const x = Math.max(8, Math.min(clientX, vw - menuW - 8));
    const y = Math.max(8, Math.min(clientY, vh - menuH - 8));
    setCtxMenu({ x, y, node });
  };

  const handleStartRename = (node) => {
    setCtxMenu(null);
    setCreateTarget(null);
    setRenamingNode({ rootId: node.rootId, path: node.path, origName: node.name });
    setRenameValue(node.name);
  };

  const remapScopedSet = (prevSet, oldScoped, newScopedOrNull) => {
    if (!prevSet || prevSet.size === 0 || !oldScoped) return prevSet;
    let changed = false;
    const next = new Set();
    prevSet.forEach((p) => {
      if (p === oldScoped || p.startsWith(`${oldScoped}/`)) {
        changed = true;
        if (newScopedOrNull) {
          next.add(`${newScopedOrNull}${p.slice(oldScoped.length)}`);
        }
      } else {
        next.add(p);
      }
    });
    return changed ? next : prevSet;
  };

  const handleCommitRename = async () => {
    if (!renamingNode) return;
    const clean = renameValue.trim();
    if (!clean || clean === renamingNode.origName) {
      setRenamingNode(null);
      return;
    }
    const res = await onRenameFolder?.(renamingNode.path, clean, renamingNode.rootId);
    if (res?.ok) {
      if (res.oldScoped && res.newScoped) {
        setExpandedSet((prev) => remapScopedSet(prev, res.oldScoped, res.newScoped));
        setHiddenFolders((prev) => remapScopedSet(prev, res.oldScoped, res.newScoped));
      }
      setRenamingNode(null);
    }
  };

  const toggleMetricMode = () => {
    setMetricMode((cur) => (cur === "size" ? "count" : "size"));
  };

  const toggleShowHiddenRoot = (rootId) => {
    setShowHiddenRoots((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  };

  const toggleHideFolder = (node) => {
    setCtxMenu(null);
    if (!node || node.isVirtualRoot) return;
    const key = node.scopedPath || `${node.rootId}::${node.path}`;
    const wasHidden = hiddenFolders.has(key);
    setHiddenFolders((prev) => {
      const next = new Set(prev);
      if (wasHidden) next.delete(key);
      else next.add(key);
      return next;
    });
    curation?.showToast?.(
      wasHidden ? `Unhid "${node.name}" in tree` : `Hid "${node.name}" from tree`
    );
  };

  const handleRequestDeleteFolder = async (node) => {
    setCtxMenu(null);
    if (!node || !onDeleteFolder) return;
    if (node.totalCount > 0) {
      setPendingDeleteNode({ node, entryCount: node.totalCount });
      return;
    }
    const res = await onDeleteFolder(node.path, node.rootId, false);
    if (res?.ok) {
      const scoped = node.scopedPath || `${node.rootId}::${node.path}`;
      setHiddenFolders((prev) => remapScopedSet(prev, scoped, null));
    } else if (res?.needsConfirm) {
      setPendingDeleteNode({
        node,
        entryCount: res.entryCount || 0,
        dirCount: res.dirCount || 0,
        fileCount: res.fileCount || 0,
        sampleEntries: res.sampleEntries || [],
      });
    }
  };

  const handleConfirmDeleteFolder = async () => {
    if (!pendingDeleteNode?.node || !onDeleteFolder || deletingFolder) return;
    setDeletingFolder(true);
    try {
      const targetNode = pendingDeleteNode.node;
      const res = await onDeleteFolder(targetNode.path, targetNode.rootId, true);
      if (res?.ok) {
        const scoped = targetNode.scopedPath || `${targetNode.rootId}::${targetNode.path}`;
        setHiddenFolders((prev) => remapScopedSet(prev, scoped, null));
        setPendingDeleteNode(null);
      }
    } finally {
      setDeletingFolder(false);
    }
  };

  const toggleExpand = (scopedPath) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(scopedPath)) next.delete(scopedPath);
      else next.add(scopedPath);
      return next;
    });
  };

  const toggleRootCollapse = (rootId) => {
    setCollapsedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  };

  const resolveHeaderCreateTarget = () => {
    if (
      activeScopedSpec &&
      activeScopedSpec.includes("::") &&
      rootSections.some((s) => activeScopedSpec.startsWith(`${s.root.id}::`))
    ) {
      const rid = activeScopedSpec.slice(0, activeScopedSpec.indexOf("::"));
      const parsed = parseScopedFolderPath(activeScopedSpec, rid);
      return {
        rootId: rid,
        parentSub: !parsed.isRootAll && parsed.subfolder !== "(Root)" ? parsed.subfolder : "",
      };
    }
    return { rootId: defaultRootId, parentSub: "" };
  };

  const toggleCreateTarget = (rootId, parentSub = "") => {
    if (!rootId) return;
    if (createTarget && createTarget.rootId === rootId && createTarget.parentSub === parentSub) {
      setCreateTarget(null);
      setNewFolderName("");
      return;
    }
    setCollapsedRoots((prev) => {
      if (!prev.has(rootId)) return prev;
      const next = new Set(prev);
      next.delete(rootId);
      return next;
    });
    if (parentSub) {
      setExpandedSet((prev) => {
        const next = new Set(prev);
        const parts = parentSub.split("/").filter(Boolean);
        let acc = "";
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p;
          next.add(`${rootId}::${acc}`);
        }
        return next;
      });
    }
    setNewFolderName("");
    setCreateTarget({ rootId, parentSub });
  };

  const handleSubmitNewFolder = async (e) => {
    e.preventDefault();
    const clean = newFolderName.trim();
    if (!clean || !createTarget?.rootId) return;

    const { rootId, parentSub } = createTarget;
    const createdScoped = await onCreateFolder?.(parentSub, clean, rootId);
    if (createdScoped) {
      setCollapsedRoots((prev) => {
        const next = new Set(prev);
        next.delete(rootId);
        return next;
      });
      if (parentSub) {
        setExpandedSet((prev) => new Set([...prev, `${rootId}::${parentSub}`]));
      }
      setNewFolderName("");
      setCreateTarget(null);
    }
  };

  const activeComboId =
    activeSpec && typeof activeSpec === "object" && activeSpec.type === "combo"
      ? activeSpec.comboId
      : "";

  const startWidthResize = (e) => {
    if (!isStatic || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizeCleanupRef.current?.();
    const startX = e.clientX;
    const startW = sbWidth;
    setResizing(true);
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";

    const onMove = (ev) => {
      const dx = side === "left" ? ev.clientX - startX : startX - ev.clientX;
      const next = Math.round(Math.max(SB_MIN_W, Math.min(SB_MAX_W, startW + dx)));
      setSbWidth(next);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
      setResizing(false);
      resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  const multiRoot = rootSections.length > 1;
  const headerCreateTarget = resolveHeaderCreateTarget();
  const headerCreateRootPath =
    rootSections.find((s) => s.root.id === headerCreateTarget.rootId)?.root?.path ||
    rootSections.find((s) => s.root.id === headerCreateTarget.rootId)?.root?.label ||
    activeRootPath ||
    "active root";
  const creatingRootLabel =
    rootSections.find((s) => s.root.id === createTarget?.rootId)?.root?.label || "";

  const renderInlineCreateForm = (depth = 0) => {
    if (!createTarget) return null;
    const parentLeaf = createTarget.parentSub
      ? createTarget.parentSub.split("/").pop()
      : creatingRootLabel || "root";
    const fullTarget = createTarget.parentSub
      ? `${creatingRootLabel || "root"}/${createTarget.parentSub}`
      : creatingRootLabel || "root";
    return (
      <form
        ref={newFolderFormRef}
        className="hm-sb-newfolder"
        style={depth > 0 ? { marginLeft: `${8 + depth * 14}px` } : undefined}
        onSubmit={handleSubmitNewFolder}
      >
        <FolderPlus size={12} className="hm-sb-newfolder-icon" />
        <input
          type="text"
          autoFocus
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setCreateTarget(null);
              setNewFolderName("");
            }
          }}
          placeholder={`New in ${parentLeaf}...`}
          title={`Creating subfolder inside ${fullTarget}`}
        />
        <button type="submit" className="hm-btn hm-sb-newfolder-add">
          Add
        </button>
        <button
          type="button"
          className="hm-sb-newfolder-cancel"
          onClick={() => {
            setCreateTarget(null);
            setNewFolderName("");
          }}
          title="Cancel (Esc)"
          aria-label="Cancel folder creation"
        >
          <X size={11} />
        </button>
      </form>
    );
  };

  const panelBody = (
    <aside
      ref={asideRef}
      className={`hm-folder-sidebar side-${side} ${isStatic ? "is-static" : "is-hover"} ${
        isHover && hoverOpen ? "is-open" : ""
      } ${isDraggingFiles && isStatic ? "is-drag-active" : ""} ${resizing ? "is-resizing" : ""}`}
      style={isStatic ? { width: sbWidth, flex: `0 0 ${sbWidth}px` } : { width: sbWidth }}
      aria-label="Folder Tree Sidebar"
      onMouseEnter={isHover ? scheduleHoverOpen : undefined}
      onMouseLeave={isHover ? scheduleHoverClose : undefined}
    >
      {isStatic && (
        <div
          className="hm-sb-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Folder Sidebar Width"
          onPointerDown={startWidthResize}
          onDoubleClick={() => setSbWidth(SB_DEFAULT_W)}
          title="Drag edge to resize width (double-click to reset to 248px)"
        />
      )}

      {/* Header */}
      <div className="hm-sb-head">
        <div className="hm-sb-title-wrap">
          <FolderTree size={14} style={{ color: "var(--hm-accent-bright)", flexShrink: 0 }} />
          <span className="hm-sb-title">Folders</span>
          {isWall && zones.length <= 1 && (
            <span className="hm-sb-zbadge">Z{activeZoneNum}</span>
          )}
        </div>

        <div className="hm-sb-head-actions">
          <button
            type="button"
            className={`hm-sb-metric-btn ${metricMode === "size" ? "is-size" : ""}`}
            onClick={() => setMetricMode((cur) => (cur === "size" ? "count" : "size"))}
            title={
              metricMode === "size"
                ? "Showing folder disk size (click to show render count #)"
                : "Showing render count # (click to show folder disk size)"
            }
            aria-label="Toggle folder metric between count and size"
          >
            {metricMode === "size" ? "GB" : "#"}
          </button>
          {isStatic && onCreateFolder && (
            <button
              type="button"
              className={`hm-icon-btn sm ${createTarget ? "active" : ""}`}
              onClick={() =>
                toggleCreateTarget(headerCreateTarget.rootId, headerCreateTarget.parentSub)
              }
              title={`Create new folder inside ${headerCreateRootPath}${
                headerCreateTarget.parentSub ? `/${headerCreateTarget.parentSub}` : ""
              }`}
            >
              <FolderPlus size={13} />
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              className={`hm-icon-btn sm ${refreshing ? "spinning" : ""}`}
              onClick={() => onRefresh?.()}
              disabled={refreshing}
              title="Rescan all mounted folders & outputs from disk"
            >
              <RefreshCw size={13} />
            </button>
          )}
          <button
            type="button"
            className={`hm-icon-btn sm ${isStatic ? "active" : ""}`}
            onClick={() => onToggleMode?.(isStatic ? "hover" : "static")}
            title={
              isStatic
                ? "Unpin to Hover Edge overlay (stops resizing grid)"
                : "Pin Static beside grid (unlocks Hold-to-Drag into folders)"
            }
          >
            {isStatic ? <Pin size={13} /> : <PinOff size={13} />}
          </button>
          <button
            type="button"
            className="hm-icon-btn sm"
            onClick={() => onToggleMode?.("off")}
            title="Hide Folder Sidebar"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Multi-zone Wall switcher bar */}
      {isWall && zones.length > 1 && (
        <div className="hm-sb-zones-bar" role="tablist" aria-label="Target Wall Zone">
          <span className="hm-sb-zones-label">Zone</span>
          <div className="hm-sb-zones-pills">
            {zones.map((z, idx) => {
              const active = z.id === selectedZone?.id;
              return (
                <button
                  key={z.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`hm-sb-zone-pill ${active ? "active" : ""}`}
                  onMouseEnter={() => onHoverZone?.(z.id)}
                  onMouseLeave={() => onHoverZone?.(null)}
                  onClick={() => onSelectZone?.(z.id)}
                  title={`Switch Folders target to Zone ${idx + 1}`}
                >
                  Z{idx + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Filter Search */}
      <div className="hm-sb-search">
        <Search size={12} style={{ color: "var(--stage-text-muted)", flexShrink: 0 }} />
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter folders..."
        />
        {filterText && (
          <button
            type="button"
            className="hm-sb-search-clr"
            onClick={() => setFilterText("")}
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Scrollable Tree */}
      <div className="hm-sb-scroll">
        {/* Sticky Quick Entries */}
        <div className="hm-sb-section">
          <div className={`hm-sb-quick-row ${activeSpec === "__FAVORITES__" ? "active" : ""}`}>
            <button
              type="button"
              className="hm-sb-row-btn"
              onClick={() => onSelectSpec("__FAVORITES__")}
              title={`Favorited renders (${favCount} renders • ${formatCompactFolderSize(favSizeMb)})`}
            >
              <FavMark favIcon={favIcon} filled size={12} style={{ color: "var(--hm-accent-bright)" }} />
              <span className="hm-sb-name">Favorites</span>
            </button>
            <MetricToggleChip
              metricMode={metricMode}
              count={favCount}
              sizeMb={favSizeMb}
              onToggle={toggleMetricMode}
            />
          </div>

          {!isWall && (
            <div
              className={`hm-sb-quick-row is-purg ${
                activeSpec === "__PURGATORY__" ? "active" : ""
              } ${
                isStatic && isDraggingFiles && dragHoverTarget === "__PURGATORY__"
                  ? "is-drop-hot"
                  : ""
              }`}
              data-drop-folder={isStatic ? "__PURGATORY__" : undefined}
            >
              <button
                type="button"
                className="hm-sb-row-btn"
                onClick={() => onSelectSpec("__PURGATORY__")}
                title={`Purgatory staging tray (${purgatoryCount} staged • ${formatCompactFolderSize(purgatorySizeMb)})`}
              >
                <Flame size={12} style={{ color: "#fb923c" }} />
                <span className="hm-sb-name">Purgatory</span>
              </button>
              <MetricToggleChip
                metricMode={metricMode}
                count={purgatoryCount}
                sizeMb={purgatorySizeMb}
                onToggle={toggleMetricMode}
              />
            </div>
          )}

          <div className={`hm-sb-quick-row ${activeSpec === "ALL" ? "active" : ""}`}>
            <button
              type="button"
              className="hm-sb-row-btn"
              onClick={() => onSelectSpec("ALL")}
              title={
                multiRoot
                  ? `Show renders across all ${rootSections.length} mounted root folders combined (${liveItems.length} renders • ${formatCompactFolderSize(liveSizeMb)})`
                  : `Show all renders in library (${liveItems.length} renders • ${formatCompactFolderSize(liveSizeMb)})`
              }
            >
              <Folder size={12} style={{ color: "var(--hm-accent-bright)" }} />
              <span className="hm-sb-name">
                All Folders {multiRoot ? <em className="hm-sb-all-tag">All Roots</em> : null}
              </span>
            </button>
            <MetricToggleChip
              metricMode={metricMode}
              count={liveItems.length}
              sizeMb={liveSizeMb}
              onToggle={toggleMetricMode}
            />
          </div>
        </div>

        {/* Hierarchical Disk Folders grouped visually by Root */}
        <div className="hm-sb-sec-label">
          <span>{multiRoot ? `Root Libraries (${rootSections.length})` : "Folders"}</span>
          {isStatic && (
            <span className="hm-sb-drag-hint">
              {isDraggingFiles ? "Drop to Move / Copy" : "Hold card to drag"}
            </span>
          )}
        </div>

        <div className={`hm-sb-roots-stack ${multiRoot ? "is-multi" : ""}`}>
          {rootSections.map((sec) => {
            const rid = sec.root.id;
            const rootAllSpec = `${rid}::*`;
            const rootTopSpec = `${rid}::(Root)`;
            const isRootCollapsed = collapsedRoots.has(rid) && !filterText.trim();
            const isRootAllActive = activeScopedSpec === rootAllSpec;
            const isRootDropHot = isStatic && isDraggingFiles && dragHoverTarget === rootTopSpec;
            const hiddenCountInRoot = countHiddenNodes(sec.tree.rootNode.children, hiddenFolders);
            const showHidden = showHiddenRoots.has(rid);

            return (
              <section
                key={rid}
                className={`hm-sb-root-card ${isRootAllActive ? "is-root-active" : ""}`}
                aria-label={`Root folder ${sec.root.label}`}
              >
                <div
                  className={`hm-sb-root-head ${isRootAllActive ? "active" : ""} ${
                    isRootDropHot ? "is-drop-hot" : ""
                  }`}
                  data-drop-folder={isStatic ? rootTopSpec : undefined}
                >
                  <button
                    type="button"
                    className="hm-sb-chevron"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRootCollapse(rid);
                    }}
                    title={isRootCollapsed ? "Expand root folders" : "Collapse root folders"}
                  >
                    {isRootCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>

                  <button
                    type="button"
                    className="hm-sb-root-title-btn"
                    onClick={() => onSelectSpec(rootAllSpec)}
                    title={`Show all folders inside ${sec.root.path || sec.root.label} (${sec.totalCount} renders • ${formatCompactFolderSize(sec.totalSizeMb)})`}
                  >
                    <HardDrive size={12} className="hm-sb-drive-icon" />
                    <span className="hm-sb-root-label">{sec.root.label}</span>
                  </button>

                  <MetricToggleChip
                    metricMode={metricMode}
                    count={sec.totalCount}
                    sizeMb={sec.totalSizeMb}
                    onToggle={toggleMetricMode}
                  />

                  <div className="hm-sb-root-actions">
                    {hiddenCountInRoot > 0 && (
                      <button
                        type="button"
                        className={`hm-sb-root-act hm-sb-root-eye ${showHidden ? "active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleShowHiddenRoot(rid);
                        }}
                        title={
                          showHidden
                            ? `Hide ${hiddenCountInRoot} hidden folder${hiddenCountInRoot === 1 ? "" : "s"}`
                            : `Show ${hiddenCountInRoot} hidden folder${hiddenCountInRoot === 1 ? "" : "s"}`
                        }
                        aria-label={showHidden ? "Hide hidden folders" : "Show hidden folders"}
                      >
                        {showHidden ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                    )}
                    {isStatic && onCreateFolder && (
                      <button
                        type="button"
                        className={`hm-sb-root-act ${
                          createTarget && createTarget.rootId === rid && !createTarget.parentSub
                            ? "active"
                            : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCreateTarget(rid, "");
                        }}
                        title={`Create new top-level folder inside ${sec.root.path || sec.root.label}`}
                      >
                        <FolderPlus size={11} />
                      </button>
                    )}
                    {onRequestRemoveRoot && (
                      <button
                        type="button"
                        className="hm-sb-root-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestRemoveRoot(sec.root);
                        }}
                        title={`Remove "${sec.root.label}" from gallery (does NOT delete files on disk)`}
                        aria-label={`Remove root folder ${sec.root.label}`}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </div>

                {!isRootCollapsed && (
                  <div className="hm-sb-tree">
                    {onCreateFolder &&
                      createTarget &&
                      createTarget.rootId === rid &&
                      !createTarget.parentSub &&
                      renderInlineCreateForm(0)}
                    {(sec.tree.rootNode.directCount > 0 || isStatic) && (
                      <div
                        className={`hm-sb-row ${activeScopedSpec === rootTopSpec ? "active" : ""} ${
                          isStatic && isDraggingFiles && dragHoverTarget === rootTopSpec
                            ? "is-drop-hot"
                            : ""
                        } ${ctxMenu?.node?.scopedPath === rootTopSpec ? "is-ctx-target" : ""}`}
                        style={{ paddingLeft: "8px" }}
                        data-drop-folder={isStatic ? rootTopSpec : undefined}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openContextMenu(e.clientX, e.clientY, {
                            isVirtualRoot: true,
                            rootId: rid,
                            path: "(Root)",
                            scopedPath: rootTopSpec,
                            name: `${sec.root.label} (Root)`,
                            totalCount: sec.tree.rootNode.directCount,
                            totalSizeMb: sec.tree.rootNode.directSizeMb,
                          });
                        }}
                      >
                        <span className="hm-sb-chevron-gap" />
                        <button
                          type="button"
                          className="hm-sb-row-btn"
                          onClick={() => onSelectSpec(rootTopSpec)}
                          title={`Loose renders sitting directly inside ${sec.root.path || sec.root.label} (${sec.tree.rootNode.directCount} renders • ${formatCompactFolderSize(sec.tree.rootNode.directSizeMb)})`}
                        >
                          <Folder size={13} className="hm-sb-ficon" />
                          <span className="hm-sb-name">(Root)</span>
                        </button>
                        <MetricToggleChip
                          metricMode={metricMode}
                          count={sec.tree.rootNode.directCount}
                          sizeMb={sec.tree.rootNode.directSizeMb}
                          onToggle={toggleMetricMode}
                        />
                      </div>
                    )}

                    {sec.tree.rootNode.children.map((node) => (
                      <SidebarTreeNode
                        key={node.scopedPath || node.path}
                        node={node}
                        depth={0}
                        metricMode={metricMode}
                        onToggleMetricMode={toggleMetricMode}
                        activeScopedSpec={activeScopedSpec}
                        expandedSet={expandedSet}
                        filterText={filterText}
                        staticDroppable={isStatic}
                        isDraggingFiles={isDraggingFiles}
                        dragHoverTarget={dragHoverTarget}
                        onToggleExpand={toggleExpand}
                        onSelectFolder={onSelectSpec}
                        createTarget={createTarget}
                        renderCreateForm={renderInlineCreateForm}
                        renamingNode={renamingNode}
                        renameValue={renameValue}
                        onChangeRenameValue={setRenameValue}
                        onCommitRename={handleCommitRename}
                        onCancelRename={() => setRenamingNode(null)}
                        ctxTargetKey={
                          ctxMenu?.node ? ctxMenu.node.scopedPath || ctxMenu.node.path : ""
                        }
                        onOpenContextMenu={openContextMenu}
                        hiddenSet={hiddenFolders}
                        showHidden={showHidden}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {onOpenAddRootModal && (
            <button
              type="button"
              className="hm-sb-add-root-btn"
              onClick={onOpenAddRootModal}
              title="Mount another media folder or SSD drive into HammelArt Atelier"
            >
              <Plus size={13} />
              <span>Mount Root Folder…</span>
            </button>
          )}
        </div>

        {/* Folder Combos */}
        <div className="hm-sb-sec-label" style={{ marginTop: 10 }}>
          <span>Folder Combos</span>
          <Sparkles size={10} style={{ color: "var(--hm-accent-bright)" }} />
        </div>

        {folderCombos.length > 0 ? (
          <div className="hm-sb-section">
            {folderCombos.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`hm-sb-quick-row ${activeComboId === c.id ? "active" : ""}`}
                onClick={() => onSelectSpec({ type: "combo", comboId: c.id })}
                title={`${c.label} (${c.paths?.length || 0} folders)`}
              >
                {c.favoritesOnly ? (
                  <FavMark
                    favIcon={favIcon}
                    filled
                    size={11}
                    style={{ color: "var(--hm-accent-bright)" }}
                  />
                ) : (
                  <Sparkles size={11} style={{ color: "var(--hm-accent-bright)" }} />
                )}
                <span className="hm-sb-name">{c.label}</span>
                <span className="hm-sb-count">{c.paths?.length || 0}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="hm-sb-empty-combos">No Combos saved yet</div>
        )}
      </div>

      {/* Footer Launcher for Multi-Branch Combo Builder */}
      <div className="hm-sb-foot">
        <button
          type="button"
          className="hm-btn hm-sb-modal-btn"
          onClick={onOpenTreeModal}
          title="Open Master Folder Tree to mix multi-branch & multi-root Combos"
        >
          <SlidersHorizontal size={12} />
          <span>Mix &amp; Save Combos…</span>
        </button>
      </div>
    </aside>
  );

  const overlays =
    typeof document !== "undefined"
      ? createPortal(
          <>
            {ctxMenu?.node && (
              <div
                ref={ctxMenuRef}
                className="hm-sb-ctx-menu"
                role="menu"
                aria-label={`Folder actions for ${ctxMenu.node.name}`}
                style={{ left: ctxMenu.x, top: ctxMenu.y }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="hm-sb-ctx-head">
                  <span title={ctxMenu.node.path}>{ctxMenu.node.name}</span>
                  <span className="hm-sb-ctx-meta">
                    {ctxMenu.node.totalCount} · {formatCompactFolderSize(ctxMenu.node.totalSizeMb)}
                  </span>
                </div>

                {onCreateFolder && (
                  <button
                    type="button"
                    role="menuitem"
                    className="hm-sb-ctx-item"
                    onClick={() => {
                      const target = ctxMenu.node;
                      setCtxMenu(null);
                      toggleCreateTarget(target.rootId, target.isVirtualRoot ? "" : target.path);
                    }}
                  >
                    <FolderPlus size={13} />
                    <span>
                      {ctxMenu.node.isVirtualRoot ? "New Top-Level Folder…" : "New Subfolder…"}
                    </span>
                  </button>
                )}

                {!ctxMenu.node.isVirtualRoot && onRenameFolder && (
                  <button
                    type="button"
                    role="menuitem"
                    className="hm-sb-ctx-item"
                    onClick={() => handleStartRename(ctxMenu.node)}
                  >
                    <Pencil size={13} />
                    <span>Rename…</span>
                  </button>
                )}

                {onOpenFolderExplorer && (
                  <button
                    type="button"
                    role="menuitem"
                    className="hm-sb-ctx-item"
                    onClick={() => {
                      const target = ctxMenu.node;
                      setCtxMenu(null);
                      onOpenFolderExplorer(target.isVirtualRoot ? "" : target.path, target.rootId);
                    }}
                  >
                    <ExternalLink size={13} />
                    <span>Open in Explorer</span>
                  </button>
                )}

                {!ctxMenu.node.isVirtualRoot && (() => {
                  const targetKey =
                    ctxMenu.node.scopedPath || `${ctxMenu.node.rootId}::${ctxMenu.node.path}`;
                  const isHidden = hiddenFolders.has(targetKey);
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      className="hm-sb-ctx-item"
                      onClick={() => toggleHideFolder(ctxMenu.node)}
                    >
                      {isHidden ? <Eye size={13} /> : <EyeOff size={13} />}
                      <span>{isHidden ? "Unhide in Tree" : "Hide from Tree"}</span>
                    </button>
                  );
                })()}

                {!ctxMenu.node.isVirtualRoot && onDeleteFolder && (
                  <>
                    <div className="hm-sb-ctx-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="hm-sb-ctx-item is-danger"
                      onClick={() => handleRequestDeleteFolder(ctxMenu.node)}
                    >
                      <Trash2 size={13} />
                      <span>
                        {ctxMenu.node.totalCount > 0
                          ? "Send Folder to Recycle Bin…"
                          : (ctxMenu.node.children?.length || 0) > 0
                          ? "Delete Folder…"
                          : "Delete Empty Folder"}
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}

            {pendingDeleteNode?.node && (
              <div
                className="hm-unsaved-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="hm-del-folder-title"
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget && !deletingFolder) {
                    setPendingDeleteNode(null);
                  }
                }}
              >
                <div className="hm-root-modal is-warn" onClick={(e) => e.stopPropagation()}>
                  <div className="hm-root-modal-head">
                    <div className="hm-root-modal-title-wrap">
                      <div className="hm-unsaved-icon">
                        <AlertTriangle size={16} />
                      </div>
                      <div>
                        <h3 id="hm-del-folder-title">Send Folder to Recycle Bin?</h3>
                        <p>
                          <Folder size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                          <strong>{pendingDeleteNode.node.path}</strong>
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="hm-icon-btn sm"
                      disabled={deletingFolder}
                      onClick={() => setPendingDeleteNode(null)}
                      aria-label="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="hm-root-modal-body">
                    <div className="hm-remove-safe-note">
                      {pendingDeleteNode.node.totalCount > 0 ? (
                        <>
                          This folder contains{" "}
                          <strong>
                            {pendingDeleteNode.node.totalCount} renders (
                            {formatCompactFolderSize(pendingDeleteNode.node.totalSizeMb)})
                          </strong>
                        </>
                      ) : (
                        <>
                          This folder has 0 gallery renders, but isn&apos;t empty on disk — it
                          contains{" "}
                          <strong>
                            {(() => {
                              const parts = [];
                              if (pendingDeleteNode.dirCount > 0) {
                                parts.push(
                                  `${pendingDeleteNode.dirCount} subfolder${
                                    pendingDeleteNode.dirCount === 1 ? "" : "s"
                                  }`
                                );
                              }
                              if (pendingDeleteNode.fileCount > 0) {
                                parts.push(
                                  `${pendingDeleteNode.fileCount} non-gallery file${
                                    pendingDeleteNode.fileCount === 1 ? "" : "s"
                                  }`
                                );
                              }
                              const head =
                                parts.length > 0
                                  ? parts.join(", ")
                                  : `${pendingDeleteNode.entryCount || "some"} item(s)`;
                              const sample =
                                pendingDeleteNode.sampleEntries?.length > 0
                                  ? ` (${pendingDeleteNode.sampleEntries.join(", ")})`
                                  : "";
                              return `${head}${sample}`;
                            })()}
                          </strong>
                        </>
                      )}
                      . It will be moved cleanly to the <strong>Windows Recycle Bin</strong> (not
                      permanently erased), so you can restore it anytime.
                    </div>
                  </div>

                  <div className="hm-unsaved-actions" style={{ padding: "0 18px 16px" }}>
                    <button
                      type="button"
                      className="hm-btn"
                      disabled={deletingFolder}
                      onClick={() => setPendingDeleteNode(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="hm-btn hm-btn-discard"
                      disabled={deletingFolder}
                      onClick={handleConfirmDeleteFolder}
                      autoFocus
                    >
                      <Trash2 size={13} />{" "}
                      {deletingFolder ? "Moving to Recycle Bin…" : "Send to Recycle Bin"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>,
          document.body
        )
      : null;

  if (isStatic) {
    return (
      <>
        {panelBody}
        {overlays}
      </>
    );
  }

  return (
    <>
      <div
        ref={sensorRef}
        className={`hm-sb-edge-sensor side-${side}`}
        onMouseEnter={scheduleHoverOpen}
        onMouseLeave={scheduleHoverClose}
        title="Hover to open Folder Tree"
      >
        <div className="hm-sb-edge-pill" />
      </div>
      {panelBody}
      {overlays}
    </>
  );
}

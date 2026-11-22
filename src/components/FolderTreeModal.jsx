import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  Check,
  X,
  CheckSquare,
  Square,
  FolderTree,
} from "lucide-react";
import {
  arePathListsEqual,
  buildMultiRootTrees,
  extractSelectedPathsFromSpec,
  getBranchPaths,
  getFolderSpecLabel,
  matchesFolderSpec,
  resolveComboObject,
  toScopedPath,
} from "../utils/folderTree";
import { itemKey } from "../utils/lightboxFlight";
import { FavMark, useCuration } from "../utils/curation";
import MorphPresetSave from "./MorphPresetSave";

function TreeBranchNode({
  node,
  rootLabel,
  rootPath,
  depth,
  selectedSet,
  expandedSet,
  filterText,
  onToggleExpand,
  onTogglePath,
  onSelectBranch,
  onClearBranch,
}) {
  const nodeKey = node.scopedPath || node.path;
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedSet.has(nodeKey) || Boolean(filterText);
  const isChecked = selectedSet.has(nodeKey);

  const q = filterText.trim().toLowerCase();
  const branchPaths = useMemo(() => getBranchPaths(node, false, true), [node]);
  const selectedInBranch = branchPaths.filter((p) => selectedSet.has(p)).length;
  const hasActiveDescendant =
    hasChildren && branchPaths.some((p) => p !== nodeKey && selectedSet.has(p));

  const matchesSelfOrChild = useMemo(() => {
    if (!q) return true;
    const check = (n) =>
      n.name.toLowerCase().includes(q) ||
      n.path.toLowerCase().includes(q) ||
      (node.isVirtualRoot && (rootLabel || "").toLowerCase().includes(q)) ||
      (n.children && n.children.some(check));
    return check(node);
  }, [node, q, rootLabel]);

  if (!matchesSelfOrChild) return null;

  const canCheckDirect = !node.isVirtualRoot || node.directCount > 0;

  return (
    <div className={`hm-ft-node-group ${node.isVirtualRoot ? "is-root-section" : ""}`}>
      <div
        className={`hm-ft-row ${depth > 0 ? "is-child" : ""} ${isChecked ? "is-checked" : ""} ${
          !isChecked && hasActiveDescendant ? "has-active-child" : ""
        }`}
      >
        <div className="hm-ft-row-left">
          {hasChildren ? (
            <button
              type="button"
              className="hm-ft-chevron"
              onClick={() => onToggleExpand(nodeKey)}
              title={isExpanded ? "Collapse subfolders" : "Expand subfolders"}
            >
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="hm-ft-chevron-spacer" />
          )}

          <button
            type="button"
            className="hm-ft-check-area"
            disabled={!canCheckDirect}
            onClick={() => canCheckDirect && onTogglePath(nodeKey)}
            title={
              canCheckDirect
                ? `Toggle images directly inside "${node.isVirtualRoot ? rootLabel || "Root" : node.path}"`
                : "Parent container folder (0 direct images — use ✓ Branch or expand subfolders)"
            }
          >
            {isChecked ? (
              <CheckSquare size={14} className="hm-ft-check-icon on" />
            ) : (
              <Square
                size={14}
                className={`hm-ft-check-icon ${!canCheckDirect ? "dim" : ""}`}
              />
            )}
            {isExpanded && hasChildren ? (
              <FolderOpen size={14} className="hm-ft-folder-icon open" />
            ) : (
              <Folder size={14} className="hm-ft-folder-icon" />
            )}
            <span className="hm-ft-name">
              {node.isVirtualRoot ? `${rootLabel || "Root"} (Root)` : node.name}
            </span>
            {node.isVirtualRoot && rootPath && (
              <span className="hm-ft-root-subpath">{rootPath}</span>
            )}
          </button>

          <span className="hm-ft-count" title="Images directly inside this folder">
            {node.directCount}
          </span>

          {hasActiveDescendant && !isChecked && (
            <span className="hm-ft-child-dot" title="Subfolders below are selected">
              {selectedInBranch} active below
            </span>
          )}
        </div>

        {hasChildren && (
          <div className="hm-ft-branch-btns">
            <button
              type="button"
              className="hm-ft-branch-btn"
              onClick={() => onSelectBranch(node)}
              title="Select this folder + ALL subfolders below (then uncheck any to exclude)"
            >
              ✓ Branch
            </button>
            <button
              type="button"
              className="hm-ft-branch-btn muted"
              onClick={() => onClearBranch(node)}
              title="Unselect this folder + all subfolders below"
            >
              × Branch
            </button>
          </div>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="hm-ft-children">
          {node.children.map((child) => (
            <TreeBranchNode
              key={child.scopedPath || child.path}
              node={child}
              rootLabel={rootLabel}
              rootPath={rootPath}
              depth={depth + 1}
              selectedSet={selectedSet}
              expandedSet={expandedSet}
              filterText={filterText}
              onToggleExpand={onToggleExpand}
              onTogglePath={onTogglePath}
              onSelectBranch={onSelectBranch}
              onClearBranch={onClearBranch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FolderTreeModal({
  isOpen,
  onClose,
  isWallMode = false,
  zones = [],
  initialZoneId = null,
  onSelectWallZone,
  targetTitle,
  rawItems,
  roots = [],
  extraFoldersByRoot = {},
  initialSpec,
  folderCombos,
  onApplySpec,
  onApplyWallZoneSpecs,
  onSaveNewCombo,
  onUpdateCombo,
  onDeleteCombo,
}) {
  const rootSections = useMemo(
    () => buildMultiRootTrees(rawItems, roots, extraFoldersByRoot),
    [rawItems, roots, extraFoldersByRoot]
  );

  const allPaths = useMemo(
    () => rootSections.flatMap((sec) => sec.allScopedPaths),
    [rootSections]
  );

  const defaultRootId = roots[0]?.id || rootSections[0]?.root?.id || "root_1";

  const curation = useCuration();
  const favSet = curation?.favSet || null;
  const favIcon = curation?.favIcon || "star";

  const [modalZoneId, setModalZoneId] = useState(null);
  const [draftSpecsByZone, setDraftSpecsByZone] = useState({});
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [expandedSet, setExpandedSet] = useState(() => new Set([`${defaultRootId}::(Root)`]));
  const [filterText, setFilterText] = useState("");
  const [linkedComboId, setLinkedComboId] = useState(null);

  const loadSpecIntoEditor = (spec) => {
    const init = extractSelectedPathsFromSpec(spec, allPaths, folderCombos, defaultRootId);
    setSelectedPaths(init);
    const comboObj = resolveComboObject(spec, folderCombos);
    setFavoritesOnly(
      spec === "__FAVORITES__" ||
        Boolean(spec && typeof spec === "object" && spec.favoritesOnly) ||
        Boolean(comboObj?.favoritesOnly)
    );
    setLinkedComboId(
      spec && typeof spec === "object" && spec.type === "combo" ? spec.comboId : null
    );
  };

  useEffect(() => {
    if (!isOpen) return;
    if (isWallMode && zones.length > 0) {
      const startZone = zones.find((z) => z.id === initialZoneId) || zones[0];
      setModalZoneId(startZone.id);
      setDraftSpecsByZone({});
      loadSpecIntoEditor(startZone.folderFilter || "ALL");
    } else {
      setModalZoneId(null);
      setDraftSpecsByZone({});
      loadSpecIntoEditor(initialSpec);
    }
    const nextExp = new Set();
    rootSections.forEach((sec) => {
      nextExp.add(sec.tree.rootNode.scopedPath);
      sec.tree.rootNode.children.forEach((c) => nextExp.add(c.scopedPath || c.path));
    });
    setExpandedSet(nextExp);
    setFilterText("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const matchedCount = useMemo(() => {
    const tempSpec = { type: "custom", paths: selectedPaths, favoritesOnly };
    return rawItems.filter((it) => {
      const isFav = Boolean(favSet && favSet.has(itemKey(it)));
      return matchesFolderSpec(it.subfolder, tempSpec, folderCombos, isFav, false, it.root_id || defaultRootId);
    }).length;
  }, [rawItems, selectedPaths, favoritesOnly, folderCombos, favSet, defaultRootId]);

  const targetCombo = folderCombos.find((c) => c.id === linkedComboId) || null;
  const isComboDirty = Boolean(
    targetCombo &&
      (!arePathListsEqual(selectedPaths, targetCombo.paths || [], defaultRootId) ||
        favoritesOnly !== Boolean(targetCombo.favoritesOnly))
  );

  const toggleExpand = (path) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => {
    const keys = [];
    rootSections.forEach((sec) => {
      for (const node of sec.tree.nodesByPath.values()) {
        keys.push(node.scopedPath || node.path);
      }
    });
    setExpandedSet(new Set(keys));
  };

  const collapseAll = () => {
    setExpandedSet(new Set(rootSections.map((sec) => sec.tree.rootNode.scopedPath)));
  };

  const togglePath = (path) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const selectBranch = (node) => {
    const add = getBranchPaths(node, false, true);
    setSelectedPaths((prev) => Array.from(new Set([...prev, ...add])));
  };

  const clearBranch = (node) => {
    const rem = new Set(getBranchPaths(node, true, true));
    setSelectedPaths((prev) => prev.filter((p) => !rem.has(p)));
  };

  const handleLoadCombo = (combo) => {
    setSelectedPaths((combo.paths || []).map((p) => toScopedPath(p, defaultRootId)));
    setFavoritesOnly(Boolean(combo.favoritesOnly));
    setLinkedComboId(combo.id);
  };

  const handleSaveNew = (cleanName) => {
    const newId = onSaveNewCombo(cleanName, [...selectedPaths], favoritesOnly);
    if (newId) setLinkedComboId(newId);
  };

  const handleUpdate = (comboId) => {
    onUpdateCombo(comboId, [...selectedPaths], favoritesOnly);
  };

  const buildCurrentSpec = () => {
    if (arePathListsEqual(selectedPaths, allPaths, defaultRootId)) {
      return favoritesOnly ? "__FAVORITES__" : "ALL";
    }
    if (targetCombo && !isComboDirty) return { type: "combo", comboId: targetCombo.id };
    return favoritesOnly
      ? { type: "custom", paths: [...selectedPaths], favoritesOnly: true }
      : { type: "custom", paths: [...selectedPaths] };
  };

  const handleSwitchModalZone = (nextZoneId) => {
    if (!isWallMode || nextZoneId === modalZoneId) return;
    const currentSpec = buildCurrentSpec();
    const updatedDrafts = modalZoneId
      ? { ...draftSpecsByZone, [modalZoneId]: currentSpec }
      : { ...draftSpecsByZone };
    setDraftSpecsByZone(updatedDrafts);
    setModalZoneId(nextZoneId);
    onSelectWallZone?.(nextZoneId);
    const nextZone = zones.find((z) => z.id === nextZoneId);
    const nextSpec =
      updatedDrafts[nextZoneId] !== undefined
        ? updatedDrafts[nextZoneId]
        : nextZone?.folderFilter || "ALL";
    loadSpecIntoEditor(nextSpec);
  };

  const handleConfirmApply = () => {
    const currentSpec = buildCurrentSpec();
    if (isWallMode && modalZoneId && onApplyWallZoneSpecs) {
      onApplyWallZoneSpecs({
        ...draftSpecsByZone,
        [modalZoneId]: currentSpec,
      });
    } else {
      onApplySpec(currentSpec);
    }
    onClose();
  };

  const activeZoneIdx = isWallMode ? zones.findIndex((z) => z.id === modalZoneId) : -1;
  const activeZoneLabel = activeZoneIdx >= 0 ? `Zone ${activeZoneIdx + 1}` : targetTitle;
  const touchedCount = isWallMode
    ? new Set([...Object.keys(draftSpecsByZone), ...(modalZoneId ? [modalZoneId] : [])]).size
    : 0;
  const applyButtonText = isWallMode
    ? touchedCount > 1
      ? `Apply (${touchedCount} Zones)`
      : `Apply to ${activeZoneLabel}`
    : `Apply to ${targetTitle}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="hm-ft-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="hm-ft-modal"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="hm-ft-head">
              <div className="hm-ft-head-title">
                <FolderTree size={17} style={{ color: "var(--hm-accent-bright)" }} />
                <div>
                  <h3>Master Folder Tree</h3>
                  <p>
                    {isWallMode ? (
                      <>
                        Editing sources for <strong>Wall Mode Zones</strong> • Pick independent
                        folders per Zone
                      </>
                    ) : (
                      <>
                        Editing source for <strong>{targetTitle}</strong> (shared across single
                        views) • Independent folder picking
                      </>
                    )}
                  </p>
                </div>
              </div>
              <button type="button" className="hm-icon-btn" onClick={onClose} title="Close">
                <X size={15} />
              </button>
            </div>

            {/* Wall Mode ONLY: Z1 | Z2 | Z3... Zone Switcher */}
            {isWallMode && zones.length > 0 && (
              <div className="hm-ft-zones-bar">
                <span className="hm-ft-bar-label">Zones:</span>
                <div className="hm-ft-zones-pills">
                  {zones.map((z, idx) => {
                    const isActive = z.id === modalZoneId;
                    const displaySpec = isActive
                      ? buildCurrentSpec()
                      : draftSpecsByZone[z.id] !== undefined
                      ? draftSpecsByZone[z.id]
                      : z.folderFilter || "ALL";
                    const lbl = getFolderSpecLabel(displaySpec, folderCombos, roots);
                    return (
                      <button
                        key={z.id}
                        type="button"
                        className={`hm-cap-zone-pill ${isActive ? "active" : ""}`}
                        onClick={() => handleSwitchModalZone(z.id)}
                        title={`Switch editor to Zone ${idx + 1}: ${lbl}`}
                      >
                        <strong>Z{idx + 1}</strong>
                        <span>{lbl}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Saved Folder Combos Quick Strip */}
            <div className="hm-ft-combos-bar">
              <span className="hm-ft-bar-label">Saved Combos:</span>
              <div className="hm-ft-combos-list">
                {folderCombos.length === 0 ? (
                  <span className="hm-ft-empty-hint">
                    None saved yet — check any mix below and click + Save Preset!
                  </span>
                ) : (
                  folderCombos.map((c) => (
                    <div
                      key={c.id}
                      className={`hm-drawer-preset-pill ${linkedComboId === c.id ? "active" : ""}`}
                      onClick={() => handleLoadCombo(c)}
                    >
                      <span>
                        {c.favoritesOnly && (
                          <FavMark
                            favIcon={favIcon}
                            filled
                            size={10}
                            style={{ marginRight: 5, verticalAlign: -1, color: "var(--hm-accent-bright)" }}
                          />
                        )}
                        {c.label}
                      </span>
                      <button
                        type="button"
                        className="hm-preset-del"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (linkedComboId === c.id) setLinkedComboId(null);
                          onDeleteCombo(c.id);
                        }}
                        title="Delete Folder Combo"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Search & Quick Batch Helpers */}
            <div className="hm-ft-tools">
              <div className="hm-search-box" style={{ flex: 1, minWidth: 180 }}>
                <Search size={13} style={{ color: "var(--stage-text-muted)" }} />
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filter folders by name or path..."
                />
                {filterText && (
                  <button
                    type="button"
                    onClick={() => setFilterText("")}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <button
                type="button"
                className="hm-btn"
                onClick={() => setSelectedPaths([...allPaths])}
              >
                Select All
              </button>
              <button type="button" className="hm-btn" onClick={() => setSelectedPaths([])}>
                Clear All
              </button>
              <button type="button" className="hm-btn" onClick={expandAll}>
                Expand
              </button>
              <button type="button" className="hm-btn" onClick={collapseAll}>
                Collapse
              </button>
            </div>

            {/* Hierarchical Tree Scroll Area */}
            <div className="hm-ft-scroll">
              {rootSections.map((sec) => (
                <TreeBranchNode
                  key={sec.root.id}
                  node={sec.tree.rootNode}
                  rootLabel={sec.root.label}
                  rootPath={sec.root.path}
                  depth={0}
                  selectedSet={selectedSet}
                  expandedSet={expandedSet}
                  filterText={filterText}
                  onToggleExpand={toggleExpand}
                  onTogglePath={togglePath}
                  onSelectBranch={selectBranch}
                  onClearBranch={clearBranch}
                />
              ))}
            </div>

            {/* Footer: Live Match Counter + Favorites Only + MorphPresetSave + Apply */}
            <div className="hm-ft-foot">
              <div className="hm-ft-foot-left">
                <span className="hm-ft-match-pill">
                  <strong>{matchedCount}</strong> / {rawItems.length} renders • {selectedPaths.length}{" "}
                  folders
                </span>
                <button
                  type="button"
                  className={`hm-btn hm-ft-fav-toggle ${favoritesOnly ? "active" : ""}`}
                  onClick={() => setFavoritesOnly((v) => !v)}
                  title="Only include favorited renders from selected folders"
                >
                  <FavMark favIcon={favIcon} filled={favoritesOnly} size={12} />
                  <span>Favorites Only</span>
                </button>
                <MorphPresetSave
                  targetPreset={targetCombo}
                  isDirty={isComboDirty}
                  onUpdate={handleUpdate}
                  onSaveNew={handleSaveNew}
                />
              </div>

              <div className="hm-ft-foot-right">
                <button type="button" className="hm-btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="hm-btn hm-save-cta"
                  onClick={handleConfirmApply}
                >
                  <Check size={13} /> {applyButtonText}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

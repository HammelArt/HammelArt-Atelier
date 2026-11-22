import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Folder, ChevronDown, FolderTree, Sparkles, Flame } from "lucide-react";
import { getFolderSpecLabel } from "../utils/folderTree";
import { FavMark, useCuration } from "../utils/curation";
import ThemedSelect from "./ThemedSelect";

const CAPSULE_SPRING = {
  type: "spring",
  stiffness: 460,
  damping: 22,
  mass: 0.85,
};

/**
 * Centered 2-Layer Folder Source Bar:
 * Trigger button sits right next to the 4 Mode Pills.
 * Clicking pops open a bouncy frosted capsule underneath with:
 * 1. Quick classic single-folder selector
 * 2. Saved Folder Combos
 * 3. Launch Master Folder Tree Overlay
 * In Wall Mode, targets Z1 | Z2 | Z3... with live canvas hover-glow (zero Global clutter).
 */
export default function FolderSourceBar({
  appMode,
  purgatoryOpen = false,
  folders,
  roots = [],
  singleFolderSpec,
  onSetSingleFolder,
  zones,
  activeZoneId,
  onSelectZoneTarget,
  onHoverWallZone,
  onSetZoneFolder,
  folderCombos,
  onDeleteCombo,
  onOpenTreeModal,
  folderSidebarMode = "off",
  onChangeFolderSidebarMode,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const curation = useCuration();
  const favIcon = curation?.favIcon || "star";

  const isWall = appMode === "wall";
  const selectedZone = zones.find((z) => z.id === activeZoneId) || zones[0];
  const currentSpec = isWall ? selectedZone?.folderFilter || "ALL" : singleFolderSpec || "ALL";
  const currentLabel = isWall
    ? `Sources (${zones.length})`
    : purgatoryOpen
    ? "Purgatory"
    : getFolderSpecLabel(singleFolderSpec, folderCombos, roots);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (e.target.closest?.('[data-themed-menu="true"]')) return;
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        onHoverWallZone(null);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        onHoverWallZone(null);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onHoverWallZone]);

  const applySpecToTarget = (spec) => {
    if (isWall && selectedZone) {
      onSetZoneFolder(selectedZone.id, spec);
    } else {
      onSetSingleFolder(spec);
      setOpen(false);
      onHoverWallZone(null);
    }
  };

  const quickSelectVal = typeof currentSpec === "string" ? currentSpec : "__CUSTOM__";
  const activeComboId =
    currentSpec && typeof currentSpec === "object" && currentSpec.type === "combo"
      ? currentSpec.comboId
      : "";
  const selectedZoneNum = Math.max(1, zones.findIndex((z) => z.id === selectedZone?.id) + 1);

  const quickFolderOptions = [
    ...(quickSelectVal === "__CUSTOM__"
      ? [
          {
            value: "__CUSTOM__",
            label: getFolderSpecLabel(currentSpec, folderCombos, roots),
            menuLabel: getFolderSpecLabel(currentSpec, folderCombos, roots),
            depth: 0,
            icon: <Sparkles size={12} style={{ color: "var(--hm-accent-bright)" }} />,
            disabled: true,
          },
        ]
      : []),
    ...folders.map((f) => ({
      value: f.value,
      label: f.label,
      menuLabel: f.menuLabel,
      depth: f.depth,
      meta: String(f.totalCount),
      icon: f.isFavorites ? (
        <FavMark favIcon={favIcon} filled size={12} style={{ color: "var(--hm-accent-bright)" }} />
      ) : f.isPurgatory ? (
        <Flame size={12} style={{ color: "#fb923c" }} />
      ) : (
        <Folder size={12} style={{ color: "var(--hm-accent-bright)" }} />
      ),
    })),
  ];

  const comboOptions = folderCombos.map((c) => ({
    value: c.id,
    label: c.label,
    meta: `${c.paths?.length || 0}`,
    icon: c.favoritesOnly ? (
      <FavMark favIcon={favIcon} filled size={12} style={{ color: "var(--hm-accent-bright)" }} />
    ) : (
      <Sparkles size={12} style={{ color: "var(--hm-accent-bright)" }} />
    ),
    onDelete: (id) => onDeleteCombo(id),
  }));

  return (
    <div ref={wrapRef} className="hm-source-bar-wrap">
      <button
        type="button"
        className={`hm-source-trigger ${open ? "active" : ""}`}
        onClick={() => {
          setOpen((v) => {
            if (v) onHoverWallZone(null);
            return !v;
          });
        }}
        title="Pick folder, Folder Combo preset, or open Master Folder Tree"
      >
        {!isWall && (purgatoryOpen || singleFolderSpec === "__PURGATORY__") ? (
          <Flame size={13} style={{ color: "#fb923c" }} />
        ) : !isWall && singleFolderSpec === "__FAVORITES__" ? (
          <FavMark favIcon={favIcon} filled size={13} style={{ color: "var(--hm-accent-bright)" }} />
        ) : (
          <Folder size={13} style={{ color: "var(--hm-accent-bright)" }} />
        )}
        <span className="hm-source-trigger-text">{currentLabel}</span>
        <ChevronDown
          size={13}
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <div className="hm-source-capsule-pos">
            <motion.div
              className="hm-source-capsule"
              initial={{ opacity: 0, y: -8, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.94 }}
              transition={CAPSULE_SPRING}
              onMouseLeave={() => onHoverWallZone(null)}
              onMouseMove={(e) => e.stopPropagation()}
            >
            {/* In Wall Mode: Pure Z1 | Z2 | Z3... strip (zero Global clutter, hover illuminates Zone!) */}
            {isWall && (
              <div className="hm-cap-zones-row">
                <span className="hm-cap-zones-hint">Target Zone:</span>
                <div className="hm-cap-zones-pills">
                  {zones.map((z, idx) => {
                    const isSel = z.id === selectedZone?.id;
                    const lbl = getFolderSpecLabel(z.folderFilter || "ALL", folderCombos, roots);
                    return (
                      <button
                        key={z.id}
                        type="button"
                        className={`hm-cap-zone-pill ${isSel ? "active" : ""}`}
                        onMouseEnter={() => onHoverWallZone(z.id)}
                        onFocus={() => onHoverWallZone(z.id)}
                        onClick={() => onSelectZoneTarget(z.id)}
                        title={`Zone ${idx + 1}: ${lbl}`}
                      >
                        <strong>Z{idx + 1}</strong>
                        <span>{lbl}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3 Clear Side-by-Side Source Options */}
            <div className="hm-cap-grid">
              {/* Slot 1: Classic Quick Single Folder Picker */}
              <div className="hm-cap-card">
                <div className="hm-cap-card-head">
                  <span>1. Quick Folder</span>
                  {isWall && <span className="hm-cap-ztag">Z{selectedZoneNum}</span>}
                </div>
                <ThemedSelect
                  value={quickSelectVal}
                  leadingIcon={<Folder size={13} style={{ color: "var(--hm-accent-bright)" }} />}
                  options={quickFolderOptions}
                  onChange={(val) => {
                    if (val !== "__CUSTOM__") {
                      applySpecToTarget(val);
                    }
                  }}
                />
              </div>

              {/* Slot 2: Saved Multi-Folder Combo Presets */}
              <div className="hm-cap-card">
                <div className="hm-cap-card-head">
                  <span>2. Folder Combos</span>
                  <Sparkles size={11} style={{ color: "var(--hm-accent-bright)" }} />
                </div>
                <ThemedSelect
                  value={activeComboId}
                  placeholder={folderCombos.length ? "Select Combo..." : "No combos saved"}
                  emptyText="Save mixes inside 3. Folder Tree"
                  leadingIcon={<Sparkles size={13} style={{ color: "var(--hm-accent-bright)" }} />}
                  options={comboOptions}
                  onChange={(comboId) => {
                    if (comboId) {
                      applySpecToTarget({ type: "combo", comboId });
                    }
                  }}
                />
              </div>

              {/* Slot 3: Master Folder Tree Overlay Launcher */}
              <button
                type="button"
                className="hm-cap-tree-btn"
                onClick={() => {
                  setOpen(false);
                  onHoverWallZone(null);
                  onOpenTreeModal(isWall ? selectedZone?.id : null);
                }}
              >
                <div className="hm-cap-card-head" style={{ width: "100%" }}>
                  <span>3. Folder Tree</span>
                  <FolderTree size={12} style={{ color: "var(--hm-accent-bright)" }} />
                </div>
                <p>Mix branches, exclude subfolders &amp; save Combos</p>
              </button>
            </div>

            {onChangeFolderSidebarMode && (
              <div className="hm-cap-sidebar-row">
                <div className="hm-cap-sidebar-lbl">
                  <FolderTree size={12} style={{ color: "var(--hm-accent-bright)" }} />
                  <span>Folder Rail Sidebar</span>
                </div>
                <div className="hm-cap-sidebar-pills">
                  {[
                    { id: "off", label: "Off" },
                    { id: "hover", label: "Hover Edge" },
                    { id: "static", label: "Static + Drag" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`hm-cap-sb-pill ${
                        folderSidebarMode === opt.id ? "active" : ""
                      }`}
                      onClick={() => onChangeFolderSidebarMode(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

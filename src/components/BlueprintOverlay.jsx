import React, { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Lock, Unlock, Plus, X, ArrowLeftRight, Layers, Sparkles } from "lucide-react";
import { MAX_ZONES, countZones, listZones } from "../utils/zoneTree";
import MorphPresetSave from "./MorphPresetSave";

function formatAspectLabel(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return "16:9";
  if (Math.abs(aspect - 32 / 9) < 0.25) return "32:9 Super-Wide";
  if (Math.abs(aspect - 21 / 9) < 0.22) return "21:9 Ultrawide";
  if (Math.abs(aspect - 16 / 9) < 0.14) return "16:9 Widescreen";
  if (Math.abs(aspect - 16 / 10) < 0.1) return "16:10";
  if (Math.abs(aspect - 4 / 3) < 0.1) return "4:3";
  if (aspect < 0.9) return "Portrait";
  return `${aspect.toFixed(2)}:1`;
}

function BlueprintResizer({ dir, splitId, ratio, containerRef, onUpdateRatio }) {
  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    const onMove = (ev) => {
      const rect = el.getBoundingClientRect();
      const raw =
        dir === "row"
          ? (ev.clientX - rect.left) / Math.max(1, rect.width)
          : (ev.clientY - rect.top) / Math.max(1, rect.height);
      onUpdateRatio(splitId, raw);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const pct = (ratio * 100).toFixed(2);
  return (
    <div
      className={`bp-resizer dir-${dir}`}
      style={dir === "row" ? { left: `${pct}%` } : { top: `${pct}%` }}
      onPointerDown={onPointerDown}
      title="Drag divider to resize linked zones (always 100%)"
    >
      <div className="bp-resizer-pill" />
    </div>
  );
}

function BlueprintZoneNode({
  zone,
  zoneNumber,
  totalZones,
  canSplit,
  activeZoneId,
  swapSourceId,
  allZonePresets,
  onSelectZone,
  onSplitZone,
  onRemoveZone,
  onTriggerSwap,
}) {
  const isActive = zone.id === activeZoneId;
  const [hoverEdge, setHoverEdge] = useState(null); // "left" | "right" | "top" | "bottom" | null

  const handleMouseMove = (e) => {
    if (!canSplit) {
      if (hoverEdge) setHoverEdge(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
    const ny = (e.clientY - rect.top) / Math.max(1, rect.height);

    const dLeft = nx;
    const dRight = 1 - nx;
    const dTop = ny;
    const dBottom = 1 - ny;
    const minDist = Math.min(dLeft, dRight, dTop, dBottom);

    if (minDist > 0.3) {
      if (hoverEdge) setHoverEdge(null);
      return;
    }
    if (minDist === dLeft) setHoverEdge("left");
    else if (minDist === dRight) setHoverEdge("right");
    else if (minDist === dTop) setHoverEdge("top");
    else setHoverEdge("bottom");
  };

  const isSwapSource = swapSourceId === zone.id;
  const isSwapTarget = Boolean(swapSourceId && swapSourceId !== zone.id);
  const matchedPreset = allZonePresets.find((p) => p.id === zone.activePresetId);
  const styleLabel = matchedPreset
    ? matchedPreset.label
    : `${zone.engineMode === "slideshow" ? "Slideshow" : zone.engineMode === "classic" ? "Classic" : "Conveyor"} (Custom)`;
  const folderLabel = zone.folderFilter
    ? zone.folderFilter === "ALL"
      ? "All Folders"
      : zone.folderFilter
    : "Global Folder";

  return (
    <div
      className={`bp-zone-box ${isActive ? "is-active" : ""} ${isSwapSource ? "is-swap-src" : ""} ${
        isSwapTarget ? "is-swap-tgt" : ""
      }`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverEdge(null)}
      onClick={() => onSelectZone(zone.id)}
    >
      {/* Interactive Green Hotspot Split Preview (exact Sketch #3 regions, zero clutter!) */}
      {canSplit && hoverEdge && (
        <button
          type="button"
          className={`bp-split-hotspot edge-${hoverEdge}`}
          onClick={(e) => {
            e.stopPropagation();
            onSplitZone(zone.id, hoverEdge);
            setHoverEdge(null);
          }}
          title={`Split ${hoverEdge.toUpperCase()} — create new Zone`}
        >
          <Plus size={14} /> Split {hoverEdge}
        </button>
      )}

      {/* Clean Minimal Top Row */}
      <div className="bp-zone-head">
        <span className="bp-zone-badge">Z{zoneNumber}</span>
        <div className="bp-zone-actions" onClick={(e) => e.stopPropagation()}>
          {totalZones > 1 && (
            <button
              type="button"
              className={`bp-mini-icon ${isSwapSource ? "active" : ""}`}
              onClick={() => onTriggerSwap(zone.id)}
              title="Swap preset & folder with another zone"
            >
              <ArrowLeftRight size={11} />
            </button>
          )}
          {totalZones > 1 && (
            <button
              type="button"
              className="bp-mini-icon danger"
              onClick={() => onRemoveZone(zone.id)}
              title="Remove zone (sibling expands 100%)"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Clean Centered Readout — click box to edit in strip below */}
      <div className="bp-zone-summary">
        <div className="bp-zone-summary-style">{styleLabel}</div>
        <div className="bp-zone-summary-sub">📁 {folderLabel}</div>
      </div>
    </div>
  );
}

function BlueprintTreeBranch({
  node,
  zoneIndexMap,
  totalZones,
  canSplit,
  seamGap,
  onUpdateRatio,
  leafProps,
}) {
  const splitRef = useRef(null);

  if (node.type === "zone") {
    return (
      <BlueprintZoneNode
        zone={node}
        zoneNumber={zoneIndexMap.get(node.id) || 1}
        totalZones={totalZones}
        canSplit={canSplit}
        {...leafProps}
      />
    );
  }

  const pctA = (node.ratio * 100).toFixed(2);
  const gapPx = Math.max(4, Math.round(seamGap * 0.65));

  return (
    <div ref={splitRef} className={`bp-split dir-${node.dir}`} style={{ gap: `${gapPx}px` }}>
      <div className="bp-slot" style={{ flex: `0 0 calc(${pctA}% - ${gapPx / 2}px)` }}>
        <BlueprintTreeBranch
          node={node.a}
          zoneIndexMap={zoneIndexMap}
          totalZones={totalZones}
          canSplit={canSplit}
          seamGap={seamGap}
          onUpdateRatio={onUpdateRatio}
          leafProps={leafProps}
        />
      </div>
      <BlueprintResizer
        dir={node.dir}
        splitId={node.id}
        ratio={node.ratio}
        containerRef={splitRef}
        onUpdateRatio={onUpdateRatio}
      />
      <div className="bp-slot" style={{ flex: "1 1 0%" }}>
        <BlueprintTreeBranch
          node={node.b}
          zoneIndexMap={zoneIndexMap}
          totalZones={totalZones}
          canSplit={canSplit}
          seamGap={seamGap}
          onUpdateRatio={onUpdateRatio}
          leafProps={leafProps}
        />
      </div>
    </div>
  );
}

export default function BlueprintOverlay({
  isOpen,
  onClose,
  workspaceAspect,
  tree,
  seamGap,
  wallLocked,
  activeZoneId,
  swapSourceId,
  folders,
  allZonePresets,
  builtinWallPresets,
  userWallPresets,
  activeWallPresetId,
  targetUserWallPreset,
  isWallDirty,
  onUpdateSeamGap,
  onSetWallLocked,
  onSelectZone,
  onSplitZone,
  onRemoveZone,
  onTriggerSwap,
  onUpdateRatio,
  onApplyPresetToZone,
  onSetZoneFolder,
  onSetZoneSort,
  onApplyWallPreset,
  onUpdateUserWallPreset,
  onSaveNewUserWallPreset,
  onDeleteUserWallPreset,
}) {
  const zones = useMemo(() => listZones(tree), [tree]);
  const totalZones = countZones(tree);
  const canSplit = totalZones < MAX_ZONES;

  const zoneIndexMap = useMemo(() => {
    const m = new Map();
    zones.forEach((z, idx) => m.set(z.id, idx + 1));
    return m;
  }, [zones]);

  if (!isOpen) return null;

  const safeAspect = Math.max(0.8, Math.min(3.8, workspaceAspect || 16 / 9));

  return (
    <div className="cb-modal-backdrop bp-backdrop" onClick={onClose}>
      <motion.div
        className="bp-modal"
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bp-header">
          <div className="bp-title-group">
            <div className="bp-kicker">
              <Layers size={13} /> True-Aspect Wall Blueprint
            </div>
            <h2>
              Multi-Zone Mosaic Architect{" "}
              <span className="bp-aspect-pill">
                {formatAspectLabel(safeAspect)} • {totalZones}/{MAX_ZONES} Zones
              </span>
            </h2>
            <p className="bp-sub">
              Hover near a Zone&apos;s <strong>Left / Right / Top / Bottom</strong> edge to preview &amp; click a green{" "}
              <strong>+ Split</strong> • Drag any divider to resize linked rectangles (always 100%)!
            </p>
          </div>

          <div className="bp-head-actions">
            <label className="hm-slider-pill" title="Gap between neighboring zones (0px = seamless flush canvas)">
              Seam Gap
              <input
                type="range"
                min="0"
                max="18"
                step="1"
                value={seamGap}
                onChange={(e) => onUpdateSeamGap(Number(e.target.value))}
              />
              <span className="hm-slider-val">{seamGap}px</span>
            </label>

            <button
              type="button"
              className={`hm-btn ${!wallLocked ? "active" : ""}`}
              onClick={() => {
                onSetWallLocked(false);
                onClose();
              }}
              title="Close Blueprint & keep live canvas drag handles + quick pills visible"
            >
              <Unlock size={13} /> Edit Live on Wall
            </button>

            <button
              type="button"
              className="hm-btn active bp-lock-cta"
              onClick={() => {
                onSetWallLocked(true);
                onClose();
              }}
              title="Lock Wall into clean zero-chrome homogeneous browsing canvas"
            >
              <Lock size={13} /> Lock &amp; Browse
            </button>
          </div>
        </div>

        {/* Layer 2: Multi-Zone Wall Layout Presets Strip */}
        <div className="bp-wall-presets">
          <span className="bp-strip-label">
            <Sparkles size={11} /> Wall Presets:
          </span>
          {builtinWallPresets.map((wp) => (
            <button
              key={wp.id}
              type="button"
              className={`hm-btn ${activeWallPresetId === wp.id ? "active" : ""}`}
              onClick={() => onApplyWallPreset(wp)}
            >
              {wp.label}
            </button>
          ))}

          {userWallPresets.map((wp) => {
            const isEdited = targetUserWallPreset?.id === wp.id && isWallDirty;
            const isSelected =
              activeWallPresetId === wp.id || (targetUserWallPreset?.id === wp.id && !isWallDirty);
            return (
              <button
                key={wp.id}
                type="button"
                className={`hm-btn hm-user-preset ${isSelected ? "active" : ""}`}
                onClick={() => onApplyWallPreset(wp)}
              >
                {wp.label}
                {isEdited && <span className="hm-preset-dirty-dot" />}
                <span
                  className="hm-user-preset-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteUserWallPreset(wp.id);
                  }}
                  title="Delete saved wall preset"
                >
                  ×
                </span>
              </button>
            );
          })}

          <MorphPresetSave
            targetPreset={targetUserWallPreset}
            isDirty={isWallDirty}
            onUpdate={onUpdateUserWallPreset}
            onSaveNew={onSaveNewUserWallPreset}
          />
        </div>

        {/* Miniature Live-Aspect Canvas Frame */}
        <div className="bp-stage-wrap">
          <div
            className="bp-canvas-frame"
            style={{
              aspectRatio: `${safeAspect}`,
            }}
          >
            <BlueprintTreeBranch
              node={tree}
              zoneIndexMap={zoneIndexMap}
              totalZones={totalZones}
              canSplit={canSplit}
              seamGap={seamGap}
              onUpdateRatio={onUpdateRatio}
              leafProps={{
                activeZoneId,
                allZonePresets,
                swapSourceId,
                onSelectZone,
                onSplitZone,
                onRemoveZone,
                onTriggerSwap,
              }}
            />
          </div>
        </div>

        {/* Single Uncluttered Selected Zone Inspector Bar */}
        {(() => {
          const selIdx = Math.max(0, zones.findIndex((z) => z.id === activeZoneId));
          const selZone = zones[selIdx] || zones[0];
          if (!selZone) return null;
          return (
            <div className="bp-zone-inspector">
              <div className="bp-inspector-left">
                <span className="bp-zone-badge">Editing Zone {selIdx + 1}</span>
                <select
                  className="hm-select"
                  value={selZone.activePresetId || "__custom__"}
                  onChange={(e) => {
                    const found = allZonePresets.find((p) => p.id === e.target.value);
                    if (found) onApplyPresetToZone(selZone.id, found);
                  }}
                  title="Assign Layer-1 Preset to selected Zone"
                >
                  {!selZone.activePresetId && <option value="__custom__">⚙ Custom Settings</option>}
                  {allZonePresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>

                <select
                  className="hm-select"
                  value={selZone.folderFilter ?? "__GLOBAL__"}
                  onChange={(e) =>
                    onSetZoneFolder(selZone.id, e.target.value === "__GLOBAL__" ? null : e.target.value)
                  }
                  title="Folder feed for selected Zone"
                >
                  <option value="__GLOBAL__">🌐 Follow Global Folder</option>
                  {folders.map((f) => (
                    <option key={f} value={f}>
                      📁 {f === "ALL" ? "All Folders" : f}
                    </option>
                  ))}
                </select>

                <select
                  className="hm-select"
                  value={selZone.sortBy ?? "__GLOBAL__"}
                  onChange={(e) =>
                    onSetZoneSort(selZone.id, e.target.value === "__GLOBAL__" ? null : e.target.value)
                  }
                  title="Sort order for selected Zone"
                >
                  <option value="__GLOBAL__">🌐 Follow Global Sort</option>
                  <option value="newest">Sort: Newest</option>
                  <option value="oldest">Sort: Oldest</option>
                  <option value="size">Sort: File Size</option>
                  <option value="aspect">Sort: Portrait → Wide</option>
                  <option value="name">Sort: A–Z</option>
                  <option value="shuffle">Sort: Shuffle</option>
                </select>
              </div>

              {canSplit && (
                <div className="bp-inspector-splits">
                  <span className="bp-strip-label">Quick Split Z{selIdx + 1}:</span>
                  {["left", "right", "top", "bottom"].map((edge) => (
                    <button
                      key={edge}
                      type="button"
                      className="hm-btn"
                      onClick={() => onSplitZone(selZone.id, edge)}
                    >
                      <Plus size={11} /> {edge[0].toUpperCase() + edge.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </motion.div>
    </div>
  );
}

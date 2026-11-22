import React, { useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, ArrowLeftRight, Plus, X, FolderPlus } from "lucide-react";
import ConveyorBrick from "./ConveyorBrick";
import ClassicGridEngine from "./ClassicGridEngine";
import SlideshowEngine from "./SlideshowEngine";
import { filterAndSortItems } from "../utils/presets";
import { EMPTY_ZONE_FILTER, isFolderSpecUnmountedRoot } from "../utils/folderTree";
import { useCuration } from "../utils/curation";
import { MAX_ZONES, countZones, findZone, listZones } from "../utils/zoneTree";

function SplitResizer({ dir, splitId, ratio, containerRef, onUpdateRatio }) {
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

  const pct = (ratio * 100).toFixed(3);
  return (
    <div
      className={`cb-split-resizer dir-${dir}`}
      style={dir === "row" ? { left: `${pct}%` } : { top: `${pct}%` }}
      onPointerDown={onPointerDown}
      title="Drag border to resize adjacent zones"
    >
      <div className="cb-split-resizer-bar" />
    </div>
  );
}

function ZoneLeafView({
  zone,
  zoneNumber,
  totalZones,
  canSplit,
  editing,
  blueprintMode,
  rawItems,
  globalFolder,
  globalSearch,
  globalSort,
  shuffleSeed,
  roots = [],
  folderCombos = [],
  searchFavOnly = false,
  searchAllFolders = false,
  advancedFilter = null,
  allZonePresets,
  activeZoneId,
  hoveredBarZoneId,
  pulsingZoneId = null,
  soloZoneId,
  swapSourceId,
  lightboxOpen = false,
  selectedKeys = null,
  vanishingKeys = null,
  dragToMoveEnabled = false,
  isDraggingFiles = false,
  onTileClick = null,
  onClearSelection = null,
  onBeginTileDrag = null,
  onSelectZone,
  onSplitZone,
  onToggleSolo,
  onTriggerSwap,
  onRemoveZone,
  onInspect,
  onPatchZoneSlideshowCfg,
  onOpenZoneDrawer,
  onOpenZoneTree,
  onResetZoneAll,
}) {
  const isActive = zone.id === activeZoneId;
  const isBarHovered = zone.id === hoveredBarZoneId;
  const effectiveFolder = zone.folderFilter || "ALL";
  const effectiveSort = zone.sortBy || globalSort;
  const [hoverEdge, setHoverEdge] = useState(null);
  const curation = useCuration();
  const favSet = curation?.favSet;
  const pinSet = curation?.pinSet;
  const purgatorySet = curation?.purgatorySet;
  const notesMap = curation?.notesMap;

  const zoneItems = useMemo(
    () =>
      filterAndSortItems(
        rawItems,
        effectiveFolder,
        globalSearch,
        effectiveSort,
        shuffleSeed,
        folderCombos,
        {
          favSet,
          pinSet,
          purgatorySet,
          notesMap,
          favoritesOnly: searchFavOnly,
          searchAllFolders,
          advancedFilter,
        }
      ),
    [
      rawItems,
      effectiveFolder,
      globalSearch,
      effectiveSort,
      shuffleSeed,
      folderCombos,
      favSet,
      pinSet,
      purgatorySet,
      notesMap,
      searchFavOnly,
      searchAllFolders,
      advancedFilter,
    ]
  );

  // Lightbox clicks are intentionally paused while Drawer Edit Mode is open
  const safeInspect = editing
    ? undefined
    : (payload) =>
        onInspect?.(
          payload && typeof payload === "object" && payload.item
            ? { ...payload, sourceLabel: payload.sourceLabel || `Zone ${zoneNumber}` }
            : { item: payload, items: zoneItems, sourceLabel: `Zone ${zoneNumber}` }
        );

  const isEmptyAssignedZone = effectiveFolder === EMPTY_ZONE_FILTER;
  const isUnmountedRootZone = useMemo(
    () =>
      zoneItems.length === 0 &&
      !isEmptyAssignedZone &&
      isFolderSpecUnmountedRoot(effectiveFolder, roots, folderCombos),
    [zoneItems.length, isEmptyAssignedZone, effectiveFolder, roots, folderCombos]
  );

  const renderEngine = () => {
    if (isEmptyAssignedZone || isUnmountedRootZone) {
      return (
        <div className="cb-zone-unmounted-wrap">
          <div className="cb-zone-unmounted-card">
            <div className="cb-zone-unmounted-icon">
              <FolderPlus size={16} />
            </div>
            <div className="cb-zone-unmounted-title">
              {isEmptyAssignedZone ? `Zone ${zoneNumber} Ready` : "Source Folder Unmounted"}
            </div>
            <div className="cb-zone-unmounted-sub">
              {isEmptyAssignedZone
                ? "Pick any mounted folder or saved combo from your Master Folder Tree, or load All Folders."
                : `The library assigned to Zone ${zoneNumber} was unmounted. Choose another folder or reset to All Folders.`}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {onOpenZoneTree && (
                <button
                  type="button"
                  className="hm-welcome-btn-primary"
                  style={{ height: 30, padding: "0 12px", fontSize: 12 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenZoneTree(zone.id);
                  }}
                >
                  Choose Folder…
                </button>
              )}
              {onResetZoneAll && (
                <button
                  type="button"
                  className="hm-welcome-btn-secondary"
                  style={{ height: 30, padding: "0 12px", fontSize: 12 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onResetZoneAll(zone.id);
                  }}
                >
                  All Folders
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    const mode = zone.engineMode || "conveyor";
    if (mode === "conveyor") {
      const cfg = zone.conveyorCfg;
      return (
        <ConveyorBrick
          items={zoneItems}
          axis={cfg.axis}
          flowMode={cfg.flowMode}
          turnStyle={cfg.turnStyle}
          lanes={cfg.lanes}
          laneFill={cfg.laneFill}
          tileShape={cfg.tileShape}
          gap={cfg.gap}
          cornerRadius={cfg.cornerRadius ?? 12}
          bend={cfg.bend}
          autoSpeed={cfg.paused ? 0 : cfg.autoSpeed}
          cursorSteer={cfg.cursorSteer}
          hoverBrake={cfg.hoverBrake}
          edgeFade={cfg.edgeFade}
          showGuideWire={cfg.showGuideWire}
          showMetadata={cfg.showMetadata ?? true}
          hoverFX={cfg.hoverFX}
          uncropHover={cfg.uncropHover ?? false}
          isActiveZone={isActive}
          selectedKeys={selectedKeys}
          vanishingKeys={vanishingKeys}
          onTileClick={
            onTileClick ? (e, item) => onTileClick(e, item, zoneItems) : null
          }
          onClearSelection={onClearSelection}
          dragToMoveEnabled={dragToMoveEnabled}
          isDraggingFiles={isDraggingFiles}
          onBeginTileDrag={onBeginTileDrag}
          onInspect={safeInspect}
        />
      );
    }
    if (mode === "classic") {
      const cfg = zone.classicCfg;
      return (
        <ClassicGridEngine
          items={zoneItems}
          layoutStyle={cfg.layoutStyle}
          cols={cfg.cols}
          sizeFill={cfg.sizeFill}
          tileShape={cfg.tileShape}
          ratioTame={cfg.ratioTame ?? 0}
          wideSpan={cfg.wideSpan ?? false}
          gap={cfg.gap}
          cornerRadius={cfg.cornerRadius ?? 12}
          autoSpeed={cfg.paused ? 0 : cfg.autoSpeed}
          edgeFX={cfg.edgeFX}
          cursorSteer={cfg.cursorSteer}
          hoverBrake={cfg.hoverBrake}
          loopWrap={cfg.loopWrap}
          edgeFade={cfg.edgeFade}
          showMetadata={cfg.showMetadata ?? true}
          hoverFX={cfg.hoverFX}
          uncropHover={cfg.uncropHover ?? false}
          isActiveZone={isActive}
          selectedKeys={selectedKeys}
          vanishingKeys={vanishingKeys}
          onTileClick={
            onTileClick ? (e, item) => onTileClick(e, item, zoneItems) : null
          }
          onClearSelection={onClearSelection}
          dragToMoveEnabled={dragToMoveEnabled}
          isDraggingFiles={isDraggingFiles}
          onBeginTileDrag={onBeginTileDrag}
          onInspect={safeInspect}
        />
      );
    }
    const cfg = zone.slideshowCfg;
    return (
      <SlideshowEngine
        items={zoneItems}
        cfg={cfg}
        isActiveZone={isActive}
        lightboxOpen={lightboxOpen}
        editing={editing}
        onInspect={safeInspect}
        onPatchCfg={(patch) => onPatchZoneSlideshowCfg?.(zone.id, patch)}
        onOpenDrawer={() => onOpenZoneDrawer?.(zone.id)}
      />
    );
  };

  const handleSplitMouseMove = (e) => {
    if (!blueprintMode || !canSplit) {
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

  const isZonePulsing = zone.id === pulsingZoneId;
  const isSwapSource = swapSourceId === zone.id;
  const isSwapTarget = Boolean(swapSourceId && swapSourceId !== zone.id);
  const matchedPreset = allZonePresets?.find((p) => p.id === zone.activePresetId);
  const engineShort =
    zone.engineMode === "slideshow" ? "Slideshow" : zone.engineMode === "classic" ? "Classic" : "Conveyor";

  return (
    <div
      data-zone-id={zone.id}
      className={`cb-zone-cell ${editing ? "is-editing-cell" : ""} ${
        editing && isActive ? "is-edit-active" : ""
      } ${isBarHovered ? "is-bar-hovered" : ""} ${isZonePulsing ? "is-zone-pulsing" : ""} ${
        isSwapSource ? "is-swap-source" : ""
      } ${isSwapTarget ? "is-swap-target" : ""}`}
      onPointerDownCapture={() => {
        if (editing) onSelectZone(zone.id);
      }}
      onClick={() => {
        if (editing && isSwapTarget) onTriggerSwap(zone.id);
      }}
      onMouseMove={handleSplitMouseMove}
      onMouseLeave={() => setHoverEdge(null)}
    >
      {renderEngine()}

      {/* Solo Mode Exit Pill (if maximized while browsing or editing) */}
      {soloZoneId === zone.id && (
        <button
          className="cb-zone-solo-exit"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSolo(null);
          }}
          title="Return to full Multi-Zone Wall"
        >
          <Minimize2 size={13} /> Exit Solo ({zoneItems.length})
        </button>
      )}

      {/* Subtle corner badge when Editing (Drawer open) or hovering/pulsing from Folder Sidebar */}
      {(editing || isBarHovered || isZonePulsing) && !blueprintMode && (
        <div
          className={`cb-zone-corner-tag ${isActive || isZonePulsing ? "active" : ""}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSelectZone(zone.id);
          }}
          title={`Click anywhere in this box to tune Zone ${zoneNumber}`}
        >
          <span className="cb-zone-corner-num">Z{zoneNumber}</span>
          <span className="cb-zone-corner-mode">
            {matchedPreset ? matchedPreset.label : engineShort}
          </span>
        </div>
      )}

      {/* In-Place Blueprint Split Veil + Green Edge Hotspots directly on live Wall */}
      {editing && blueprintMode && (
        <div className="cb-live-bp-veil">
          <div className="cb-live-bp-top" onPointerDown={(e) => e.stopPropagation()}>
            <span className={`cb-zone-corner-tag ${isActive ? "active" : ""}`}>
              <span className="cb-zone-corner-num">Z{zoneNumber}</span>
              <span className="cb-zone-corner-mode">{engineShort}</span>
            </span>

            <div className="cb-live-bp-actions">
              {totalZones > 1 && (
                <button
                  type="button"
                  className="bp-mini-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSolo(soloZoneId === zone.id ? null : zone.id);
                  }}
                  title="Preview this Zone solo"
                >
                  <Maximize2 size={11} />
                </button>
              )}
              {totalZones > 1 && (
                <button
                  type="button"
                  className={`bp-mini-icon ${isSwapSource ? "active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTriggerSwap(zone.id);
                  }}
                  title={isSwapTarget ? "Click to swap places" : "Swap contents with another zone"}
                >
                  <ArrowLeftRight size={11} />
                </button>
              )}
              {totalZones > 1 && (
                <button
                  type="button"
                  className="bp-mini-icon danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveZone(zone.id);
                  }}
                  title="Remove Zone (neighbor expands to fill 100%)"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          <div className="cb-live-bp-hint">
            {canSplit
              ? isSwapTarget
                ? "Click to swap here"
                : "Hover any edge to + Split"
              : `Max ${MAX_ZONES} zones reached`}
          </div>

          {canSplit && hoverEdge && (
            <button
              type="button"
              className={`bp-split-hotspot edge-${hoverEdge}`}
              onPointerDown={(e) => e.stopPropagation()}
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
        </div>
      )}
    </div>
  );
}

function SplitTreeBranch({
  node,
  zoneIndexMap,
  totalZones,
  canSplit,
  seamGap,
  editing,
  blueprintMode,
  onUpdateRatio,
  leafProps,
}) {
  const splitRef = useRef(null);

  if (node.type === "zone") {
    return (
      <ZoneLeafView
        zone={node}
        zoneNumber={zoneIndexMap.get(node.id) || 1}
        totalZones={totalZones}
        canSplit={canSplit}
        editing={editing}
        blueprintMode={blueprintMode}
        {...leafProps}
      />
    );
  }

  const pctA = (node.ratio * 100).toFixed(3);
  const halfGap = seamGap * 0.5;

  return (
    <div
      ref={splitRef}
      className={`cb-split-branch dir-${node.dir}`}
      style={{ gap: `${seamGap}px` }}
    >
      <div
        className="cb-split-slot"
        style={{
          flex: `0 0 calc(${pctA}% - ${halfGap}px)`,
        }}
      >
        <SplitTreeBranch
          node={node.a}
          zoneIndexMap={zoneIndexMap}
          totalZones={totalZones}
          canSplit={canSplit}
          seamGap={seamGap}
          editing={editing}
          blueprintMode={blueprintMode}
          onUpdateRatio={onUpdateRatio}
          leafProps={leafProps}
        />
      </div>

      {editing && (
        <SplitResizer
          dir={node.dir}
          splitId={node.id}
          ratio={node.ratio}
          containerRef={splitRef}
          onUpdateRatio={onUpdateRatio}
        />
      )}

      <div className="cb-split-slot" style={{ flex: "1 1 0%" }}>
        <SplitTreeBranch
          node={node.b}
          zoneIndexMap={zoneIndexMap}
          totalZones={totalZones}
          canSplit={canSplit}
          seamGap={seamGap}
          editing={editing}
          blueprintMode={blueprintMode}
          onUpdateRatio={onUpdateRatio}
          leafProps={leafProps}
        />
      </div>
    </div>
  );
}

export default function ZoneWallRenderer({
  tree,
  seamGap = 8,
  editing = false,
  blueprintMode = false,
  soloZoneId = null,
  activeZoneId,
  hoveredBarZoneId = null,
  pulsingZoneId = null,
  rawItems,
  globalFolder,
  globalSearch,
  globalSort,
  shuffleSeed,
  roots = [],
  folderCombos = [],
  searchFavOnly = false,
  searchAllFolders = false,
  advancedFilter = null,
  allZonePresets,
  swapSourceId,
  lightboxOpen = false,
  selectedKeys = null,
  vanishingKeys = null,
  dragToMoveEnabled = false,
  isDraggingFiles = false,
  onTileClick = null,
  onClearSelection = null,
  onBeginTileDrag = null,
  onSelectZone,
  onSplitZone,
  onToggleSolo,
  onTriggerSwap,
  onRemoveZone,
  onUpdateRatio,
  onInspect,
  onPatchZoneSlideshowCfg,
  onOpenZoneDrawer,
  onOpenZoneTree,
  onResetZoneAll,
}) {
  const zones = useMemo(() => listZones(tree), [tree]);
  const totalZones = countZones(tree);
  const canSplit = totalZones < MAX_ZONES;

  const zoneIndexMap = useMemo(() => {
    const m = new Map();
    zones.forEach((z, idx) => m.set(z.id, idx + 1));
    return m;
  }, [zones]);

  const soloZone = soloZoneId ? findZone(tree, soloZoneId) : null;

  const leafProps = {
    rawItems,
    globalFolder,
    globalSearch,
    globalSort,
    shuffleSeed,
    roots,
    folderCombos,
    searchFavOnly,
    searchAllFolders,
    advancedFilter,
    allZonePresets,
    activeZoneId,
    hoveredBarZoneId,
    pulsingZoneId,
    soloZoneId,
    swapSourceId,
    lightboxOpen,
    selectedKeys,
    vanishingKeys,
    dragToMoveEnabled,
    isDraggingFiles,
    onTileClick,
    onClearSelection,
    onBeginTileDrag,
    onSelectZone,
    onSplitZone,
    onToggleSolo,
    onTriggerSwap,
    onRemoveZone,
    onInspect,
    onPatchZoneSlideshowCfg,
    onOpenZoneDrawer,
    onOpenZoneTree,
    onResetZoneAll,
  };

  if (soloZone) {
    return (
      <div className={`cb-wall-host ${editing ? "is-editing" : "is-locked"}`}>
        <ZoneLeafView
          {...leafProps}
          zone={soloZone}
          zoneNumber={zoneIndexMap.get(soloZone.id) || 1}
          totalZones={1}
          canSplit={false}
          editing={editing}
          blueprintMode={false}
          activeZoneId={soloZone.id}
        />
      </div>
    );
  }

  return (
    <div
      className={`cb-wall-host ${editing ? "is-editing" : "is-locked"} ${
        seamGap === 0 && totalZones > 1 ? "seam-zero" : ""
      }`}
    >
      <SplitTreeBranch
        node={tree}
        zoneIndexMap={zoneIndexMap}
        totalZones={totalZones}
        canSplit={canSplit}
        seamGap={seamGap}
        editing={editing}
        blueprintMode={blueprintMode}
        onUpdateRatio={onUpdateRatio}
        leafProps={{
          ...leafProps,
          activeZoneId,
        }}
      />
    </div>
  );
}

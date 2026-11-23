import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  X,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Play,
  Pause,
  Layers,
  Scissors,
  ArrowLeftRight,
  Maximize2,
  Trash2,
  Shuffle,
  Sun,
  Moon,
  Check,
  Sparkles,
  FolderTree,
  Folder,
  Flame,
  LayoutGrid,
  Rows3,
  HardDrive,
  Plus,
  ArrowUp,
  ArrowDown,
  ChevronDown,
} from "lucide-react";
import { ACCENT_SLOTS, BUTTON_THEMES } from "../theme";
import { MAX_ZONES } from "../utils/zoneTree";
import { getFolderSpecLabel } from "../utils/folderTree";
import { DEFAULT_CARD_LABELS, FavMark, useCuration } from "../utils/curation";
import { DELETE_FX_OPTIONS } from "../utils/deletionFx";
import {
  SLIDESHOW_STYLES,
  getSlideshowStyle,
  getSlideshowStyleParams,
} from "../utils/slideshowStyles";
import MorphPresetSave from "./MorphPresetSave";
import ThemedSelect from "./ThemedSelect";

const DRAWER_SEC_MAP_KEY = "argon_cb_drawer_sec_map_v1";
const DrawerAccordionContext = createContext(null);

function loadDrawerSecMap() {
  try {
    const raw = window.localStorage.getItem(DRAWER_SEC_MAP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return {};
}

function DrawerSection({ id, title, badge, children }) {
  const acc = useContext(DrawerAccordionContext);
  const isCollapsible = Boolean(acc && id);
  const isOpen = !isCollapsible || acc.activeId === id;

  return (
    <section className={`hm-drawer-section ${isOpen ? "is-open" : "is-collapsed"}`}>
      {isCollapsible ? (
        <button
          type="button"
          className="hm-drawer-sec-head"
          aria-expanded={isOpen}
          onClick={() => acc.onSelect(id)}
        >
          <div className="hm-drawer-sec-head-main">
            <h4>{title}</h4>
          </div>
          <div className="hm-drawer-sec-head-right">
            {badge && <span className="hm-drawer-sec-badge">{badge}</span>}
            <ChevronDown size={14} className="hm-drawer-sec-chevron" />
          </div>
        </button>
      ) : (
        <div className="hm-drawer-sec-head">
          <h4>{title}</h4>
          {badge && <span className="hm-drawer-sec-badge">{badge}</span>}
        </div>
      )}
      {isOpen && <div className="hm-drawer-sec-body">{children}</div>}
    </section>
  );
}

function DrawerSlider({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  prefixAction,
  disabled = false,
}) {
  return (
    <div className={`hm-drawer-row-block ${disabled ? "is-disabled" : ""}`}>
      <div className="hm-drawer-row-top">
        <div className="hm-drawer-label-wrap">
          <span className="hm-drawer-label">{label}</span>
          {hint && <span className="hm-drawer-hint">{hint}</span>}
        </div>
        <div className="hm-drawer-val-group">
          {prefixAction}
          <span className="hm-drawer-val">
            {value}
            {unit}
          </span>
        </div>
      </div>
      <input
        className="hm-drawer-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function DrawerToggle({ label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      className={`hm-drawer-toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <div className="hm-drawer-label-wrap">
        <span className="hm-drawer-label">{label}</span>
        {hint && <span className="hm-drawer-hint">{hint}</span>}
      </div>
      <span className={`hm-switch ${checked ? "on" : ""}`}>
        <span className="hm-switch-knob" />
      </span>
    </button>
  );
}

function DrawerSelect({ label, hint, value, onChange, children }) {
  return (
    <div className="hm-drawer-row-block">
      <div className="hm-drawer-label-wrap">
        <span className="hm-drawer-label">{label}</span>
        {hint && <span className="hm-drawer-hint">{hint}</span>}
      </div>
      <ThemedSelect value={value} onChange={onChange}>
        {children}
      </ThemedSelect>
    </div>
  );
}

function FolderScopeRow({
  label,
  hint,
  spec,
  folders,
  roots = [],
  folderCombos,
  onChangeSpec,
  onOpenTree,
  treeTitle,
}) {
  const curation = useCuration();
  const favIcon = curation?.favIcon || "star";
  const selectValue =
    typeof spec === "string"
      ? spec
      : spec?.type === "combo"
      ? `__COMBO__:${spec.comboId}`
      : spec?.type === "custom"
      ? "__CUSTOM__"
      : "ALL";

  const options = [
    ...folders.map((f) => ({
      value: f.value,
      label: f.label,
      menuLabel: f.menuLabel,
      depth: f.depth,
      meta: String(f.totalCount),
      icon: f.isFavorites ? (
        <FavMark favIcon={favIcon} filled size={12} style={{ color: "var(--hm-accent-bright)" }} />
      ) : (
        <Folder size={12} style={{ color: "var(--hm-accent-bright)" }} />
      ),
    })),
    ...folderCombos.map((c) => ({
      value: `__COMBO__:${c.id}`,
      label: c.label,
      menuLabel: c.label,
      group: "Saved Folder Combos",
      meta: `${c.paths?.length || 0}`,
      icon: c.favoritesOnly ? (
        <FavMark favIcon={favIcon} filled size={12} style={{ color: "var(--hm-accent-bright)" }} />
      ) : (
        <Sparkles size={12} style={{ color: "var(--hm-accent-bright)" }} />
      ),
    })),
    ...(spec?.type === "custom"
      ? [
          {
            value: "__CUSTOM__",
            label: getFolderSpecLabel(spec, folderCombos, roots),
            menuLabel: getFolderSpecLabel(spec, folderCombos, roots),
            icon: <Sparkles size={12} style={{ color: "var(--hm-accent-bright)" }} />,
          },
        ]
      : []),
  ];

  return (
    <div className="hm-drawer-inline-split">
      <div style={{ flex: 1 }}>
        <div className="hm-drawer-row-block">
          <div className="hm-drawer-label-wrap">
            <span className="hm-drawer-label">{label}</span>
            {hint && <span className="hm-drawer-hint">{hint}</span>}
          </div>
          <ThemedSelect
            value={selectValue}
            leadingIcon={<Folder size={13} style={{ color: "var(--hm-accent-bright)" }} />}
            options={options}
            onChange={(val) => {
              if (val.startsWith("__COMBO__:")) {
                onChangeSpec({ type: "combo", comboId: val.slice(10) });
              } else if (val !== "__CUSTOM__") {
                onChangeSpec(val);
              }
            }}
          />
        </div>
      </div>
      {onOpenTree && (
        <button
          type="button"
          className="hm-btn"
          style={{ alignSelf: "flex-end", marginBottom: 2 }}
          onClick={onOpenTree}
          title={treeTitle}
        >
          <FolderTree size={13} />
        </button>
      )}
    </div>
  );
}

function StageThemeSection({
  stageMode,
  setStageMode,
  accentId,
  setAccentId,
  buttonTheme = "candy",
  setButtonTheme,
  buttonCrispText = false,
  setButtonCrispText,
  screensaverMin = 4,
  setScreensaverMin,
  screensaverSource = "current",
  setScreensaverSource,
  dockSide = "left",
  onSetDockSide,
  folderSidebarMode = "off",
  onSetFolderSidebarMode,
  activeRootPath = "",
  roots = [],
  onOpenAddRootModal,
  onRequestRemoveRoot,
  onReorderRoots,
  dropActionMode = "ask",
  setDropActionMode,
}) {
  const curation = useCuration();
  const favIcon = curation?.favIcon || "star";
  const hasWorkspaceControls = Boolean(
    onSetFolderSidebarMode ||
      onSetDockSide ||
      setDropActionMode ||
      (Array.isArray(roots) && onOpenAddRootModal) ||
      setScreensaverMin
  );

  return (
    <>
    <DrawerSection id="stage_theme" title="Stage & Theme" badge="Global">
      <div className="hm-drawer-seg-row">
        <button
          type="button"
          className={`hm-drawer-seg-btn ${stageMode === "dark" ? "active" : ""}`}
          onClick={() => setStageMode("dark")}
        >
          <Moon size={13} /> Dark Stage
        </button>
        <button
          type="button"
          className={`hm-drawer-seg-btn ${stageMode === "light" ? "active" : ""}`}
          onClick={() => setStageMode("light")}
        >
          <Sun size={13} /> Light Stage
        </button>
      </div>
      <div className="hm-drawer-accent-row">
        <span className="hm-drawer-hint">Accent Glow</span>
        <div className="hm-accent-dock">
          {Object.values(ACCENT_SLOTS).map((slot) => (
            <button
              key={slot.id}
              type="button"
              className={`hm-accent-dot ${accentId === slot.id ? "active" : ""}`}
              style={{
                backgroundColor: slot.accent,
                boxShadow: accentId === slot.id ? `0 0 8px ${slot.accent}` : "none",
              }}
              onClick={() => setAccentId(slot.id)}
              title={slot.name}
            />
          ))}
        </div>
      </div>
      {setButtonTheme && (
        <div className="hm-drawer-row-block" style={{ marginTop: 4 }}>
          <div className="hm-drawer-label-wrap">
            <span className="hm-drawer-label">Button Theme Switcher</span>
            <span className="hm-drawer-hint">
              Applies to all gallery buttons across dark &amp; light mode
            </span>
          </div>
          <div className="hm-drawer-seg-row">
            {BUTTON_THEMES.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`hm-drawer-seg-btn ${buttonTheme === opt.id ? "active" : ""}`}
                onClick={() => setButtonTheme(opt.id)}
                title={opt.hint}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {setButtonCrispText && (
            <div style={{ marginTop: 4 }}>
              <DrawerToggle
                label="Crisp Hover Text"
                hint="Integer lift without zoom scale so button fonts stay razor-sharp"
                checked={Boolean(buttonCrispText)}
                onChange={setButtonCrispText}
              />
            </div>
          )}
        </div>
      )}
      {curation && (
        <div className="hm-drawer-row-block" style={{ marginTop: 4 }}>
          <div className="hm-drawer-label-wrap">
            <span className="hm-drawer-label">Favorites Symbol</span>
            <span className="hm-drawer-hint">Badge, search chip &amp; radial icon</span>
          </div>
          <div className="hm-drawer-seg-row">
            <button
              type="button"
              className={`hm-drawer-seg-btn ${favIcon === "star" ? "active" : ""}`}
              onClick={() => curation.setFavIcon("star")}
            >
              <FavMark favIcon="star" filled={favIcon === "star"} size={12} /> Star
            </button>
            <button
              type="button"
              className={`hm-drawer-seg-btn ${favIcon === "heart" ? "active" : ""}`}
              onClick={() => curation.setFavIcon("heart")}
            >
              <FavMark favIcon="heart" filled={favIcon === "heart"} size={12} /> Heart
            </button>
          </div>
        </div>
      )}

      {curation && (
        <div className="hm-drawer-row-block" style={{ marginTop: 4 }}>
          <div className="hm-drawer-label-wrap">
            <span className="hm-drawer-label">Permanent Delete FX</span>
            <span className="hm-drawer-hint">
              Plays on Shift+Del, Radial Delete &amp; Purgatory PURGE
            </span>
          </div>
          <div className="hm-drawer-seg-row">
            {DELETE_FX_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`hm-drawer-seg-btn ${
                  (curation.deleteFx || "ember") === opt.id ? "active" : ""
                }`}
                onClick={() => curation.setDeleteFx?.(opt.id)}
                title={opt.hint}
              >
                {opt.label === "Magic Poof"
                  ? "Poof"
                  : opt.label === "Ember Burn"
                  ? "Ember"
                  : opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </DrawerSection>

    {hasWorkspaceControls && (
      <DrawerSection id="workspace_library" title="Workspace & Library" badge="Global">
      {onSetFolderSidebarMode && (
        <div className="hm-drawer-row-block" style={{ marginTop: 6 }}>
          <div className="hm-drawer-label-wrap">
            <span className="hm-drawer-label">Folder Tree Sidebar</span>
            <span className="hm-drawer-hint">
              Hover Edge overlay or Static organizer (enables Hold-to-Drag into folders)
            </span>
          </div>
          <div className="hm-drawer-seg-row">
            {[
              { id: "off", label: "Off" },
              { id: "hover", label: "Hover Edge" },
              { id: "static", label: "Static" },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`hm-drawer-seg-btn ${
                  folderSidebarMode === opt.id ? "active" : ""
                }`}
                onClick={() => onSetFolderSidebarMode(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {onSetDockSide && (
        <div className="hm-drawer-row-block" style={{ marginTop: 4 }}>
          <div className="hm-drawer-label-wrap">
            <span className="hm-drawer-label">Workspace Panels Side</span>
            <span className="hm-drawer-hint">
              Folder Tree always pairs cleanly opposite Customize Settings
            </span>
          </div>
          <div className="hm-drawer-seg-row">
            <button
              type="button"
              className={`hm-drawer-seg-btn ${dockSide === "right" ? "active" : ""}`}
              onClick={() => onSetDockSide("right")}
            >
              <PanelLeft size={12} /> Folders L · Settings R
            </button>
            <button
              type="button"
              className={`hm-drawer-seg-btn ${dockSide === "left" ? "active" : ""}`}
              onClick={() => onSetDockSide("left")}
            >
              <PanelRight size={12} /> Settings L · Folders R
            </button>
          </div>
        </div>
      )}

      {setDropActionMode && (
        <div className="hm-drawer-row-block" style={{ marginTop: 6 }}>
          <div className="hm-drawer-label-wrap">
            <span className="hm-drawer-label">Drag &amp; Drop on Folder</span>
            <span className="hm-drawer-hint">
              Choose at cursor on drop, or hold Ctrl (Copy) / Shift (Move)
            </span>
          </div>
          <div className="hm-drawer-seg-row">
            {[
              { id: "ask", label: "Ask Move/Copy" },
              { id: "move", label: "Direct Move" },
              { id: "copy", label: "Direct Copy" },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`hm-drawer-seg-btn ${dropActionMode === opt.id ? "active" : ""}`}
                onClick={() => setDropActionMode(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(roots) && onOpenAddRootModal && (
        <div className="hm-drawer-row-block" style={{ marginTop: 8 }}>
          <div className="hm-drawer-label-wrap">
            <span className="hm-drawer-label">Mounted Root Libraries ({roots.length})</span>
            <span className="hm-drawer-hint">
              Stack multiple drives or folders cleanly in the Folders sidebar
            </span>
          </div>
          <div className="hm-drawer-roots-list">
            {roots.map((r, idx) => (
              <div key={r.id} className="hm-drawer-root-item">
                <HardDrive size={12} style={{ color: "var(--hm-accent-bright)", flexShrink: 0 }} />
                <div className="hm-drawer-root-meta">
                  <strong>{r.label}</strong>
                  <span title={r.path}>{r.path}</span>
                </div>
                <div className="hm-drawer-root-btns">
                  {onReorderRoots && roots.length > 1 && (
                    <>
                      <button
                        type="button"
                        className="hm-icon-btn sm"
                        disabled={idx === 0}
                        onClick={() => {
                          const ids = roots.map((x) => x.id);
                          [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
                          onReorderRoots(ids);
                        }}
                        title="Move root up"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="hm-icon-btn sm"
                        disabled={idx === roots.length - 1}
                        onClick={() => {
                          const ids = roots.map((x) => x.id);
                          [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
                          onReorderRoots(ids);
                        }}
                        title="Move root down"
                      >
                        <ArrowDown size={11} />
                      </button>
                    </>
                  )}
                  {onRequestRemoveRoot && (
                    <button
                      type="button"
                      className="hm-icon-btn sm danger"
                      onClick={() => onRequestRemoveRoot(r)}
                      title={`Unmount "${r.label}" from gallery (does NOT delete files on disk)`}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="hm-btn hm-drawer-add-root-btn"
              onClick={onOpenAddRootModal}
            >
              <Plus size={12} /> Add Root Folder…
            </button>
          </div>
        </div>
      )}

      {setScreensaverMin && (
        <div className="hm-drawer-row-block" style={{ marginTop: 6 }}>
          <DrawerSelect
            label="Idle Screensaver"
            hint="Starts only when the whole PC rests & HammelArt is the active tab"
            value={String(screensaverMin)}
            onChange={(v) => setScreensaverMin(Number(v))}
          >
            <option value="0">Off</option>
            <option value="1">After 1 minute</option>
            <option value="2">After 2 minutes</option>
            <option value="3">After 3 minutes</option>
            <option value="4">After 4 minutes</option>
            <option value="5">After 5 minutes</option>
            <option value="10">After 10 minutes</option>
          </DrawerSelect>

          {screensaverMin > 0 && setScreensaverSource && (
            <div className="hm-drawer-seg-row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className={`hm-drawer-seg-btn ${screensaverSource === "current" ? "active" : ""}`}
                onClick={() => setScreensaverSource("current")}
                title="Plays images from your current view/folder"
              >
                Current View
              </button>
              <button
                type="button"
                className={`hm-drawer-seg-btn ${screensaverSource === "favorites" ? "active" : ""}`}
                onClick={() => setScreensaverSource("favorites")}
                title="Plays only your Favorited renders (falls back to all if empty)"
              >
                Favorites
              </button>
              <button
                type="button"
                className={`hm-drawer-seg-btn ${screensaverSource === "all" ? "active" : ""}`}
                onClick={() => setScreensaverSource("all")}
                title={`Plays all renders across ${activeRootPath || "the active library"}`}
              >
                All Renders
              </button>
            </div>
          )}
        </div>
      )}
      </DrawerSection>
    )}
    </>
  );
}

export default function CustomizeDrawer({
  isOpen,
  dockSide,
  onSetDockSide,
  folderSidebarMode = "off",
  onSetFolderSidebarMode,
  appMode,
  isDirty,
  onSaveChanges,
  onCancel,

  // Wall tabs & tree state (used when appMode === "wall")
  activeTab,
  onSelectTab,
  blueprintMode,
  onToggleBlueprintMode,
  zones,
  totalZones,
  activeZone,
  activeZoneNumber,
  seamGap,
  onUpdateSeamGap,
  builtinWallPresets,
  userWallPresets,
  activeWallPresetId,
  targetUserWallPreset,
  isWallDirty,
  onApplyWallPreset,
  onUpdateUserWallPreset,
  onSaveNewUserWallPreset,
  onDeleteUserWallPreset,
  onSplitZone,
  onRemoveZone,
  onTriggerSwap,
  swapSourceId,
  soloZoneId,
  onToggleSolo,
  onSetZoneFolder,
  onSetZoneSort,

  // Engine settings (for Single mode OR active Wall Zone tab)
  engineMode,
  onChangeZoneEngineMode,
  conveyorCfg,
  classicCfg,
  slideshowCfg,
  patchConveyor,
  patchClassic,
  patchSlideshow,
  onResetEngineDefaults,

  // Presets (Layer 1)
  allZonePresets,
  userPresets,
  activePresetId,
  targetUserPreset,
  isPresetDirty,
  onApplyPreset,
  onUpdateUserPreset,
  onSaveNewUserPreset,
  onDeleteUserPreset,

  // Source filtering & saved Folder Combos
  folders,
  folderFilter,
  setFolderFilter,
  folderCombos = [],
  onOpenTreeModal,
  sortBy,
  setSortBy,
  onReshuffle,

  // Stage & theme
  stageMode,
  setStageMode,
  accentId,
  setAccentId,
  buttonTheme = "candy",
  setButtonTheme,
  buttonCrispText = false,
  setButtonCrispText,
  screensaverMin,
  setScreensaverMin,
  screensaverSource,
  setScreensaverSource,
  activeRootPath = "",
  roots = [],
  onOpenAddRootModal,
  onRequestRemoveRoot,
  onReorderRoots,
  dropActionMode = "ask",
  setDropActionMode,

  // Exclusive Purgatory tuning
  purgatoryOpen = false,
  purgatoryCfg = { layoutStyle: "masonry", cols: 10 },
  patchPurgatory,
  purgatoryCount = 0,
  onRescueAllPurgatory,
}) {
  const curation = useCuration();
  const [secMap, setSecMap] = useState(loadDrawerSecMap);
  const isWallMode = !purgatoryOpen && appMode === "wall";
  const isWallOverviewTab = isWallMode && activeTab === "wall";

  useEffect(() => {
    if (isOpen) setSecMap(loadDrawerSecMap());
  }, [isOpen]);

  const { flowKey, validSectionIds } = useMemo(() => {
    if (purgatoryOpen) {
      return {
        flowKey: "purgatory",
        validSectionIds: ["purgatory_layout", "stage_theme", "workspace_library"],
      };
    }
    if (isWallOverviewTab) {
      return {
        flowKey: "wall_overview",
        validSectionIds: [
          "wall_blueprint",
          "wall_presets",
          "wall_roster",
          "wall_fallbacks",
          "stage_theme",
          "workspace_library",
        ],
      };
    }
    if (isWallMode) {
      return {
        flowKey: "wall_zone",
        validSectionIds:
          engineMode === "slideshow"
            ? ["zone_identity", "presets", "content", "geometry", "motion"]
            : ["zone_identity", "presets", "content", "geometry", "motion", "polish"],
      };
    }
    const singleFlow = engineMode || appMode || "classic";
    return {
      flowKey: singleFlow,
      validSectionIds:
        engineMode === "slideshow"
          ? ["presets", "content", "geometry", "motion", "stage_theme", "workspace_library"]
          : [
              "presets",
              "content",
              "geometry",
              "motion",
              "polish",
              "stage_theme",
              "workspace_library",
            ],
    };
  }, [purgatoryOpen, isWallOverviewTab, isWallMode, engineMode, appMode]);

  const savedSectionId = secMap[flowKey];
  const activeSectionId = validSectionIds.includes(savedSectionId)
    ? savedSectionId
    : validSectionIds[0];

  const accordionCtx = useMemo(
    () => ({
      activeId: activeSectionId,
      onSelect: (id) => {
        if (!id || id === activeSectionId) return;
        setSecMap((prev) => {
          const next = { ...prev, [flowKey]: id };
          try {
            window.localStorage.setItem(DRAWER_SEC_MAP_KEY, JSON.stringify(next));
          } catch {}
          return next;
        });
      },
    }),
    [activeSectionId, flowKey]
  );

  if (!isOpen) return null;

  const canSplit = totalZones < MAX_ZONES;

  const modeTitle = purgatoryOpen
    ? "Purgatory Mode"
    : appMode === "classic"
    ? "Classic Mode"
    : appMode === "conveyor"
    ? "Conveyor Mode"
    : appMode === "slideshow"
    ? "Slideshow"
    : isWallOverviewTab
    ? "Wall Architect"
    : `Zone ${activeZoneNumber} Tuning`;

  const enginePresets = allZonePresets.filter((p) => p.engineMode === engineMode);
  const activeCfg =
    engineMode === "classic" ? classicCfg : engineMode === "slideshow" ? slideshowCfg : conveyorCfg;
  const patchActiveEngine =
    engineMode === "classic"
      ? patchClassic
      : engineMode === "slideshow"
      ? patchSlideshow
      : patchConveyor;

  return (
    <aside className={`hm-drawer dock-${dockSide}`} aria-label="Gallery Customization Drawer">
      {/* Drawer Header */}
      <div className="hm-drawer-head">
        <div className="hm-drawer-title-group">
          <Sparkles size={14} style={{ color: "var(--hm-accent-bright)" }} />
          <div>
            <div className="hm-drawer-title">{modeTitle}</div>
            <div className="hm-drawer-sub">
              {purgatoryOpen
                ? "Staging Tray Tuning • Lightbox paused"
                : isWallMode
                ? "Live Edit Mode • Click any zone box or drag borders"
                : "Live Scaled Preview • Lightbox paused"}
            </div>
          </div>
        </div>

        <div className="hm-drawer-head-actions">
          <button
            type="button"
            className="hm-icon-btn"
            onClick={onCancel}
            title="Discard changes & close drawer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Multi-Tab Strip (Wall Mode ONLY — single modes stay 1 clean tab!) */}
      {isWallMode && (
        <div className="hm-drawer-tabs">
          <button
            type="button"
            className={`hm-drawer-tab ${activeTab === "wall" ? "active" : ""}`}
            onClick={() => onSelectTab("wall")}
          >
            <Layers size={12} /> Wall
          </button>
          {zones.map((z, idx) => (
            <button
              key={z.id}
              type="button"
              className={`hm-drawer-tab ${activeTab === z.id ? "active" : ""}`}
              onClick={() => onSelectTab(z.id)}
              title={`Zone ${idx + 1} (${z.engineMode})`}
            >
              Z{idx + 1}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable Categorized Body */}
      <DrawerAccordionContext.Provider value={accordionCtx}>
      <div className="hm-drawer-scroll">
        {purgatoryOpen ? (
          <>
            <DrawerSection
              id="purgatory_layout"
              title="Purgatory Staging Layout"
              badge={`${purgatoryCount} Staged`}
            >
              <div className="hm-drawer-row-block">
                <div className="hm-drawer-label-wrap">
                  <span className="hm-drawer-label">Grid Arrangement</span>
                  <span className="hm-drawer-hint">Masonry waterfall or balanced rows</span>
                </div>
                <div className="hm-drawer-seg-row">
                  <button
                    type="button"
                    className={`hm-drawer-seg-btn ${
                      (purgatoryCfg.layoutStyle || "masonry") === "masonry" ? "active" : ""
                    }`}
                    onClick={() => patchPurgatory?.({ layoutStyle: "masonry" })}
                  >
                    <LayoutGrid size={12} /> Masonry
                  </button>
                  <button
                    type="button"
                    className={`hm-drawer-seg-btn ${
                      purgatoryCfg.layoutStyle === "grid" ? "active" : ""
                    }`}
                    onClick={() => patchPurgatory?.({ layoutStyle: "grid" })}
                  >
                    <Rows3 size={12} /> Rows
                  </button>
                </div>
              </div>

              <DrawerSlider
                label="Thumbnail Columns"
                hint="Fewer columns = bigger preview prints"
                value={purgatoryCfg.cols || 10}
                min={2}
                max={14}
                step={1}
                onChange={(v) => patchPurgatory?.({ cols: v })}
              />

              {onRescueAllPurgatory && (
                <button
                  type="button"
                  className="hm-drawer-cta"
                  disabled={purgatoryCount === 0}
                  onClick={onRescueAllPurgatory}
                  style={{ opacity: purgatoryCount === 0 ? 0.45 : 1 }}
                >
                  <RotateCcw size={14} />
                  <div>
                    <div>Rescue All Staged ({purgatoryCount})</div>
                    <span>Restore every print safely back to the gallery</span>
                  </div>
                </button>
              )}
            </DrawerSection>

            <StageThemeSection
              stageMode={stageMode}
              setStageMode={setStageMode}
              accentId={accentId}
              setAccentId={setAccentId}
              buttonTheme={buttonTheme}
              setButtonTheme={setButtonTheme}
              buttonCrispText={buttonCrispText}
              setButtonCrispText={setButtonCrispText}
              screensaverMin={screensaverMin}
              setScreensaverMin={setScreensaverMin}
              screensaverSource={screensaverSource}
              setScreensaverSource={setScreensaverSource}
              dockSide={dockSide}
              onSetDockSide={onSetDockSide}
              folderSidebarMode={folderSidebarMode}
              onSetFolderSidebarMode={onSetFolderSidebarMode}
              activeRootPath={activeRootPath}
              roots={roots}
              onOpenAddRootModal={onOpenAddRootModal}
              onRequestRemoveRoot={onRequestRemoveRoot}
              onReorderRoots={onReorderRoots}
              dropActionMode={dropActionMode}
              setDropActionMode={setDropActionMode}
            />
          </>
        ) : isWallOverviewTab ? (
          <>
            {/* WALL OVERVIEW TAB */}
            <DrawerSection id="wall_blueprint" title="Blueprint & Layout Splits" badge={`${totalZones}/${MAX_ZONES} Zones`}>
              <button
                type="button"
                className={`hm-drawer-cta ${blueprintMode ? "active" : ""}`}
                onClick={() => onToggleBlueprintMode(!blueprintMode)}
              >
                <Scissors size={14} />
                <div>
                  <div>{blueprintMode ? "Blueprint Splits Active" : "Edit Blueprint Splits"}</div>
                  <span>
                    {blueprintMode
                      ? "Hover any Zone edge on the live wall to + Split or remove"
                      : "Activate + Split edge hotspots & delete/swap overlays on live wall"}
                  </span>
                </div>
              </button>

              {canSplit && activeZone && (
                <div className="hm-drawer-seg-row">
                  <button
                    type="button"
                    className="hm-drawer-seg-btn"
                    onClick={() => onSplitZone(activeZone.id, "right")}
                    title="Split selected Zone side-by-side"
                  >
                    + Split Z{activeZoneNumber} Right
                  </button>
                  <button
                    type="button"
                    className="hm-drawer-seg-btn"
                    onClick={() => onSplitZone(activeZone.id, "bottom")}
                    title="Split selected Zone stacked top/bottom"
                  >
                    + Split Z{activeZoneNumber} Bottom
                  </button>
                </div>
              )}

              <DrawerSlider
                label="Seam Gap"
                hint="Space separating adjacent zones (0px = seamless mosaic)"
                value={seamGap}
                min={0}
                max={18}
                step={1}
                unit="px"
                onChange={onUpdateSeamGap}
              />
            </DrawerSection>

            <DrawerSection id="wall_presets" title="Wall Presets" badge="Layouts">
              <div className="hm-drawer-preset-list">
                {[...builtinWallPresets, ...userWallPresets].map((wp) => {
                  const isCustom = userWallPresets.some((u) => u.id === wp.id);
                  const isMatch = activeWallPresetId === wp.id;
                  return (
                    <div
                      key={wp.id}
                      className={`hm-drawer-preset-pill ${isMatch ? "active" : ""}`}
                      onClick={() => onApplyWallPreset(wp)}
                    >
                      <span>{wp.label}</span>
                      {isCustom && (
                        <button
                          type="button"
                          className="hm-preset-del"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteUserWallPreset(wp.id);
                          }}
                          title="Delete saved Wall Preset"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="hm-drawer-morph-wrap">
                <MorphPresetSave
                  targetPreset={targetUserWallPreset}
                  isDirty={isWallDirty}
                  onUpdate={onUpdateUserWallPreset}
                  onSaveNew={onSaveNewUserWallPreset}
                />
              </div>
            </DrawerSection>

            <DrawerSection id="wall_roster" title="Zone Quick Roster" badge={`${zones.length} Active`}>
              <div className="hm-roster-list">
                {zones.map((z, idx) => {
                  const num = idx + 1;
                  const preset = allZonePresets.find((p) => p.id === z.activePresetId);
                  const engineLabel =
                    z.engineMode === "slideshow"
                      ? "Slideshow"
                      : z.engineMode === "classic"
                      ? "Classic"
                      : "Conveyor";
                  const folderLabel = getFolderSpecLabel(z.folderFilter || "ALL", folderCombos, roots);
                  const isSwapSrc = swapSourceId === z.id;
                  return (
                    <div
                      key={z.id}
                      className={`hm-roster-card ${z.id === activeZone?.id ? "active" : ""}`}
                      onClick={() => onSelectTab(z.id)}
                    >
                      <div className="hm-roster-main">
                        <span className="hm-roster-num">Z{num}</span>
                        <div className="hm-roster-info">
                          <strong>{preset ? preset.label : engineLabel}</strong>
                          <span>
                            {engineLabel} • 📁 {folderLabel}
                          </span>
                        </div>
                      </div>
                      <div className="hm-roster-actions" onClick={(e) => e.stopPropagation()}>
                        {totalZones > 1 && (
                          <button
                            type="button"
                            className={`bp-mini-icon ${soloZoneId === z.id ? "active" : ""}`}
                            onClick={() => onToggleSolo(soloZoneId === z.id ? null : z.id)}
                            title="Preview Zone Solo"
                          >
                            <Maximize2 size={11} />
                          </button>
                        )}
                        {totalZones > 1 && (
                          <button
                            type="button"
                            className={`bp-mini-icon ${isSwapSrc ? "active" : ""}`}
                            onClick={() => onTriggerSwap(z.id)}
                            title="Swap contents with another Zone"
                          >
                            <ArrowLeftRight size={11} />
                          </button>
                        )}
                        {totalZones > 1 && (
                          <button
                            type="button"
                            className="bp-mini-icon danger"
                            onClick={() => onRemoveZone(z.id)}
                            title="Remove Zone"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </DrawerSection>

            <DrawerSection id="wall_fallbacks" title="Global Feed Fallbacks" badge="Default">
              <div className="hm-drawer-inline-split">
                <div style={{ flex: 1 }}>
                  <DrawerSelect
                    label="Global Sort"
                    hint="Used by Zones that don't set a custom sort"
                    value={sortBy}
                    onChange={(v) => {
                      setSortBy(v);
                      if (v === "shuffle") onReshuffle();
                    }}
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="size">File Size</option>
                    <option value="aspect">Portrait → Wide</option>
                    <option value="name">Filename A–Z</option>
                    <option value="shuffle">Shuffle</option>
                  </DrawerSelect>
                </div>
                {sortBy === "shuffle" && (
                  <button
                    type="button"
                    className="hm-btn"
                    style={{ alignSelf: "flex-end", marginBottom: 2 }}
                    onClick={onReshuffle}
                    title="Re-roll Shuffle seed"
                  >
                    <Shuffle size={13} />
                  </button>
                )}
              </div>
            </DrawerSection>

            <StageThemeSection
              stageMode={stageMode}
              setStageMode={setStageMode}
              accentId={accentId}
              setAccentId={setAccentId}
              buttonTheme={buttonTheme}
              setButtonTheme={setButtonTheme}
              buttonCrispText={buttonCrispText}
              setButtonCrispText={setButtonCrispText}
              screensaverMin={screensaverMin}
              setScreensaverMin={setScreensaverMin}
              screensaverSource={screensaverSource}
              setScreensaverSource={setScreensaverSource}
              dockSide={dockSide}
              onSetDockSide={onSetDockSide}
              folderSidebarMode={folderSidebarMode}
              onSetFolderSidebarMode={onSetFolderSidebarMode}
              activeRootPath={activeRootPath}
              roots={roots}
              onOpenAddRootModal={onOpenAddRootModal}
              onRequestRemoveRoot={onRequestRemoveRoot}
              onReorderRoots={onReorderRoots}
              dropActionMode={dropActionMode}
              setDropActionMode={setDropActionMode}
            />
          </>
        ) : (
          <>
            {/* SINGLE-MODE OR ZONE TAB ENGINE SETTINGS */}
            {isWallMode && activeZone && (
              <DrawerSection id="zone_identity" title={`Zone ${activeZoneNumber} Identity`} badge="Per-Zone">
                <div className="hm-drawer-seg-row">
                  <button
                    type="button"
                    className={`hm-drawer-seg-btn ${engineMode === "classic" ? "active" : ""}`}
                    onClick={() => onChangeZoneEngineMode("classic")}
                  >
                    Classic
                  </button>
                  <button
                    type="button"
                    className={`hm-drawer-seg-btn ${engineMode === "conveyor" ? "active" : ""}`}
                    onClick={() => onChangeZoneEngineMode("conveyor")}
                  >
                    Conveyor
                  </button>
                  <button
                    type="button"
                    className={`hm-drawer-seg-btn ${engineMode === "slideshow" ? "active" : ""}`}
                    onClick={() => onChangeZoneEngineMode("slideshow")}
                  >
                    Slideshow
                  </button>
                </div>

                <FolderScopeRow
                  label="Zone Folder"
                  hint="Quick folder, Folder Combo, or custom tree"
                  spec={activeZone.folderFilter}
                  folders={folders}
                  folderCombos={folderCombos}
                  onChangeSpec={(next) => onSetZoneFolder(activeZone.id, next)}
                  onOpenTree={onOpenTreeModal ? () => onOpenTreeModal(activeZone.id) : null}
                  treeTitle="Open Master Folder Tree for this Zone"
                />

                <DrawerSelect
                  label="Zone Sort Order"
                  value={activeZone.sortBy ?? "__GLOBAL__"}
                  onChange={(val) =>
                    onSetZoneSort(activeZone.id, val === "__GLOBAL__" ? null : val)
                  }
                >
                  <option value="__GLOBAL__">🌐 Follow Global ({sortBy})</option>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="size">File Size</option>
                  <option value="aspect">Portrait → Wide</option>
                  <option value="name">Filename A–Z</option>
                  <option value="shuffle">Shuffle</option>
                </DrawerSelect>

                {totalZones > 1 && (
                  <div className="hm-drawer-seg-row">
                    <button
                      type="button"
                      className={`hm-drawer-seg-btn ${swapSourceId === activeZone.id ? "active" : ""}`}
                      onClick={() => onTriggerSwap(activeZone.id)}
                    >
                      <ArrowLeftRight size={12} />{" "}
                      {swapSourceId === activeZone.id ? "Click target zone..." : "Swap Place"}
                    </button>
                    <button
                      type="button"
                      className="hm-drawer-seg-btn danger"
                      onClick={() => onRemoveZone(activeZone.id)}
                    >
                      <Trash2 size={12} /> Remove Zone
                    </button>
                  </div>
                )}
              </DrawerSection>
            )}

            {/* 1. PRESETS & SNAPSHOTS */}
            <DrawerSection id="presets" title="1. Presets & Snapshots" badge={engineMode}>
              <div className="hm-drawer-preset-list">
                {enginePresets.map((p) => {
                  const isCustom = userPresets.some((u) => u.id === p.id);
                  const isMatch = activePresetId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`hm-drawer-preset-pill ${isMatch ? "active" : ""}`}
                      onClick={() => onApplyPreset(p)}
                    >
                      <span>{p.label}</span>
                      {isCustom && (
                        <button
                          type="button"
                          className="hm-preset-del"
                          onClick={(e) => onDeleteUserPreset(e, p.id)}
                          title="Delete saved Preset"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="hm-drawer-morph-wrap">
                <MorphPresetSave
                  targetPreset={targetUserPreset}
                  isDirty={isPresetDirty}
                  onUpdate={onUpdateUserPreset}
                  onSaveNew={onSaveNewUserPreset}
                />
                <button
                  type="button"
                  className="hm-btn"
                  onClick={onResetEngineDefaults}
                  title="Reset current mode settings to clean defaults"
                >
                  <RotateCcw size={12} /> Reset
                </button>
              </div>
            </DrawerSection>

            {/* 2. CONTENT & FILTERING */}
            <DrawerSection id="content" title={engineMode === "slideshow" ? "2. Source" : "2. Content & Cards"}>
              {!isWallMode && (
                <>
                  <FolderScopeRow
                    label="Folder Scope"
                    hint="Quick folder, saved Combo, or Master Tree"
                    spec={folderFilter}
                    folders={folders}
                    folderCombos={folderCombos}
                    onChangeSpec={setFolderFilter}
                    onOpenTree={onOpenTreeModal ? () => onOpenTreeModal(null) : null}
                    treeTitle="Open Master Folder Tree"
                  />

                  <div className="hm-drawer-inline-split">
                    <div style={{ flex: 1 }}>
                      <DrawerSelect
                        label="Sort Order"
                        hint={
                          engineMode === "slideshow" && slideshowCfg?.shuffle !== false
                            ? "Active when Shuffle Order is turned off"
                            : undefined
                        }
                        value={sortBy}
                        onChange={(v) => {
                          setSortBy(v);
                          if (v === "shuffle") onReshuffle();
                        }}
                      >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="size">File Size</option>
                        <option value="aspect">Portrait → Wide</option>
                        <option value="name">Filename A–Z</option>
                        <option value="shuffle">Shuffle</option>
                      </DrawerSelect>
                    </div>
                    {sortBy === "shuffle" && (
                      <button
                        type="button"
                        className="hm-btn"
                        style={{ alignSelf: "flex-end", marginBottom: 2 }}
                        onClick={onReshuffle}
                        title="Re-roll Shuffle seed"
                      >
                        <Shuffle size={13} />
                      </button>
                    )}
                  </div>
                </>
              )}

              {engineMode !== "slideshow" && (
                <DrawerToggle
                  label="Card Labels"
                  hint="Master switch for card badges & hover details"
                  checked={activeCfg.showMetadata ?? true}
                  onChange={(v) => patchActiveEngine({ showMetadata: v })}
                />
              )}

              {engineMode !== "slideshow" &&
                (activeCfg.showMetadata ?? true) &&
                (() => {
                  const cl = curation?.cardLabels || DEFAULT_CARD_LABELS;
                  const toggleLbl = curation?.toggleCardLabel;
                  const alwaysOpts = [
                    { k: "folder", label: "Folder" },
                    { k: "wf", label: "WF ✓/✕" },
                    { k: "resolution", label: "Resolution" },
                    { k: "filename", label: "Filename" },
                  ];
                  const hoverTopOpts = [
                    { k: "folder", label: "Folder" },
                    { k: "wf", label: "WF ✓/✕" },
                  ];
                  const hoverBotOpts = [
                    { k: "filename", label: "Filename" },
                    { k: "resolution", label: "Resolution" },
                    { k: "note", label: "Note Peek" },
                    { k: "model", label: "Model" },
                    { k: "prompt", label: "Prompt" },
                    { k: "size", label: "Size / Len" },
                  ];
                  return (
                    <div className="hm-label-cfg-card">
                      <div className="hm-label-cfg-head">
                        <span>Always Visible</span>
                        <span className="hm-label-cap-pill">{cl.always.length} / 2</span>
                      </div>
                      <div className="hm-label-chip-grid">
                        {alwaysOpts.map((o) => (
                          <button
                            key={o.k}
                            type="button"
                            className={`hm-label-chip ${cl.always.includes(o.k) ? "active" : ""}`}
                            onClick={() => toggleLbl?.("always", o.k)}
                            title="Up to 2 resting badges"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>

                      <div className="hm-label-cfg-head" style={{ marginTop: 6 }}>
                        <span>On Hover • Top Left</span>
                        <span className="hm-label-cap-pill">Global</span>
                      </div>
                      <div className="hm-label-chip-grid">
                        {hoverTopOpts.map((o) => (
                          <button
                            key={o.k}
                            type="button"
                            className={`hm-label-chip ${cl.hoverTop.includes(o.k) ? "active" : ""}`}
                            onClick={() => toggleLbl?.("hoverTop", o.k)}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>

                      <div className="hm-label-cfg-head" style={{ marginTop: 6 }}>
                        <span>On Hover • Footer</span>
                        <span className="hm-label-cap-pill">{cl.hoverBottom.length} / 3</span>
                      </div>
                      <div className="hm-label-chip-grid">
                        {hoverBotOpts.map((o) => (
                          <button
                            key={o.k}
                            type="button"
                            className={`hm-label-chip ${cl.hoverBottom.includes(o.k) ? "active" : ""}`}
                            onClick={() => toggleLbl?.("hoverBottom", o.k)}
                            title="Up to 3 footer lines (clicking a 4th swaps oldest)"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>

                      <div className="hm-label-cfg-head" style={{ marginTop: 8 }}>
                        <span>Video Play Indicator</span>
                        <span className="hm-label-cap-pill">Bottom-Right</span>
                      </div>
                      <div className="hm-label-chip-grid">
                        {[
                          { k: "always", label: "Always" },
                          { k: "hover", label: "On Hover" },
                          { k: "off", label: "Off" },
                        ].map((opt) => (
                          <button
                            key={opt.k}
                            type="button"
                            className={`hm-label-chip ${
                              (curation?.videoBadgeMode || "always") === opt.k ? "active" : ""
                            }`}
                            onClick={() => curation?.setVideoBadgeMode?.(opt.k)}
                            title="Subtle theme-colored play icon on video cards"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
            </DrawerSection>

            {/* 3. GEOMETRY */}
            {engineMode === "classic" && (
              <DrawerSection id="geometry" title="3. Layout & Card Geometry">
                <div className="hm-drawer-seg-row">
                  <button
                    type="button"
                    className={`hm-drawer-seg-btn ${
                      classicCfg.layoutStyle === "grid" && classicCfg.tileShape !== "cube"
                        ? "active"
                        : ""
                    }`}
                    onClick={() => patchClassic({ layoutStyle: "grid", tileShape: "natural" })}
                    title="Strict horizontal rows (height averaged per row)"
                  >
                    Explorer Rows
                  </button>
                  <button
                    type="button"
                    className={`hm-drawer-seg-btn ${
                      classicCfg.tileShape === "cube" ? "active" : ""
                    }`}
                    onClick={() => patchClassic({ layoutStyle: "grid", tileShape: "cube" })}
                    title="Uniform 1:1 square cards"
                  >
                    1:1 Grid
                  </button>
                  <button
                    type="button"
                    className={`hm-drawer-seg-btn ${
                      classicCfg.layoutStyle === "masonry" && classicCfg.tileShape !== "cube"
                        ? "active"
                        : ""
                    }`}
                    onClick={() => patchClassic({ layoutStyle: "masonry", tileShape: "natural" })}
                    title="Uncropped staggered Pinterest waterfall"
                  >
                    Masonry
                  </button>
                </div>

                {classicCfg.layoutStyle === "masonry" && classicCfg.tileShape !== "cube" && (
                  <>
                    <DrawerSlider
                      label="Ratio Tame"
                      hint="0% = pure natural aspect • pulls tall/wide balance toward square"
                      value={classicCfg.ratioTame ?? 0}
                      min={0}
                      max={100}
                      step={5}
                      unit="%"
                      onChange={(v) => patchClassic({ ratioTame: v })}
                    />
                    <DrawerToggle
                      label="Wide 2-Col Span (Test)"
                      hint="Widescreen shots span 2 columns for hero area balance"
                      checked={classicCfg.wideSpan ?? false}
                      onChange={(v) => patchClassic({ wideSpan: v })}
                    />
                  </>
                )}

                <DrawerSlider
                  label="Columns"
                  hint="Cards across the grid width"
                  value={classicCfg.cols}
                  min={1}
                  max={14}
                  onChange={(v) => patchClassic({ cols: v })}
                />
                <DrawerSlider
                  label="Canvas Width"
                  hint="Centered gallery width inside the stage"
                  value={classicCfg.sizeFill}
                  min={25}
                  max={100}
                  step={5}
                  unit="%"
                  onChange={(v) => patchClassic({ sizeFill: v })}
                />
                <DrawerSlider
                  label="Card Gap"
                  hint="Spacing between tiles"
                  value={classicCfg.gap}
                  min={0}
                  max={36}
                  unit="px"
                  onChange={(v) => patchClassic({ gap: v })}
                />
                <DrawerSlider
                  label="Corner Radius"
                  hint="Sharp crisp corners → soft rounded cards"
                  value={classicCfg.cornerRadius ?? 12}
                  min={0}
                  max={28}
                  unit="px"
                  onChange={(v) => patchClassic({ cornerRadius: v })}
                />
              </DrawerSection>
            )}

            {engineMode === "conveyor" && (
              <DrawerSection id="geometry" title="3. Stream & Lane Geometry">
                <div className="hm-drawer-row-block">
                  <div className="hm-drawer-label-wrap">
                    <span className="hm-drawer-label">Flow Pattern</span>
                    <span className="hm-drawer-hint">Continuous S-curve vs. synchronized streams</span>
                  </div>
                  <div className="hm-drawer-seg-row">
                    <button
                      type="button"
                      className={`hm-drawer-seg-btn ${conveyorCfg.flowMode === "snake" ? "active" : ""}`}
                      onClick={() => patchConveyor({ flowMode: "snake" })}
                    >
                      Snake S-Curve
                    </button>
                    <button
                      type="button"
                      className={`hm-drawer-seg-btn ${conveyorCfg.flowMode === "parallel" ? "active" : ""}`}
                      onClick={() => patchConveyor({ flowMode: "parallel" })}
                    >
                      Parallel Streams
                    </button>
                  </div>
                </div>

                <div className="hm-drawer-row-block">
                  <div className="hm-drawer-label-wrap">
                    <span className="hm-drawer-label">Track Direction</span>
                    <span className="hm-drawer-hint">Horizontal rows vs. vertical columns</span>
                  </div>
                  <div className="hm-drawer-seg-row">
                    <button
                      type="button"
                      className={`hm-drawer-seg-btn ${conveyorCfg.axis === "horizontal" ? "active" : ""}`}
                      onClick={() => patchConveyor({ axis: "horizontal" })}
                    >
                      Horizontal Lanes
                    </button>
                    <button
                      type="button"
                      className={`hm-drawer-seg-btn ${conveyorCfg.axis === "vertical" ? "active" : ""}`}
                      onClick={() => patchConveyor({ axis: "vertical" })}
                    >
                      Vertical Columns
                    </button>
                  </div>
                </div>

                <DrawerSlider
                  label="Lanes"
                  hint="Number of flowing conveyor tracks"
                  value={conveyorCfg.lanes}
                  min={1}
                  max={14}
                  onChange={(v) => patchConveyor({ lanes: v })}
                />
                <DrawerSlider
                  label="Lane Size Fill"
                  hint="Shrink for single-row filmstrips"
                  value={conveyorCfg.laneFill}
                  min={20}
                  max={100}
                  step={2}
                  unit="%"
                  onChange={(v) => patchConveyor({ laneFill: v })}
                />

                <div className="hm-drawer-row-block">
                  <div className="hm-drawer-label-wrap">
                    <span className="hm-drawer-label">Card Framing</span>
                  </div>
                  <div className="hm-drawer-seg-row">
                    <button
                      type="button"
                      className={`hm-drawer-seg-btn ${conveyorCfg.tileShape === "natural" ? "active" : ""}`}
                      onClick={() => patchConveyor({ tileShape: "natural" })}
                    >
                      Natural Ratio
                    </button>
                    <button
                      type="button"
                      className={`hm-drawer-seg-btn ${conveyorCfg.tileShape === "cube" ? "active" : ""}`}
                      onClick={() => patchConveyor({ tileShape: "cube" })}
                    >
                      Uniform 1:1 Cube
                    </button>
                  </div>
                </div>

                <DrawerSlider
                  label="Card Gap"
                  hint="Spacing between conveyor bricks"
                  value={conveyorCfg.gap}
                  min={0}
                  max={36}
                  unit="px"
                  onChange={(v) => patchConveyor({ gap: v })}
                />
                <DrawerSlider
                  label="Corner Radius"
                  value={conveyorCfg.cornerRadius ?? 12}
                  min={0}
                  max={28}
                  unit="px"
                  onChange={(v) => patchConveyor({ cornerRadius: v })}
                />
                <DrawerSlider
                  label="Circular Bend"
                  hint={
                    conveyorCfg.axis === "vertical"
                      ? "Disabled in Vertical Columns"
                      : "Curve tracks into bowls or rings"
                  }
                  value={conveyorCfg.axis === "vertical" ? 0 : conveyorCfg.bend}
                  min={-8}
                  max={8}
                  step={0.5}
                  disabled={conveyorCfg.axis === "vertical"}
                  onChange={(v) => patchConveyor({ bend: v })}
                />
              </DrawerSection>
            )}

            {engineMode === "slideshow" &&
              (() => {
                const activeStyle = getSlideshowStyle(slideshowCfg?.styleId);
                const curStyleParams = getSlideshowStyleParams(slideshowCfg, activeStyle.id);
                const patchStyleParam = (key, val) => {
                  const prevAll = slideshowCfg?.styleParams || {};
                  patchSlideshow({
                    styleParams: {
                      ...prevAll,
                      [activeStyle.id]: {
                        ...curStyleParams,
                        [key]: val,
                      },
                    },
                  });
                };
                const resetThisStyle = () => {
                  const prevAll = slideshowCfg?.styleParams || {};
                  patchSlideshow({
                    styleParams: {
                      ...prevAll,
                      [activeStyle.id]: { ...activeStyle.defaultParams },
                    },
                  });
                };
                return (
                  <>
                    <DrawerSection id="geometry" title="3. Slideshow Style & FX" badge={activeStyle.badge}>
                      <div className="hm-slide-style-list">
                        {SLIDESHOW_STYLES.map((st) => {
                          const selected = st.id === activeStyle.id;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              className={`hm-slide-style-card ${selected ? "active" : ""}`}
                              onClick={() => patchSlideshow({ styleId: st.id })}
                            >
                              <div className="hm-slide-style-top">
                                <span className="hm-slide-style-name">{st.label}</span>
                                <span className={`hm-slide-style-badge ${st.badge !== "2D" ? "is-3d" : ""}`}>
                                  {st.badge}
                                </span>
                              </div>
                              <div className="hm-slide-style-tag">{st.tagline}</div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="hm-slide-fx-box">
                        <div className="hm-slide-fx-head">
                          <span>{activeStyle.label} Settings</span>
                          <button
                            type="button"
                            className="hm-slide-fx-reset"
                            onClick={resetThisStyle}
                            title="Reset only this style's parameters"
                          >
                            <RotateCcw size={11} /> Reset FX
                          </button>
                        </div>

                        {activeStyle.controls.map((ctrl) => {
                          if (ctrl.visibleWhen && !ctrl.visibleWhen(curStyleParams)) return null;
                          const val = curStyleParams[ctrl.key];
                          if (ctrl.type === "slider") {
                            return (
                              <DrawerSlider
                                key={ctrl.key}
                                label={ctrl.label}
                                hint={ctrl.hint}
                                value={val}
                                min={ctrl.min}
                                max={ctrl.max}
                                step={ctrl.step ?? 1}
                                unit={ctrl.unit || ""}
                                onChange={(v) => patchStyleParam(ctrl.key, v)}
                              />
                            );
                          }
                          if (ctrl.type === "segmented") {
                            return (
                              <div key={ctrl.key} className="hm-drawer-row-block">
                                <div className="hm-drawer-row-top">
                                  <div className="hm-drawer-label-wrap">
                                    <span className="hm-drawer-label">{ctrl.label}</span>
                                    {ctrl.hint && <span className="hm-drawer-hint">{ctrl.hint}</span>}
                                  </div>
                                </div>
                                <div className="hm-drawer-seg-row">
                                  {ctrl.options.map((opt) => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      className={`hm-drawer-seg-btn ${val === opt.value ? "active" : ""}`}
                                      onClick={() => patchStyleParam(ctrl.key, opt.value)}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          }
                          if (ctrl.type === "toggle") {
                            return (
                              <DrawerToggle
                                key={ctrl.key}
                                label={ctrl.label}
                                hint={ctrl.hint}
                                checked={Boolean(val)}
                                onChange={(v) => patchStyleParam(ctrl.key, v)}
                              />
                            );
                          }
                          return null;
                        })}
                      </div>
                    </DrawerSection>

                    <DrawerSection id="motion" title="4. Playback & Framing">
                      <DrawerSlider
                        label="Slide Hold"
                        hint="Seconds before advancing to next print"
                        value={slideshowCfg?.holdSec ?? 6}
                        min={2}
                        max={30}
                        step={0.5}
                        unit="s"
                        onChange={(v) => patchSlideshow({ holdSec: v, paused: false })}
                        prefixAction={
                          <button
                            type="button"
                            className="hm-mini-play"
                            onClick={() => patchSlideshow({ paused: !slideshowCfg?.paused })}
                            title={slideshowCfg?.paused ? "Resume slideshow" : "Pause slideshow"}
                          >
                            {slideshowCfg?.paused ? <Play size={11} /> : <Pause size={11} />}
                          </button>
                        }
                      />

                      <DrawerToggle
                        label="Shuffle Order"
                        hint="Curates a fresh shuffled sequence for viewing"
                        checked={slideshowCfg?.shuffle !== false}
                        onChange={(v) => patchSlideshow({ shuffle: v })}
                      />

                      <DrawerToggle
                        label="Ambient Color Halo"
                        hint="Softly radiates each artwork's palette into the stage margins"
                        checked={slideshowCfg?.ambientHalo !== false}
                        onChange={(v) => patchSlideshow({ ambientHalo: v })}
                      />

                      {slideshowCfg?.ambientHalo !== false && (
                        <DrawerSlider
                          label="Halo Glow"
                          value={slideshowCfg?.haloStrength ?? 55}
                          min={15}
                          max={100}
                          step={5}
                          unit="%"
                          onChange={(v) => patchSlideshow({ haloStrength: v })}
                        />
                      )}

                      <DrawerToggle
                        label="Hover Controls"
                        hint="Show ghost Prev/Play/Fullscreen pill on hover (off keeps Wall zones calm)"
                        checked={slideshowCfg?.hoverControls !== false}
                        onChange={(v) => patchSlideshow({ hoverControls: v })}
                      />

                      <DrawerToggle
                        label="Timer Bar"
                        hint="Subtle bottom progress line (off by default, always hidden in Fullscreen)"
                        checked={Boolean(slideshowCfg?.showTimerBar)}
                        onChange={(v) => patchSlideshow({ showTimerBar: v })}
                      />

                      <DrawerSlider
                        label="Corner Radius"
                        value={slideshowCfg?.cornerRadius ?? 12}
                        min={0}
                        max={28}
                        unit="px"
                        onChange={(v) => patchSlideshow({ cornerRadius: v })}
                      />
                    </DrawerSection>
                  </>
                );
              })()}

            {/* 4. MOTION & CRUISE (Classic & Conveyor) */}
            {engineMode !== "slideshow" && (
              <DrawerSection id="motion" title="4. Motion & Cruise">
                <DrawerSlider
                  label="Auto-Scroll Speed"
                  hint={
                    engineMode === "classic"
                      ? "0 = still Explorer; >0 = hands-free drift"
                      : "Negative reverses direction"
                  }
                  value={activeCfg.paused ? 0 : activeCfg.autoSpeed}
                  min={engineMode === "conveyor" ? -220 : -180}
                  max={engineMode === "conveyor" ? 220 : 180}
                  step={4}
                  onChange={(v) => patchActiveEngine({ autoSpeed: v, paused: false })}
                  prefixAction={
                    <button
                      type="button"
                      className="hm-mini-play"
                      onClick={() => patchActiveEngine({ paused: !activeCfg.paused })}
                      title={activeCfg.paused ? "Resume auto-motion" : "Pause auto-motion"}
                    >
                      {activeCfg.paused || activeCfg.autoSpeed === 0 ? (
                        <Play size={11} />
                      ) : (
                        <Pause size={11} />
                      )}
                    </button>
                  }
                />

                <DrawerToggle
                  label="Cursor Edge Steer"
                  hint="Move cursor near edges to steer scroll speed"
                  checked={activeCfg.cursorSteer}
                  onChange={(v) => patchActiveEngine({ cursorSteer: v })}
                />
                <DrawerToggle
                  label="Hover Brake"
                  hint="Automatically pauses drift while hovering a card"
                  checked={activeCfg.hoverBrake}
                  onChange={(v) => patchActiveEngine({ hoverBrake: v })}
                />
                {engineMode !== "conveyor" && (
                  <DrawerToggle
                    label="Infinite Loop Wrap"
                    hint="Seamlessly loops back around at the end"
                    checked={activeCfg.loopWrap}
                    onChange={(v) => patchActiveEngine({ loopWrap: v })}
                  />
                )}
              </DrawerSection>
            )}

            {/* 5. TRANSITIONS & VISUAL POLISH (Classic & Conveyor) */}
            {engineMode !== "slideshow" && (
              <DrawerSection id="polish" title="5. Polish & Hover Candy">
                {engineMode === "classic" && (
                  <DrawerSelect
                    label="Border Enter / Exit FX"
                    hint="How top & bottom rows animate crossing the edge"
                    value={classicCfg.edgeFX}
                    onChange={(v) => patchClassic({ edgeFX: v })}
                  >
                    <option value="fade">Soft Fade</option>
                    <option value="tilt">3D Horizon Fold</option>
                    <option value="pop">Scale Pop-In</option>
                    <option value="curtain">Curtain Wipe</option>
                  </DrawerSelect>
                )}

                {engineMode === "conveyor" && (
                  <>
                    <DrawerSelect
                      label="Edge Transition Style"
                      hint="How cards behave crossing turnarounds & seams"
                      value={conveyorCfg.turnStyle === "arc" ? "split" : conveyorCfg.turnStyle}
                      onChange={(v) => patchConveyor({ turnStyle: v })}
                    >
                      <option value="split">Seam Split (100%)</option>
                      <option value="flip3d">3D Flip-Book</option>
                      <option value="accordion">Elastic Squeeze</option>
                      <option value="shutter">Laser Shutter</option>
                    </DrawerSelect>

                    {conveyorCfg.flowMode === "snake" && (
                      <DrawerToggle
                        label="Snake Guide Wire"
                        hint="Show glowing dashed path between Snake lanes"
                        checked={conveyorCfg.showGuideWire}
                        onChange={(v) => patchConveyor({ showGuideWire: v })}
                      />
                    )}
                  </>
                )}

                <DrawerToggle
                  label="Soft Edge Fade"
                  hint="Subtle gradient vignette at scrolling edges"
                  checked={activeCfg.edgeFade}
                  onChange={(v) => patchActiveEngine({ edgeFade: v })}
                />

                <DrawerSelect
                  label="Hover FX"
                  hint="Micro-animation on mouse hover"
                  value={activeCfg.hoverFX}
                  onChange={(v) => patchActiveEngine({ hoverFX: v })}
                >
                  <option value="glow">Glow Only</option>
                  <option value="pop">Lift Pop</option>
                  <option value="tilt">3D Tilt</option>
                  <option value="pop_tilt">Pop + 3D Tilt</option>
                  <option value="bounce">Spring Bounce</option>
                </DrawerSelect>

                <DrawerToggle
                  label="Unfold Cropped on Hover"
                  hint="Cropped cards expand to full uncropped ratio on hover (hitbox stays locked)"
                  checked={activeCfg.uncropHover ?? false}
                  onChange={(v) => patchActiveEngine({ uncropHover: v })}
                />
              </DrawerSection>
            )}

            {!isWallMode && (
              <StageThemeSection
                stageMode={stageMode}
                setStageMode={setStageMode}
                accentId={accentId}
                setAccentId={setAccentId}
                buttonTheme={buttonTheme}
                setButtonTheme={setButtonTheme}
                buttonCrispText={buttonCrispText}
                setButtonCrispText={setButtonCrispText}
                screensaverMin={screensaverMin}
                setScreensaverMin={setScreensaverMin}
                screensaverSource={screensaverSource}
                setScreensaverSource={setScreensaverSource}
                dockSide={dockSide}
                onSetDockSide={onSetDockSide}
                folderSidebarMode={folderSidebarMode}
                onSetFolderSidebarMode={onSetFolderSidebarMode}
                activeRootPath={activeRootPath}
                roots={roots}
                onOpenAddRootModal={onOpenAddRootModal}
                onRequestRemoveRoot={onRequestRemoveRoot}
                onReorderRoots={onReorderRoots}
                dropActionMode={dropActionMode}
                setDropActionMode={setDropActionMode}
              />
            )}
          </>
        )}
      </div>
      </DrawerAccordionContext.Provider>

      {/* Sticky Drawer Footer: Cancel / Save Changes */}
      <div className="hm-drawer-foot">
        <span className="hm-drawer-dirty">
          {isDirty ? "Unsaved live tweaks" : "Live preview synced"}
        </span>
        <div className="hm-drawer-foot-btns">
          <button type="button" className="hm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`hm-btn hm-save-cta ${isDirty ? "is-dirty" : ""}`}
            onClick={onSaveChanges}
          >
            <Check size={13} /> Save Changes
          </button>
        </div>
      </div>
    </aside>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  LayoutGrid,
  GitCommitHorizontal,
  Presentation,
  Layers,
  SlidersHorizontal,
  Globe,
  Eye,
  Flame,
  Trash2,
  RotateCcw,
  Folder,
  AlertTriangle,
  Check,
  HelpCircle,
  Upload,
} from "lucide-react";
import { HAMMELART_CREST_PATH, ACCENT_SLOTS, applyThemeToDOM } from "./theme";
import { FavMark, useCuration } from "./utils/curation";
import { getThumbnailUrl, itemKey } from "./utils/lightboxFlight";
import { captureTileFxTarget } from "./utils/deletionFx";
import {
  buildStageRadialItems,
  buildTileRadialItems,
  checkComfyStatus,
  recycleItemRequest,
  batchDeleteItemsRequest,
  moveBatchItemsRequest,
  copyBatchItemsRequest,
  createFolderRequest,
  renameFolderRequest,
  deleteFolderRequest,
  openFolderExplorerRequest,
} from "./utils/radialBuilders";
import ConveyorBrick from "./components/ConveyorBrick";
import ClassicGridEngine from "./components/ClassicGridEngine";
import SlideshowEngine from "./components/SlideshowEngine";
import ZoneWallRenderer from "./components/ZoneWallRenderer";
import PurgatoryView, { DEFAULT_PURGATORY_CFG } from "./components/PurgatoryView";
import DeletionFxOverlay from "./components/DeletionFxOverlay";
import FolderSidebar from "./components/FolderSidebar";
import CustomizeDrawer from "./components/CustomizeDrawer";
import FolderSourceBar from "./components/FolderSourceBar";
import FolderTreeModal from "./components/FolderTreeModal";
import InspectModal from "./components/InspectModal";
import RadialMenu from "./components/RadialMenu";
import NotePopover from "./components/NotePopover";
import WelcomeModal from "./components/WelcomeModal";
import FilterOverlayModal from "./components/FilterOverlayModal";
import SpotlightTour from "./components/SpotlightTour";
import {
  AddRootModal,
  RemoveRootConfirmModal,
  DropActionPopover,
  ScanProgressOverlay,
} from "./components/RootManagerModals";
import {
  DEFAULT_CONVEYOR,
  DEFAULT_CLASSIC,
  DEFAULT_SLIDESHOW,
  BUILTIN_PRESETS,
  filterAndSortItems,
  isPresetMatched,
  normalizeSlideshowCfg,
} from "./utils/presets";
import {
  DEFAULT_ADVANCED_FILTER,
  countActiveAdvancedFilters,
} from "./utils/advancedFilter";
import {
  applyRootRemovalToState,
  flattenQuickFolderEntries,
  getFolderSpecLabel,
  isFolderSpecUnmountedRoot,
  matchesFolderSpec,
  normalizeSubfolder,
  parseScopedFolderPath,
  remapFolderSpecForTreeOp,
  remapSubfolderPrefix,
} from "./utils/folderTree";
import {
  applyPresetObjectToZone,
  areTreesEquivalent,
  buildBuiltinWallPresets,
  cloneTreeWithFreshIds,
  countZones,
  createZone,
  findZone,
  listZones,
  migrateZoneNode,
  removeZone,
  splitZone,
  swapZones,
  updateSplitRatio,
  updateZone,
} from "./utils/zoneTree";

function loadSaved(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function loadInitialWallTree() {
  try {
    const rawTree = localStorage.getItem("argon_cb_wall_tree_v3");
    if (rawTree) {
      const parsed = JSON.parse(rawTree);
      if (parsed && (parsed.type === "zone" || parsed.type === "split")) {
        return migrateZoneNode(parsed);
      }
    }
  } catch {}

  const rawMigratedMode = localStorage.getItem("argon_cb_mode_v2");
  if (rawMigratedMode) {
    const migratedMode = rawMigratedMode === "horizon" ? "slideshow" : rawMigratedMode;
    return createZone({
      id: "z_main",
      engineMode: migratedMode,
      conveyorCfg: loadSaved("argon_cb_conveyor_v2", DEFAULT_CONVEYOR),
      classicCfg: loadSaved("argon_cb_classic_v2", DEFAULT_CLASSIC),
      slideshowCfg: normalizeSlideshowCfg(),
      activePresetId:
        migratedMode === "conveyor"
          ? "snake_studio"
          : migratedMode === "slideshow"
          ? "slideshow_pile"
          : null,
    });
  }

  return {
    type: "split",
    id: "s_main",
    dir: "row",
    ratio: 0.62,
    a: createZone({
      id: "z_main",
      engineMode: "classic",
      classicCfg: { ...DEFAULT_CLASSIC, cols: 5 },
      activePresetId: null,
    }),
    b: createZone({
      id: "z_zone2",
      engineMode: "classic",
      folderFilter: "__EMPTY_ZONE__",
      classicCfg: { ...DEFAULT_CLASSIC, cols: 4 },
      activePresetId: null,
    }),
  };
}

function loadInitialSingleCfgs() {
  const defaults = {
    classic: { ...DEFAULT_CLASSIC },
    conveyor: { ...DEFAULT_CONVEYOR },
    slideshow: normalizeSlideshowCfg(),
    presetIds: {
      classic: "classic_explorer",
      conveyor: "snake_studio",
      slideshow: "slideshow_pile",
    },
    lastUserPresetIds: {
      classic: null,
      conveyor: null,
      slideshow: null,
    },
  };
  try {
    const raw = localStorage.getItem("argon_cb_single_v4");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        classic: { ...DEFAULT_CLASSIC, ...parsed.classic },
        conveyor: { ...DEFAULT_CONVEYOR, ...parsed.conveyor },
        slideshow: normalizeSlideshowCfg(parsed.slideshow),
        presetIds: { ...defaults.presetIds, ...parsed.presetIds },
        lastUserPresetIds: { ...defaults.lastUserPresetIds, ...parsed.lastUserPresetIds },
      };
    }
    return {
      ...defaults,
      classic: loadSaved("argon_cb_classic_v2", DEFAULT_CLASSIC),
      conveyor: loadSaved("argon_cb_conveyor_v2", DEFAULT_CONVEYOR),
    };
  } catch {
    return defaults;
  }
}

function formatAspectTag(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return "16:9";
  if (Math.abs(aspect - 32 / 9) < 0.25) return "32:9";
  if (Math.abs(aspect - 21 / 9) < 0.28) return "21:9";
  if (Math.abs(aspect - 16 / 9) < 0.14) return "16:9";
  if (Math.abs(aspect - 16 / 10) < 0.1) return "16:10";
  return `${aspect.toFixed(2)}:1`;
}

export default function App() {
  const [rawItems, setRawItems] = useState([]);
  const [stageMode, setStageMode] = useState(() => {
    try {
      const m = localStorage.getItem("argon_cb_stage_mode_v1");
      return m === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [accentId, setAccentId] = useState(() => {
    try {
      return localStorage.getItem("argon_cb_accent_id_v1") || "cyber_violet";
    } catch {
      return "cyber_violet";
    }
  });
  const [inspectPayload, setInspectPayload] = useState(null);

  // Step 4 Top-Level App Mode: "classic" | "conveyor" | "slideshow" | "wall"
  const [appMode, setAppMode] = useState(() => {
    try {
      const saved = localStorage.getItem("argon_cb_app_mode_v4");
      if (saved === "horizon") return "slideshow";
      if (saved === "classic" || saved === "conveyor" || saved === "slideshow" || saved === "wall") {
        return saved;
      }
      if (localStorage.getItem("argon_cb_wall_tree_v3")) {
        const tree = loadInitialWallTree();
        if (countZones(tree) > 1) return "wall";
      }
      const v2 = localStorage.getItem("argon_cb_mode_v2") || "classic";
      return v2 === "horizon" ? "slideshow" : v2;
    } catch {
      return "classic";
    }
  });

  // Independent Single-Mode Configs (Classic / Conveyor / Slideshow)
  const [singleCfgs, setSingleCfgs] = useState(loadInitialSingleCfgs);

  // Global Filter & Sort state
  const curation = useCuration();
  const favSet = curation?.favSet;
  const pinSet = curation?.pinSet;
  const purgatorySet = curation?.purgatorySet;
  const notesMap = curation?.notesMap;
  const favIcon = curation?.favIcon || "star";
  const deleteFx = curation?.deleteFx || "ember";

  const [purgatoryOpen, setPurgatoryOpen] = useState(false);
  const [purgatoryCfg, setPurgatoryCfg] = useState(() =>
    loadSaved("argon_cb_purgatory_cfg_v1", DEFAULT_PURGATORY_CFG)
  );
  const patchPurgatory = (patch) =>
    setPurgatoryCfg((prev) => ({ ...DEFAULT_PURGATORY_CFG, ...prev, ...patch }));
  const [purgatoryPulsing, setPurgatoryPulsing] = useState(false);
  const [purgatoryBusy, setPurgatoryBusy] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [vanishingKeys, setVanishingKeys] = useState(() => new Set());
  const [dockBurnArmed, setDockBurnArmed] = useState(false);
  const lastSelectedKeyRef = useRef("");
  const fxOverlayRef = useRef(null);

  const [search, setSearch] = useState("");
  const [searchFavOnly, setSearchFavOnly] = useState(false);
  const [searchAllFolders, setSearchAllFolders] = useState(false);
  const [advancedFilter, setAdvancedFilter] = useState(DEFAULT_ADVANCED_FILTER);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const activeAdvCount = useMemo(
    () => countActiveAdvancedFilters(advancedFilter),
    [advancedFilter]
  );
  const hasAnyTempFilter = Boolean(
    search.trim() || searchFavOnly || searchAllFolders || activeAdvCount > 0
  );
  const clearAllTempFilters = () => {
    setSearch("");
    setSearchFavOnly(false);
    setSearchAllFolders(false);
    setAdvancedFilter(DEFAULT_ADVANCED_FILTER);
  };
  const [folderFilter, setFolderFilter] = useState(() => {
    try {
      const raw = localStorage.getItem("argon_cb_folder_filter_v4");
      if (!raw) return "ALL";
      if (raw.startsWith("{") || raw.startsWith('"')) {
        const parsed = JSON.parse(raw);
        return parsed || "ALL";
      }
      return raw;
    } catch {
      return "ALL";
    }
  });
  const [sortBy, setSortBy] = useState(() => {
    try {
      return localStorage.getItem("argon_cb_sort_by_v4") || "newest";
    } catch {
      return "newest";
    }
  });
  const [shuffleSeed, setShuffleSeed] = useState(0);

  // Wall Mode Multi-Zone BSP Tree
  const [wallTree, setWallTree] = useState(loadInitialWallTree);
  const [activeZoneId, setActiveZoneId] = useState(() => {
    const list = listZones(loadInitialWallTree());
    return list[0]?.id || "z_main";
  });
  const [seamGap, setSeamGap] = useState(() => {
    try {
      const raw = localStorage.getItem("argon_cb_wall_gap_v3");
      if (raw === null) return 8;
      const g = Number(raw);
      return Number.isFinite(g) ? Math.max(0, Math.min(18, g)) : 8;
    } catch {
      return 8;
    }
  });
  const [soloZoneId, setSoloZoneId] = useState(null);
  const [swapSourceId, setSwapSourceId] = useState(null);
  const [pulseZoneId, setPulseZoneId] = useState(null);
  const zonePulseTimerRef = useRef(null);
  const triggerZonePulse = useCallback((zoneId) => {
    if (!zoneId) return;
    if (zonePulseTimerRef.current) clearTimeout(zonePulseTimerRef.current);
    setPulseZoneId(zoneId);
    zonePulseTimerRef.current = setTimeout(() => {
      zonePulseTimerRef.current = null;
      setPulseZoneId(null);
    }, 950);
  }, []);
  useEffect(() => {
    return () => {
      if (zonePulseTimerRef.current) clearTimeout(zonePulseTimerRef.current);
    };
  }, []);

  // Step 4 Customize Drawer State (Drawer Closed = Pure Locked Showcase · Drawer Open = Edit Mode)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDiscardIntent, setPendingDiscardIntent] = useState(null);
  useEffect(() => {
    if (!pendingDiscardIntent) return undefined;
    const onEsc = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPendingDiscardIntent(null);
      }
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [pendingDiscardIntent]);
  const [dockSide, setDockSide] = useState(() => {
    try {
      return localStorage.getItem("argon_cb_drawer_side_v4") === "left" ? "left" : "right";
    } catch {
      return "right";
    }
  });
  const [folderSidebarMode, setFolderSidebarMode] = useState(() => {
    try {
      const m = localStorage.getItem("argon_cb_folder_sidebar_v1");
      return m === "off" || m === "hover" || m === "static" ? m : "static";
    } catch {
      return "static";
    }
  });
  const [extraFolders, setExtraFolders] = useState([]);
  const [extraFoldersByRoot, setExtraFoldersByRoot] = useState({});
  const [roots, setRoots] = useState([]);
  const [activeRootPath, setActiveRootPath] = useState("");
  const [rootsLoaded, setRootsLoaded] = useState(false);
  const [addRootOpen, setAddRootOpen] = useState(false);
  const [pendingRemoveRoot, setPendingRemoveRoot] = useState(null);
  const [pendingDropChoice, setPendingDropChoice] = useState(null);
  const [scanOverlayStatus, setScanOverlayStatus] = useState(null);
  const [dropActionMode, setDropActionMode] = useState(() => {
    try {
      const v = localStorage.getItem("argon_cb_drop_action_v1");
      return v === "move" || v === "copy" || v === "ask" ? v : "ask";
    } catch {
      return "ask";
    }
  });
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    try {
      return localStorage.getItem("argon_cb_welcome_dismissed_v1") === "true";
    } catch {
      return false;
    }
  });
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [welcomeInitialTab, setWelcomeInitialTab] = useState("welcome");
  const [tourOpen, setTourOpen] = useState(false);
  const welcomeAutoCheckedRef = useRef(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateActionResult, setUpdateActionResult] = useState(null);

  const checkForUpdates = useCallback(async (force = false) => {
    setCheckingUpdates(true);
    try {
      const res = await fetch(`/api/update/status${force ? "?force=1" : ""}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          setUpdateInfo(data);
        }
      }
    } catch {} finally {
      setCheckingUpdates(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      checkForUpdates(false);
    }, 1400);
    return () => clearTimeout(t);
  }, [checkForUpdates]);

  const handleRunUpdate = useCallback(async () => {
    setApplyingUpdate(true);
    setUpdateActionResult(null);
    try {
      const res = await fetch("/api/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zipUrl: updateInfo?.zipUrl || null }),
      });
      const data = await res.json();
      setUpdateActionResult(data);
      if (data?.ok) {
        await checkForUpdates(true);
      }
    } catch {
      setUpdateActionResult({
        ok: false,
        message: "Failed to contact Atelier server while applying update.",
      });
    } finally {
      setApplyingUpdate(false);
    }
  }, [updateInfo?.zipUrl, checkForUpdates]);

  const handleRestartApp = useCallback(async () => {
    try {
      await fetch("/api/restart", { method: "POST" });
      setUpdateActionResult((prev) => ({
        ...(prev || {}),
        ok: true,
        restarting: true,
        message: "Restarting HammelArt Atelier…",
      }));
    } catch {}
  }, []);
  const [libraryRefreshing, setLibraryRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);
  const pendingSseRefreshRef = useRef(false);
  const lastLibrarySyncRef = useRef(0);
  const lastMutationAtRef = useRef(0);
  const [activeDrag, setActiveDrag] = useState(null);
  const [externalDragHover, setExternalDragHover] = useState(null);
  const [importingFiles, setImportingFiles] = useState(false);
  const importingFilesRef = useRef(false);
  const [isNativeFs, setIsNativeFs] = useState(false);
  const [drawerTab, setDrawerTab] = useState("wall");
  const [blueprintMode, setBlueprintMode] = useState(false);
  const draftSnapshotRef = useRef(null);
  const [draftRevision, setDraftRevision] = useState(0);

  // Viewport geometry for Aspect-True Scaled Preview when Drawer is Open
  const viewportRef = useRef(null);
  const [viewportBox, setViewportBox] = useState({ w: 1280, h: 700 });
  const [fullStageAspect, setFullStageAspect] = useState(16 / 9);

  // Layer 1 & Layer 2 Presets (filtering out removed Horizon 3D presets cleanly)
  const [userPresets, setUserPresets] = useState(() => {
    try {
      const raw = localStorage.getItem("argon_cb_user_presets_v2");
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((p) => p && p.engineMode !== "horizon") : [];
    } catch {
      return [];
    }
  });
  const builtinWallPresets = useMemo(() => buildBuiltinWallPresets(), []);
  const [activeWallPresetId, setActiveWallPresetId] = useState(null);
  const [lastUserWallPresetId, setLastUserWallPresetId] = useState(null);
  const [userWallPresets, setUserWallPresets] = useState(() => {
    try {
      const raw = localStorage.getItem("argon_cb_wall_presets_v3");
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list)
        ? list.map((wp) => (wp?.tree ? { ...wp, tree: migrateZoneNode(wp.tree) } : wp))
        : [];
    } catch {
      return [];
    }
  });
  const [hoveredBarZoneId, setHoveredBarZoneId] = useState(null);
  const [treeModalTarget, setTreeModalTarget] = useState(null);
  const [radialMenu, setRadialMenu] = useState(null);
  const [comfyOnline, setComfyOnline] = useState(false);
  const [noteTarget, setNoteTarget] = useState(null);
  const [lightboxExiting, setLightboxExiting] = useState(false);
  const [peekLabels, setPeekLabels] = useState(false);
  const [screensaverMin, setScreensaverMin] = useState(() => {
    try {
      const raw = localStorage.getItem("argon_cb_screensaver_min_v1");
      if (raw === null) return 4;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 4;
    } catch {
      return 4;
    }
  });
  const [screensaverSource, setScreensaverSource] = useState(() => {
    try {
      const v = localStorage.getItem("argon_cb_screensaver_src_v1");
      return v === "favorites" || v === "all" ? v : "current";
    } catch {
      return "current";
    }
  });
  const [screensaverActive, setScreensaverActive] = useState(false);
  const lastTabInputAtRef = useRef(Date.now());
  const [folderCombos, setFolderCombos] = useState(() => {
    try {
      const raw = localStorage.getItem("argon_cb_folder_combos_v4");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [buttonTheme, setButtonTheme] = useState(() => {
    try {
      return localStorage.getItem("argon_cb_btn_theme_v1") || "candy";
    } catch {
      return "candy";
    }
  });
  const [buttonCrispText, setButtonCrispText] = useState(() => {
    try {
      return localStorage.getItem("argon_cb_btn_crisp_v1") === "true";
    } catch {
      return false;
    }
  });

  applyThemeToDOM(stageMode, accentId, buttonTheme, buttonCrispText);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_btn_crisp_v1", String(buttonCrispText));
    } catch {}
  }, [buttonCrispText]);

  // Delegated cursor light-track (Silk/Jelly/Bio) & tactile click burst across all button themes
  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_btn_theme_v1", buttonTheme);
    } catch {}
    const BTN_SEL =
      ".hm-btn, .hm-icon-btn, .hm-mode-pill, .hm-drawer-seg-btn, .hm-drawer-preset-pill, .hm-sb-zone-pill, .hm-search-chip, .hm-purg-seg-btn, .hm-purg-btn, .hm-cap-sb-pill";
    const needsMove = buttonTheme === "silk" || buttonTheme === "jelly" || buttonTheme === "bio";
    const onMove = needsMove
      ? (e) => {
          const btn = e.target?.closest?.(BTN_SEL);
          if (!btn) return;
          const r = btn.getBoundingClientRect();
          btn.style.setProperty("--hm-bx", `${(((e.clientX - r.left) / Math.max(1, r.width)) * 100).toFixed(1)}%`);
          btn.style.setProperty("--hm-by", `${(((e.clientY - r.top) / Math.max(1, r.height)) * 100).toFixed(1)}%`);
        }
      : null;
    const onClick = (e) => {
      const btn = e.target?.closest?.(BTN_SEL);
      if (!btn || btn.disabled) return;
      if (buttonTheme === "bio") {
        const r = btn.getBoundingClientRect();
        btn.style.setProperty("--hm-rx", `${(e.clientX - r.left).toFixed(1)}px`);
        btn.style.setProperty("--hm-ry", `${(e.clientY - r.top).toFixed(1)}px`);
        delete btn.dataset.hmBioKick;
        void btn.offsetWidth;
        btn.dataset.hmBioKick = "1";
        setTimeout(() => {
          delete btn.dataset.hmBioKick;
        }, 540);
        return;
      }
      delete btn.dataset.hmKick;
      void btn.offsetWidth;
      btn.dataset.hmKick = "1";
      setTimeout(() => {
        delete btn.dataset.hmKick;
      }, 460);
    };
    if (onMove) window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("click", onClick, true);
    return () => {
      if (onMove) window.removeEventListener("pointermove", onMove);
      window.removeEventListener("click", onClick, true);
    };
  }, [buttonTheme]);

  // Track viewport size cleanly; record true full-screen aspect when Drawer is closed
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 60 && rect.height > 60) {
        setViewportBox({ w: rect.width, h: rect.height });
        if (!drawerOpen) {
          setFullStageAspect(rect.width / rect.height);
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawerOpen]);

  // Persistence
  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_stage_mode_v1", stageMode);
    } catch {}
  }, [stageMode]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_accent_id_v1", accentId);
    } catch {}
  }, [accentId]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_folder_filter_v4", JSON.stringify(folderFilter));
    } catch {}
  }, [folderFilter]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_sort_by_v4", sortBy);
    } catch {}
  }, [sortBy]);

  useEffect(() => {
    if (rootsLoaded && roots.length > 0 && isFolderSpecUnmountedRoot(folderFilter, roots, folderCombos)) {
      setFolderFilter("ALL");
    }
  }, [rootsLoaded, roots, folderFilter, folderCombos]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_app_mode_v4", appMode);
    } catch {}
  }, [appMode]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_welcome_dismissed_v1", welcomeDismissed ? "true" : "false");
    } catch {}
  }, [welcomeDismissed]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_drop_action_v1", dropActionMode);
    } catch {}
  }, [dropActionMode]);

  useEffect(() => {
    if (!rootsLoaded || welcomeAutoCheckedRef.current) return;
    welcomeAutoCheckedRef.current = true;
    if (roots.length === 0 || !welcomeDismissed) {
      setWelcomeInitialTab("welcome");
      setWelcomeOpen(true);
    }
  }, [rootsLoaded, roots.length, welcomeDismissed]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_purgatory_cfg_v1", JSON.stringify(purgatoryCfg));
    } catch {}
  }, [purgatoryCfg]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_single_v4", JSON.stringify(singleCfgs));
    } catch {}
  }, [singleCfgs]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_drawer_side_v4", dockSide);
    } catch {}
  }, [dockSide]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_folder_sidebar_v1", folderSidebarMode);
    } catch {}
  }, [folderSidebarMode]);

  useEffect(() => {
    const syncFs = () => setIsNativeFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFs);
    return () => document.removeEventListener("fullscreenchange", syncFs);
  }, []);

  const screensaverDesktopFsRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.pywebview) return undefined;
    let cancelled = false;
    if (screensaverActive) {
      fetch("/api/desktop-fullscreen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullscreen: true }),
      })
        .then((res) => (res.ok ? res.json().catch(() => null) : null))
        .then((data) => {
          if (data?.ok) {
            const owned = !data.already_fullscreen;
            if (cancelled && owned) {
              fetch("/api/desktop-fullscreen", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fullscreen: false }),
              }).catch(() => {});
            } else {
              screensaverDesktopFsRef.current = owned;
            }
          }
        })
        .catch(() => {});
    } else if (screensaverDesktopFsRef.current) {
      screensaverDesktopFsRef.current = false;
      fetch("/api/desktop-fullscreen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullscreen: false }),
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [screensaverActive]);

  useEffect(() => {
    return () => {
      if (screensaverDesktopFsRef.current) {
        screensaverDesktopFsRef.current = false;
        fetch("/api/desktop-fullscreen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullscreen: false }),
        }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_wall_tree_v3", JSON.stringify(wallTree));
    } catch {}
  }, [wallTree]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_wall_gap_v3", String(seamGap));
    } catch {}
  }, [seamGap]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_user_presets_v2", JSON.stringify(userPresets));
    } catch {}
  }, [userPresets]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_wall_presets_v3", JSON.stringify(userWallPresets));
    } catch {}
  }, [userWallPresets]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_folder_combos_v4", JSON.stringify(folderCombos));
    } catch {}
  }, [folderCombos]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_screensaver_min_v1", String(screensaverMin));
    } catch {}
  }, [screensaverMin]);

  useEffect(() => {
    try {
      localStorage.setItem("argon_cb_screensaver_src_v1", screensaverSource);
    } catch {}
  }, [screensaverSource]);

  // Global Whole-PC Idle + Active-Tab Screensaver Controller
  useEffect(() => {
    if (screensaverMin <= 0) {
      setScreensaverActive(false);
      return;
    }

    if (!screensaverActive) {
      lastTabInputAtRef.current = Date.now();
      const bump = () => {
        lastTabInputAtRef.current = Date.now();
      };
      const onVis = () => {
        if (document.visibilityState === "visible") {
          lastTabInputAtRef.current = Date.now();
        }
      };

      window.addEventListener("pointerdown", bump, { passive: true });
      window.addEventListener("mousemove", bump, { passive: true });
      window.addEventListener("keydown", bump, { passive: true });
      window.addEventListener("wheel", bump, { passive: true });
      window.addEventListener("touchstart", bump, { passive: true });
      document.addEventListener("visibilitychange", onVis);

      const targetMs = screensaverMin * 60 * 1000;
      const timer = setInterval(async () => {
        if (drawerOpen || document.fullscreenElement) {
          lastTabInputAtRef.current = Date.now();
          return;
        }
        if (document.visibilityState !== "visible") return;
        const activeVideo = document.querySelector(".cb-lightbox-backdrop video");
        if (activeVideo && !activeVideo.paused && !activeVideo.ended) {
          lastTabInputAtRef.current = Date.now();
          return;
        }
        const tabIdle = Date.now() - lastTabInputAtRef.current;
        if (tabIdle < targetMs - 1500) return;

        let effectiveIdle = tabIdle;
        try {
          const res = await fetch("/api/idle");
          if (res.ok) {
            const data = await res.json();
            if (data?.supported && typeof data.idle_ms === "number" && data.idle_ms >= 0) {
              effectiveIdle = Math.min(tabIdle, data.idle_ms);
            }
          }
        } catch {}

        const latestTabIdle = Date.now() - lastTabInputAtRef.current;
        if (
          document.visibilityState === "visible" &&
          !document.fullscreenElement &&
          latestTabIdle >= targetMs &&
          effectiveIdle >= targetMs
        ) {
          setScreensaverActive(true);
        }
      }, 4000);

      return () => {
        clearInterval(timer);
        window.removeEventListener("pointerdown", bump);
        window.removeEventListener("mousemove", bump);
        window.removeEventListener("keydown", bump);
        window.removeEventListener("wheel", bump);
        window.removeEventListener("touchstart", bump);
        document.removeEventListener("visibilitychange", onVis);
      };
    }

    // Active Screensaver wake listeners (capture-phase so wake input stays clean & doesn't click behind)
    let armed = false;
    let originPos = null;
    const armTimer = setTimeout(() => {
      armed = true;
    }, 320);

    const dismiss = (e) => {
      if (!armed) return;
      if (e && typeof e.preventDefault === "function") {
        e.preventDefault();
        e.stopPropagation();
      }
      lastTabInputAtRef.current = Date.now();
      setScreensaverActive(false);
    };

    const onMove = (e) => {
      if (!armed) return;
      if (!originPos) {
        originPos = { x: e.clientX, y: e.clientY };
        return;
      }
      if (Math.hypot(e.clientX - originPos.x, e.clientY - originPos.y) > 14) {
        lastTabInputAtRef.current = Date.now();
        setScreensaverActive(false);
      }
    };

    const onVisHide = () => {
      if (document.visibilityState !== "visible") {
        lastTabInputAtRef.current = Date.now();
        setScreensaverActive(false);
      }
    };

    window.addEventListener("keydown", dismiss, true);
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("wheel", dismiss, { capture: true, passive: false });
    window.addEventListener("touchstart", dismiss, true);
    window.addEventListener("mousemove", onMove, true);
    document.addEventListener("visibilitychange", onVisHide);

    return () => {
      clearTimeout(armTimer);
      window.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("wheel", dismiss, true);
      window.removeEventListener("touchstart", dismiss, true);
      window.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("visibilitychange", onVisHide);
    };
  }, [screensaverMin, screensaverActive, drawerOpen]);

  // Fetch gallery metadata (reusable for manual refresh + throttled focus sync)
  const showToastRef = useRef(curation?.showToast);
  showToastRef.current = curation?.showToast;

  const refreshLibrary = useCallback(async ({ silent = false } = {}) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (!silent) setLibraryRefreshing(true);

    let pollTimer = null;
    const delayTimer = setTimeout(() => {
      const poll = async () => {
        try {
          const sr = await fetch("/api/roots/scan-status", { cache: "no-store" });
          const sd = sr.ok ? await sr.json() : null;
          if (sd?.active) {
            setScanOverlayStatus(sd);
          }
        } catch {}
      };
      poll();
      pollTimer = setInterval(poll, 180);
    }, 450);

    try {
      const r = await fetch("/api/images", { cache: "no-store" });
      const d = r.ok ? await r.json() : null;
      if (d) {
        if (Array.isArray(d.images)) {
          setRawItems(d.images);
        }
        if (Array.isArray(d.folders)) {
          setExtraFolders(d.folders);
        }
        if (d.folders_by_root && typeof d.folders_by_root === "object") {
          setExtraFoldersByRoot(d.folders_by_root);
        } else if (Array.isArray(d.folders)) {
          const rid = d.roots?.[0]?.id || "root_1";
          setExtraFoldersByRoot({ [rid]: d.folders });
        }
        if (Array.isArray(d.roots)) {
          setRoots(d.roots);
        }
        if (typeof d.active_root_path === "string") {
          setActiveRootPath(d.active_root_path);
        }
        setRootsLoaded(true);
        lastLibrarySyncRef.current = Date.now();
        if (!silent) {
          const folderCount = Array.isArray(d.scoped_folders)
            ? d.scoped_folders.length
            : Array.isArray(d.folders)
            ? d.folders.length
            : 0;
          const imgCount = Array.isArray(d.images) ? d.images.length : 0;
          showToastRef.current?.(`Synced · ${folderCount} folders · ${imgCount} files`);
        }
      }
    } catch {
      setRootsLoaded(true);
      if (!silent) showToastRef.current?.("Could not refresh folders");
    } finally {
      clearTimeout(delayTimer);
      if (pollTimer) clearInterval(pollTimer);
      setScanOverlayStatus(null);
      refreshInFlightRef.current = false;
      if (!silent) setLibraryRefreshing(false);
      if (pendingSseRefreshRef.current) {
        pendingSseRefreshRef.current = false;
        setTimeout(() => {
          refreshLibrary({ silent: true });
        }, 40);
      }
    }
  }, []);

  useEffect(() => {
    refreshLibrary({ silent: true });
    const onFocusSync = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLibrarySyncRef.current > 8000) {
        refreshLibrary({ silent: true });
      }
    };
    window.addEventListener("focus", onFocusSync);
    document.addEventListener("visibilitychange", onFocusSync);
    return () => {
      window.removeEventListener("focus", onFocusSync);
      document.removeEventListener("visibilitychange", onFocusSync);
    };
  }, [refreshLibrary]);

  // Live background folder watcher SSE subscription
  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    const es = new EventSource("/api/events");
    const onLibraryChanged = (ev) => {
      if (Date.now() - lastMutationAtRef.current < 3500) return;
      if (refreshInFlightRef.current) {
        pendingSseRefreshRef.current = true;
        return;
      }
      let info = {};
      try {
        info = JSON.parse(ev.data || "{}");
      } catch {}
      refreshLibrary({ silent: true }).then(() => {
        if ((info.added || 0) > 0 && Date.now() - lastMutationAtRef.current > 3500) {
          showToastRef.current?.(
            `Synced ${info.added} new ${info.added === 1 ? "file" : "files"}`
          );
        }
      });
    };
    es.addEventListener("library-changed", onLibraryChanged);
    return () => {
      es.removeEventListener("library-changed", onLibraryChanged);
      es.close();
    };
  }, [refreshLibrary]);

  const rawItemMap = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < rawItems.length; i++) {
      map.set(itemKey(rawItems[i]), rawItems[i]);
    }
    return map;
  }, [rawItems]);

  const folders = useMemo(
    () => flattenQuickFolderEntries(rawItems, favSet, purgatorySet, roots, extraFoldersByRoot),
    [rawItems, favSet, purgatorySet, roots, extraFoldersByRoot]
  );

  // Prune stale Purgatory keys when files disappear externally on disk
  useEffect(() => {
    if (rawItems.length === 0 || !curation?.prunePurgatory) return;
    curation.prunePurgatory(new Set(rawItemMap.keys()));
  }, [rawItems.length, rawItemMap, curation?.prunePurgatory]);

  // Trigger top-bar Purgatory arrival flash pulse whenever staged prints beam in
  useEffect(() => {
    if (!curation?.purgatoryPulseNonce) return;
    setPurgatoryPulsing(true);
    const timer = setTimeout(() => setPurgatoryPulsing(false), 680);
    return () => clearTimeout(timer);
  }, [curation?.purgatoryPulseNonce]);

  const purgatoryItems = useMemo(() => {
    if (!purgatorySet || purgatorySet.size === 0) return [];
    const list = rawItems.filter((it) => purgatorySet.has(itemKey(it)));
    list.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return list;
  }, [rawItems, purgatorySet]);

  const livePurgatoryCount = purgatoryItems.length;

  const singleFilteredItems = useMemo(
    () =>
      filterAndSortItems(rawItems, folderFilter, search, sortBy, shuffleSeed, folderCombos, {
        favSet,
        pinSet,
        purgatorySet,
        notesMap,
        favoritesOnly: searchFavOnly,
        searchAllFolders,
        advancedFilter,
      }),
    [
      rawItems,
      folderFilter,
      search,
      sortBy,
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

  // Clear multi-select when context shifts cleanly
  useEffect(() => {
    setSelectedKeys(new Set());
    setDockBurnArmed(false);
    lastSelectedKeyRef.current = "";
  }, [appMode, folderFilter, purgatoryOpen]);

  useEffect(() => {
    if (selectedKeys.size === 0) setDockBurnArmed(false);
  }, [selectedKeys.size]);

  // Wall zones sync
  const zones = useMemo(() => listZones(wallTree), [wallTree]);
  const totalZones = countZones(wallTree);

  useEffect(() => {
    if (!zones.some((z) => z.id === activeZoneId) && zones[0]) {
      setActiveZoneId(zones[0].id);
    }
    if (drawerTab !== "wall" && !zones.some((z) => z.id === drawerTab)) {
      setDrawerTab("wall");
    }
    if (soloZoneId && !zones.some((z) => z.id === soloZoneId)) {
      setSoloZoneId(null);
    }
    if (swapSourceId && !zones.some((z) => z.id === swapSourceId)) {
      setSwapSourceId(null);
    }
  }, [zones, activeZoneId, drawerTab, soloZoneId, swapSourceId]);

  const activeZone = findZone(wallTree, activeZoneId) || zones[0];
  const activeZoneNumber = Math.max(1, zones.findIndex((z) => z.id === activeZone?.id) + 1);
  const allZonePresets = useMemo(() => [...BUILTIN_PRESETS, ...userPresets], [userPresets]);

  // Unified Drawer Open / Save / Cancel Snapshot Lifecycle
  const captureSnapshot = () => ({
    appMode,
    singleCfgs: JSON.parse(JSON.stringify(singleCfgs)),
    purgatoryCfg: { ...purgatoryCfg },
    wallTree: JSON.parse(JSON.stringify(wallTree)),
    seamGap,
    folderFilter,
    sortBy,
    shuffleSeed,
    stageMode,
    accentId,
    buttonTheme,
    buttonCrispText,
    favIcon,
    deleteFx,
    folderSidebarMode,
    dockSide,
    dropActionMode,
    screensaverMin,
    screensaverSource,
    activeWallPresetId,
    lastUserWallPresetId,
  });

  const openDrawer = () => {
    if (!drawerOpen) {
      draftSnapshotRef.current = captureSnapshot();
      setDraftRevision((r) => r + 1);
      if (appMode === "wall" && !purgatoryOpen) {
        setDrawerTab("wall");
      }
      setPendingDiscardIntent(null);
      setBlueprintMode(false);
      setSwapSourceId(null);
      setDrawerOpen(true);
    }
  };

  const handleSaveChanges = () => {
    draftSnapshotRef.current = null;
    setPendingDiscardIntent(null);
    setBlueprintMode(false);
    setSwapSourceId(null);
    setSoloZoneId(null);
    setDrawerOpen(false);
  };

  const handleCancelDrawer = () => {
    const snap = draftSnapshotRef.current;
    if (snap) {
      setAppMode(snap.appMode);
      setSingleCfgs(snap.singleCfgs);
      if (snap.purgatoryCfg) setPurgatoryCfg(snap.purgatoryCfg);
      setWallTree(snap.wallTree);
      setSeamGap(snap.seamGap);
      setFolderFilter(snap.folderFilter);
      setSortBy(snap.sortBy);
      setShuffleSeed(snap.shuffleSeed);
      setStageMode(snap.stageMode);
      setAccentId(snap.accentId);
      if (snap.buttonTheme) setButtonTheme(snap.buttonTheme);
      if (typeof snap.buttonCrispText === "boolean") setButtonCrispText(snap.buttonCrispText);
      if (snap.favIcon) curation?.setFavIcon?.(snap.favIcon);
      if (snap.deleteFx) curation?.setDeleteFx?.(snap.deleteFx);
      if (snap.folderSidebarMode) setFolderSidebarMode(snap.folderSidebarMode);
      if (snap.dockSide) setDockSide(snap.dockSide);
      if (snap.dropActionMode) setDropActionMode(snap.dropActionMode);
      if (typeof snap.screensaverMin === "number") setScreensaverMin(snap.screensaverMin);
      if (snap.screensaverSource) setScreensaverSource(snap.screensaverSource);
      setActiveWallPresetId(snap.activeWallPresetId);
      setLastUserWallPresetId(snap.lastUserWallPresetId);
    }
    draftSnapshotRef.current = null;
    setPendingDiscardIntent(null);
    setBlueprintMode(false);
    setSwapSourceId(null);
    setSoloZoneId(null);
    setDrawerOpen(false);
  };

  const isDrawerDirty = useMemo(() => {
    if (!drawerOpen || !draftSnapshotRef.current) return false;
    const snap = draftSnapshotRef.current;
    const current = {
      appMode,
      singleCfgs,
      purgatoryCfg,
      wallTree,
      seamGap,
      folderFilter,
      sortBy,
      shuffleSeed,
      stageMode,
      accentId,
      buttonTheme,
      buttonCrispText,
      favIcon,
      deleteFx,
      folderSidebarMode,
      dockSide,
      dropActionMode,
      screensaverMin,
      screensaverSource,
      activeWallPresetId,
      lastUserWallPresetId,
    };
    return JSON.stringify(snap) !== JSON.stringify(current);
  }, [
    drawerOpen,
    draftRevision,
    appMode,
    singleCfgs,
    purgatoryCfg,
    wallTree,
    seamGap,
    folderFilter,
    sortBy,
    shuffleSeed,
    stageMode,
    accentId,
    buttonTheme,
    buttonCrispText,
    favIcon,
    deleteFx,
    folderSidebarMode,
    dockSide,
    dropActionMode,
    screensaverMin,
    screensaverSource,
    activeWallPresetId,
    lastUserWallPresetId,
  ]);

  const executePostGuardIntent = (intent) => {
    if (intent === "purgatory") setPurgatoryOpen((v) => !v);
  };

  const requestGuardedCloseDrawer = (intent = "close") => {
    if (!drawerOpen) {
      executePostGuardIntent(intent);
      return;
    }
    if (isDrawerDirty) {
      setPendingDiscardIntent(intent);
      return;
    }
    handleCancelDrawer();
    executePostGuardIntent(intent);
  };

  const confirmDiscardChanges = () => {
    const intent = pendingDiscardIntent || "close";
    handleCancelDrawer();
    executePostGuardIntent(intent);
  };

  const confirmSaveBeforeIntent = () => {
    const intent = pendingDiscardIntent || "close";
    handleSaveChanges();
    executePostGuardIntent(intent);
  };

  // Hover shortcuts: F (Favorite), X/Del (Purgatory • Shift = Burn SSD), Esc (Clear select) & Hold V (Peek)
  const kbHandlersRef = useRef({});
  const drawerGuardRef = useRef(null);
  drawerGuardRef.current = requestGuardedCloseDrawer;

  useEffect(() => {
    if (
      inspectPayload ||
      treeModalTarget ||
      filterModalOpen ||
      welcomeOpen ||
      addRootOpen ||
      pendingRemoveRoot ||
      noteTarget ||
      tourOpen ||
      pendingDropChoice ||
      pendingDiscardIntent ||
      screensaverActive
    ) {
      setPeekLabels(false);
      return;
    }
    const onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      const H = kbHandlersRef.current;

      if (e.key === "F11") {
        e.preventDefault();
        fetch("/api/desktop-fullscreen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d?.desktop) {
              if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.().catch(() => {});
              } else {
                document.exitFullscreen?.().catch(() => {});
              }
            }
          })
          .catch(() => {});
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k === "a") {
        if (
          !H.purgatoryOpen &&
          !H.drawerOpen &&
          (H.appMode === "classic" || H.appMode === "conveyor" || H.appMode === "wall")
        ) {
          e.preventDefault();
          H.selectAllVisible?.();
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Escape" && H.selectedCount > 0 && !H.drawerOpen) {
        e.preventDefault();
        H.clearSelection?.();
        return;
      }

      if (k === "f" && !e.shiftKey) {
        if (H.selectedCount > 0 && !H.purgatoryOpen && H.appMode !== "slideshow") {
          const chosen = H.getSelectedItems?.() || [];
          if (chosen.length > 0) {
            e.preventDefault();
            H.toggleBatchFavorite?.(chosen);
            return;
          }
        }
        const hovered =
          document.querySelector(".cb-tile.is-hovered .cb-tile-fx[data-lb-key]") ||
          document.querySelector(".cb-tile:hover .cb-tile-fx[data-lb-key]");
        const key = hovered?.getAttribute?.("data-lb-key");
        if (key) {
          e.preventDefault();
          curation?.toggleFavorite?.(key);
        }
      } else if (e.key === "Delete" || k === "x") {
        // Multi-selected tiles take precedence over single hovered tile across Classic, Conveyor & Wall
        if (H.selectedCount > 0 && !H.purgatoryOpen && H.appMode !== "slideshow") {
          e.preventDefault();
          const chosen = H.getSelectedItems?.() || [];
          if (chosen.length > 0) {
            if (e.shiftKey) H.handlePermanentBurn?.(chosen);
            else H.handleSendToPurgatory?.(chosen);
          }
          return;
        }
        const hovered =
          document.querySelector(".cb-tile.is-hovered .cb-tile-fx[data-lb-key]") ||
          document.querySelector(".cb-tile:hover .cb-tile-fx[data-lb-key]");
        if (!hovered || hovered.closest?.(".cb-slideshow-stage")) return;
        const key = hovered.getAttribute?.("data-lb-key");
        const item = key ? H.rawItemMap?.get(key) : null;
        if (item) {
          e.preventDefault();
          if (e.shiftKey) {
            H.handlePermanentBurn?.(item);
          } else if (H.purgatoryOpen) {
            H.handleRescueFromPurgatory?.(item);
          } else {
            H.handleSendToPurgatory?.(item);
          }
        }
      } else if (k === "v" && !e.repeat && !e.shiftKey) {
        e.preventDefault();
        setPeekLabels(true);
      }
    };
    const onKeyUp = (e) => {
      if (e.key === "v" || e.key === "V") {
        setPeekLabels(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    inspectPayload,
    treeModalTarget,
    filterModalOpen,
    welcomeOpen,
    addRootOpen,
    pendingRemoveRoot,
    noteTarget,
    tourOpen,
    pendingDropChoice,
    pendingDiscardIntent,
    screensaverActive,
    curation,
  ]);

  // Ensure Hold-to-Peek always releases cleanly on pointerup / cancel / window blur
  useEffect(() => {
    if (!peekLabels) return;
    const stopPeek = () => setPeekLabels(false);
    window.addEventListener("pointerup", stopPeek);
    window.addEventListener("pointercancel", stopPeek);
    window.addEventListener("blur", stopPeek);
    return () => {
      window.removeEventListener("pointerup", stopPeek);
      window.removeEventListener("pointercancel", stopPeek);
      window.removeEventListener("blur", stopPeek);
    };
  }, [peekLabels]);

  // Escape closes Drawer through Unsaved Changes Guard when no child overlay sits above it
  useEffect(() => {
    if (
      !drawerOpen ||
      inspectPayload ||
      filterModalOpen ||
      treeModalTarget ||
      addRootOpen ||
      welcomeOpen ||
      pendingRemoveRoot ||
      pendingDiscardIntent
    ) {
      return;
    }
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        drawerGuardRef.current?.("close");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    drawerOpen,
    inspectPayload,
    filterModalOpen,
    treeModalTarget,
    addRootOpen,
    welcomeOpen,
    pendingRemoveRoot,
    pendingDiscardIntent,
  ]);

  // Helpers routing edits either to active Single Mode OR active Wall Zone!
  const isWallMode = appMode === "wall";
  const drawerEngineMode = isWallMode ? activeZone.engineMode || "conveyor" : appMode;
  const drawerConveyorCfg = isWallMode ? activeZone.conveyorCfg : singleCfgs.conveyor;
  const drawerClassicCfg = isWallMode ? activeZone.classicCfg : singleCfgs.classic;
  const drawerSlideshowCfg = isWallMode ? activeZone.slideshowCfg : singleCfgs.slideshow;
  const drawerActivePresetId = isWallMode
    ? activeZone.activePresetId
    : singleCfgs.presetIds[drawerEngineMode];
  const drawerLastUserPresetId = isWallMode
    ? activeZone.lastUserPresetId
    : singleCfgs.lastUserPresetIds[drawerEngineMode];

  const patchWallActiveZone = (updater) => {
    if (!activeZone) return;
    setActiveWallPresetId(null);
    setWallTree((prev) => updateZone(prev, activeZone.id, updater));
  };

  const patchConveyor = (patch) => {
    if (isWallMode) {
      patchWallActiveZone((z) => ({
        ...z,
        activePresetId: null,
        conveyorCfg: { ...DEFAULT_CONVEYOR, ...z.conveyorCfg, ...patch },
      }));
    } else {
      setSingleCfgs((prev) => ({
        ...prev,
        conveyor: { ...DEFAULT_CONVEYOR, ...prev.conveyor, ...patch },
        presetIds: { ...prev.presetIds, conveyor: null },
      }));
    }
  };

  const patchClassic = (patch) => {
    if (isWallMode) {
      patchWallActiveZone((z) => ({
        ...z,
        activePresetId: null,
        classicCfg: { ...DEFAULT_CLASSIC, ...z.classicCfg, ...patch },
      }));
    } else {
      setSingleCfgs((prev) => ({
        ...prev,
        classic: { ...DEFAULT_CLASSIC, ...prev.classic, ...patch },
        presetIds: { ...prev.presetIds, classic: null },
      }));
    }
  };

  // Ctrl + MouseWheel gallery card zoom (controls Columns / Lanes live without browser page-zoom)
  const ctrlWheelRef = useRef({});
  ctrlWheelRef.current = {
    disabled: Boolean(
      inspectPayload ||
        screensaverActive ||
        treeModalTarget ||
        noteTarget ||
        addRootOpen ||
        welcomeOpen ||
        filterModalOpen ||
        tourOpen ||
        pendingRemoveRoot ||
        pendingDropChoice ||
        pendingDiscardIntent
    ),
    purgatoryOpen,
    purgatoryCols: purgatoryCfg.cols || 10,
    appMode,
    classicCols: singleCfgs.classic.cols || 7,
    conveyorLanes: singleCfgs.conveyor.lanes || 3,
    zones,
    activeZoneId: activeZone?.id,
    updatePurgatoryCols: (next) =>
      setPurgatoryCfg((prev) => ({ ...DEFAULT_PURGATORY_CFG, ...prev, cols: next })),
    updateSingleClassicCols: (next) =>
      setSingleCfgs((prev) => ({
        ...prev,
        classic: { ...DEFAULT_CLASSIC, ...prev.classic, cols: next },
        presetIds: { ...prev.presetIds, classic: null },
      })),
    updateSingleConveyorLanes: (next) =>
      setSingleCfgs((prev) => ({
        ...prev,
        conveyor: { ...DEFAULT_CONVEYOR, ...prev.conveyor, lanes: next },
        presetIds: { ...prev.presetIds, conveyor: null },
      })),
    updateZoneGridCount: (zoneId, engine, next) => {
      setActiveWallPresetId(null);
      setWallTree((prev) =>
        updateZone(prev, zoneId, (z) => ({
          ...z,
          activePresetId: null,
          ...(engine === "classic"
            ? { classicCfg: { ...DEFAULT_CLASSIC, ...z.classicCfg, cols: next } }
            : { conveyorCfg: { ...DEFAULT_CONVEYOR, ...z.conveyorCfg, lanes: next } }),
        }))
      );
    },
    showToast: curation?.showToast,
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    let acc = 0;
    let lastTs = 0;
    let ctrlKeyDown = false;
    const THRESHOLD = 60;

    const onKeyDown = (e) => {
      if (e.key === "Control" || e.key === "Meta") ctrlKeyDown = true;
    };
    const onKeyUp = (e) => {
      if (e.key === "Control" || e.key === "Meta") ctrlKeyDown = false;
    };
    const onBlur = () => {
      ctrlKeyDown = false;
    };

    const onWheel = (e) => {
      const modHeld = Boolean(e.ctrlKey || e.metaKey || ctrlKeyDown);
      if (!modHeld) return;
      const S = ctrlWheelRef.current;
      if (S.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      const rawDelta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!rawDelta) return;
      const now = performance.now();
      if (now - lastTs > 350 || (acc !== 0 && acc * rawDelta < 0)) {
        acc = 0;
      }
      lastTs = now;
      acc += rawDelta;
      if (Math.abs(acc) < THRESHOLD) return;

      const step = acc > 0 ? 1 : -1;
      acc = 0;
      const clampInt = (val, min, max) => Math.max(min, Math.min(max, val));

      if (S.purgatoryOpen) {
        const next = clampInt(S.purgatoryCols + step, 2, 14);
        if (next !== S.purgatoryCols) S.updatePurgatoryCols(next);
        S.showToast?.(`Purgatory · ${next} Columns`);
        return;
      }

      if (S.appMode === "wall") {
        const hoveredZoneId = e.target?.closest?.("[data-zone-id]")?.getAttribute("data-zone-id");
        const targetId = hoveredZoneId || S.activeZoneId;
        const zIdx = S.zones.findIndex((z) => z.id === targetId);
        const zone = zIdx >= 0 ? S.zones[zIdx] : S.zones[0];
        if (!zone) return;
        const labelPrefix = `Z${(zIdx >= 0 ? zIdx : 0) + 1}`;
        if (zone.engineMode === "classic") {
          const cur = zone.classicCfg?.cols ?? 4;
          const next = clampInt(cur + step, 1, 14);
          if (next !== cur) S.updateZoneGridCount(zone.id, "classic", next);
          S.showToast?.(`${labelPrefix} · ${next} ${next === 1 ? "Column" : "Columns"}`);
        } else if (zone.engineMode === "conveyor") {
          const cur = zone.conveyorCfg?.lanes ?? 3;
          const next = clampInt(cur + step, 1, 14);
          if (next !== cur) S.updateZoneGridCount(zone.id, "conveyor", next);
          S.showToast?.(`${labelPrefix} · ${next} ${next === 1 ? "Lane" : "Lanes"}`);
        }
        return;
      }

      if (S.appMode === "classic") {
        const next = clampInt(S.classicCols + step, 1, 14);
        if (next !== S.classicCols) S.updateSingleClassicCols(next);
        S.showToast?.(`${next} ${next === 1 ? "Column" : "Columns"}`);
      } else if (S.appMode === "conveyor") {
        const next = clampInt(S.conveyorLanes + step, 1, 14);
        if (next !== S.conveyorLanes) S.updateSingleConveyorLanes(next);
        S.showToast?.(`${next} ${next === 1 ? "Lane" : "Lanes"}`);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      el.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, []);

  const patchSlideshow = (patch) => {
    if (isWallMode) {
      patchWallActiveZone((z) => ({
        ...z,
        activePresetId: null,
        slideshowCfg: normalizeSlideshowCfg({ ...z.slideshowCfg, ...patch }),
      }));
    } else {
      setSingleCfgs((prev) => ({
        ...prev,
        slideshow: normalizeSlideshowCfg({ ...prev.slideshow, ...patch }),
        presetIds: { ...prev.presetIds, slideshow: null },
      }));
    }
  };

  const patchZoneSlideshowCfg = (zoneId, patch) => {
    setActiveWallPresetId(null);
    setWallTree((prev) =>
      updateZone(prev, zoneId, (z) => ({
        ...z,
        activePresetId: null,
        slideshowCfg: normalizeSlideshowCfg({ ...z.slideshowCfg, ...patch }),
      }))
    );
  };

  const openZoneInDrawer = (zoneId) => {
    if (zoneId) setActiveZoneId(zoneId);
    openDrawer();
    if (zoneId) setDrawerTab(zoneId);
  };

  const handleResetEngineDefaults = () => {
    if (drawerEngineMode === "classic") patchClassic({ ...DEFAULT_CLASSIC });
    else if (drawerEngineMode === "slideshow") patchSlideshow({ ...DEFAULT_SLIDESHOW });
    else patchConveyor({ ...DEFAULT_CONVEYOR });
  };

  const handleChangeZoneEngineMode = (nextEngine) => {
    if (!isWallMode) return;
    patchWallActiveZone((z) => ({
      ...z,
      engineMode: nextEngine,
      activePresetId: null,
    }));
  };

  // Layer 1 Preset Handlers
  const applyPreset = (p) => {
    const isCustom = userPresets.some((u) => u.id === p.id);
    if (isWallMode) {
      if (!activeZone) return;
      setActiveWallPresetId(null);
      setWallTree((prev) =>
        updateZone(prev, activeZone.id, (z) => ({
          ...applyPresetObjectToZone(z, p),
          lastUserPresetId: isCustom ? p.id : null,
        }))
      );
    } else {
      const m = p.engineMode || appMode;
      const normalized =
        m === "classic"
          ? { ...DEFAULT_CLASSIC, ...p.cfg }
          : m === "slideshow"
          ? normalizeSlideshowCfg(p.cfg)
          : { ...DEFAULT_CONVEYOR, ...p.cfg };
      setSingleCfgs((prev) => ({
        ...prev,
        [m]: normalized,
        presetIds: { ...prev.presetIds, [m]: p.id },
        lastUserPresetIds: { ...prev.lastUserPresetIds, [m]: isCustom ? p.id : null },
      }));
    }
  };

  const getActiveEngineCfgCopy = () => {
    if (drawerEngineMode === "classic") return { ...drawerClassicCfg };
    if (drawerEngineMode === "slideshow") return normalizeSlideshowCfg(drawerSlideshowCfg);
    return { ...drawerConveyorCfg };
  };

  const updateUserPreset = (id) => {
    const cfgCopy = getActiveEngineCfgCopy();
    setUserPresets((prev) =>
      prev.map((p) => (p.id === id ? { ...p, engineMode: drawerEngineMode, cfg: cfgCopy } : p))
    );
    if (isWallMode) {
      patchWallActiveZone((z) => ({ ...z, activePresetId: id, lastUserPresetId: id }));
    } else {
      setSingleCfgs((prev) => ({
        ...prev,
        presetIds: { ...prev.presetIds, [drawerEngineMode]: id },
        lastUserPresetIds: { ...prev.lastUserPresetIds, [drawerEngineMode]: id },
      }));
    }
  };

  const saveNewUserPreset = (cleanName) => {
    const id = `user_${Date.now()}`;
    const snap = {
      id,
      label: cleanName,
      engineMode: drawerEngineMode,
      cfg: getActiveEngineCfgCopy(),
    };
    setUserPresets((prev) => [...prev, snap]);
    if (isWallMode) {
      patchWallActiveZone((z) => ({ ...z, activePresetId: id, lastUserPresetId: id }));
    } else {
      setSingleCfgs((prev) => ({
        ...prev,
        presetIds: { ...prev.presetIds, [drawerEngineMode]: id },
        lastUserPresetIds: { ...prev.lastUserPresetIds, [drawerEngineMode]: id },
      }));
    }
  };

  const deleteUserPreset = (e, id) => {
    e.stopPropagation();
    setUserPresets((prev) => prev.filter((p) => p.id !== id));
    setWallTree((prev) => {
      let next = prev;
      listZones(prev).forEach((z) => {
        if (z.activePresetId === id || z.lastUserPresetId === id) {
          next = updateZone(next, z.id, (curr) => ({
            ...curr,
            activePresetId: curr.activePresetId === id ? null : curr.activePresetId,
            lastUserPresetId: curr.lastUserPresetId === id ? null : curr.lastUserPresetId,
          }));
        }
      });
      return next;
    });
    setSingleCfgs((prev) => {
      const nextP = { ...prev.presetIds };
      const nextL = { ...prev.lastUserPresetIds };
      ["classic", "conveyor", "slideshow"].forEach((k) => {
        if (nextP[k] === id) nextP[k] = null;
        if (nextL[k] === id) nextL[k] = null;
      });
      return { ...prev, presetIds: nextP, lastUserPresetIds: nextL };
    });
  };

  const targetUserPreset = userPresets.find((p) => p.id === drawerLastUserPresetId) || null;
  const isPresetDirty = Boolean(
    targetUserPreset &&
      !isPresetMatched(
        targetUserPreset,
        drawerEngineMode,
        drawerConveyorCfg,
        drawerClassicCfg,
        drawerSlideshowCfg
      )
  );

  // Layer 2 Wall Layout Actions
  const handleSelectWallZone = (zoneId) => {
    setActiveZoneId(zoneId);
    if (drawerOpen && isWallMode && !blueprintMode) {
      setDrawerTab(zoneId);
    }
  };

  const handleSelectDrawerTab = (tabId) => {
    setDrawerTab(tabId);
    if (tabId !== "wall") {
      setActiveZoneId(tabId);
      setBlueprintMode(false);
    }
  };

  const handleSplitZone = (zoneId, edge) => {
    setActiveWallPresetId(null);
    setWallTree((prev) => {
      const { tree, newZoneId } = splitZone(prev, zoneId, edge, userPresets);
      if (newZoneId) setActiveZoneId(newZoneId);
      return tree;
    });
  };

  const handleRemoveZone = (zoneId) => {
    setActiveWallPresetId(null);
    setWallTree((prev) => removeZone(prev, zoneId));
  };

  const handleUpdateRatio = (splitId, nextRatio) => {
    setActiveWallPresetId(null);
    setWallTree((prev) => updateSplitRatio(prev, splitId, nextRatio));
  };

  const handleTriggerSwap = (zoneId) => {
    if (!swapSourceId) {
      setSwapSourceId(zoneId);
      return;
    }
    if (swapSourceId === zoneId) {
      setSwapSourceId(null);
      return;
    }
    setActiveWallPresetId(null);
    setWallTree((prev) => swapZones(prev, swapSourceId, zoneId));
    setSwapSourceId(null);
  };

  const handleSetZoneFolder = (zoneId, fol) => {
    setActiveWallPresetId(null);
    setWallTree((prev) => updateZone(prev, zoneId, (z) => ({ ...z, folderFilter: fol })));
  };

  // Saved Folder Combo CRUD + Master Folder Tree Modal handlers
  const handleSaveNewFolderCombo = (cleanName, paths, favoritesOnly = false) => {
    const base = cleanName.trim() || "Folder Combo";
    const existingLower = new Set(folderCombos.map((c) => c.label.trim().toLowerCase()));
    let uniqueLabel = base;
    let suffix = 2;
    while (existingLower.has(uniqueLabel.toLowerCase())) {
      uniqueLabel = `${base} (${suffix})`;
      suffix += 1;
    }
    const id = `combo_${Date.now()}`;
    setFolderCombos((prev) => [
      ...prev,
      { id, label: uniqueLabel, paths: [...paths], favoritesOnly: Boolean(favoritesOnly) },
    ]);
    return id;
  };

  const handleApplyWallZoneSpecs = (specsByZoneId) => {
    if (!specsByZoneId) return;
    setActiveWallPresetId(null);
    setWallTree((prev) => {
      let next = prev;
      for (const [zId, spec] of Object.entries(specsByZoneId)) {
        next = updateZone(next, zId, (z) => ({ ...z, folderFilter: spec }));
      }
      return next;
    });
  };

  const handleUpdateFolderCombo = (comboId, paths, favoritesOnly = false) => {
    setFolderCombos((prev) =>
      prev.map((c) =>
        c.id === comboId
          ? { ...c, paths: [...paths], favoritesOnly: Boolean(favoritesOnly) }
          : c
      )
    );
  };

  const handleDeleteFolderCombo = (comboId) => {
    setFolderCombos((prev) => prev.filter((c) => c.id !== comboId));
    setFolderFilter((prev) =>
      prev?.type === "combo" && prev.comboId === comboId ? "ALL" : prev
    );
    setWallTree((prev) => {
      let next = prev;
      for (const z of listZones(prev)) {
        if (z.folderFilter?.type === "combo" && z.folderFilter.comboId === comboId) {
          next = updateZone(next, z.id, (zone) => ({ ...zone, folderFilter: "ALL" }));
        }
      }
      return next;
    });
  };

  const handleOpenTreeModal = (zoneIdOrNull = null) => {
    setHoveredBarZoneId(null);
    if (appMode === "wall") {
      const targetId = zoneIdOrNull || activeZone?.id || zones[0]?.id || null;
      if (targetId) setActiveZoneId(targetId);
      setTreeModalTarget({ isWall: true, zoneId: targetId });
    } else {
      setTreeModalTarget({ isWall: false, zoneId: null });
    }
  };

  const handleSetZoneSort = (zoneId, s) => {
    setActiveWallPresetId(null);
    setWallTree((prev) => updateZone(prev, zoneId, (z) => ({ ...z, sortBy: s })));
  };

  const handleApplyWallPreset = (wp) => {
    const nextTree = wp.buildTree ? wp.buildTree() : cloneTreeWithFreshIds(wp.tree);
    setWallTree(nextTree);
    setSeamGap(typeof wp.seamGap === "number" ? wp.seamGap : 8);
    setActiveWallPresetId(wp.id);
    const isCustom = userWallPresets.some((u) => u.id === wp.id);
    setLastUserWallPresetId(isCustom ? wp.id : null);
    const first = listZones(nextTree)[0];
    if (first) setActiveZoneId(first.id);
    setSwapSourceId(null);
    setSoloZoneId(null);
  };

  const targetUserWallPreset = userWallPresets.find((p) => p.id === lastUserWallPresetId) || null;
  const isWallDirty = useMemo(() => {
    if (!targetUserWallPreset) return false;
    return (
      seamGap !== targetUserWallPreset.seamGap ||
      !areTreesEquivalent(wallTree, targetUserWallPreset.tree)
    );
  }, [targetUserWallPreset, seamGap, wallTree]);

  const handleUpdateUserWallPreset = (id) => {
    const treeSnap = JSON.parse(JSON.stringify(wallTree));
    setUserWallPresets((prev) =>
      prev.map((wp) => (wp.id === id ? { ...wp, seamGap, tree: treeSnap } : wp))
    );
    setActiveWallPresetId(id);
    setLastUserWallPresetId(id);
  };

  const handleSaveNewUserWallPreset = (cleanName) => {
    const id = `wall_user_${Date.now()}`;
    const treeSnap = JSON.parse(JSON.stringify(wallTree));
    setUserWallPresets((prev) => [...prev, { id, label: cleanName, seamGap, tree: treeSnap }]);
    setActiveWallPresetId(id);
    setLastUserWallPresetId(id);
  };

  const handleDeleteUserWallPreset = (id) => {
    setUserWallPresets((prev) => prev.filter((wp) => wp.id !== id));
    if (activeWallPresetId === id) setActiveWallPresetId(null);
    if (lastUserWallPresetId === id) setLastUserWallPresetId(null);
  };

  // Switch between top-level modes smoothly
  const handleSwitchAppMode = (nextMode) => {
    setPurgatoryOpen(false);
    setAppMode(nextMode);
    setBlueprintMode(false);
    setSwapSourceId(null);
    setSoloZoneId(null);
    if (nextMode === "wall") {
      setDrawerTab("wall");
    }
  };

  const handleSelectFolderFilter = (nextSpec) => {
    if (nextSpec === "__PURGATORY__") {
      setPurgatoryOpen(true);
      return;
    }
    setPurgatoryOpen(false);
    setFolderFilter(nextSpec);
  };

  // Proportional true-aspect stage sizing when Drawer is open
  const previewFrameStyle = useMemo(() => {
    if (!drawerOpen) return { width: "100%", height: "100%" };
    const availW = Math.max(220, viewportBox.w - 40);
    const availH = Math.max(180, viewportBox.h - 56);
    let w = availW;
    let h = w / Math.max(0.4, fullStageAspect);
    if (h > availH) {
      h = availH;
      w = h * Math.max(0.4, fullStageAspect);
    }
    return {
      width: `${Math.round(w)}px`,
      height: `${Math.round(h)}px`,
    };
  }, [drawerOpen, viewportBox, fullStageAspect]);

  const activeAccentRgb = (ACCENT_SLOTS[accentId] || ACCENT_SLOTS.cyber_violet).rgb;

  const normalizeItemsArg = (itemsOrOne) => {
    const arr = Array.isArray(itemsOrOne) ? itemsOrOne : [itemsOrOne];
    return arr.filter(Boolean);
  };

  const handleSendToPurgatory = async (itemsOrOne, explicitEl = null) => {
    const arr = normalizeItemsArg(itemsOrOne).filter((it) => !curation?.isInPurgatory?.(it));
    if (arr.length === 0) return false;
    const keys = arr.map(itemKey).filter(Boolean);
    const targets = arr
      .map((it, idx) => captureTileFxTarget(itemKey(it), idx === 0 ? explicitEl : null))
      .filter(Boolean);

    setVanishingKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });

    try {
      if (targets.length > 0 && fxOverlayRef.current) {
        await fxOverlayRef.current.playFx({
          mode: "zap",
          targets,
          accentRgb: activeAccentRgb,
          onArrivePulse: () => curation?.triggerPurgatoryPulse?.(),
        });
      } else {
        curation?.triggerPurgatoryPulse?.();
      }
      curation?.addToPurgatory?.(keys, { silent: true });
      setSelectedKeys((prev) => {
        if (!prev.size) return prev;
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
      return true;
    } finally {
      setVanishingKeys((prev) => {
        if (!prev.size) return prev;
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }
  };

  const handleRescueFromPurgatory = (itemsOrOne) => {
    const arr = normalizeItemsArg(itemsOrOne);
    if (!arr.length) return false;
    curation?.removeFromPurgatory?.(arr);
    return true;
  };

  const handleCreateFolder = async (parentSubfolder, name, targetRootId = "") => {
    const fallbackRid = roots[0]?.id || "root_1";
    const rid = targetRootId || fallbackRid;
    const res = await createFolderRequest(parentSubfolder, name, rid);
    if (!res.ok || !res.subfolder) {
      curation?.showToast?.(res.error || "Could not create folder");
      return null;
    }
    lastMutationAtRef.current = Date.now();
    const createdRootId = res.rootId || rid;
    setExtraFoldersByRoot((prev) => {
      const existing = prev[createdRootId] || [];
      if (existing.includes(res.subfolder)) return prev;
      return { ...prev, [createdRootId]: [...existing, res.subfolder] };
    });
    if (createdRootId === fallbackRid) {
      setExtraFolders((prev) =>
        prev.includes(res.subfolder) ? prev : [...prev, res.subfolder]
      );
    }
    curation?.showToast?.(`Created folder "${res.subfolder}"`);
    void refreshLibrary({ silent: true });
    return res.scopedSubfolder || `${createdRootId}::${res.subfolder}`;
  };

  const removeFolderFromLocalState = (targetRid, cleanSub) => {
    const fallbackRid = roots[0]?.id || "root_1";
    const removedKeys = new Set();

    setRawItems((prev) =>
      prev.filter((it) => {
        const itemRid = it.root_id || fallbackRid;
        if (itemRid !== targetRid) return true;
        const curSub = normalizeSubfolder(it.subfolder);
        if (curSub === cleanSub || curSub.startsWith(`${cleanSub}/`)) {
          removedKeys.add(itemKey(it));
          return false;
        }
        return true;
      })
    );

    if (removedKeys.size > 0) {
      setSelectedKeys((prev) => {
        if (!prev.size) return prev;
        const next = new Set(prev);
        removedKeys.forEach((k) => next.delete(k));
        return next;
      });
    }

    applyTreeFolderStateChange(targetRid, cleanSub, null);
  };

  const applyTreeFolderStateChange = (rid, oldSub, nextSubOrNull) => {
    const fallbackRid = roots[0]?.id || "root_1";
    const isMatch = (sub) => {
      const clean = normalizeSubfolder(sub);
      return clean === oldSub || clean.startsWith(`${oldSub}/`);
    };

    const mapWallNode = (node) => {
      if (!node) return node;
      if (node.type === "split") {
        return { ...node, a: mapWallNode(node.a), b: mapWallNode(node.b) };
      }
      return {
        ...node,
        folderFilter: remapFolderSpecForTreeOp(
          node.folderFilter,
          rid,
          oldSub,
          nextSubOrNull,
          fallbackRid
        ),
      };
    };

    setExtraFoldersByRoot((prev) => {
      const list = prev[rid] || [];
      if (!list.length) return prev;
      const nextList = nextSubOrNull
        ? Array.from(new Set(list.map((f) => remapSubfolderPrefix(f, oldSub, nextSubOrNull))))
        : list.filter((f) => !isMatch(f));
      return { ...prev, [rid]: nextList };
    });

    if (rid === fallbackRid) {
      setExtraFolders((prev) =>
        nextSubOrNull
          ? Array.from(new Set(prev.map((f) => remapSubfolderPrefix(f, oldSub, nextSubOrNull))))
          : prev.filter((f) => !isMatch(f))
      );
    }

    setFolderFilter((prev) =>
      remapFolderSpecForTreeOp(prev, rid, oldSub, nextSubOrNull, fallbackRid)
    );
    setWallTree((prev) => mapWallNode(prev));
    setFolderCombos((prev) =>
      prev
        .map((c) => {
          if (!Array.isArray(c.paths)) return c;
          const nextPaths = [];
          for (const p of c.paths) {
            const parsed = parseScopedFolderPath(p, fallbackRid);
            if (parsed.rootId !== rid || parsed.isRootAll || parsed.subfolder === "(Root)") {
              nextPaths.push(p);
              continue;
            }
            if (!isMatch(parsed.subfolder)) {
              nextPaths.push(p);
              continue;
            }
            if (nextSubOrNull) {
              nextPaths.push(`${rid}::${nextSubOrNull}${parsed.subfolder.slice(oldSub.length)}`);
            }
          }
          return { ...c, paths: Array.from(new Set(nextPaths)) };
        })
        .filter((c) => !Array.isArray(c.paths) || c.paths.length > 0)
    );
  };

  const handleRenameFolder = async (subfolder, newName, targetRootId = "") => {
    const fallbackRid = roots[0]?.id || "root_1";
    const rid = targetRootId || fallbackRid;
    const res = await renameFolderRequest(subfolder, newName, rid);
    if (!res.ok || !res.newSubfolder) {
      if (res.notFound) {
        removeFolderFromLocalState(rid, normalizeSubfolder(subfolder));
        curation?.showToast?.("Folder already missing on disk — tree synced");
        void refreshLibrary({ silent: true });
        return res;
      }
      curation?.showToast?.(res.error || "Could not rename folder");
      return null;
    }

    const oldSub = res.oldSubfolder || normalizeSubfolder(subfolder);
    const newSub = res.newSubfolder;
    const targetRid = res.rootId || rid;
    lastMutationAtRef.current = Date.now();
    if (oldSub !== newSub) {
      const moves = [];
      setRawItems((prev) =>
        prev.map((it) => {
          const itemRid = it.root_id || fallbackRid;
          if (itemRid !== targetRid) return it;
          const curSub = normalizeSubfolder(it.subfolder);
          if (curSub !== oldSub && !curSub.startsWith(`${oldSub}/`)) return it;
          const nextSub = remapSubfolderPrefix(curSub, oldSub, newSub);
          const oldKey = itemKey(it);
          const nextItem = { ...it, subfolder: nextSub };
          const newKey = itemKey(nextItem);
          moves.push({ oldKey, newKey });
          return { ...nextItem, file_key: newKey, id: newKey };
        })
      );
      if (moves.length > 0) {
        curation?.migrateCurationKeys?.(moves);
        const moveSet = new Map(moves.map((m) => [m.oldKey, m.newKey]));
        setSelectedKeys((prev) => {
          if (!prev.size) return prev;
          const next = new Set();
          prev.forEach((k) => next.add(moveSet.get(k) || k));
          return next;
        });
      }
      applyTreeFolderStateChange(targetRid, oldSub, newSub);
      void refreshLibrary({ silent: true });
    }

    const oldLeaf = oldSub.split("/").pop();
    const newLeaf = newSub.split("/").pop();
    curation?.showToast?.(`Renamed "${oldLeaf}" → "${newLeaf}"`);
    return res;
  };

  const handleDeleteFolder = async (subfolder, targetRootId = "", confirmed = false) => {
    const fallbackRid = roots[0]?.id || "root_1";
    const rid = targetRootId || fallbackRid;
    const res = await deleteFolderRequest(subfolder, rid, confirmed);
    if (res.needsConfirm) return res;
    if (!res.ok) {
      if (res.notFound) {
        removeFolderFromLocalState(rid, normalizeSubfolder(subfolder));
        curation?.showToast?.("Folder already missing on disk — tree synced");
        void refreshLibrary({ silent: true });
        return res;
      }
      curation?.showToast?.(res.error || "Could not delete folder");
      return res;
    }

    const cleanSub = res.subfolder || normalizeSubfolder(subfolder);
    const targetRid = res.rootId || rid;
    lastMutationAtRef.current = Date.now();
    removeFolderFromLocalState(targetRid, cleanSub);
    void refreshLibrary({ silent: true });

    const leaf = cleanSub.split("/").pop();
    curation?.showToast?.(
      res.recycled
        ? `Sent "${leaf}" to Recycle Bin`
        : `Removed empty folder "${leaf}"`
    );
    return res;
  };

  const handleOpenFolderExplorer = async (subfolder, targetRootId = "") => {
    const fallbackRid = roots[0]?.id || "root_1";
    const rid = targetRootId || fallbackRid;
    const res = await openFolderExplorerRequest(subfolder, rid);
    if (!res.ok) {
      if (res.notFound && subfolder && subfolder !== "(Root)") {
        removeFolderFromLocalState(rid, normalizeSubfolder(subfolder));
        curation?.showToast?.("Folder already missing on disk — tree synced");
        void refreshLibrary({ silent: true });
        return res;
      }
      curation?.showToast?.(res.error || "Could not open Explorer");
    }
    return res;
  };

  const handleMoveItemsToFolder = async (itemsToMove, targetFolder) => {
    const arr = normalizeItemsArg(itemsToMove);
    if (!arr.length) return false;
    if (targetFolder === "__PURGATORY__") {
      return await handleSendToPurgatory(arr);
    }
    const fallbackRid = roots[0]?.id || "root_1";
    const parsedTarget = parseScopedFolderPath(String(targetFolder || ""), fallbackRid);
    const targetRootId = parsedTarget.rootId;
    const cleanDst =
      parsedTarget.subfolder === "(Root)" || parsedTarget.subfolder === "*"
        ? ""
        : String(parsedTarget.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const targetScoped = `${targetRootId}::${cleanDst || "(Root)"}`;

    const movable = arr.filter((it) => {
      const srcRid = it.root_id || fallbackRid;
      const srcSub = String(it.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      return !(srcRid === targetRootId && srcSub === cleanDst);
    });
    if (movable.length === 0) {
      curation?.showToast?.("Already inside this folder");
      return false;
    }

    const leavesActiveView =
      !purgatoryOpen &&
      appMode !== "wall" &&
      folderFilter !== "ALL" &&
      !searchAllFolders &&
      !matchesFolderSpec(cleanDst || "(Root)", folderFilter, folderCombos, true, false, targetRootId);

    const keys = movable.map(itemKey).filter(Boolean);
    const targets = leavesActiveView
      ? movable.map((it) => captureTileFxTarget(itemKey(it))).filter(Boolean)
      : [];

    if (leavesActiveView && targets.length > 0) {
      setVanishingKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.add(k));
        return next;
      });
    }

    try {
      const fxPromise =
        leavesActiveView && targets.length > 0 && fxOverlayRef.current
          ? fxOverlayRef.current.playFx({
              mode: "zap",
              targets,
              accentRgb: activeAccentRgb,
            })
          : Promise.resolve();

      const [, res] = await Promise.all([fxPromise, moveBatchItemsRequest(movable, targetScoped)]);
      lastMutationAtRef.current = Date.now();
      const movedList = Array.isArray(res?.moved) ? res.moved : [];
      if (movedList.length > 0) {
        const moveMap = new Map(movedList.map((m) => [m.oldKey, m]));
        setRawItems((prev) =>
          prev.map((it) => {
            const k = itemKey(it);
            const mv = moveMap.get(k);
            if (!mv) return it;
            return {
              ...it,
              filename: mv.filename,
              subfolder: mv.subfolder,
              root_id: mv.root_id || targetRootId,
              file_key: mv.newKey,
              id: mv.newKey,
            };
          })
        );
        curation?.migrateCurationKeys?.(movedList);
        setSelectedKeys((prev) => {
          if (!prev.size) return prev;
          const next = new Set(prev);
          movedList.forEach((m) => next.delete(m.oldKey));
          return next;
        });
        const dstRootLabel = roots.find((r) => r.id === targetRootId)?.label;
        const dstLabel =
          roots.length > 1 && dstRootLabel
            ? `${dstRootLabel} · ${cleanDst || "(Root)"}`
            : cleanDst || "Root";
        curation?.showToast?.(
          `Moved ${movedList.length} ${movedList.length === 1 ? "file" : "files"} to ${dstLabel}`
        );
      }
      if ((res?.failed?.length || 0) > 0 && movedList.length === 0) {
        curation?.showToast?.("Could not move files on drive");
      }
      return movedList.length > 0;
    } finally {
      if (leavesActiveView) {
        setVanishingKeys((prev) => {
          if (!prev.size) return prev;
          const next = new Set(prev);
          keys.forEach((k) => next.delete(k));
          return next;
        });
      }
    }
  };

  const handleCopyItemsToFolder = async (itemsToCopy, targetFolder = null) => {
    const arr = normalizeItemsArg(itemsToCopy);
    if (!arr.length) return false;
    const isDuplicateInPlace = targetFolder === null || targetFolder === undefined;
    const fallbackRid = roots[0]?.id || "root_1";
    let targetScoped = null;
    let dstLabel = "folder";
    if (!isDuplicateInPlace) {
      const parsed = parseScopedFolderPath(String(targetFolder), fallbackRid);
      const cleanDst =
        parsed.subfolder === "(Root)" || parsed.subfolder === "*"
          ? ""
          : String(parsed.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      targetScoped = `${parsed.rootId}::${cleanDst || "(Root)"}`;
      const dstRootLabel = roots.find((r) => r.id === parsed.rootId)?.label;
      dstLabel =
        roots.length > 1 && dstRootLabel
          ? `${dstRootLabel} · ${cleanDst || "(Root)"}`
          : cleanDst || "Root";
    }

    const res = await copyBatchItemsRequest(arr, targetScoped, {
      preferCopySuffix: isDuplicateInPlace,
    });
    lastMutationAtRef.current = Date.now();
    const copiedList = Array.isArray(res?.copied) ? res.copied : [];
    if (copiedList.length > 0) {
      await refreshLibrary({ silent: true });
      curation?.showToast?.(
        isDuplicateInPlace
          ? `Duplicated ${copiedList.length} clean ${copiedList.length === 1 ? "copy" : "copies"}`
          : `Copied ${copiedList.length} ${copiedList.length === 1 ? "file" : "files"} to ${dstLabel}`
      );
      return true;
    }
    curation?.showToast?.("Could not copy files on drive");
    return false;
  };

  const handleConfirmRemoveRoot = async (root, mixedPolicy = "strip") => {
    if (!root) return;
    try {
      const res = await fetch("/api/roots/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootId: root.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        curation?.showToast?.(data.error || "Could not remove root folder");
        return;
      }
      lastMutationAtRef.current = Date.now();

      const { nextCombos, nextWallPresets, nextWallTree, nextFolderFilter } =
        applyRootRemovalToState(
          root.id,
          { folderCombos, userWallPresets, wallTree, folderFilter },
          mixedPolicy
        );
      setFolderCombos(nextCombos);
      setUserWallPresets(nextWallPresets);
      if (nextWallTree) setWallTree(nextWallTree);
      setFolderFilter(nextFolderFilter);
      setPendingRemoveRoot(null);

      await refreshLibrary({ silent: true });
      curation?.showToast?.(`Removed "${root.label}" from gallery (files untouched on disk)`);
      if (!data.roots || data.roots.length === 0) {
        setWelcomeInitialTab("root");
        setWelcomeOpen(true);
      }
    } catch {
      curation?.showToast?.("Could not remove root folder");
    }
  };

  const handleReorderRoots = async (rootIds) => {
    try {
      const res = await fetch("/api/roots/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && Array.isArray(data.roots)) {
        setRoots(data.roots);
      }
    } catch {}
  };

  const dragCallbacksRef = useRef({});
  dragCallbacksRef.current = {
    handleMoveItemsToFolder,
    handleCopyItemsToFolder,
    dropActionMode,
  };

  const handleBeginTileDrag = (triggerItem, pt) => {
    if (!triggerItem || folderSidebarMode !== "static" || purgatoryOpen || drawerOpen) return;
    const k = itemKey(triggerItem);
    const inSel = selectedKeys.size > 0 && selectedKeys.has(k);
    const dragItems = inSel
      ? rawItems.filter((it) => selectedKeys.has(itemKey(it)) && !purgatorySet?.has?.(itemKey(it)))
      : [triggerItem];
    if (!dragItems.length) return;
    document.body.classList.add("hm-dragging-cards");
    setActiveDrag({
      items: dragItems,
      x: pt.x,
      y: pt.y,
      hoverTarget: null,
    });
  };

  useEffect(() => {
    if (!activeDrag) return undefined;
    const onMove = (e) => {
      const hit = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest?.("[data-drop-folder]")
        ?.getAttribute?.("data-drop-folder");
      setActiveDrag((prev) =>
        prev ? { ...prev, x: e.clientX, y: e.clientY, hoverTarget: hit || null } : null
      );
    };
    const finishDrag = (e) => {
      document.body.classList.remove("hm-dragging-cards");
      const hit = e
        ? document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest?.("[data-drop-folder]")
            ?.getAttribute?.("data-drop-folder")
        : null;
      const itemsSnap = activeDrag.items;
      setActiveDrag(null);
      if (!hit || !itemsSnap?.length) return;

      if (hit === "__PURGATORY__") {
        dragCallbacksRef.current.handleMoveItemsToFolder?.(itemsSnap, hit);
        return;
      }

      const modePref = dragCallbacksRef.current.dropActionMode || "ask";
      const effectiveAction = e?.ctrlKey ? "copy" : e?.shiftKey ? "move" : modePref;
      if (effectiveAction === "copy") {
        dragCallbacksRef.current.handleCopyItemsToFolder?.(itemsSnap, hit);
      } else if (effectiveAction === "move") {
        dragCallbacksRef.current.handleMoveItemsToFolder?.(itemsSnap, hit);
      } else {
        setPendingDropChoice({
          x: e?.clientX ?? 200,
          y: e?.clientY ?? 200,
          items: itemsSnap,
          targetScoped: hit,
        });
      }
    };
    const cancelDrag = () => finishDrag(null);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        document.body.classList.remove("hm-dragging-cards");
        setActiveDrag(null);
      }
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", finishDrag, true);
    window.addEventListener("pointercancel", cancelDrag, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.classList.remove("hm-dragging-cards");
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finishDrag, true);
      window.removeEventListener("pointercancel", cancelDrag, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [Boolean(activeDrag)]);

  // Windows Explorer drag-and-drop copy/import handler
  const externalDropCtxRef = useRef({});
  externalDropCtxRef.current = {
    roots,
    folderFilter,
    purgatoryOpen,
    refreshLibrary,
    appMode,
    zones,
    blocked: Boolean(
      purgatoryOpen ||
        drawerOpen ||
        welcomeOpen ||
        addRootOpen ||
        pendingRemoveRoot ||
        inspectPayload ||
        filterModalOpen ||
        treeModalTarget ||
        noteTarget ||
        tourOpen ||
        pendingDropChoice ||
        pendingDiscardIntent ||
        screensaverActive
    ),
  };

  useEffect(() => {
    let dragDepth = 0;
    const SUPPORTED_EXT_RE = /\.(png|jpe?g|webp|mp4|webm|mov)$/i;

    const isExternalFileDrag = (e) => {
      const types = e?.dataTransfer?.types;
      if (!types) return false;
      return Array.from(types).includes("Files");
    };

    const resolveExternalTarget = (clientX, clientY) => {
      const ctx = externalDropCtxRef.current;
      const mountedRoots = ctx.roots || [];
      if (!mountedRoots.length) return null;
      const fallbackRid = mountedRoots[0]?.id || "root_1";
      const elUnder =
        typeof clientX === "number" && typeof clientY === "number"
          ? document.elementFromPoint(clientX, clientY)
          : null;
      const hit = elUnder?.closest?.("[data-drop-folder]")?.getAttribute?.("data-drop-folder");

      let chosenSpec = hit && hit !== "__PURGATORY__" ? hit : null;
      const fromSidebar = Boolean(chosenSpec);
      if (!chosenSpec && ctx.appMode === "wall" && elUnder) {
        const zoneId = elUnder.closest?.("[data-zone-id]")?.getAttribute?.("data-zone-id");
        const hoveredZone = zoneId ? (ctx.zones || []).find((z) => z.id === zoneId) : null;
        const zf = hoveredZone?.folderFilter;
        if (typeof zf === "string" && zf !== "ALL") {
          chosenSpec = zf;
        } else if (zf && typeof zf === "object" && zf.type === "custom" && zf.paths?.length === 1) {
          chosenSpec = zf.paths[0];
        }
      }
      if (!chosenSpec) {
        const ff = ctx.folderFilter;
        if (typeof ff === "string" && ff !== "ALL") {
          chosenSpec = ff;
        } else if (ff && typeof ff === "object" && ff.type === "custom" && ff.paths?.length === 1) {
          chosenSpec = ff.paths[0];
        } else {
          chosenSpec = `${fallbackRid}::(Root)`;
        }
      }

      const parsed = parseScopedFolderPath(String(chosenSpec), fallbackRid);
      const sub =
        parsed.subfolder === "(Root)" || parsed.subfolder === "*"
          ? ""
          : String(parsed.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      const rootEntry = mountedRoots.find((r) => r.id === parsed.rootId) || mountedRoots[0];
      const rid = rootEntry?.id || parsed.rootId;
      const rootLabel = rootEntry?.label || "Library";
      const label =
        mountedRoots.length > 1
          ? `${rootLabel} · ${sub || "(Root)"}`
          : sub || `${rootLabel} · (Root)`;
      return {
        rootId: rid,
        subfolder: sub,
        targetScoped: `${rid}::${sub || "(Root)"}`,
        label,
        fromSidebar,
      };
    };

    const clearHover = () => {
      dragDepth = 0;
      setExternalDragHover(null);
    };

    const onDragEnter = (e) => {
      if (!isExternalFileDrag(e)) return;
      const ctx = externalDropCtxRef.current;
      if (!ctx.roots?.length || ctx.blocked) return;
      e.preventDefault();
      dragDepth += 1;
      const target = resolveExternalTarget(e.clientX, e.clientY);
      if (target) setExternalDragHover(target);
    };

    const onDragOver = (e) => {
      if (!isExternalFileDrag(e)) return;
      const ctx = externalDropCtxRef.current;
      if (!ctx.roots?.length || ctx.blocked) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      const target = resolveExternalTarget(e.clientX, e.clientY);
      if (target) {
        setExternalDragHover((prev) =>
          prev &&
          prev.targetScoped === target.targetScoped &&
          prev.fromSidebar === target.fromSidebar
            ? prev
            : target
        );
      }
    };

    const onDragLeave = (e) => {
      if (!isExternalFileDrag(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 || e.relatedTarget === null) {
        clearHover();
      }
    };

    const onDrop = async (e) => {
      if (!isExternalFileDrag(e)) return;
      const ctx = externalDropCtxRef.current;
      if (!ctx.roots?.length || ctx.blocked) {
        clearHover();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const target = resolveExternalTarget(e.clientX, e.clientY);
      const dtItems = Array.from(e.dataTransfer?.items || []);
      const droppedFiles = [];
      let skippedLocalCount = 0;
      if (dtItems.length > 0) {
        for (const item of dtItems) {
          if (item.kind !== "file") continue;
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) {
            skippedLocalCount++;
            continue;
          }
          const f = item.getAsFile?.();
          if (!f) continue;
          if (!SUPPORTED_EXT_RE.test(f.name || "")) {
            skippedLocalCount++;
            continue;
          }
          droppedFiles.push(f);
        }
      } else {
        for (const f of Array.from(e.dataTransfer?.files || [])) {
          if (!SUPPORTED_EXT_RE.test(f.name || "")) {
            skippedLocalCount++;
            continue;
          }
          droppedFiles.push(f);
        }
      }
      clearHover();
      if (!target) return;
      if (droppedFiles.length === 0) {
        if (skippedLocalCount > 0) {
          showToastRef.current?.("Only supported image/video files can be imported (folders skipped)");
        }
        return;
      }
      if (importingFilesRef.current) {
        showToastRef.current?.("Import already in progress…");
        return;
      }

      const form = new FormData();
      form.append("targetRootId", target.rootId);
      form.append("targetSubfolder", target.subfolder);
      droppedFiles.forEach((f) => form.append("files", f, f.name));

      importingFilesRef.current = true;
      setImportingFiles(true);
      lastMutationAtRef.current = Date.now();
      try {
        const res = await fetch("/api/import-files", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        const impCount = Array.isArray(data?.imported) ? data.imported.length : 0;
        const skipCount =
          skippedLocalCount + (Array.isArray(data?.skipped) ? data.skipped.length : 0);
        if (impCount > 0) {
          lastMutationAtRef.current = Date.now();
          await ctx.refreshLibrary?.({ silent: true });
          const skipSuffix = skipCount > 0 ? ` (${skipCount} skipped)` : "";
          showToastRef.current?.(
            `Copied ${impCount} ${impCount === 1 ? "file" : "files"} into ${target.label}${skipSuffix}`
          );
        } else if (skipCount > 0) {
          showToastRef.current?.("No supported image or video files in drop");
        } else {
          showToastRef.current?.(data?.error || "Could not import dropped files");
        }
      } catch {
        showToastRef.current?.("Import upload failed");
      } finally {
        importingFilesRef.current = false;
        setImportingFiles(false);
      }
    };

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("blur", clearHover);
    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("blur", clearHover);
    };
  }, []);

  const handlePermanentBurn = async (itemsOrOne, explicitEl = null) => {
    const arr = normalizeItemsArg(itemsOrOne);
    if (arr.length === 0) return false;
    const keys = arr.map(itemKey).filter(Boolean);
    const fxMode = curation?.deleteFx || "ember";
    const targets = arr
      .map((it, idx) => captureTileFxTarget(itemKey(it), idx === 0 ? explicitEl : null))
      .filter(Boolean);

    setPurgatoryBusy(true);
    setVanishingKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });

    try {
      const fxPromise =
        targets.length > 0 && fxOverlayRef.current
          ? fxOverlayRef.current.playFx({
              mode: fxMode,
              targets,
              accentRgb: activeAccentRgb,
            })
          : Promise.resolve();

      const apiPromise =
        arr.length === 1
          ? recycleItemRequest(arr[0], { permanent: true }).then((ok) => ({
              ok,
              deleted: ok ? [itemKey(arr[0])] : [],
              failed: ok ? [] : [{ key: itemKey(arr[0]) }],
            }))
          : batchDeleteItemsRequest(arr, { permanent: true });

      const [, res] = await Promise.all([fxPromise, apiPromise]);
      lastMutationAtRef.current = Date.now();
      const deletedList = Array.isArray(res?.deleted) ? res.deleted : [];
      if (deletedList.length > 0) {
        const delSet = new Set(deletedList);
        setRawItems((prev) => prev.filter((it) => !delSet.has(itemKey(it))));
        curation?.purgeCurationKeys?.(deletedList);
        setSelectedKeys((prev) => {
          if (!prev.size) return prev;
          const next = new Set(prev);
          deletedList.forEach((k) => next.delete(k));
          return next;
        });
      }
      if (!res?.ok || (res?.failed?.length || 0) > 0) {
        const failCount = res?.failed?.length || arr.length;
        curation?.showToast?.(
          deletedList.length > 0
            ? `Burned ${deletedList.length} from SSD (${failCount} failed)`
            : "Could not permanently erase file(s) from drive"
        );
      } else {
        curation?.showToast?.(
          deletedList.length === 1
            ? "Permanently erased from SSD"
            : `Purged ${deletedList.length} files from SSD`
        );
      }
      return deletedList.length > 0;
    } finally {
      setPurgatoryBusy(false);
      setVanishingKeys((prev) => {
        if (!prev.size) return prev;
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }
  };

  kbHandlersRef.current = {
    selectedCount: selectedKeys.size,
    purgatoryOpen,
    drawerOpen,
    appMode,
    rawItemMap,
    clearSelection: () => setSelectedKeys(new Set()),
    getSelectedItems: () =>
      rawItems.filter((it) => selectedKeys.has(itemKey(it)) && !purgatorySet?.has?.(itemKey(it))),
    selectAllVisible: () => {
      const targetItems =
        appMode === "wall" && activeZone
          ? filterAndSortItems(
              rawItems,
              activeZone.folderFilter || "ALL",
              search,
              activeZone.sortBy || sortBy,
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
            )
          : singleFilteredItems;
      const next = new Set();
      targetItems.forEach((it) => {
        const k = itemKey(it);
        if (k) next.add(k);
      });
      setSelectedKeys(next);
      const scopeMsg = appMode === "wall" ? " in active zone" : "";
      curation?.showToast?.(
        next.size > 0
          ? `Selected ${next.size} items${scopeMsg} (Esc to clear)`
          : "No visible items to select"
      );
    },
    toggleBatchFavorite: (items) => {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return;
      const anyUnfav = list.some((it) => !curation?.isFavorited?.(it));
      let changed = 0;
      list.forEach((it) => {
        const fav = Boolean(curation?.isFavorited?.(it));
        if (anyUnfav && !fav) {
          curation?.toggleFavorite?.(it, true);
          changed++;
        } else if (!anyUnfav && fav) {
          curation?.toggleFavorite?.(it, true);
          changed++;
        }
      });
      curation?.showToast?.(
        anyUnfav
          ? `Favorited ${changed} selected`
          : `Removed ${changed} from Favorites`
      );
    },
    handleSendToPurgatory,
    handleRescueFromPurgatory,
    handlePermanentBurn,
  };

  const handleClassicTileClick = (e, item, scopeItems = singleFilteredItems) => {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return false;
    const k = itemKey(item);
    if (!k) return false;
    e.preventDefault();
    e.stopPropagation();

    const list = Array.isArray(scopeItems) ? scopeItems : singleFilteredItems;
    if (e.shiftKey && lastSelectedKeyRef.current) {
      const idxA = list.findIndex((it) => itemKey(it) === lastSelectedKeyRef.current);
      const idxB = list.findIndex((it) => itemKey(it) === k);
      if (idxA >= 0 && idxB >= 0) {
        const lo = Math.min(idxA, idxB);
        const hi = Math.max(idxA, idxB);
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) {
            next.add(itemKey(list[i]));
          }
          return next;
        });
        lastSelectedKeyRef.current = k;
        return true;
      }
    }

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    lastSelectedKeyRef.current = k;
    return true;
  };

  const activeStageEngineCfg =
    drawerEngineMode === "classic"
      ? drawerClassicCfg
      : drawerEngineMode === "slideshow"
      ? drawerSlideshowCfg
      : drawerConveyorCfg;

  const handleToggleStagePause = () => {
    const nextPaused = !activeStageEngineCfg.paused;
    if (drawerEngineMode === "slideshow") patchSlideshow({ paused: nextPaused });
    else if (drawerEngineMode === "conveyor") patchConveyor({ paused: nextPaused });
    else patchClassic({ paused: nextPaused });
  };

  const handleToggleStageLabels = () => {
    const nextShow = !(activeStageEngineCfg.showMetadata ?? true);
    if (drawerEngineMode === "classic") patchClassic({ showMetadata: nextShow });
    else if (drawerEngineMode === "conveyor") patchConveyor({ showMetadata: nextShow });
  };

  const resolvedRadialMenu = useMemo(() => {
    if (!radialMenu) return null;
    if (radialMenu.kind === "tile" && radialMenu.item) {
      const targetKey = itemKey(radialMenu.item);
      const inMultiSelection =
        !purgatoryOpen &&
        appMode !== "slideshow" &&
        selectedKeys.size > 1 &&
        selectedKeys.has(targetKey);
      const radialTargets = inMultiSelection
        ? rawItems.filter(
            (it) => selectedKeys.has(itemKey(it)) && !purgatorySet?.has?.(itemKey(it))
          )
        : radialMenu.item;
      const batchCount = Array.isArray(radialTargets) ? radialTargets.length : 1;

      return {
        ...radialMenu,
        title: batchCount > 1 ? `${batchCount} selected renders` : radialMenu.item.filename,
        items: buildTileRadialItems({
          item: radialMenu.item,
          curation,
          comfyOnline,
          inPurgatoryView: purgatoryOpen,
          batchCount,
          onOpenNote: (it) => setNoteTarget({ item: it, x: radialMenu.x, y: radialMenu.y }),
          onDuplicateItem: () => handleCopyItemsToFolder(radialTargets, null),
          onSendToPurgatory: () => handleSendToPurgatory(radialTargets),
          onRescueFromPurgatory: () => handleRescueFromPurgatory(radialTargets),
          onBurnItem: () => handlePermanentBurn(radialTargets),
        }),
      };
    }
    return {
      ...radialMenu,
      title: purgatoryOpen
        ? "Purgatory Mode"
        : appMode === "wall"
        ? "Wall Stage"
        : appMode === "slideshow"
        ? "Slideshow"
        : appMode === "conveyor"
        ? "Conveyor"
        : "Classic Grid",
      items: buildStageRadialItems({
        appMode,
        isPaused: Boolean(activeStageEngineCfg.paused),
        showMetadata: activeStageEngineCfg.showMetadata ?? true,
        sortBy,
        searchFavOnly,
        curation,
        onToggleCustomize: () => (drawerOpen ? handleSaveChanges() : openDrawer()),
        onSwitchMode: handleSwitchAppMode,
        onTogglePause: handleToggleStagePause,
        onToggleLabels: handleToggleStageLabels,
        onChangeSort: setSortBy,
        onReshuffle: () => setShuffleSeed((s) => s + 1),
        onToggleSearchFav: () => setSearchFavOnly((v) => !v),
        onOpenFolderTree: () => handleOpenTreeModal(null),
      }),
    };
  }, [
    radialMenu,
    comfyOnline,
    curation,
    appMode,
    purgatoryOpen,
    selectedKeys,
    singleFilteredItems,
    activeStageEngineCfg,
    sortBy,
    searchFavOnly,
    drawerOpen,
  ]);

  const openGalleryRadialAt = (clientX, clientY, targetEl) => {
    const tag = targetEl?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      setRadialMenu(null);
      return;
    }
    if (!targetEl?.closest?.(".cb-stage-viewport") || targetEl?.closest?.(".cb-slideshow-stage")) {
      setRadialMenu(null);
      return;
    }
    const tileFx = targetEl
      ?.closest?.(".cb-tile")
      ?.querySelector?.(".cb-tile-fx[data-lb-key]");
    const key = tileFx?.getAttribute?.("data-lb-key");
    const item = key ? rawItemMap.get(key) : null;
    if (item) {
      checkComfyStatus().then(setComfyOnline);
    }
    setRadialMenu({
      kind: item ? "tile" : "stage",
      item: item || null,
      x: clientX,
      y: clientY,
      openedAt: performance.now(),
      fromPointerDown: true,
    });
  };

  const openLightboxPayload = (nextPayload) => {
    if (
      typeof window !== "undefined" &&
      performance.now() - (window.__hmRadialDismissedAt || 0) < 260
    ) {
      return;
    }
    setInspectPayload(nextPayload);
  };

  useEffect(() => {
    if (!curation?.setRadialLockedKey) return;
    if (radialMenu?.kind === "tile" && radialMenu?.item) {
      curation.setRadialLockedKey(itemKey(radialMenu.item));
    } else {
      curation.setRadialLockedKey("");
    }
  }, [radialMenu, curation?.setRadialLockedKey]);

  // Lightbox clicks are intentionally paused while Drawer is open
  const handleInspectSingle = (payload) => {
    const modeLabel =
      appMode === "conveyor"
        ? "Conveyor Mode"
        : appMode === "slideshow"
        ? "Slideshow"
        : "Classic Mode";
    openLightboxPayload(
      payload && typeof payload === "object" && payload.item
        ? { ...payload, sourceLabel: payload.sourceLabel || modeLabel }
        : { item: payload, items: singleFilteredItems, sourceLabel: modeLabel }
    );
  };
  const safeInspectSingle = drawerOpen ? undefined : handleInspectSingle;

  const classicResetKey = `${typeof folderFilter === "string" ? folderFilter : JSON.stringify(folderFilter)}|${search}|${sortBy}|${shuffleSeed}|${searchFavOnly}|${searchAllFolders}`;

  const renderMainStage = () => {
    if (purgatoryOpen) {
      return (
        <PurgatoryView
          items={purgatoryItems}
          cfg={purgatoryCfg}
          vanishingKeys={vanishingKeys}
          purging={purgatoryBusy}
          onExit={() => setPurgatoryOpen(false)}
          onRescueAll={() => curation?.clearPurgatory?.()}
          onPurgeAll={(list) => handlePermanentBurn(list)}
          onOpenCustomize={openDrawer}
          onInspect={
            drawerOpen
              ? undefined
              : (payload) =>
                  openLightboxPayload(
                    payload && typeof payload === "object" && payload.item
                      ? { ...payload, sourceLabel: "Purgatory" }
                      : { item: payload, items: purgatoryItems, sourceLabel: "Purgatory" }
                  )
          }
        />
      );
    }
    if (appMode === "classic") {
      const cfg = singleCfgs.classic;
      return (
        <ClassicGridEngine
          items={singleFilteredItems}
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
          isActiveZone={true}
          resetKey={classicResetKey}
          selectedKeys={selectedKeys}
          vanishingKeys={vanishingKeys}
          onTileClick={handleClassicTileClick}
          onClearSelection={() => setSelectedKeys(new Set())}
          dragToMoveEnabled={folderSidebarMode === "static" && !purgatoryOpen && !drawerOpen}
          isDraggingFiles={Boolean(activeDrag)}
          onBeginTileDrag={handleBeginTileDrag}
          onInspect={safeInspectSingle}
        />
      );
    }
    if (appMode === "conveyor") {
      const cfg = singleCfgs.conveyor;
      return (
        <ConveyorBrick
          items={singleFilteredItems}
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
          isActiveZone={true}
          selectedKeys={selectedKeys}
          vanishingKeys={vanishingKeys}
          onTileClick={handleClassicTileClick}
          onClearSelection={() => setSelectedKeys(new Set())}
          dragToMoveEnabled={folderSidebarMode === "static" && !purgatoryOpen && !drawerOpen}
          isDraggingFiles={Boolean(activeDrag)}
          onBeginTileDrag={handleBeginTileDrag}
          onInspect={safeInspectSingle}
        />
      );
    }
    if (appMode === "slideshow") {
      const cfg = singleCfgs.slideshow;
      return (
        <SlideshowEngine
          items={singleFilteredItems}
          cfg={cfg}
          isActiveZone={true}
          lightboxOpen={Boolean(inspectPayload) || screensaverActive}
          editing={drawerOpen}
          onInspect={safeInspectSingle}
          onPatchCfg={patchSlideshow}
          onOpenDrawer={openDrawer}
        />
      );
    }

    return (
      <ZoneWallRenderer
        tree={wallTree}
        seamGap={seamGap}
        editing={drawerOpen}
        blueprintMode={blueprintMode}
        soloZoneId={soloZoneId}
        activeZoneId={activeZone.id}
        hoveredBarZoneId={hoveredBarZoneId}
        pulsingZoneId={pulseZoneId}
        rawItems={rawItems}
        globalFolder={folderFilter}
        globalSearch={search}
        globalSort={sortBy}
        shuffleSeed={shuffleSeed}
        roots={roots}
        folderCombos={folderCombos}
        searchFavOnly={searchFavOnly}
        searchAllFolders={searchAllFolders}
        advancedFilter={advancedFilter}
        allZonePresets={allZonePresets}
        swapSourceId={swapSourceId}
        lightboxOpen={Boolean(inspectPayload) || screensaverActive}
        selectedKeys={selectedKeys}
        vanishingKeys={vanishingKeys}
        dragToMoveEnabled={folderSidebarMode === "static" && !purgatoryOpen && !drawerOpen}
        isDraggingFiles={Boolean(activeDrag)}
        onTileClick={handleClassicTileClick}
        onClearSelection={() => setSelectedKeys(new Set())}
        onBeginTileDrag={handleBeginTileDrag}
        onSelectZone={handleSelectWallZone}
        onSplitZone={handleSplitZone}
        onToggleSolo={setSoloZoneId}
        onTriggerSwap={handleTriggerSwap}
        onRemoveZone={handleRemoveZone}
        onUpdateRatio={handleUpdateRatio}
        onInspect={openLightboxPayload}
        onPatchZoneSlideshowCfg={patchZoneSlideshowCfg}
        onOpenZoneDrawer={openZoneInDrawer}
        onOpenZoneTree={(zid) => handleOpenTreeModal(zid)}
        onResetZoneAll={(zid) => handleSetZoneFolder(zid, "ALL")}
      />
    );
  };

  return (
    <div className={`cb-app ${peekLabels ? "is-peeking-labels" : ""}`}>
      {/* Whisper-Quiet Top Bar: 4 Modes + Search + Customize */}
      <header className="hm-topbar hm-topbar-quiet">
        <div className="hm-topbar-row">
          <div className="hm-brand">
            <div className="hm-crest-seal">
              <svg viewBox="0 0 1024 960" width="18" height="18" fill="currentColor">
                <path d={HAMMELART_CREST_PATH} />
              </svg>
            </div>
            <div>
              <div className="hm-brand-title">
                HAMMELART <span className="hm-pill-tag">ATELIER</span>
              </div>
              <div className="hm-brand-sub">
                {rawItems.length} renders •{" "}
                {purgatoryOpen
                  ? `Purgatory (${livePurgatoryCount})`
                  : appMode === "wall"
                  ? `Wall (${totalZones} ${totalZones === 1 ? "Zone" : "Zones"})`
                  : appMode === "slideshow"
                  ? "Slideshow"
                  : appMode === "conveyor"
                  ? "Conveyor"
                  : "Classic"}
              </div>
            </div>
          </div>

          <div className="hm-topbar-center">
            <nav className="hm-mode-nav" aria-label="Gallery Modes">
              <button
                type="button"
                className={`hm-mode-pill ${!purgatoryOpen && appMode === "classic" ? "active" : ""}`}
                onClick={() => handleSwitchAppMode("classic")}
              >
                <LayoutGrid size={13} /> Classic Mode
              </button>
              <button
                type="button"
                className={`hm-mode-pill ${!purgatoryOpen && appMode === "conveyor" ? "active" : ""}`}
                onClick={() => handleSwitchAppMode("conveyor")}
              >
                <GitCommitHorizontal size={13} /> Conveyor Mode
              </button>
              <button
                type="button"
                className={`hm-mode-pill ${!purgatoryOpen && appMode === "slideshow" ? "active" : ""}`}
                onClick={() => handleSwitchAppMode("slideshow")}
              >
                <Presentation size={13} /> Slideshow
              </button>
              <button
                type="button"
                className={`hm-mode-pill ${!purgatoryOpen && appMode === "wall" ? "active" : ""}`}
                onClick={() => handleSwitchAppMode("wall")}
              >
                <Layers size={13} /> Wall Mode
              </button>
            </nav>

            <FolderSourceBar
              appMode={appMode}
              purgatoryOpen={purgatoryOpen}
              folders={folders}
              roots={roots}
              singleFolderSpec={folderFilter}
              onSetSingleFolder={handleSelectFolderFilter}
              zones={zones}
              activeZoneId={activeZone.id}
              onSelectZoneTarget={setActiveZoneId}
              onHoverWallZone={setHoveredBarZoneId}
              onSetZoneFolder={handleSetZoneFolder}
              folderCombos={folderCombos}
              onDeleteCombo={handleDeleteFolderCombo}
              onOpenTreeModal={handleOpenTreeModal}
              folderSidebarMode={folderSidebarMode}
              onChangeFolderSidebarMode={setFolderSidebarMode}
            />
          </div>

          <div className="hm-toolbar-group">
            <div className="hm-search-box">
              <Search size={13} style={{ color: "var(--stage-text-muted)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prompt, model, note, seed..."
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
                >
                  <X size={12} />
                </button>
              )}
              <button
                type="button"
                className={`hm-search-chip ${searchFavOnly ? "active" : ""}`}
                onClick={() => setSearchFavOnly((v) => !v)}
                title={
                  searchFavOnly
                    ? "Showing Favorites Only (click to show all)"
                    : "Filter current view to Favorites only"
                }
              >
                <FavMark favIcon={favIcon} filled={searchFavOnly} size={12} />
              </button>
              <button
                type="button"
                className={`hm-search-chip wide ${searchAllFolders ? "active" : ""}`}
                onClick={() => setSearchAllFolders((v) => !v)}
                title={
                  searchAllFolders
                    ? "Searching across ALL folders (click to scope back to active folder)"
                    : "Expand search & Favorites filter across ALL folders"
                }
              >
                <Globe size={11} />
                <span>All</span>
              </button>

              {activeAdvCount === 0 ? (
                <button
                  type="button"
                  className="hm-search-chip hm-filter-open-btn"
                  onClick={() => setFilterModalOpen(true)}
                  title="Detailed Filters (file size, megapixels, aspect ratios, date, workflow…)"
                  aria-label="Open Detailed Filters"
                >
                  <SlidersHorizontal size={11} />
                </button>
              ) : (
                <span className="hm-filter-split-pill">
                  <button
                    type="button"
                    className="hm-search-chip wide active"
                    onClick={() => setFilterModalOpen(true)}
                    title={`Edit ${activeAdvCount} active detailed filter${activeAdvCount === 1 ? "" : "s"}`}
                    aria-label="Edit Detailed Filters"
                  >
                    <SlidersHorizontal size={11} />
                    <span>{activeAdvCount}</span>
                  </button>
                  <button
                    type="button"
                    className="hm-search-chip active hm-filter-split-clear"
                    onClick={() => setAdvancedFilter(DEFAULT_ADVANCED_FILTER)}
                    title="Turn off Detailed Filters (snap back to base view)"
                    aria-label="Clear Detailed Filters"
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
            </div>

            {hasAnyTempFilter && (
              <button
                type="button"
                className="hm-btn hm-search-reset-all"
                onClick={clearAllTempFilters}
                title="Reset Search, Favorites, All & Detailed Filters back to your saved view"
                aria-label="Reset all active filters"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            )}

            {appMode !== "slideshow" && (
              <button
                type="button"
                className={`hm-btn hm-peek-btn ${peekLabels ? "active" : ""}`}
                onPointerDown={(e) => {
                  if (e.button === 0) {
                    e.preventDefault();
                    setPeekLabels(true);
                  }
                }}
                title="Hold to reveal all card hover labels (or hold V)"
              >
                <Eye size={13} />
                <span>Peek</span>
              </button>
            )}

            <button
              type="button"
              className={`hm-btn hm-purgatory-pill ${
                livePurgatoryCount > 0 ? "has-items" : ""
              } ${purgatoryOpen ? "active" : ""} ${purgatoryPulsing ? "is-pulsing" : ""}`}
              onClick={() => {
                if (drawerOpen) requestGuardedCloseDrawer("purgatory");
                else setPurgatoryOpen((v) => !v);
              }}
              title={
                livePurgatoryCount > 0
                  ? `Open Purgatory (${livePurgatoryCount} staged for review/purge)`
                  : "Open Purgatory staging tray"
              }
            >
              <Flame size={13} />
              <span>Purgatory</span>
              <span className="hm-purgatory-badge">{livePurgatoryCount}</span>
            </button>

            <button
              type="button"
              className={`hm-btn hm-customize-btn ${drawerOpen ? "active" : ""}`}
              onClick={() => (drawerOpen ? handleSaveChanges() : openDrawer())}
              title={
                drawerOpen
                  ? "Save changes and return to 100% gallery"
                  : "Open mode settings drawer (scales gallery live beside menu)"
              }
            >
              <SlidersHorizontal size={13} />
              {drawerOpen ? "Editing…" : !purgatoryOpen && appMode === "wall" ? "Edit Wall" : "Customize"}
            </button>

            <button
              type="button"
              className={`hm-btn hm-help-btn ${welcomeOpen || tourOpen ? "active" : ""} ${
                updateInfo?.updateAvailable ? "has-update" : ""
              }`}
              onClick={() => {
                setTourOpen(false);
                setWelcomeInitialTab(updateInfo?.updateAvailable ? "updates" : "welcome");
                setWelcomeOpen(true);
              }}
              title={
                updateInfo?.updateAvailable
                  ? `Update available (v${updateInfo.latestVersion}) — Click to view`
                  : "Welcome Guide, First Root Folder & Un-Blur UI Tour"
              }
              aria-label={
                updateInfo?.updateAvailable
                  ? `Update available (v${updateInfo.latestVersion})`
                  : "Open Welcome Guide & UI Tour"
              }
            >
              <HelpCircle size={14} />
              {updateInfo?.updateAvailable ? (
                <span className="hm-update-dot" aria-hidden="true" />
              ) : null}
            </button>
          </div>
        </div>
      </header>

      {/* Main Split Workspace: Switchable Left/Right Drawer + Live Aspect-True Gallery Stage */}
      <main className={`cb-drawer-shell dock-${dockSide}`}>
        <CustomizeDrawer
          isOpen={drawerOpen}
          dockSide={dockSide}
          onSetDockSide={setDockSide}
          folderSidebarMode={folderSidebarMode}
          onSetFolderSidebarMode={setFolderSidebarMode}
          appMode={appMode}
          isDirty={isDrawerDirty}
          onSaveChanges={handleSaveChanges}
          onCancel={() => requestGuardedCloseDrawer("close")}
          activeTab={drawerTab}
          onSelectTab={handleSelectDrawerTab}
          blueprintMode={blueprintMode}
          onToggleBlueprintMode={(val) => {
            setBlueprintMode(val);
            if (!val) setSwapSourceId(null);
          }}
          zones={zones}
          totalZones={totalZones}
          activeZone={activeZone}
          activeZoneNumber={activeZoneNumber}
          seamGap={seamGap}
          onUpdateSeamGap={setSeamGap}
          builtinWallPresets={builtinWallPresets}
          userWallPresets={userWallPresets}
          activeWallPresetId={activeWallPresetId}
          targetUserWallPreset={targetUserWallPreset}
          isWallDirty={isWallDirty}
          onApplyWallPreset={handleApplyWallPreset}
          onUpdateUserWallPreset={handleUpdateUserWallPreset}
          onSaveNewUserWallPreset={handleSaveNewUserWallPreset}
          onDeleteUserWallPreset={handleDeleteUserWallPreset}
          onSplitZone={handleSplitZone}
          onRemoveZone={handleRemoveZone}
          onTriggerSwap={handleTriggerSwap}
          swapSourceId={swapSourceId}
          soloZoneId={soloZoneId}
          onToggleSolo={setSoloZoneId}
          onSetZoneFolder={handleSetZoneFolder}
          onSetZoneSort={handleSetZoneSort}
          engineMode={drawerEngineMode}
          onChangeZoneEngineMode={handleChangeZoneEngineMode}
          conveyorCfg={drawerConveyorCfg}
          classicCfg={drawerClassicCfg}
          slideshowCfg={drawerSlideshowCfg}
          patchConveyor={patchConveyor}
          patchClassic={patchClassic}
          patchSlideshow={patchSlideshow}
          onResetEngineDefaults={handleResetEngineDefaults}
          allZonePresets={allZonePresets}
          userPresets={userPresets}
          activePresetId={drawerActivePresetId}
          targetUserPreset={targetUserPreset}
          isPresetDirty={isPresetDirty}
          onApplyPreset={applyPreset}
          onUpdateUserPreset={updateUserPreset}
          onSaveNewUserPreset={saveNewUserPreset}
          onDeleteUserPreset={deleteUserPreset}
          folders={folders}
          folderFilter={folderFilter}
          setFolderFilter={handleSelectFolderFilter}
          folderCombos={folderCombos}
          onOpenTreeModal={handleOpenTreeModal}
          sortBy={sortBy}
          setSortBy={setSortBy}
          onReshuffle={() => setShuffleSeed((s) => s + 1)}
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
          activeRootPath={activeRootPath}
          roots={roots}
          onOpenAddRootModal={() => setAddRootOpen(true)}
          onRequestRemoveRoot={(r) => setPendingRemoveRoot(r)}
          onReorderRoots={handleReorderRoots}
          dropActionMode={dropActionMode}
          setDropActionMode={setDropActionMode}
          purgatoryOpen={purgatoryOpen}
          purgatoryCfg={purgatoryCfg}
          patchPurgatory={patchPurgatory}
          purgatoryCount={livePurgatoryCount}
          onRescueAllPurgatory={() => curation?.clearPurgatory?.()}
        />

        <section
          ref={viewportRef}
          className={`cb-stage-viewport ${drawerOpen ? "is-preview-scaled" : ""}`}
          onContextMenu={(e) => {
            const tag = e.target?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;
            e.preventDefault();
          }}
          onPointerDown={(e) => {
            if (
              e.button !== 2 ||
              drawerOpen ||
              (inspectPayload && !lightboxExiting) ||
              treeModalTarget ||
              noteTarget
            ) {
              return;
            }
            openGalleryRadialAt(e.clientX, e.clientY, e.target);
          }}
        >
          {drawerOpen && (
            <div className="cb-preview-banner">
              <span>LIVE {formatAspectTag(fullStageAspect)} PREVIEW</span>
              <span>•</span>
              <span>
                {isWallMode
                  ? blueprintMode
                    ? "Hover Zone edges to + Split • Drag dividers to resize"
                    : "Click any Zone box to tune • Drag borders to resize • Lightbox paused"
                  : "Hover & scroll preview active • Lightbox paused until Save Changes"}
              </span>
            </div>
          )}

          <div
            className={`cb-stage-frame ${drawerOpen ? "is-framed" : ""}`}
            style={previewFrameStyle}
          >
            {renderMainStage()}
          </div>

          {(externalDragHover || importingFiles) && (
            <div className="hm-ext-drop-pill" role="status" aria-live="polite">
              <Upload size={14} className="hm-ext-drop-ico" />
              <span>
                {importingFiles
                  ? "Copying files into gallery…"
                  : `Drop to Copy into ${externalDragHover.label}`}
              </span>
            </div>
          )}

          {!purgatoryOpen && !drawerOpen && appMode !== "slideshow" && selectedKeys.size > 0 && (
            <div className="hm-select-dock" role="region" aria-label="Multi-selection actions">
              <span className="hm-select-count">
                {selectedKeys.size} selected
              </span>
              {folderSidebarMode === "static" && (
                <span className="hm-select-hint">Hold card to drag</span>
              )}
              <button
                type="button"
                className="hm-btn hm-select-purg-btn"
                onClick={() =>
                  handleSendToPurgatory(
                    rawItems.filter((it) => selectedKeys.has(itemKey(it)))
                  )
                }
              >
                <Flame size={13} /> Purgatory
              </button>
              <button
                type="button"
                className={`hm-btn hm-select-burn-btn ${dockBurnArmed ? "is-armed" : ""}`}
                onClick={(e) => {
                  const chosen = rawItems.filter((it) =>
                    selectedKeys.has(itemKey(it))
                  );
                  if (!chosen.length) return;
                  if (e.shiftKey || dockBurnArmed) {
                    setDockBurnArmed(false);
                    handlePermanentBurn(chosen);
                  } else {
                    setDockBurnArmed(true);
                  }
                }}
                title="Permanently erase selected files from SSD (Shift = instant)"
              >
                <Trash2 size={13} />
                {dockBurnArmed ? `Confirm Burn (${selectedKeys.size})` : "Burn SSD"}
              </button>
              <button
                type="button"
                className="hm-btn"
                onClick={() => {
                  const chosen = rawItems.filter(
                    (it) => selectedKeys.has(itemKey(it)) && !purgatorySet?.has?.(itemKey(it))
                  );
                  kbHandlersRef.current.toggleBatchFavorite?.(chosen);
                }}
              >
                <FavMark favIcon={favIcon} filled size={12} /> Favorite
              </button>
              <button
                type="button"
                className="hm-btn"
                onClick={() => setSelectedKeys(new Set())}
                title="Clear selection (Esc)"
              >
                <RotateCcw size={12} /> Clear
              </button>
            </div>
          )}
        </section>

        <FolderSidebar
          mode={folderSidebarMode}
          side={dockSide === "left" ? "right" : "left"}
          hidden={screensaverActive || isNativeFs}
          appMode={appMode}
          purgatoryOpen={purgatoryOpen}
          rawItems={rawItems}
          roots={roots}
          extraFoldersByRoot={extraFoldersByRoot}
          singleFolderSpec={folderFilter}
          zones={zones}
          activeZoneId={activeZone.id}
          folderCombos={folderCombos}
          purgatoryCount={livePurgatoryCount}
          isDraggingFiles={Boolean(activeDrag) || Boolean(externalDragHover)}
          dragHoverTarget={
            activeDrag?.hoverTarget ||
            (externalDragHover?.fromSidebar ? externalDragHover.targetScoped : null)
          }
          onSelectSpec={(nextSpec) => {
            if (!purgatoryOpen && appMode === "wall" && activeZone) {
              if (nextSpec === "__PURGATORY__") {
                setPurgatoryOpen(true);
              } else {
                handleSetZoneFolder(activeZone.id, nextSpec);
              }
            } else {
              handleSelectFolderFilter(nextSpec);
            }
          }}
          onToggleMode={setFolderSidebarMode}
          onSelectZone={(zId) => {
            setActiveZoneId(zId);
            triggerZonePulse(zId);
          }}
          onHoverZone={setHoveredBarZoneId}
          onOpenTreeModal={() => handleOpenTreeModal(null)}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onOpenFolderExplorer={handleOpenFolderExplorer}
          onRefresh={() => refreshLibrary({ silent: false })}
          refreshing={libraryRefreshing}
          activeRootPath={activeRootPath}
          onOpenAddRootModal={() => setAddRootOpen(true)}
          onRequestRemoveRoot={(r) => setPendingRemoveRoot(r)}
        />
      </main>

      <FolderTreeModal
        isOpen={Boolean(treeModalTarget)}
        onClose={() => setTreeModalTarget(null)}
        isWallMode={Boolean(treeModalTarget?.isWall)}
        zones={zones}
        initialZoneId={treeModalTarget?.zoneId}
        onSelectWallZone={setActiveZoneId}
        targetTitle={
          treeModalTarget?.isWall
            ? `Zone ${Math.max(
                1,
                zones.findIndex((z) => z.id === treeModalTarget.zoneId) + 1
              )}`
            : appMode === "conveyor"
            ? "Conveyor Mode"
            : appMode === "slideshow"
            ? "Slideshow"
            : "Classic Mode"
        }
        rawItems={rawItems}
        roots={roots}
        extraFoldersByRoot={extraFoldersByRoot}
        initialSpec={
          treeModalTarget?.isWall
            ? zones.find((z) => z.id === treeModalTarget.zoneId)?.folderFilter || "ALL"
            : folderFilter
        }
        folderCombos={folderCombos}
        onApplySpec={(nextSpec) => {
          handleSelectFolderFilter(nextSpec);
        }}
        onApplyWallZoneSpecs={handleApplyWallZoneSpecs}
        onSaveNewCombo={handleSaveNewFolderCombo}
        onUpdateCombo={handleUpdateFolderCombo}
        onDeleteCombo={handleDeleteFolderCombo}
      />

      <InspectModal
        payload={inspectPayload}
        onClose={() => {
          setLightboxExiting(false);
          setInspectPayload(null);
        }}
        onExitingChange={setLightboxExiting}
        onSendToPurgatory={handleSendToPurgatory}
        onRescueFromPurgatory={handleRescueFromPurgatory}
        onBurnItem={handlePermanentBurn}
        onSearchTag={(tag) => {
          setSearch(tag);
          setLightboxExiting(false);
          setInspectPayload(null);
        }}
      />

      <RadialMenu
        menuState={resolvedRadialMenu}
        onClose={() => setRadialMenu(null)}
        onRightClickSwitch={(e, under) => {
          if (drawerOpen || (inspectPayload && !lightboxExiting) || treeModalTarget || noteTarget) {
            setRadialMenu(null);
            return;
          }
          openGalleryRadialAt(e.clientX, e.clientY, under);
        }}
      />
      <NotePopover target={noteTarget} onClose={() => setNoteTarget(null)} />

      {screensaverActive && (
        <div className="cb-screensaver-overlay" aria-label="Idle Gallery Screensaver">
          <SlideshowEngine
            items={(() => {
              const livePool =
                purgatorySet && purgatorySet.size > 0
                  ? rawItems.filter((it) => !purgatorySet.has(itemKey(it)))
                  : rawItems;
              if (screensaverSource === "favorites") {
                const favOnly = livePool.filter((it) => favSet?.has(itemKey(it)));
                return favOnly.length > 0 ? favOnly : livePool;
              }
              if (screensaverSource === "all") return livePool;
              return singleFilteredItems.length > 0 ? singleFilteredItems : livePool;
            })()}
            cfg={singleCfgs.slideshow}
            isActiveZone={true}
            screensaverMode={true}
          />
        </div>
      )}

      <DeletionFxOverlay ref={fxOverlayRef} />

      {activeDrag && (
        <div
          className="hm-drag-stack-ghost"
          style={{ left: activeDrag.x + 16, top: activeDrag.y + 16 }}
          aria-hidden="true"
        >
          <div className="hm-drag-stack-thumbs">
            {activeDrag.items.slice(0, 3).map((it, idx) => (
              <img
                key={itemKey(it)}
                src={getThumbnailUrl(it)}
                alt=""
                className="hm-drag-stack-thumb"
                style={{
                  transform: `translate(${idx * 5}px, ${idx * -3}px) rotate(${(idx - 1) * 5}deg)`,
                  zIndex: 3 - idx,
                }}
              />
            ))}
          </div>
          <div className="hm-drag-stack-pill">
            {activeDrag.hoverTarget === "__PURGATORY__" ? (
              <>
                <Flame size={13} style={{ color: "#fb923c" }} />
                <span>Send {activeDrag.items.length} → Purgatory</span>
              </>
            ) : activeDrag.hoverTarget ? (
              <>
                <Folder size={13} style={{ color: "var(--hm-accent-bright)" }} />
                <span>
                  {dropActionMode === "copy" ? "Copy" : dropActionMode === "move" ? "Move" : "Drop"}{" "}
                  {activeDrag.items.length} →{" "}
                  {(() => {
                    const parsed = parseScopedFolderPath(
                      activeDrag.hoverTarget,
                      roots[0]?.id || "root_1"
                    );
                    return parsed.subfolder === "(Root)"
                      ? "Root"
                      : parsed.subfolder.split("/").pop();
                  })()}
                </span>
              </>
            ) : (
              <span>
                {dropActionMode === "copy" ? "Copying" : "Dragging"} {activeDrag.items.length}
              </span>
            )}
          </div>
        </div>
      )}

      {pendingDiscardIntent && (
        <div
          className="hm-unsaved-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hm-unsaved-title"
          onClick={() => setPendingDiscardIntent(null)}
        >
          <div className="hm-unsaved-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="hm-unsaved-head">
              <div className="hm-unsaved-icon">
                <AlertTriangle size={16} />
              </div>
              <div id="hm-unsaved-title" className="hm-unsaved-title">
                {pendingDiscardIntent === "purgatory"
                  ? "Save changes before opening Purgatory?"
                  : "Save changes before closing?"}
              </div>
            </div>
            <p className="hm-unsaved-desc">
              You have unsaved customization tweaks. Discarding will revert every change made since
              opening Customize.
            </p>
            <div className="hm-unsaved-actions">
              <button
                type="button"
                className="hm-btn"
                onClick={() => setPendingDiscardIntent(null)}
              >
                Keep Editing
              </button>
              <button
                type="button"
                className="hm-btn hm-btn-discard"
                onClick={confirmDiscardChanges}
              >
                Discard
              </button>
              <button
                type="button"
                className="hm-btn hm-save-cta is-dirty"
                onClick={confirmSaveBeforeIntent}
                autoFocus
              >
                <Check size={13} /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <FilterOverlayModal
        isOpen={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        activeFilter={advancedFilter}
        onApplyFilter={(next) => setAdvancedFilter(next)}
        onClearFilter={() => setAdvancedFilter(DEFAULT_ADVANCED_FILTER)}
        rawItems={rawItems}
        folderFilter={purgatoryOpen ? "__PURGATORY__" : folderFilter}
        search={search}
        folderCombos={folderCombos}
        favSet={favSet}
        pinSet={pinSet}
        purgatorySet={purgatorySet}
        notesMap={notesMap}
        searchFavOnly={searchFavOnly}
        searchAllFolders={searchAllFolders}
        scopeLabel={
          purgatoryOpen
            ? "Purgatory"
            : appMode === "wall"
            ? "Wall Zones"
            : getFolderSpecLabel(folderFilter, folderCombos, roots)
        }
      />

      <WelcomeModal
        isOpen={welcomeOpen}
        initialTab={welcomeInitialTab}
        activeRootPath={activeRootPath}
        roots={roots}
        totalItems={rawItems.length}
        totalFolders={folders.length}
        welcomeDismissed={welcomeDismissed}
        onToggleDismissed={setWelcomeDismissed}
        updateInfo={updateInfo}
        checkingUpdates={checkingUpdates}
        applyingUpdate={applyingUpdate}
        updateActionResult={updateActionResult}
        onCheckUpdates={() => checkForUpdates(true)}
        onApplyUpdate={handleRunUpdate}
        onRestartApp={handleRestartApp}
        onRootApplied={async () => {
          setFolderFilter("ALL");
          await refreshLibrary({ silent: true });
        }}
        onClose={() => setWelcomeOpen(false)}
        onStartTour={() => {
          setWelcomeOpen(false);
          setTourOpen(true);
        }}
      />

      <SpotlightTour
        isOpen={tourOpen}
        onClose={() => setTourOpen(false)}
        onReopenWelcome={() => {
          setWelcomeInitialTab("welcome");
          setWelcomeOpen(true);
        }}
      />

      <AddRootModal
        isOpen={addRootOpen}
        onClose={() => setAddRootOpen(false)}
        onRootAdded={async (data) => {
          await refreshLibrary({ silent: true });
          if (data?.root) {
            curation?.showToast?.(
              `Mounted "${data.root.label}" · ${data.imageCount ?? 0} files`
            );
          }
        }}
      />

      <RemoveRootConfirmModal
        root={pendingRemoveRoot}
        folderCombos={folderCombos}
        userWallPresets={userWallPresets}
        onCancel={() => setPendingRemoveRoot(null)}
        onConfirm={handleConfirmRemoveRoot}
      />

      <DropActionPopover
        pendingDrop={pendingDropChoice}
        roots={roots}
        onCancel={() => setPendingDropChoice(null)}
        onMove={async (drop) => {
          setPendingDropChoice(null);
          await handleMoveItemsToFolder(drop.items, drop.targetScoped);
        }}
        onCopy={async (drop) => {
          setPendingDropChoice(null);
          await handleCopyItemsToFolder(drop.items, drop.targetScoped);
        }}
      />

      <ScanProgressOverlay scanStatus={addRootOpen ? null : scanOverlayStatus} />
    </div>
  );
}

import React from "react";
import {
  Pin,
  PinOff,
  StickyNote,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  Cpu,
  Trash2,
  SlidersHorizontal,
  Layers,
  Play,
  Pause,
  Tag,
  ArrowUpDown,
  Shuffle,
  Clock,
  FolderTree,
  FileText,
  Maximize2,
  EyeOff,
  LayoutGrid,
  GitCommitHorizontal,
  Presentation,
  Sparkles,
  Image,
  Sun,
  Compass,
  Square,
  Palette,
  SkipForward,
  RotateCcw,
  Sticker,
  Wind,
  Flame,
  CopyPlus,
  Workflow,
} from "lucide-react";
import { FavMark } from "./curation";
import { getMediaUrl, itemKey } from "./lightboxFlight";
import { loadComfyCfg, openWorkflowInComfyRequest } from "./comfyBridge";

export async function openInExplorerRequest(item) {
  if (!item) return { ok: false, error: "No item" };
  try {
    const res = await fetch("/api/open-explorer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: item.filename,
        subfolder: item.subfolder || "",
        root_id: item.root_id || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && Boolean(data?.ok ?? true), error: data?.error };
  } catch {
    return { ok: false, error: "Request failed" };
  }
}

export async function recycleItemRequest(item, { permanent = false } = {}) {
  if (!item) return false;
  try {
    const res = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: item.filename,
        subfolder: item.subfolder || "",
        root_id: item.root_id || "",
        permanent: Boolean(permanent),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function batchDeleteItemsRequest(items = [], { permanent = true } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: true, deleted: [], failed: [] };
  }
  try {
    const res = await fetch("/api/delete-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((it) => ({
          filename: it.filename,
          subfolder: it.subfolder || "",
          root_id: it.root_id || "",
          key: itemKey(it),
        })),
        permanent: Boolean(permanent),
      }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && Boolean(data?.ok ?? true),
      deleted: Array.isArray(data?.deleted) ? data.deleted : [],
      failed: Array.isArray(data?.failed) ? data.failed : [],
    };
  } catch {
    return { ok: false, deleted: [], failed: [] };
  }
}

export async function createFolderRequest(parentSubfolder = "", name = "", rootId = "") {
  try {
    let targetRootId = rootId || "";
    let cleanParent = parentSubfolder || "";
    if (typeof cleanParent === "string" && cleanParent.includes("::")) {
      const idx = cleanParent.indexOf("::");
      targetRootId = targetRootId || cleanParent.slice(0, idx);
      cleanParent = cleanParent.slice(idx + 2);
    }
    const res = await fetch("/api/create-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootId: targetRootId,
        parentSubfolder: cleanParent === "(Root)" || cleanParent === "*" ? "" : cleanParent,
        name: String(name || "").trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && Boolean(data?.ok),
      rootId: data?.rootId || targetRootId,
      subfolder: data?.subfolder || "",
      scopedSubfolder: data?.scopedSubfolder || "",
      error: data?.error || "",
    };
  } catch {
    return { ok: false, rootId: "", subfolder: "", scopedSubfolder: "", error: "Request failed" };
  }
}

export async function renameFolderRequest(subfolder = "", newName = "", rootId = "") {
  try {
    const res = await fetch("/api/rename-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootId: rootId || "",
        subfolder: subfolder || "",
        newName: String(newName || "").trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && Boolean(data?.ok),
      notFound: res.status === 404 || Boolean(data?.notFound),
      rootId: data?.rootId || rootId || "",
      oldSubfolder: data?.oldSubfolder || subfolder,
      newSubfolder: data?.newSubfolder || "",
      oldScoped: data?.oldScoped || "",
      newScoped: data?.newScoped || "",
      error: data?.error || "",
    };
  } catch {
    return { ok: false, notFound: false, error: "Rename request failed" };
  }
}

export async function deleteFolderRequest(subfolder = "", rootId = "", confirmed = false) {
  try {
    const res = await fetch("/api/delete-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootId: rootId || "",
        subfolder: subfolder || "",
        confirmed: Boolean(confirmed),
      }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && Boolean(data?.ok),
      notFound: res.status === 404 || Boolean(data?.notFound),
      needsConfirm: Boolean(data?.needsConfirm),
      entryCount: data?.entryCount ?? 0,
      dirCount: data?.dirCount ?? 0,
      fileCount: data?.fileCount ?? 0,
      sampleEntries: Array.isArray(data?.sampleEntries) ? data.sampleEntries : [],
      empty: Boolean(data?.empty),
      recycled: Boolean(data?.recycled),
      rootId: data?.rootId || rootId || "",
      subfolder: data?.subfolder || subfolder,
      error: data?.error || "",
    };
  } catch {
    return { ok: false, notFound: false, error: "Delete request failed" };
  }
}

export async function openFolderExplorerRequest(subfolder = "", rootId = "") {
  try {
    const res = await fetch("/api/open-explorer-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootId: rootId || "",
        subfolder: subfolder || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && Boolean(data?.ok),
      notFound: res.status === 404 || Boolean(data?.notFound),
      error: data?.error || "",
    };
  } catch {
    return { ok: false, notFound: false, error: "Could not open Explorer" };
  }
}

function splitTargetFolderSpec(targetFolder) {
  if (targetFolder && typeof targetFolder === "object") {
    const sub = targetFolder.subfolder === "(Root)" ? "" : targetFolder.subfolder || "";
    return { targetRootId: targetFolder.rootId || "", targetSubfolder: sub };
  }
  const s = String(targetFolder || "");
  if (s.includes("::")) {
    const idx = s.indexOf("::");
    const sub = s.slice(idx + 2);
    return { targetRootId: s.slice(0, idx), targetSubfolder: sub === "(Root)" || sub === "*" ? "" : sub };
  }
  return { targetRootId: "", targetSubfolder: s === "(Root)" ? "" : s };
}

export async function moveBatchItemsRequest(items = [], targetFolder = "") {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: true, targetRootId: "", targetSubfolder: "", moved: [], failed: [] };
  }
  const { targetRootId, targetSubfolder } = splitTargetFolderSpec(targetFolder);
  try {
    const res = await fetch("/api/move-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((it) => ({
          filename: it.filename,
          subfolder: it.subfolder || "",
          root_id: it.root_id || "",
          key: itemKey(it),
        })),
        targetRootId,
        targetSubfolder,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && Boolean(data?.ok),
      targetRootId: data?.targetRootId || targetRootId,
      targetSubfolder: data?.targetSubfolder ?? "",
      moved: Array.isArray(data?.moved) ? data.moved : [],
      failed: Array.isArray(data?.failed) ? data.failed : [],
    };
  } catch {
    return { ok: false, targetRootId: "", targetSubfolder: "", moved: [], failed: [] };
  }
}

export async function copyBatchItemsRequest(items = [], targetFolder = null, { preferCopySuffix = true } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: true, copied: [], failed: [] };
  }
  const payload = {
    items: items.map((it) => ({
      filename: it.filename,
      subfolder: it.subfolder || "",
      root_id: it.root_id || "",
      key: itemKey(it),
    })),
    preferCopySuffix: Boolean(preferCopySuffix),
  };
  if (targetFolder !== null && targetFolder !== undefined) {
    const { targetRootId, targetSubfolder } = splitTargetFolderSpec(targetFolder);
    payload.targetRootId = targetRootId;
    payload.targetSubfolder = targetSubfolder;
  }
  try {
    const res = await fetch("/api/copy-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && Boolean(data?.ok),
      copied: Array.isArray(data?.copied) ? data.copied : [],
      failed: Array.isArray(data?.failed) ? data.failed : [],
    };
  } catch {
    return { ok: false, copied: [], failed: [] };
  }
}

export async function checkComfyStatus() {
  try {
    const res = await fetch("/api/comfy-status", { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.state === "ready");
  } catch {
    return false;
  }
}

function resolveComfyInfo(comfyStateOrBool) {
  if (comfyStateOrBool && typeof comfyStateOrBool === "object") {
    const cfg = comfyStateOrBool.cfg || loadComfyCfg();
    const uiState = comfyStateOrBool.uiState || "off";
    return {
      cfg,
      uiState,
      enabled: Boolean(cfg.enabled),
      ready: uiState === "connected",
    };
  }
  const cfg = loadComfyCfg();
  const ready = Boolean(comfyStateOrBool);
  return {
    cfg,
    uiState: ready && cfg.enabled ? "connected" : cfg.enabled ? "sleeping" : "off",
    enabled: Boolean(cfg.enabled) || ready,
    ready,
  };
}

function makeOpenSubmenu(item, comfyStateOrBool, curation) {
  const mediaUrl = getMediaUrl(item);
  const comfy = resolveComfyInfo(comfyStateOrBool);
  const hasWf = Boolean(item?.has_workflow);

  const subs = [
    {
      id: "open-explorer",
      label: "Explorer",
      hint: "Reveal & select file in Windows Explorer",
      icon: <FolderOpen size={15} />,
      onSelect: async () => {
        const res = await openInExplorerRequest(item);
        if (res.ok) curation?.showToast?.("Opened in Windows Explorer");
        else curation?.showToast?.(res.error || "Could not open Windows Explorer");
      },
    },
    {
      id: "open-browser",
      label: "Browser",
      hint: "Open media in a new browser tab",
      icon: <Globe size={15} />,
      onSelect: () => {
        window.open(mediaUrl, "_blank", "noopener");
      },
    },
  ];

  if (comfy.enabled) {
    const canSend = comfy.ready && hasWf;
    let hint = "Open workflow in a new ComfyUI tab";
    if (comfy.uiState === "sleeping") {
      hint = "ComfyUI is currently sleeping (not running)";
    } else if (comfy.uiState === "needs_bridge") {
      hint = "Install ComfyUI-Atelier-Bridge in ? → 05 ComfyUI";
    } else if (!hasWf) {
      hint = "No embedded ComfyUI workflow on this file";
    }

    subs.push({
      id: "open-comfyui",
      label: "ComfyUI",
      hint,
      disabled: !canSend,
      icon: <Workflow size={15} />,
      onSelect: async () => {
        if (!canSend) return;
        const res = await openWorkflowInComfyRequest(item, comfy.cfg);
        if (res?.ok) {
          curation?.showToast?.(
            res.queued_for_open
              ? "Opening ComfyUI & loading workflow…"
              : "Opened workflow in a new ComfyUI tab"
          );
        } else {
          curation?.showToast?.(res?.error || "Could not open workflow in ComfyUI");
        }
      },
    });
  }

  return subs;
}

/**
 * Menu 1 — Thumbnail Right-Click (6 primary bubbles + Open▸ sub-bubbles)
 */
export function buildTileRadialItems({
  item,
  curation,
  comfyOnline,
  comfyState,
  inPurgatoryView = false,
  batchCount = 1,
  queuedTableCount = 0,
  onOpenNote,
  onDuplicateItem,
  onPushToTablePile,
  onSendToPurgatory,
  onRescueFromPurgatory,
  onBurnItem,
}) {
  const isFav = curation?.isFavorited?.(item);
  const isPin = curation?.isPinned?.(item);
  const isPurg = inPurgatoryView || curation?.isInPurgatory?.(item);
  const hasNote = Boolean(curation?.getNote?.(item));
  const favIcon = curation?.favIcon || "star";
  const isVideo = item.media_type === "video";

  return [
    {
      id: "tile-fav",
      label: isFav ? "Unfav" : "Favorite",
      hint: isFav ? "Remove from Favorites (F)" : "Add to Favorites (F)",
      active: isFav,
      icon: <FavMark favIcon={favIcon} filled={isFav} size={17} />,
      onSelect: () => curation?.toggleFavorite?.(item),
    },
    {
      id: "tile-copy-png",
      label: "Clean PNG",
      hint: isVideo ? "Images only" : "Copy 1:1 original PNG without metadata",
      disabled: isVideo,
      icon: <Copy size={16} />,
      onSelect: () => curation?.copyCleanImage?.(item),
    },
    ...(onDuplicateItem
      ? [
          {
            id: "tile-duplicate",
            label: batchCount > 1 ? `Dup ×${batchCount}` : "Duplicate",
            hint:
              batchCount > 1
                ? `Create clean file copies of ${batchCount} selected items in their folders`
                : "Create an exact clean file copy in the same folder (keeps workflow metadata; skips Fav/Pin/Note)",
            icon: <CopyPlus size={16} />,
            onSelect: () => onDuplicateItem?.(item),
          },
        ]
      : []),
    {
      id: "tile-open",
      label: "Open",
      hint:
        resolveComfyInfo(comfyState ?? comfyOnline).enabled
          ? "Open in Explorer, Browser or ComfyUI"
          : "Open in Explorer or Browser",
      icon: <ExternalLink size={16} />,
      children: makeOpenSubmenu(item, comfyState ?? comfyOnline, curation),
    },
    ...(isPurg
      ? [
          {
            id: "tile-rescue",
            label: batchCount > 1 ? `Rescue ×${batchCount}` : "Rescue",
            hint:
              batchCount > 1
                ? `Return ${batchCount} selected prints safely to gallery`
                : "Return print safely to gallery",
            icon: <RotateCcw size={16} />,
            onSelect: () => onRescueFromPurgatory?.(item),
          },
          {
            id: "tile-burn",
            label: batchCount > 1 ? `Del ×${batchCount}` : "Delete",
            hint:
              batchCount > 1
                ? `Permanently delete ${batchCount} selected files from disk (Hold Shift = instant)`
                : "Permanently delete file from disk (Hold Shift = instant)",
            shiftLabel: batchCount > 1 ? `Del ×${batchCount}!` : "Del Now!",
            shiftHint:
              batchCount > 1
                ? `Shift held: permanently Delete ${batchCount} files from disk immediately!`
                : "Shift held: permanently Delete file from disk immediately!",
            danger: true,
            requiresConfirm: true,
            confirmCaption:
              batchCount > 1
                ? `Click again to Delete ${batchCount} files • Shift = instant`
                : "Click again to Delete file • Shift = instant",
            icon: <Trash2 size={16} />,
            onSelect: () => onBurnItem?.(item),
          },
        ]
      : [
          {
            id: "tile-purgatory",
            label: batchCount > 1 ? `Purg ×${batchCount}` : "Purgatory",
            hint:
              batchCount > 1
                ? `Move ${batchCount} selected prints to Purgatory (Hold Shift = Delete)`
                : "Move to Purgatory (Hold Shift = Delete)",
            shiftLabel: batchCount > 1 ? `Del ×${batchCount}!` : "Del Now!",
            shiftHint:
              batchCount > 1
                ? `Release to permanently Delete ${batchCount} selected files from disk!`
                : "Release to permanently Delete file from disk!",
            shiftIcon: <Trash2 size={16} />,
            shiftDanger: true,
            icon: <Flame size={16} />,
            onSelect: (ev) =>
              ev?.shiftKey ? onBurnItem?.(item) : onSendToPurgatory?.(item),
          },
        ]),
    ...(!isPurg && onPushToTablePile
      ? [
          {
            id: "tile-table-pile",
            label: batchCount > 1 ? `Pile ×${batchCount}` : "Pile & Go",
            hint:
              queuedTableCount > 0
                ? `Throw to Table Pile (+ ${queuedTableCount} queued) & switch now • Hold Shift = stage only`
                : batchCount > 1
                ? `Push ${batchCount} prints to Table Pile & switch now • Hold Shift = stage only`
                : "Push to Table Pile & switch now • Hold Shift = stage only",
            shiftLabel: batchCount > 1 ? `+ Pile ×${batchCount}` : "+ To Pile",
            shiftHint:
              batchCount > 1
                ? `Stage ${batchCount} prints for Table Pile without leaving this view`
                : queuedTableCount > 0
                ? `Stage for Table Pile (${queuedTableCount} queued) without leaving this view`
                : "Stage for Table Pile without leaving this view",
            active: queuedTableCount > 0,
            shiftActive: true,
            icon: <Layers size={16} />,
            onSelect: (ev) => onPushToTablePile?.(item, { stageOnly: Boolean(ev?.shiftKey) }),
          },
        ]
      : []),
    {
      id: "tile-pin",
      label: isPin ? "Unpin" : "Pin Top",
      hint: isPin ? "Unpin from top of list" : "Pin to top regardless of sort",
      active: isPin,
      icon: <Pin size={16} />,
      onSelect: () => curation?.togglePin?.(item),
    },
    {
      id: "tile-note",
      label: hasNote ? "Edit Note" : "Add Note",
      hint: "Jot personal note on this render",
      active: hasNote,
      icon: <StickyNote size={16} />,
      onSelect: () => onOpenNote?.(item),
    },
  ];
}

/**
 * Menu 2 — Empty Stage / Background Right-Click
 */
export function buildStageRadialItems({
  appMode,
  isPaused,
  showMetadata,
  sortBy,
  searchFavOnly,
  curation,
  onToggleCustomize,
  onSwitchMode,
  onTogglePause,
  onToggleLabels,
  onChangeSort,
  onReshuffle,
  onToggleSearchFav,
  onOpenFolderTree,
}) {
  const favIcon = curation?.favIcon || "star";
  const isClassic = appMode === "classic";

  return [
    {
      id: "stage-customize",
      label: "Customize",
      hint: "Open settings & FX drawer",
      icon: <SlidersHorizontal size={16} />,
      onSelect: onToggleCustomize,
    },
    {
      id: "stage-mode",
      label: "Mode",
      hint: "Switch gallery engine",
      icon: <Layers size={16} />,
      children: [
        {
          id: "mode-classic",
          label: "Classic",
          active: appMode === "classic",
          icon: <LayoutGrid size={15} />,
          onSelect: () => onSwitchMode("classic"),
        },
        {
          id: "mode-conveyor",
          label: "Conveyor",
          active: appMode === "conveyor",
          icon: <GitCommitHorizontal size={15} />,
          onSelect: () => onSwitchMode("conveyor"),
        },
        {
          id: "mode-slideshow",
          label: "Slideshow",
          active: appMode === "slideshow",
          icon: <Presentation size={15} />,
          onSelect: () => onSwitchMode("slideshow"),
        },
        {
          id: "mode-wall",
          label: "Wall",
          active: appMode === "wall",
          icon: <Layers size={15} />,
          onSelect: () => onSwitchMode("wall"),
        },
      ],
    },
    isClassic
      ? {
          id: "stage-labels",
          label: "Labels",
          hint: showMetadata ? "Hide card badges & metadata" : "Show card badges & metadata",
          active: showMetadata,
          icon: <Tag size={16} />,
          onSelect: onToggleLabels,
        }
      : {
          id: "stage-pause",
          label: isPaused ? "Play" : "Pause",
          hint: isPaused ? "Resume motion" : "Pause motion",
          active: isPaused,
          icon: isPaused ? <Play size={16} /> : <Pause size={16} />,
          onSelect: onTogglePause,
        },
    {
      id: "stage-sort",
      label: "Sort",
      hint: "Shuffle or change sort order",
      icon: <ArrowUpDown size={16} />,
      children: [
        {
          id: "sort-shuffle",
          label: "Shuffle",
          active: sortBy === "shuffle",
          icon: <Shuffle size={15} />,
          onSelect: () => {
            onChangeSort("shuffle");
            onReshuffle?.();
          },
        },
        {
          id: "sort-newest",
          label: "Newest",
          active: sortBy === "newest",
          icon: <Clock size={15} />,
          onSelect: () => onChangeSort("newest"),
        },
        {
          id: "sort-oldest",
          label: "Oldest",
          active: sortBy === "oldest",
          icon: <Clock size={15} />,
          onSelect: () => onChangeSort("oldest"),
        },
        {
          id: "sort-name",
          label: "Name",
          active: sortBy === "name",
          icon: <FileText size={15} />,
          onSelect: () => onChangeSort("name"),
        },
      ],
    },
    {
      id: "stage-fav",
      label: "Favorites",
      hint: searchFavOnly ? "Show all renders" : "Filter active view to Favorites",
      active: searchFavOnly,
      icon: <FavMark favIcon={favIcon} filled={searchFavOnly} size={17} />,
      onSelect: onToggleSearchFav,
    },
    {
      id: "stage-tree",
      label: "Folders",
      hint: "Open Master Folder Tree & Combos",
      icon: <FolderTree size={16} />,
      onSelect: onOpenFolderTree,
    },
  ];
}

/**
 * Menu 3 — Lightbox Right-Click (Detailed viewer + curation actions)
 */
export function buildLightboxRadialItems({
  item,
  curation,
  comfyOnline,
  comfyState,
  isZoomed,
  pureView,
  onResetFit,
  onZoom1to1,
  onToggleInspector,
  onTogglePureView,
  onSendToPurgatory,
  onRescueFromPurgatory,
  onBurnItem,
}) {
  const isFav = curation?.isFavorited?.(item);
  const isPin = curation?.isPinned?.(item);
  const isPurg = Boolean(curation?.isInPurgatory?.(item));
  const favIcon = curation?.favIcon || "star";
  const isVideo = item.media_type === "video";

  const copySubs = [
    ...(item.raw_prompt
      ? [
          {
            id: "lb-copy-pos",
            label: "Prompt",
            icon: <FileText size={15} />,
            onSelect: () => {
              navigator.clipboard?.writeText(item.raw_prompt);
              curation?.showToast?.("Copied positive prompt");
            },
          },
        ]
      : []),
    ...(item.seed
      ? [
          {
            id: "lb-copy-seed",
            label: "Seed",
            icon: <Sparkles size={15} />,
            onSelect: () => {
              navigator.clipboard?.writeText(String(item.seed));
              curation?.showToast?.(`Copied seed ${item.seed}`);
            },
          },
        ]
      : []),
    ...(item.model_short || item.model
      ? [
          {
            id: "lb-copy-model",
            label: "Model",
            icon: <Cpu size={15} />,
            onSelect: () => {
              navigator.clipboard?.writeText(String(item.model_short || item.model));
              curation?.showToast?.("Copied model name");
            },
          },
        ]
      : []),
  ];

  return [
    {
      id: "lb-fav",
      label: isFav ? "Unfav" : "Favorite",
      hint: "Toggle Favorite (F)",
      active: isFav,
      icon: <FavMark favIcon={favIcon} filled={isFav} size={17} />,
      onSelect: () => curation?.toggleFavorite?.(item),
    },
    {
      id: "lb-clean-png",
      label: "Clean PNG",
      hint: isVideo ? "Images only" : "Copy 1:1 PNG (no metadata)",
      disabled: isVideo,
      icon: <Copy size={16} />,
      onSelect: () => curation?.copyCleanImage?.(item),
    },
    {
      id: "lb-copy-meta",
      label: "Copy Info",
      hint: copySubs.length ? "Prompt, Seed or Model" : "No metadata on file",
      disabled: copySubs.length === 0,
      icon: <FileText size={16} />,
      children: copySubs,
    },
    {
      id: "lb-open",
      label: "Open",
      hint:
        resolveComfyInfo(comfyState ?? comfyOnline).enabled
          ? "Explorer, Browser or ComfyUI"
          : "Explorer or Browser",
      icon: <ExternalLink size={16} />,
      children: makeOpenSubmenu(item, comfyState ?? comfyOnline, curation),
    },
    ...(isPurg
      ? [
          {
            id: "lb-rescue",
            label: "Rescue",
            hint: "Return print safely to gallery",
            icon: <RotateCcw size={16} />,
            onSelect: () => onRescueFromPurgatory?.(item),
          },
          {
            id: "lb-burn",
            label: "Delete",
            hint: "Permanently delete file from disk (Hold Shift = instant)",
            shiftLabel: "Del Now!",
            shiftHint: "Shift held: permanently Delete file from disk immediately!",
            danger: true,
            requiresConfirm: true,
            confirmCaption: "Click again to Delete file • Shift = instant",
            icon: <Trash2 size={16} />,
            onSelect: () => onBurnItem?.(item),
          },
        ]
      : [
          {
            id: "lb-purgatory",
            label: "Purgatory",
            hint: "Move to Purgatory (Hold Shift = Delete)",
            shiftLabel: "Del Now!",
            shiftHint: "Release to permanently Delete file from disk!",
            shiftIcon: <Trash2 size={16} />,
            shiftDanger: true,
            icon: <Flame size={16} />,
            onSelect: (ev) =>
              ev?.shiftKey ? onBurnItem?.(item) : onSendToPurgatory?.(item),
          },
        ]),
    {
      id: "lb-pin",
      label: isPin ? "Unpin" : "Pin Top",
      hint: isPin ? "Unpin from top" : "Pin to top of gallery",
      active: isPin,
      icon: <Pin size={16} />,
      onSelect: () => curation?.togglePin?.(item),
    },
    {
      id: "lb-view",
      label: "View",
      hint: "Notes, 1:1 Zoom or Pure View",
      icon: <SlidersHorizontal size={16} />,
      children: [
        {
          id: "lb-view-info",
          label: "Notes & FX",
          icon: <StickyNote size={15} />,
          onSelect: onToggleInspector,
        },
        ...(!isVideo
          ? [
              {
                id: "lb-view-zoom",
                label: isZoomed ? "Fit View" : "1:1 Zoom",
                icon: <Maximize2 size={15} />,
                onSelect: isZoomed ? onResetFit : onZoom1to1,
              },
            ]
          : []),
        {
          id: "lb-view-pure",
          label: pureView ? "Show HUD" : "Pure View",
          icon: <EyeOff size={15} />,
          onSelect: onTogglePureView,
        },
      ],
    },
  ];
}

export function buildTablePileDeskRadialItems({
  deskSurface = "warm_studio_oak_hammelart",
  deskVignette = 42,
  throwFrom = "random",
  messiness = 62,
  pinnedCount = 0,
  looseCount = 0,
  effectivePaused = false,
  isFullscreen = false,
  onPatchParams,
  onTogglePause,
  onNext,
  onWipeDesk,
  onUnpinAll,
  onOpenDrawer,
}) {
  const isWood = deskSurface !== "ambient_halo";
  return [
    {
      id: "pile-surface",
      label: "Surface",
      hint: "Tabletop material or Ambient Halo",
      icon: <Image size={16} />,
      children: [
        {
          id: "pile-surf-branded",
          label: "Branded Oak",
          active: deskSurface === "warm_studio_oak_hammelart",
          icon: <Image size={15} />,
          onSelect: () => onPatchParams?.({ deskSurface: "warm_studio_oak_hammelart" }),
        },
        {
          id: "pile-surf-oak",
          label: "Clean Oak",
          active: deskSurface === "warm_studio_oak",
          icon: <Image size={15} />,
          onSelect: () => onPatchParams?.({ deskSurface: "warm_studio_oak" }),
        },
        {
          id: "pile-surf-halo",
          label: "Ambient Halo",
          active: deskSurface === "ambient_halo",
          icon: <Sparkles size={15} />,
          onSelect: () => onPatchParams?.({ deskSurface: "ambient_halo" }),
        },
      ],
    },
    {
      id: "pile-spot",
      label: "Spot Light",
      hint: isWood ? "Overhead studio lamp vignette" : "Switch to Wood surface first",
      disabled: !isWood,
      icon: <Sun size={16} />,
      children: [
        {
          id: "pile-spot-0",
          label: "Bright 0%",
          active: deskVignette < 10,
          icon: <Sun size={14} />,
          onSelect: () => onPatchParams?.({ deskVignette: 0 }),
        },
        {
          id: "pile-spot-25",
          label: "Soft 25%",
          active: deskVignette >= 10 && deskVignette < 35,
          icon: <Sun size={14} />,
          onSelect: () => onPatchParams?.({ deskVignette: 25 }),
        },
        {
          id: "pile-spot-42",
          label: "Studio 42%",
          active: deskVignette >= 35 && deskVignette < 60,
          icon: <Sun size={14} />,
          onSelect: () => onPatchParams?.({ deskVignette: 42 }),
        },
        {
          id: "pile-spot-70",
          label: "Moody 70%",
          active: deskVignette >= 60,
          icon: <Sun size={14} />,
          onSelect: () => onPatchParams?.({ deskVignette: 70 }),
        },
      ],
    },
    {
      id: "pile-throw",
      label: "Throw",
      hint: "Which table edge sheets fly in from",
      icon: <Compass size={16} />,
      children: [
        {
          id: "pile-th-random",
          label: "8-Way",
          active: throwFrom === "random",
          icon: <Compass size={14} />,
          onSelect: () => onPatchParams?.({ throwFrom: "random" }),
        },
        {
          id: "pile-th-bottom",
          label: "Bottom",
          active: throwFrom === "bottom",
          icon: <Compass size={14} />,
          onSelect: () => onPatchParams?.({ throwFrom: "bottom" }),
        },
        {
          id: "pile-th-sides",
          label: "Sides",
          active: throwFrom === "sides",
          icon: <Compass size={14} />,
          onSelect: () => onPatchParams?.({ throwFrom: "sides" }),
        },
        {
          id: "pile-th-top",
          label: "Top",
          active: throwFrom === "top",
          icon: <Compass size={14} />,
          onSelect: () => onPatchParams?.({ throwFrom: "top" }),
        },
      ],
    },
    {
      id: "pile-mess",
      label: "Scatter",
      hint: "Spread & landing angle randomness",
      icon: <Shuffle size={16} />,
      children: [
        {
          id: "pile-mess-25",
          label: "Neat 25%",
          active: messiness <= 35,
          icon: <Layers size={14} />,
          onSelect: () => onPatchParams?.({ messiness: 25 }),
        },
        {
          id: "pile-mess-62",
          label: "Natural 62%",
          active: messiness > 35 && messiness < 80,
          icon: <Shuffle size={14} />,
          onSelect: () => onPatchParams?.({ messiness: 62 }),
        },
        {
          id: "pile-mess-95",
          label: "Wild 95%",
          active: messiness >= 80,
          icon: <Sparkles size={14} />,
          onSelect: () => onPatchParams?.({ messiness: 95 }),
        },
      ],
    },
    {
      id: "pile-pause",
      label: effectivePaused ? "Resume" : "Pause",
      hint: effectivePaused ? "Resume auto-throwing" : "Pause throws cleanly",
      active: effectivePaused,
      icon: effectivePaused ? <Play size={16} /> : <Pause size={16} />,
      onSelect: onTogglePause,
    },
    {
      id: "pile-next",
      label: "Toss Next",
      hint: "Throw next print onto desk now",
      icon: <SkipForward size={16} />,
      onSelect: onNext,
    },
    {
      id: "pile-wipe",
      label: "Wipe",
      hint:
        looseCount > 0
          ? "Blow away all untaped sheets (keeps taped prints)"
          : "No loose untaped prints on desk",
      disabled: looseCount === 0,
      icon: <Wind size={16} />,
      onSelect: onWipeDesk,
    },
    ...(pinnedCount > 0
      ? [
          {
            id: "pile-unpin-all",
            label: `Unpin (${pinnedCount})`,
            hint: "Release all pinned prints back into rotation",
            icon: <PinOff size={16} />,
            onSelect: onUnpinAll,
          },
        ]
      : !isFullscreen && onOpenDrawer
      ? [
          {
            id: "pile-drawer",
            label: "Full Setup",
            hint: "Open Customize Drawer sliders",
            icon: <SlidersHorizontal size={16} />,
            onSelect: onOpenDrawer,
          },
        ]
      : []),
  ];
}

export function buildTablePileCardRadialItems({
  sizeKey = "M",
  sizeScale = 1.0,
  permaPinned = false,
  paperBorder = true,
  borderThickness = 14,
  paperTone = "cotton",
  allowInspect = false,
  onSetCardSize,
  onSetCardSizeScale,
  onWipeCard,
  onTogglePermaPin,
  onPopTop,
  onStraighten,
  onInspectCard,
  onPatchParams,
}) {
  const pct = Math.round(Number(sizeScale || 1.0) * 100);
  return [
    {
      id: "pilec-size",
      label: `Size ${pct}%`,
      hint: "Drag the curved slider • Scroll or dbl-click for 100%",
      icon: <Maximize2 size={16} />,
      arcSlider: {
        min: 0.32,
        max: 1.56,
        step: 0.01,
        defaultValue: 1.0,
        value: Number(sizeScale || 1.0),
        ticks: [0.4, 0.72, 1.0, 1.28, 1.56],
        minLabel: "32%",
        maxLabel: "156%",
        bubbleLabel: (v) => `Size ${Math.round(Number(v) * 100)}%`,
        formatValue: (v) => `Print Size: ${Math.round(Number(v) * 100)}%`,
        onChange: (v, isFinal) => {
          if (onSetCardSizeScale) {
            onSetCardSizeScale(v, isFinal);
          } else if (onSetCardSize) {
            const key = v < 0.86 ? "S" : v < 1.14 ? "M" : v < 1.42 ? "L" : "XL";
            onSetCardSize(key);
          }
        },
        onCommit: (v) => onSetCardSizeScale?.(v, true),
      },
    },
    {
      id: "pilec-wipe",
      label: "Wipe",
      hint: permaPinned
        ? "Untape & blow this print off the desk"
        : "Blow this print off the desk",
      icon: <Wind size={16} />,
      onSelect: onWipeCard,
    },
    {
      id: "pilec-perma",
      label: permaPinned ? "Taped" : "Tape",
      hint: permaPinned
        ? "Scotch-taped permanently across reloads (click to remove tape)"
        : "Scotch-tape permanently at this exact spot & size",
      active: permaPinned,
      icon: <Sticker size={16} />,
      onSelect: onTogglePermaPin,
    },
    {
      id: "pilec-matte",
      label: paperBorder ? "Matte On" : "Matte Off",
      hint: "Toggle archival paper passepartout border",
      active: paperBorder,
      icon: <Square size={16} />,
      onSelect: () => onPatchParams?.({ paperBorder: !paperBorder }),
    },
    {
      id: "pilec-tone",
      label: "Paper",
      hint: paperBorder ? "Lithography paper stock color" : "Enable Matte border first",
      disabled: !paperBorder,
      icon: <Palette size={16} />,
      children: [
        {
          id: "pilec-tone-cotton",
          label: "Cotton",
          active: paperTone === "cotton",
          icon: <Palette size={14} />,
          onSelect: () => onPatchParams?.({ paperTone: "cotton" }),
        },
        {
          id: "pilec-tone-white",
          label: "Pure White",
          active: paperTone === "white",
          icon: <Palette size={14} />,
          onSelect: () => onPatchParams?.({ paperTone: "white" }),
        },
        {
          id: "pilec-tone-charcoal",
          label: "Charcoal",
          active: paperTone === "charcoal",
          icon: <Palette size={14} />,
          onSelect: () => onPatchParams?.({ paperTone: "charcoal" }),
        },
      ],
    },
    {
      id: "pilec-width",
      label: "Thickness",
      hint: paperBorder ? "Adjust passepartout matte thickness" : "Enable Matte border first",
      disabled: !paperBorder,
      icon: <SlidersHorizontal size={16} />,
      children: [
        {
          id: "pilec-w-6",
          label: "Slim 6px",
          active: borderThickness <= 9,
          icon: <Square size={13} />,
          onSelect: () => onPatchParams?.({ borderThickness: 6 }),
        },
        {
          id: "pilec-w-14",
          label: "Classic 14px",
          active: borderThickness > 9 && borderThickness <= 19,
          icon: <Square size={14} />,
          onSelect: () => onPatchParams?.({ borderThickness: 14 }),
        },
        {
          id: "pilec-w-24",
          label: "Gallery 24px",
          active: borderThickness > 19 && borderThickness <= 29,
          icon: <Square size={15} />,
          onSelect: () => onPatchParams?.({ borderThickness: 24 }),
        },
        {
          id: "pilec-w-34",
          label: "Bold 34px",
          active: borderThickness > 29,
          icon: <Square size={16} />,
          onSelect: () => onPatchParams?.({ borderThickness: 34 }),
        },
      ],
    },
    {
      id: "pilec-arrange",
      label: "Arrange",
      hint: "Pop top, straighten tilt, or inspect",
      icon: <Layers size={16} />,
      children: [
        ...(!permaPinned
          ? [
              {
                id: "pilec-arr-top",
                label: "Bring Top",
                icon: <Layers size={14} />,
                onSelect: onPopTop,
              },
            ]
          : []),
        {
          id: "pilec-arr-level",
          label: "Level 0°",
          icon: <RotateCcw size={14} />,
          onSelect: onStraighten,
        },
        ...(allowInspect
          ? [
              {
                id: "pilec-arr-lb",
                label: "Lightbox",
                icon: <Maximize2 size={14} />,
                onSelect: onInspectCard,
              },
            ]
          : []),
      ],
    },
  ];
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Star, Heart } from "lucide-react";
import { getMediaUrl, itemKey } from "./lightboxFlight";

const CURATION_STORAGE_KEY = "hm_curation_v1";
const PERMA_PINS_STORAGE_KEY = "argon_cb_perma_pins_v1";
const VALID_DELETE_FX = new Set(["ember", "lightning", "poof", "instant"]);

export const DEFAULT_CARD_LABELS = {
  always: [], // max 2 from ["folder", "wf", "resolution", "filename"]
  hoverTop: ["folder", "wf"], // subset of ["folder", "wf"]
  hoverBottom: ["filename", "resolution", "note"], // max 3 from ["filename", "resolution", "note", "model", "prompt", "size"]
};

const DEFAULT_CURATION = {
  favorites: [],
  pins: [],
  purgatory: [],
  notes: {},
  favIcon: "star", // "star" | "heart"
  deleteFx: "ember", // "ember" | "lightning" | "poof" | "instant"
  videoBadgeMode: "always", // "always" | "hover" | "off"
  cardLabels: DEFAULT_CARD_LABELS,
};

function normalizeCardLabels(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CARD_LABELS };
  const alwaysValid = new Set(["folder", "wf", "resolution", "filename"]);
  const hoverTopValid = new Set(["folder", "wf"]);
  const hoverBotValid = new Set(["filename", "resolution", "note", "model", "prompt", "size"]);
  const always = Array.isArray(raw.always)
    ? raw.always.filter((k) => alwaysValid.has(k)).slice(0, 2)
    : DEFAULT_CARD_LABELS.always;
  const hoverTop = Array.isArray(raw.hoverTop)
    ? raw.hoverTop.filter((k) => hoverTopValid.has(k))
    : DEFAULT_CARD_LABELS.hoverTop;
  const hoverBottom = Array.isArray(raw.hoverBottom)
    ? raw.hoverBottom.filter((k) => hoverBotValid.has(k)).slice(0, 3)
    : DEFAULT_CARD_LABELS.hoverBottom;
  return { always, hoverTop, hoverBottom };
}

function resolveKey(itemOrKey) {
  if (!itemOrKey) return "";
  return typeof itemOrKey === "string" ? itemOrKey : itemKey(itemOrKey);
}

function loadCurationState() {
  try {
    const raw = localStorage.getItem(CURATION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CURATION, cardLabels: { ...DEFAULT_CARD_LABELS } };
    const parsed = JSON.parse(raw);
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
      purgatory: Array.isArray(parsed.purgatory) ? parsed.purgatory : [],
      notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      favIcon: parsed.favIcon === "heart" ? "heart" : "star",
      deleteFx: VALID_DELETE_FX.has(parsed.deleteFx) ? parsed.deleteFx : "ember",
      videoBadgeMode:
        parsed.videoBadgeMode === "hover" || parsed.videoBadgeMode === "off"
          ? parsed.videoBadgeMode
          : "always",
      cardLabels: normalizeCardLabels(parsed.cardLabels),
    };
  } catch {
    return { ...DEFAULT_CURATION, cardLabels: { ...DEFAULT_CARD_LABELS } };
  }
}

/**
 * Re-encodes a gallery image at 1:1 original pixel dimensions onto a fresh canvas
 * so embedded PNG/WebP ComfyUI workflow & prompt metadata chunks are stripped cleanly.
 */
async function renderCleanPngBlob(item) {
  const url = getMediaUrl(item);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const srcBlob = await res.blob();
  const objUrl = URL.createObjectURL(srcBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = objUrl;
    });
    const w = img.naturalWidth || item.width || 1;
    const h = img.naturalHeight || item.height || 1;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas PNG encode failed"))),
        "image/png"
      );
    });
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export async function copyCleanImageToClipboard(item) {
  if (!item || item.media_type === "video") {
    return { ok: false, message: "Video files cannot be copied as clean PNG" };
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return { ok: false, message: "Clipboard image write not supported in this browser" };
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": renderCleanPngBlob(item),
      }),
    ]);
    return {
      ok: true,
      message: `Copied clean ${item.resolution || "original"} PNG (no metadata)`,
    };
  } catch {
    return { ok: false, message: "Clipboard permission blocked image copy" };
  }
}

export function FavMark({ favIcon = "star", filled = false, size = 13, className = "", style }) {
  const Icon = favIcon === "heart" ? Heart : Star;
  return (
    <Icon
      size={size}
      className={className}
      fill={filled ? "currentColor" : "none"}
      style={style}
    />
  );
}

const CurationContext = createContext(null);

export function CurationProvider({ children }) {
  const [state, setState] = useState(loadCurationState);
  const [toast, setToast] = useState(null);
  const [radialLockedKey, setRadialLockedKey] = useState("");
  const [purgatoryPulseNonce, setPurgatoryPulseNonce] = useState(0);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(CURATION_STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const showToast = useCallback((message) => {
    if (!message) return;
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1900);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const favSet = useMemo(() => new Set(state.favorites), [state.favorites]);
  const pinSet = useMemo(() => new Set(state.pins), [state.pins]);
  const purgatorySet = useMemo(() => new Set(state.purgatory), [state.purgatory]);

  const isFavorited = useCallback((itemOrKey) => favSet.has(resolveKey(itemOrKey)), [favSet]);
  const isPinned = useCallback((itemOrKey) => pinSet.has(resolveKey(itemOrKey)), [pinSet]);
  const isInPurgatory = useCallback(
    (itemOrKey) => purgatorySet.has(resolveKey(itemOrKey)),
    [purgatorySet]
  );
  const getNote = useCallback(
    (itemOrKey) => state.notes[resolveKey(itemOrKey)] || "",
    [state.notes]
  );

  const triggerPurgatoryPulse = useCallback(() => {
    setPurgatoryPulseNonce((n) => n + 1);
  }, []);

  const toggleFavorite = useCallback(
    (itemOrKey, silent = false) => {
      const k = resolveKey(itemOrKey);
      if (!k) return false;
      const adding = !favSet.has(k);
      setState((prev) => {
        const exists = prev.favorites.includes(k);
        return {
          ...prev,
          favorites: exists
            ? prev.favorites.filter((x) => x !== k)
            : [...prev.favorites, k],
        };
      });
      if (!silent) {
        const sym = state.favIcon === "heart" ? "♥" : "★";
        showToast(adding ? `${sym} Added to Favorites` : `${sym} Removed from Favorites`);
      }
      return adding;
    },
    [favSet, state.favIcon, showToast]
  );

  const togglePin = useCallback(
    (itemOrKey, silent = false) => {
      const k = resolveKey(itemOrKey);
      if (!k) return false;
      const pinning = !pinSet.has(k);
      setState((prev) => {
        const exists = prev.pins.includes(k);
        return {
          ...prev,
          pins: exists ? prev.pins.filter((x) => x !== k) : [...prev.pins, k],
        };
      });
      if (!silent) {
        showToast(pinning ? "Pinned to top of list" : "Unpinned");
      }
      return pinning;
    },
    [pinSet, showToast]
  );

  const setNote = useCallback((itemOrKey, rawText) => {
    const k = resolveKey(itemOrKey);
    if (!k) return;
    const text = String(rawText ?? "");
    setState((prev) => {
      const nextNotes = { ...prev.notes };
      if (text.trim()) nextNotes[k] = text;
      else delete nextNotes[k];
      return { ...prev, notes: nextNotes };
    });
  }, []);

  const setFavIcon = useCallback((mode) => {
    setState((prev) => ({
      ...prev,
      favIcon: mode === "heart" ? "heart" : "star",
    }));
  }, []);

  const setDeleteFx = useCallback((fx) => {
    setState((prev) => ({
      ...prev,
      deleteFx: VALID_DELETE_FX.has(fx) ? fx : "ember",
    }));
  }, []);

  const toKeyList = (itemsOrKeys) => {
    const arr = Array.isArray(itemsOrKeys) ? itemsOrKeys : [itemsOrKeys];
    return arr.map(resolveKey).filter(Boolean);
  };

  const addToPurgatory = useCallback(
    (itemsOrKeys, { silent = true } = {}) => {
      const keys = toKeyList(itemsOrKeys);
      if (!keys.length) return 0;
      const added = keys.filter((k) => !purgatorySet.has(k)).length;
      setState((prev) => {
        const cur = new Set(prev.purgatory);
        let changed = false;
        const next = [...prev.purgatory];
        for (const k of keys) {
          if (!cur.has(k)) {
            cur.add(k);
            next.push(k);
            changed = true;
          }
        }
        return changed ? { ...prev, purgatory: next } : prev;
      });
      if (!silent && added > 0) {
        showToast(added === 1 ? "Sent to Purgatory" : `Sent ${added} renders to Purgatory`);
      }
      return added;
    },
    [purgatorySet, showToast]
  );

  const removeFromPurgatory = useCallback(
    (itemsOrKeys, { silent = false } = {}) => {
      const keys = new Set(toKeyList(itemsOrKeys));
      if (!keys.size) return;
      setState((prev) => {
        const next = prev.purgatory.filter((k) => !keys.has(k));
        return next.length === prev.purgatory.length ? prev : { ...prev, purgatory: next };
      });
      if (!silent) {
        showToast(keys.size === 1 ? "Rescued from Purgatory" : `Rescued ${keys.size} renders`);
      }
    },
    [showToast]
  );

  const clearPurgatory = useCallback(() => {
    setState((prev) => (prev.purgatory.length ? { ...prev, purgatory: [] } : prev));
  }, []);

  const purgeCurationKeys = useCallback((itemsOrKeys) => {
    const rmSet = new Set(toKeyList(itemsOrKeys));
    if (!rmSet.size) return;
    setState((prev) => {
      const nextNotes = { ...prev.notes };
      let notesChanged = false;
      for (const k of rmSet) {
        if (k in nextNotes) {
          delete nextNotes[k];
          notesChanged = true;
        }
      }
      return {
        ...prev,
        purgatory: prev.purgatory.filter((k) => !rmSet.has(k)),
        favorites: prev.favorites.filter((k) => !rmSet.has(k)),
        pins: prev.pins.filter((k) => !rmSet.has(k)),
        notes: notesChanged ? nextNotes : prev.notes,
      };
    });
    // Also remove erased prints from Table Pile Scotch-taped storage so no broken ghosts remain
    try {
      const rawPerma = localStorage.getItem(PERMA_PINS_STORAGE_KEY);
      if (rawPerma) {
        const parsed = JSON.parse(rawPerma);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((entry) => {
            const k = entry?.key || resolveKey(entry?.item);
            return !k || !rmSet.has(k);
          });
          if (filtered.length !== parsed.length) {
            localStorage.setItem(PERMA_PINS_STORAGE_KEY, JSON.stringify(filtered));
          }
        }
      }
    } catch {}
  }, []);

  const prunePurgatory = useCallback((validKeySet) => {
    if (!validKeySet || typeof validKeySet.has !== "function") return;
    setState((prev) => {
      if (!prev.purgatory.some((k) => !validKeySet.has(k))) return prev;
      return {
        ...prev,
        purgatory: prev.purgatory.filter((k) => validKeySet.has(k)),
      };
    });
  }, []);

  const migrateCurationKeys = useCallback((moves = []) => {
    if (!Array.isArray(moves) || moves.length === 0) return;
    const mapOldToNew = new Map();
    const mapMeta = new Map();
    for (const m of moves) {
      if (m?.oldKey && m?.newKey && m.oldKey !== m.newKey) {
        mapOldToNew.set(m.oldKey, m.newKey);
        mapMeta.set(m.oldKey, m);
      }
    }
    if (!mapOldToNew.size) return;

    const remapArr = (arr) => {
      let changed = false;
      const out = [];
      const seen = new Set();
      for (let i = 0; i < arr.length; i++) {
        const k = arr[i];
        const nk = mapOldToNew.get(k) || k;
        if (nk !== k) changed = true;
        if (!seen.has(nk)) {
          seen.add(nk);
          out.push(nk);
        }
      }
      return { arr: changed ? out : arr, changed };
    };

    setState((prev) => {
      const f = remapArr(prev.favorites);
      const p = remapArr(prev.pins);
      const pg = remapArr(prev.purgatory);
      const nextNotes = { ...prev.notes };
      let notesChanged = false;
      for (const [ok, nk] of mapOldToNew.entries()) {
        if (ok in nextNotes) {
          nextNotes[nk] = nextNotes[ok];
          delete nextNotes[ok];
          notesChanged = true;
        }
      }
      if (!f.changed && !p.changed && !pg.changed && !notesChanged) return prev;
      return {
        ...prev,
        favorites: f.arr,
        pins: p.arr,
        purgatory: pg.arr,
        notes: notesChanged ? nextNotes : prev.notes,
      };
    });

    try {
      const rawPerma = localStorage.getItem(PERMA_PINS_STORAGE_KEY);
      if (rawPerma) {
        const parsed = JSON.parse(rawPerma);
        if (Array.isArray(parsed)) {
          let changed = false;
          const updated = parsed.map((entry) => {
            const k = entry?.key || resolveKey(entry?.item);
            const mv = k ? mapMeta.get(k) : null;
            if (!mv) return entry;
            changed = true;
            return {
              ...entry,
              key: mv.newKey,
              item: {
                ...entry.item,
                filename: mv.filename,
                subfolder: mv.subfolder,
                root_id: mv.root_id || entry.item?.root_id || "root_1",
              },
            };
          });
          if (changed) {
            localStorage.setItem(PERMA_PINS_STORAGE_KEY, JSON.stringify(updated));
          }
        }
      }
    } catch {}
  }, []);

  const toggleCardLabel = useCallback((tier, key) => {
    setState((prev) => {
      const cur = normalizeCardLabels(prev.cardLabels);
      const list = cur[tier] || [];
      const exists = list.includes(key);
      let nextList;
      if (exists) {
        nextList = list.filter((x) => x !== key);
      } else {
        const cap = tier === "always" ? 2 : tier === "hoverBottom" ? 3 : 2;
        nextList = list.length >= cap ? [...list.slice(-(cap - 1)), key] : [...list, key];
      }
      return {
        ...prev,
        cardLabels: { ...cur, [tier]: nextList },
      };
    });
  }, []);

  const setVideoBadgeMode = useCallback((mode) => {
    const clean = mode === "hover" || mode === "off" ? mode : "always";
    setState((prev) => (prev.videoBadgeMode === clean ? prev : { ...prev, videoBadgeMode: clean }));
  }, []);

  const copyCleanImage = useCallback(
    async (item) => {
      const res = await copyCleanImageToClipboard(item);
      showToast(res.message);
      return res.ok;
    },
    [showToast]
  );

  const value = useMemo(
    () => ({
      favorites: state.favorites,
      pins: state.pins,
      purgatory: state.purgatory,
      notesMap: state.notes,
      favIcon: state.favIcon,
      deleteFx: state.deleteFx || "ember",
      favSet,
      pinSet,
      purgatorySet,
      favCount: state.favorites.length,
      pinCount: state.pins.length,
      purgatoryCount: state.purgatory.length,
      isFavorited,
      isPinned,
      isInPurgatory,
      getNote,
      toggleFavorite,
      togglePin,
      setNote,
      setFavIcon,
      setDeleteFx,
      purgatoryPulseNonce,
      triggerPurgatoryPulse,
      addToPurgatory,
      removeFromPurgatory,
      clearPurgatory,
      purgeCurationKeys,
      prunePurgatory,
      migrateCurationKeys,
      cardLabels: state.cardLabels || DEFAULT_CARD_LABELS,
      toggleCardLabel,
      videoBadgeMode: state.videoBadgeMode || "always",
      setVideoBadgeMode,
      copyCleanImage,
      showToast,
      radialLockedKey,
      setRadialLockedKey,
    }),
    [
      state.favorites,
      state.pins,
      state.purgatory,
      state.notes,
      state.favIcon,
      state.deleteFx,
      state.videoBadgeMode,
      state.cardLabels,
      favSet,
      pinSet,
      purgatorySet,
      isFavorited,
      isPinned,
      isInPurgatory,
      getNote,
      toggleFavorite,
      togglePin,
      setNote,
      setFavIcon,
      setDeleteFx,
      purgatoryPulseNonce,
      triggerPurgatoryPulse,
      addToPurgatory,
      removeFromPurgatory,
      clearPurgatory,
      purgeCurationKeys,
      prunePurgatory,
      migrateCurationKeys,
      toggleCardLabel,
      setVideoBadgeMode,
      copyCleanImage,
      showToast,
      radialLockedKey,
    ]
  );

  return (
    <CurationContext.Provider value={value}>
      {children}
      {toast && <div className="hm-curation-toast">{toast}</div>}
    </CurationContext.Provider>
  );
}

export function useCuration() {
  return useContext(CurationContext);
}

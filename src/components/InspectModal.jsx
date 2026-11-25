import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Info,
  Film,
  EyeOff,
  Eye,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Repeat,
  Pin,
  Copy,
  Flame,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { HAMMELART_CREST_PATH } from "../theme";
import { FavMark, useCuration } from "../utils/curation";
import {
  computeLightboxDestRect,
  createTeleportParticles,
  getStyleParams,
  loadLightboxCfg,
  saveLightboxCfg,
} from "../utils/lightboxFlight";
import {
  getElementTrueRectAndAngle,
  getExitStyleParams,
  getMediaUrl,
  getThumbnailUrl,
  itemKey,
  findVisibleTileForItem,
} from "../utils/lightboxFlight";
import { startWebGLMembraneFlight } from "../utils/webglTransition";
import { buildLightboxRadialItems } from "../utils/radialBuilders";
import { requestComfyRefresh, useComfyBridgeState } from "../utils/comfyBridge";
import LightboxInspector from "./LightboxInspector";
import RadialMenu from "./RadialMenu";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function makeMediaUrl(item) {
  return getMediaUrl(item);
}

function makeThumbUrl(item) {
  return getThumbnailUrl(item);
}

export default function InspectModal({
  payload,
  onClose,
  onSearchTag,
  onSendToPurgatory,
  onRescueFromPurgatory,
  onBurnItem,
  onExitingChange,
}) {
  const curation = useCuration();
  const favIcon = curation?.favIcon || "star";
  const [cfg, setCfg] = useState(loadLightboxCfg);
  const [currentItem, setCurrentItem] = useState(null);
  const [removedKeys, setRemovedKeys] = useState([]);
  const [lbRadial, setLbRadial] = useState(null);
  const comfyState = useComfyBridgeState();
  const lbRadialRef = useRef(false);
  lbRadialRef.current = Boolean(lbRadial);
  const stageDeletingRef = useRef(false);
  const [pureView, setPureView] = useState(false);
  const [hudIdle, setHudIdle] = useState(false);
  const [portalTarget, setPortalTarget] = useState(() =>
    typeof document !== "undefined" ? document.fullscreenElement || document.body : null
  );
  const [vp, setVp] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 720,
  }));

  // Zoom & Pan state relative to Fit center
  const [zoom, setZoom] = useState({ scale: 1, tx: 0, ty: 0 });
  const [zoomSmooth, setZoomSmooth] = useState(false);
  const [hiResLoaded, setHiResLoaded] = useState(false);
  const [flightRunning, setFlightRunning] = useState(false);

  // Custom video playback state
  const videoRef = useRef(null);
  const [vPlaying, setVPlaying] = useState(true);
  const [vMuted, setVMuted] = useState(false);
  const [vLoop, setVLoop] = useState(true);
  const [vRate, setVRate] = useState(1);
  const [vTime, setVTime] = useState(0);
  const [vDur, setVDur] = useState(0);
  const [videoDims, setVideoDims] = useState({ w: 0, h: 0 });
  const [videoSizeMode, setVideoSizeMode] = useState(() =>
    cfg.videoDefault1to1 !== false ? "native" : "fit"
  );
  const [nativeFsActive, setNativeFsActive] = useState(false);
  const [fsFallback, setFsFallback] = useState(false);
  const desktopFsRef = useRef(false);
  const isLbFullscreen = nativeFsActive || fsFallback;
  const [fsMouseAwake, setFsMouseAwake] = useState(false);
  const fsTimerRef = useRef(null);

  const backdropRef = useRef(null);
  const heroCardRef = useRef(null);
  const frontFaceRef = useRef(null);
  const backFaceRef = useRef(null);
  const teleCanvasRef = useRef(null);
  const glCanvasRef = useRef(null);
  const teleOriginRef = useRef(null);
  const teleHoloRef = useRef(null);
  const filmstripRef = useRef(null);
  const filmstripBoxRef = useRef(null);
  const filmstripGlideRef = useRef({ raf: 0, pos: 0, target: null, lastTs: 0 });
  const idleTimerRef = useRef(null);
  const panRef = useRef({ active: false, sx: 0, sy: 0, stx: 0, sty: 0, moved: false });
  const [isPanning, setIsPanning] = useState(false);

  const patchCfg = useCallback((patch) => {
    setCfg((prev) => {
      const next = {
        ...prev,
        ...patch,
        ...(patch?.inspectorFields
          ? {
              inspectorFields: {
                ...(prev.inspectorFields || {}),
                ...patch.inspectorFields,
              },
            }
          : {}),
      };
      saveLightboxCfg(next);
      return next;
    });
  }, []);

  const exitAllFullscreen = useCallback(() => {
    setFsFallback(false);
    setFsMouseAwake(false);
    if (fsTimerRef.current) clearTimeout(fsTimerRef.current);
    if (rootRef.current && document.fullscreenElement === rootRef.current) {
      document.exitFullscreen?.().catch(() => {});
    }
    if (desktopFsRef.current) {
      desktopFsRef.current = false;
      fetch("/api/desktop-fullscreen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullscreen: false }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.ok) window.dispatchEvent(new CustomEvent("hm:desktop-fs-sync", { detail: Boolean(d.fullscreen) }));
        })
        .catch(() => {});
    }
  }, []);

  // Track viewport resize & lightbox fullscreen status
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const onFs = () => {
      const fsEl = document.fullscreenElement;
      if (!fsEl || (rootRef.current && fsEl !== rootRef.current && !rootRef.current.contains(fsEl))) {
        setPortalTarget(fsEl || document.body);
      }
      const active = Boolean(rootRef.current && fsEl === rootRef.current);
      setNativeFsActive(active);
      if (!active && !desktopFsRef.current) {
        setFsFallback(false);
      }
      setFsMouseAwake(false);
      if (fsTimerRef.current) clearTimeout(fsTimerRef.current);
      setVp({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFs);
      if (fsTimerRef.current) clearTimeout(fsTimerRef.current);
      if (desktopFsRef.current) {
        desktopFsRef.current = false;
        fetch("/api/desktop-fullscreen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullscreen: false }),
        }).catch(() => {});
      }
    };
  }, []);

  const toggleLightboxFullscreen = useCallback(() => {
    const host = rootRef.current;
    if (!host) return;
    if (isLbFullscreen) {
      exitAllFullscreen();
      return;
    }

    // Reset zoom & pan so true fullscreen always lands on clean border-to-border fit
    setZoomSmooth(false);
    setZoom({ scale: 1, tx: 0, ty: 0 });

    // Engage zero-chrome pitch-black cinema mode synchronously so WebView/embedded frames never hang
    setFsFallback(true);

    const alreadyFillingScreen =
      Boolean(document.fullscreenElement && document.fullscreenElement !== host) ||
      (typeof window !== "undefined" &&
        window.screen?.width > 0 &&
        window.innerWidth >= window.screen.width - 2 &&
        window.innerHeight >= window.screen.height - 2);

    if (typeof window !== "undefined" && window.pywebview) {
      if (alreadyFillingScreen) {
        // Desktop app was already in fullscreen; keep OS window untouched on exit
        desktopFsRef.current = false;
        return;
      }
      desktopFsRef.current = true;
      fetch("/api/desktop-fullscreen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullscreen: true }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d?.ok) {
            desktopFsRef.current = false;
            try {
              host.requestFullscreen?.().catch?.(() => {});
            } catch {}
          } else {
            window.dispatchEvent(new CustomEvent("hm:desktop-fs-sync", { detail: Boolean(d.fullscreen) }));
            if (d.already_fullscreen) {
              desktopFsRef.current = false;
            }
          }
        })
        .catch(() => {
          desktopFsRef.current = false;
        });
      return;
    }

    // If the browser is already in app-level / F11 fullscreen, keep that outer fullscreen intact
    if (alreadyFillingScreen) return;

    // Call standard browser DOM Fullscreen API synchronously inside the click gesture
    try {
      const p = host.requestFullscreen?.();
      if (p && typeof p.catch === "function") {
        p.catch(() => {});
      }
    } catch {}
  }, [isLbFullscreen, exitAllFullscreen]);

  const wakeFsHud = useCallback(() => {
    if (!isLbFullscreen) return;
    setFsMouseAwake(true);
    if (fsTimerRef.current) clearTimeout(fsTimerRef.current);
    fsTimerRef.current = setTimeout(() => setFsMouseAwake(false), 1600);
  }, [isLbFullscreen]);

  const scopedItems = useMemo(() => {
    const raw = payload?.items || [];
    if (!removedKeys.length) return raw;
    const rem = new Set(removedKeys);
    return raw.filter((it) => !rem.has(itemKey(it)));
  }, [payload?.items, removedKeys]);
  const sourceLabel = payload?.sourceLabel || "";
  const activeItem = currentItem || payload?.item || null;

  const rootRef = useRef(null);
  const stageAreaRef = useRef(null);
  const irisVeilRef = useRef(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const exitRafRef = useRef(0);

  // Visually lift the currently viewed thumbnail out of its grid/conveyor slot while active
  const targetEl = useMemo(
    () => findVisibleTileForItem(activeItem, payload?.originEl),
    [activeItem, payload?.originEl]
  );

  const releaseLiftedSocket = useCallback((el, instantOpacity = false) => {
    if (!el || !el.hasAttribute("data-lb-lifted")) return;
    const attr = instantOpacity ? "data-lb-tuck-snap" : "data-lb-returning";
    el.setAttribute(attr, "true");
    el.removeAttribute("data-lb-lifted");
    // Flush layout at centered slot coordinates before hover transitions re-enable
    void el.offsetWidth;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.removeAttribute(attr);
      });
    });
  }, []);

  useLayoutEffect(() => {
    if (!targetEl) return;
    targetEl.removeAttribute("data-lb-returning");
    targetEl.removeAttribute("data-lb-tuck-snap");
    targetEl.setAttribute("data-lb-lifted", "true");
    return () => {
      releaseLiftedSocket(targetEl);
    };
  }, [targetEl, releaseLiftedSocket]);

  // Reset exit state cleanly whenever a new payload opens
  useLayoutEffect(() => {
    if (exitRafRef.current) {
      cancelAnimationFrame(exitRafRef.current);
      exitRafRef.current = 0;
    }
    closingRef.current = false;
    setClosing(false);
    onExitingChange?.(false);
    setRemovedKeys([]);
    setLbRadial(null);
    if (rootRef.current) rootRef.current.style.opacity = "";
    if (stageAreaRef.current) {
      stageAreaRef.current.style.transform = "";
      stageAreaRef.current.style.filter = "";
      stageAreaRef.current.style.opacity = "";
    }
    if (heroCardRef.current) {
      heroCardRef.current.style.opacity = "";
    }
    if (frontFaceRef.current) {
      frontFaceRef.current.style.clipPath = "";
    }
    if (irisVeilRef.current) {
      irisVeilRef.current.style.opacity = "0";
      irisVeilRef.current.style.transform = "";
    }
  }, [payload]);

  useEffect(() => {
    return () => {
      if (exitRafRef.current) cancelAnimationFrame(exitRafRef.current);
    };
  }, []);

  const exitStyle = cfg.exitStyle || "silk";
  const exitDurationMs = getExitStyleParams(cfg, exitStyle).durationMs;

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    exitAllFullscreen();
    const mode = cfg.exitStyle || "silk";
    const dur = getExitStyleParams(cfg, mode).durationMs;

    if (mode === "instant" || !rootRef.current) {
      releaseLiftedSocket(payload?.originEl);
      onClose();
      return;
    }

    closingRef.current = true;
    setClosing(true);
    onExitingChange?.(true);

    // Pause active video quietly as we exit
    if (videoRef.current && !videoRef.current.paused) {
      try {
        videoRef.current.pause();
      } catch {}
    }

    const originEl =
      targetEl ||
      (activeItem && payload?.item && itemKey(activeItem) === itemKey(payload.item)
        ? payload?.originEl
        : null);
    const trueSock = getElementTrueRectAndAngle(originEl);
    const isInitialItem = Boolean(
      activeItem && payload?.item && itemKey(activeItem) === itemKey(payload.item)
    );
    const sockRect = trueSock
      ? trueSock
      : isInitialItem && payload?.origin && payload.origin.w > 4 && payload.origin.h > 4
      ? {
          left: payload.origin.cx - payload.origin.w / 2,
          top: payload.origin.cy - payload.origin.h / 2,
          width: payload.origin.w,
          height: payload.origin.h,
          rz: payload.origin.rz || 0,
        }
      : null;

    const card = heroCardRef.current;
    const frontFace = frontFaceRef.current;
    const stage = stageAreaRef.current;
    const bg = backdropRef.current;
    const iris = irisVeilRef.current;

    const canTuck =
      mode === "tuck" &&
      Boolean(originEl && sockRect && card && !flightRunning && zoom.scale <= 1.05);

    if (!canTuck && originEl) {
      // Begin the 180ms thumbnail fade-back inside its dashed socket right away
      releaseLiftedSocket(originEl);
    }

    const cardRect = canTuck && card ? card.getBoundingClientRect() : null;
    const totalMs = flightRunning ? 160 : Math.max(100, dur);
    const t0 = performance.now();
    let socketReleased = !canTuck;

    const tickExit = (now) => {
      const raw = Math.min(1, (now - t0) / totalMs);
      const e = 1 - Math.pow(1 - raw, 3);

      if (flightRunning && rootRef.current) {
        rootRef.current.style.opacity = String(1 - e);
      } else if (canTuck && card && cardRect && sockRect) {
        // Complete spatial landing at 84% so the tile underneath swaps cleanly behind the card
        const moveT = Math.min(1, raw / 0.84);
        const tuckE = 1 - Math.pow(1 - moveT, 3);
        const cardCx = cardRect.left + cardRect.width / 2;
        const cardCy = cardRect.top + cardRect.height / 2;
        const sockCx = sockRect.left + sockRect.width / 2;
        const sockCy = sockRect.top + sockRect.height / 2;
        const dx = (sockCx - cardCx) * tuckE;
        const dy = (sockCy - cardCy) * tuckE;
        const targetS = Math.max(
          sockRect.width / Math.max(1, cardRect.width),
          sockRect.height / Math.max(1, cardRect.height)
        );
        const s = 1 + (targetS - 1) * tuckE;
        const targetRot = Number.isFinite(sockRect.rz) ? sockRect.rz : 0;
        const rotDeg = targetRot * tuckE;
        card.style.transition = "none";
        card.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0px) rotate(${rotDeg.toFixed(
          2
        )}deg) scale(${s.toFixed(4)})`;
        if (frontFace) {
          const wEnd = cardRect.width * targetS;
          const hEnd = cardRect.height * targetS;
          const cropX = Math.max(0, (1 - sockRect.width / Math.max(1, wEnd)) * 50) * tuckE;
          const cropY = Math.max(0, (1 - sockRect.height / Math.max(1, hEnd)) * 50) * tuckE;
          frontFace.style.clipPath = `inset(${cropY.toFixed(2)}% ${cropX.toFixed(2)}% ${cropY.toFixed(
            2
          )}% ${cropX.toFixed(2)}% round ${(10 * tuckE).toFixed(1)}px)`;
        }
        if (bg) bg.style.opacity = String(Math.max(0, 1 - raw * 1.25));
        if (!socketReleased && raw >= 0.84 && originEl) {
          socketReleased = true;
          releaseLiftedSocket(originEl, true);
        }
        card.style.opacity = raw > 0.85 ? String(Math.max(0, 1 - (raw - 0.85) / 0.15)) : "1";
      } else if (mode === "drift" && stage) {
        stage.style.transform = `translate3d(0px, ${(16 * e).toFixed(2)}px, 0px) scale(${(
          1 -
          0.07 * e
        ).toFixed(4)})`;
        stage.style.opacity = String(1 - e);
        if (bg) bg.style.opacity = String(1 - e);
      } else if (mode === "iris" && stage) {
        stage.style.transform = `scale(${(1 - 0.06 * e).toFixed(4)})`;
        stage.style.filter = `blur(${(4 * e).toFixed(2)}px)`;
        stage.style.opacity = String(1 - e);
        if (bg) bg.style.opacity = String(1 - e);
        if (iris) {
          const bell = Math.sin(Math.min(1, raw * 1.08) * Math.PI);
          iris.style.opacity = String(Math.max(0, bell * 0.9));
          iris.style.transform = `scale(${(1.42 - 0.62 * e).toFixed(3)})`;
        }
      } else if (stage) {
        // Default: Silk Dissolve (also graceful fallback when Quiet Tuck lacks an origin socket)
        stage.style.transform = `scale(${(1 - 0.04 * e).toFixed(4)})`;
        stage.style.filter = `blur(${(10 * e).toFixed(2)}px)`;
        stage.style.opacity = String(1 - e);
        if (bg) bg.style.opacity = String(1 - e);
      }

      if (raw < 1) {
        exitRafRef.current = requestAnimationFrame(tickExit);
      } else {
        exitRafRef.current = 0;
        releaseLiftedSocket(originEl);
        onClose();
      }
    };

    exitRafRef.current = requestAnimationFrame(tickExit);
  }, [cfg, targetEl, activeItem, payload, flightRunning, zoom.scale, onClose, releaseLiftedSocket]);

  // Destination geometry matching current viewport, inspector, filmstrip & video 1:1 cap
  const itemAspect = useMemo(() => {
    if (activeItem?.media_type === "video" && videoDims.w > 0 && videoDims.h > 0) {
      return videoDims.w / videoDims.h;
    }
    return activeItem?.aspect_ratio || 1;
  }, [activeItem?.media_type, activeItem?.aspect_ratio, videoDims.w, videoDims.h]);

  const nativeVidW = useMemo(() => {
    if (activeItem?.media_type !== "video") return 0;
    return (videoDims.w > 0 ? videoDims.w : activeItem?.width) || 0;
  }, [activeItem?.media_type, activeItem?.width, videoDims.w]);

  const nativeVidH = useMemo(() => {
    if (activeItem?.media_type !== "video") return 0;
    return (videoDims.h > 0 ? videoDims.h : activeItem?.height) || 0;
  }, [activeItem?.media_type, activeItem?.height, videoDims.h]);

  const effectiveVideoMode = isLbFullscreen ? "fit" : videoSizeMode;

  const dest = useMemo(
    () =>
      computeLightboxDestRect(
        vp.w,
        vp.h,
        itemAspect,
        isLbFullscreen ? false : cfg.inspectorOpen,
        isLbFullscreen ? false : cfg.filmstripOpen,
        isLbFullscreen ? 0 : cfg.edgePadding,
        activeItem?.media_type === "video" && effectiveVideoMode === "native" && nativeVidW > 0 && nativeVidH > 0
          ? { capWidth: nativeVidW, capHeight: nativeVidH }
          : undefined
      ),
    [
      vp.w,
      vp.h,
      itemAspect,
      isLbFullscreen,
      cfg.inspectorOpen,
      cfg.filmstripOpen,
      cfg.edgePadding,
      activeItem?.media_type,
      effectiveVideoMode,
      nativeVidW,
      nativeVidH,
    ]
  );

  // Sync activeItem & trigger 60fps 360° Hero Card Flight synchronously before first paint
  useLayoutEffect(() => {
    if (!payload?.item) {
      setCurrentItem(null);
      setFlightRunning(false);
      return;
    }

    setCurrentItem(payload.item);
    setHiResLoaded(false);
    setZoom({ scale: 1, tx: 0, ty: 0 });
    setZoomSmooth(false);
    setPureView(false);
    setVPlaying(true);
    setVTime(0);
    setVideoDims({ w: 0, h: 0 });
    const defaultVidMode = cfg.videoDefault1to1 !== false ? "native" : "fit";
    setVideoSizeMode(defaultVidMode);

    const origin = payload.origin;
    const isInitialVideo = payload.item.media_type === "video";
    const initCapW = isInitialVideo && defaultVidMode === "native" ? Number(payload.item.width) || 0 : 0;
    const initCapH = isInitialVideo && defaultVidMode === "native" ? Number(payload.item.height) || 0 : 0;
    const d = computeLightboxDestRect(
      window.innerWidth,
      window.innerHeight,
      payload.item.aspect_ratio || 1,
      cfg.inspectorOpen,
      cfg.filmstripOpen,
      cfg.edgePadding,
      initCapW > 0 && initCapH > 0 ? { capWidth: initCapW, capHeight: initCapH } : undefined
    );

    const styleMode = cfg.entryStyle || "spin";

    const resetFlightDom = () => {
      if (heroCardRef.current) {
        heroCardRef.current.style.transform = "";
        heroCardRef.current.style.visibility = "";
      }
      if (frontFaceRef.current) frontFaceRef.current.style.clipPath = "none";
      if (backFaceRef.current) {
        backFaceRef.current.style.clipPath = "none";
        backFaceRef.current.style.display = "";
      }
      if (teleOriginRef.current) {
        teleOriginRef.current.style.display = "none";
        teleOriginRef.current.style.clipPath = "none";
      }
      if (teleHoloRef.current) {
        teleHoloRef.current.style.opacity = "0";
        teleHoloRef.current.style.clipPath = "none";
        teleHoloRef.current.classList.remove("is-locked");
      }
      const cvs = teleCanvasRef.current;
      if (cvs) {
        const ctx = cvs.getContext("2d");
        ctx?.clearRect(0, 0, cvs.width, cvs.height);
      }
    };

    if (styleMode === "instant" || !origin || !heroCardRef.current) {
      resetFlightDom();
      setFlightRunning(false);
      if (backdropRef.current) backdropRef.current.style.opacity = "1";
      return;
    }

    setFlightRunning(true);
    const sp = getStyleParams(cfg, styleMode);
    const duration = clamp(Number(sp.durationMs) || 560, 200, 1400);
    let rafId = 0;
    const t0 = performance.now();

    // Branch 0: WebGL Fluid Membrane ("venom") & Silk Fabric ("cloth")
    if (styleMode === "venom" || styleMode === "cloth") {
      const rgbRaw =
        getComputedStyle(document.documentElement).getPropertyValue("--hm-accent-rgb").trim() ||
        "168, 85, 247";
      if (heroCardRef.current) heroCardRef.current.style.visibility = "hidden";
      if (backFaceRef.current) backFaceRef.current.style.display = "none";

      const cancelGL = startWebGLMembraneFlight({
        canvas: glCanvasRef.current,
        backdropEl: backdropRef.current,
        mode: styleMode,
        thumbUrl: makeThumbUrl(payload.item),
        origin,
        dest: d,
        durationMs: duration,
        intensity: sp.intensity ?? 75,
        accentRgbStr: rgbRaw,
        onComplete: () => {
          resetFlightDom();
          if (backdropRef.current) backdropRef.current.style.opacity = "1";
          setFlightRunning(false);
        },
      });

      return () => {
        cancelGL();
        resetFlightDom();
      };
    }

    // Branch A: Theme-Colored Teleport (Dematerialize -> Energy Stream -> Mirrored Spawn)
    if (styleMode === "teleport") {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cvs = teleCanvasRef.current;
      const ctx = cvs ? cvs.getContext("2d") : null;
      if (cvs && ctx) {
        cvs.width = Math.round(vw * dpr);
        cvs.height = Math.round(vh * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const rgbRaw =
        getComputedStyle(document.documentElement).getPropertyValue("--hm-accent-rgb").trim() ||
        "168, 85, 247";
      const particles = createTeleportParticles(origin, d, 148);
      const oLeft = origin.cx - origin.w * 0.5;
      const oTop = origin.cy - origin.h * 0.5;
      const dLeft = d.stageCx - d.w * 0.5;
      const dTop = d.stageCy - d.h * 0.5;

      if (heroCardRef.current) heroCardRef.current.style.transform = "";
      if (backFaceRef.current) backFaceRef.current.style.display = "none";
      if (teleOriginRef.current) {
        const to = teleOriginRef.current;
        to.style.display = "block";
        to.style.left = `${oLeft.toFixed(1)}px`;
        to.style.top = `${oTop.toFixed(1)}px`;
        to.style.width = `${origin.w.toFixed(1)}px`;
        to.style.height = `${origin.h.toFixed(1)}px`;
        to.style.transform = origin.rz ? `rotate(${origin.rz.toFixed(2)}deg)` : "";
      }

      const drawBeam = (bx, by, bh, dirSign) => {
        if (!ctx) return;
        const grad = ctx.createLinearGradient(bx - dirSign * 42, 0, bx + dirSign * 8, 0);
        grad.addColorStop(0, `rgba(${rgbRaw}, 0)`);
        grad.addColorStop(0.76, `rgba(${rgbRaw}, 0.42)`);
        grad.addColorStop(0.95, `rgba(255, 255, 255, 0.92)`);
        grad.addColorStop(1, `rgba(${rgbRaw}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(Math.min(bx - dirSign * 42, bx + dirSign * 8), by, 50, bh);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = 2;
        ctx.shadowColor = `rgba(${rgbRaw}, 0.95)`;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx, by + bh);
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      const applyTeleportFrame = (raw) => {
        if (backdropRef.current) {
          backdropRef.current.style.opacity = String(clamp(raw * 2.5, 0, 1));
        }

        // Phase 1: Dissolve source card behind left-to-right scan beam (0 -> 0.44)
        const beamOut = clamp(raw / 0.44, 0, 1);
        if (teleOriginRef.current) {
          if (beamOut >= 1) {
            teleOriginRef.current.style.display = "none";
          } else {
            teleOriginRef.current.style.clipPath = `inset(0 0 0 ${(beamOut * 100).toFixed(2)}%)`;
          }
        }

        // Phase 2: Mirrored spawn reveal (0.36 -> 0.84), then bright Lock-In Flash (0.84 -> 0.91 -> 1.0)
        const beamIn = clamp((raw - 0.36) / 0.48, 0, 1);
        const spawnClip =
          beamIn <= 0
            ? "inset(0 100% 0 0 round 12px)"
            : beamIn >= 1
            ? "none"
            : `inset(0 ${((1 - beamIn) * 100).toFixed(2)}% 0 0 round 12px)`;

        if (frontFaceRef.current) {
          frontFaceRef.current.style.clipPath = spawnClip;
        }

        if (teleHoloRef.current) {
          if (sp.teleportHoloRim === false) {
            teleHoloRef.current.style.opacity = "0";
            teleHoloRef.current.classList.remove("is-locked");
          } else {
            teleHoloRef.current.style.clipPath = spawnClip;
            if (raw < 0.84) {
              teleHoloRef.current.classList.remove("is-locked");
              teleHoloRef.current.style.opacity = beamIn <= 0 ? "0" : "0.74";
            } else if (raw < 0.91) {
              // Brief bright "Teleport Locked" confirmation flash
              teleHoloRef.current.classList.add("is-locked");
              teleHoloRef.current.style.opacity = "1";
            } else {
              teleHoloRef.current.classList.add("is-locked");
              teleHoloRef.current.style.opacity = String(clamp(1 - (raw - 0.91) / 0.09, 0, 1));
            }
          }
        }

        if (ctx) {
          ctx.clearRect(0, 0, vw, vh);
          if (raw < 0.44) {
            drawBeam(oLeft + origin.w * beamOut, oTop - 6, origin.h + 12, 1);
          }

          // Stream glowing theme embers along curved bezier arcs
          for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            if (raw < p.startT || raw > p.arriveT + 0.08) continue;
            const spanT = Math.max(0.08, p.arriveT - p.startT);
            const t = clamp((raw - p.startT) / spanT, 0, 1);
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const mt = 1 - e;
            const mx = (p.ox + p.dx) * 0.5 + p.arcX;
            const my = (p.oy + p.dy) * 0.5 + p.arcY;
            const px = mt * mt * p.ox + 2 * mt * e * mx + e * e * p.dx;
            const py = mt * mt * p.oy + 2 * mt * e * my + e * e * p.dy;

            const fadeOutTail = raw > p.arriveT ? 1 - (raw - p.arriveT) / 0.08 : 1;
            const alpha = clamp(Math.sin(t * Math.PI) * 1.15, 0.25, 0.95) * fadeOutTail;

            ctx.fillStyle = p.bright
              ? `rgba(255, 255, 255, ${(alpha * 0.9).toFixed(3)})`
              : `rgba(${rgbRaw}, ${alpha.toFixed(3)})`;
            ctx.shadowColor = `rgba(${rgbRaw}, 0.9)`;
            ctx.shadowBlur = p.bright ? 10 : 6;
            const sz = p.size * (0.65 + Math.sin(t * Math.PI) * 0.6);
            ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);
          }
          ctx.shadowBlur = 0;

          if (raw > 0.36 && raw < 0.85) {
            drawBeam(dLeft + d.w * beamIn, dTop - 8, d.h + 16, 1);
          }
        }
      };

      applyTeleportFrame(0);
      const tickTele = (now) => {
        const raw = clamp((now - t0) / duration, 0, 1);
        applyTeleportFrame(raw);
        if (raw < 1) {
          rafId = requestAnimationFrame(tickTele);
        } else {
          resetFlightDom();
          if (backdropRef.current) backdropRef.current.style.opacity = "1";
          setFlightRunning(false);
        }
      };
      rafId = requestAnimationFrame(tickTele);
      return () => {
        cancelAnimationFrame(rafId);
        resetFlightDom();
      };
    }

    // Branch B: Hero Glide & 360° Photo Card Spin
    const doSpin = styleMode === "spin";
    if (backFaceRef.current) backFaceRef.current.style.display = doSpin ? "" : "none";
    const dxStart = origin.cx - d.stageCx;
    const dyStart = origin.cy - d.stageCy;
    const uScale = clamp(Math.max(origin.w / d.w, origin.h / d.h), 0.04, 1.4);
    const trimX = Math.max(0, (d.w - origin.w / uScale) * 0.5);
    const trimY = Math.max(0, (d.h - origin.h / uScale) * 0.5);
    const startRx = origin.rx || 0;
    const startRy = origin.ry || 0;
    const startRz = origin.rz || 0;

    const applyFrame = (raw) => {
      const card = heroCardRef.current;
      const bg = backdropRef.current;
      if (!card) return;

      const posEase = 1 - Math.pow(1 - raw, 2.6);
      const scaleEase = raw * raw * (3 - 2 * raw); // expands cleanly *after* passing 180° edge
      const spinPhase = clamp(raw / 0.78, 0, 1);
      const spinEase = 1 - Math.pow(1 - spinPhase, 2.35); // kicks off right on click!

      // Subtle tactile cushion bounce peaking softly near landing & settling exact 1.0 at t=1
      let cushion = 0;
      if (sp.cushionSlap && raw > 0.76 && raw < 1) {
        const u = (raw - 0.76) / 0.24;
        cushion = Math.sin(u * Math.PI) * 0.011 * (1 - u * 0.25);
      }

      const x = dxStart * (1 - posEase);
      const y = dyStart * (1 - posEase);
      const tz = doSpin ? -Math.sin(spinPhase * Math.PI) * Math.min(340, d.w * 0.16) : 0;
      const sc = (uScale + (1 - uScale) * scaleEase) * (1 + cushion);
      const rx = startRx * (1 - posEase);
      const rz = startRz * (1 - posEase);
      const ry = doSpin ? startRy * (1 - posEase) + 360 * spinEase : startRy * (1 - posEase);

      const cx = trimX * (1 - scaleEase);
      const cy = trimY * (1 - scaleEase);
      const br = 12 * scaleEase + (10 / uScale) * (1 - scaleEase);

      card.style.transform = `perspective(2800px) translate3d(${x.toFixed(2)}px, ${y.toFixed(
        2
      )}px, ${tz.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(
        2
      )}deg) rotateZ(${rz.toFixed(2)}deg) scale(${sc.toFixed(4)})`;

      // Apply crop inset ONLY to the leaf faces (never on preserve-3d parent, which flattens 3D!)
      const nextClip =
        cx > 0.4 || cy > 0.4
          ? `inset(${cy.toFixed(1)}px ${cx.toFixed(1)}px round ${br.toFixed(1)}px)`
          : "none";
      if (frontFaceRef.current) frontFaceRef.current.style.clipPath = nextClip;
      if (backFaceRef.current) backFaceRef.current.style.clipPath = nextClip;

      if (bg) {
        bg.style.opacity = String(clamp(raw * 2.4, 0, 1));
      }
    };

    applyFrame(0);

    const tick = (now) => {
      const raw = clamp((now - t0) / duration, 0, 1);
      applyFrame(raw);
      if (raw < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        resetFlightDom();
        if (backdropRef.current) backdropRef.current.style.opacity = "1";
        setFlightRunning(false);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      resetFlightDom();
    };
  }, [payload]);

  const currentIdx = useMemo(() => {
    if (!activeItem || !scopedItems.length) return -1;
    const k = itemKey(activeItem);
    return scopedItems.findIndex((it) => itemKey(it) === k);
  }, [activeItem, scopedItems]);

  const selectItem = useCallback(
    (nextItem) => {
      if (!nextItem) return;
      setCurrentItem(nextItem);
      setHiResLoaded(false);
      setZoom({ scale: 1, tx: 0, ty: 0 });
      setZoomSmooth(false);
      setVPlaying(true);
      setVTime(0);
      setVideoDims({ w: 0, h: 0 });
      setVideoSizeMode(cfg.videoDefault1to1 !== false ? "native" : "fit");
    },
    [cfg.videoDefault1to1]
  );

  const handlePrev = useCallback(() => {
    if (scopedItems.length <= 1) return;
    const idx = currentIdx >= 0 ? currentIdx : 0;
    selectItem(scopedItems[(idx - 1 + scopedItems.length) % scopedItems.length]);
  }, [scopedItems, currentIdx, selectItem]);

  const handleNext = useCallback(() => {
    if (scopedItems.length <= 1) return;
    const idx = currentIdx >= 0 ? currentIdx : 0;
    selectItem(scopedItems[(idx + 1) % scopedItems.length]);
  }, [scopedItems, currentIdx, selectItem]);

  // Clamp panning comfortably so artwork stays reachable on stage
  const clampPan = useCallback(
    (tx, ty, scale) => {
      if (scale <= 1.005) return { tx: 0, ty: 0 };
      const maxX = Math.max(40, dest.w * scale * 0.5);
      const maxY = Math.max(40, dest.h * scale * 0.5);
      return {
        tx: clamp(tx, -maxX, maxX),
        ty: clamp(ty, -maxY, maxY),
      };
    },
    [dest.w, dest.h]
  );

  // Cursor-aimed zoom helper
  const zoomTowardPoint = useCallback(
    (nextScaleRaw, clientX, clientY, smooth = false) => {
      const nextScale = clamp(nextScaleRaw, 1, 6);
      setZoomSmooth(smooth);
      if (nextScale <= 1.005) {
        panRef.current.active = false;
        panRef.current.moved = false;
      }
      setZoom((prev) => {
        if (nextScale <= 1.005) return { scale: 1, tx: 0, ty: 0 };
        const mx = (clientX ?? dest.stageCx) - dest.stageCx;
        const my = (clientY ?? dest.stageCy) - dest.stageCy;
        const rawTx = mx - ((mx - prev.tx) / prev.scale) * nextScale;
        const rawTy = my - ((my - prev.ty) / prev.scale) * nextScale;
        const c = clampPan(rawTx, rawTy, nextScale);
        return { scale: nextScale, tx: c.tx, ty: c.ty };
      });
    },
    [dest.stageCx, dest.stageCy, clampPan]
  );

  const native1to1Scale = useMemo(() => {
    const nw = activeItem?.width || dest.w;
    return clamp(nw / Math.max(1, dest.w), 1.2, 6);
  }, [activeItem?.width, dest.w]);

  const handleWheelZoom = (e) => {
    if (flightRunning) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0018);
    zoomTowardPoint(zoom.scale * factor, e.clientX, e.clientY, false);
  };

  const handleDoubleClick = (e) => {
    if (flightRunning || activeItem?.media_type === "video") return;
    if (zoom.scale > 1.06) {
      zoomTowardPoint(1, e.clientX, e.clientY, true);
    } else {
      zoomTowardPoint(native1to1Scale, e.clientX, e.clientY, true);
    }
  };

  const handleStagePointerDown = (e) => {
    panRef.current.moved = false;
    if (flightRunning || e.button !== 0 || zoom.scale <= 1.02) return;
    e.preventDefault();
    setZoomSmooth(false);
    setIsPanning(true);
    panRef.current = {
      active: true,
      sx: e.clientX,
      sy: e.clientY,
      stx: zoom.tx,
      sty: zoom.ty,
      moved: false,
    };
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!panRef.current.active) return;
      const dx = e.clientX - panRef.current.sx;
      const dy = e.clientY - panRef.current.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panRef.current.moved = true;
      const c = clampPan(panRef.current.stx + dx, panRef.current.sty + dy, zoom.scale);
      setZoom((prev) => ({ ...prev, tx: c.tx, ty: c.ty }));
    };
    const onUp = () => {
      if (panRef.current.active) {
        panRef.current.active = false;
        setIsPanning(false);
        requestAnimationFrame(() => {
          panRef.current.moved = false;
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [zoom.scale, clampPan]);

  const toggleVideoPlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  // Auto-hide HUD on idle mouse
  const kickIdleTimer = useCallback(() => {
    setHudIdle(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (cfg.autoHideHud && !cfg.inspectorOpen) {
      idleTimerRef.current = setTimeout(() => setHudIdle(true), 2400);
    }
  }, [cfg.autoHideHud, cfg.inspectorOpen]);

  useEffect(() => {
    if (!activeItem) return;
    kickIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [activeItem, kickIdleTimer]);

  const advanceAfterRemoval = useCallback(
    (target, idxHint) => {
      const k = itemKey(target);
      setRemovedKeys((prev) => (prev.includes(k) ? prev : [...prev, k]));
      const remaining = scopedItems.filter((it) => itemKey(it) !== k);
      if (remaining.length === 0) {
        onClose();
      } else {
        const nextItem = remaining[Math.min(Math.max(0, idxHint), remaining.length - 1)];
        selectItem(nextItem);
      }
    },
    [scopedItems, onClose, selectItem]
  );

  const handlePurgatoryInsideLightbox = useCallback(
    async (target) => {
      if (!target || !onSendToPurgatory || stageDeletingRef.current) return;
      stageDeletingRef.current = true;
      const idx = scopedItems.findIndex((it) => itemKey(it) === itemKey(target));
      const heroEl = heroCardRef.current;
      const prevOp = heroEl ? heroEl.style.opacity : "";
      if (heroEl) heroEl.style.opacity = "0";
      let ok = false;
      try {
        ok = await onSendToPurgatory(target, heroEl);
      } finally {
        if (heroEl) heroEl.style.opacity = prevOp;
        stageDeletingRef.current = false;
      }
      if (ok) advanceAfterRemoval(target, idx);
    },
    [scopedItems, onSendToPurgatory, advanceAfterRemoval]
  );

  const handleRescueInsideLightbox = useCallback(
    async (target) => {
      if (!target || !onRescueFromPurgatory || stageDeletingRef.current) return;
      const idx = scopedItems.findIndex((it) => itemKey(it) === itemKey(target));
      await onRescueFromPurgatory(target);
      advanceAfterRemoval(target, idx);
    },
    [scopedItems, onRescueFromPurgatory, advanceAfterRemoval]
  );

  const handleBurnInsideLightbox = useCallback(
    async (target) => {
      if (!target || !onBurnItem || stageDeletingRef.current) return;
      stageDeletingRef.current = true;
      const idx = scopedItems.findIndex((it) => itemKey(it) === itemKey(target));
      const heroEl = heroCardRef.current;
      const prevOp = heroEl ? heroEl.style.opacity : "";
      if (heroEl) heroEl.style.opacity = "0";
      let ok = false;
      try {
        ok = await onBurnItem(target, heroEl);
      } finally {
        if (heroEl) heroEl.style.opacity = prevOp;
        stageDeletingRef.current = false;
      }
      if (ok) advanceAfterRemoval(target, idx);
    },
    [scopedItems, onBurnItem, advanceAfterRemoval]
  );

  // Keyboard shortcuts (capture phase so background grid/conveyor WASD & Arrows never scroll behind modal)
  useEffect(() => {
    if (!activeItem) return;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (closingRef.current) {
        e.stopImmediatePropagation();
        return;
      }
      // Let open dropdown portals handle Esc / Arrows without closing lightbox or moving background
      if (document.querySelector(".hm-select-menu")) {
        e.stopPropagation();
        return;
      }

      const k = e.key.toLowerCase();
      const hasMod = e.ctrlKey || e.metaKey || e.altKey;
      const isNavKey = ["a", "d", "w", "s", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k);
      if (isNavKey && !hasMod) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }

      if (e.key === "Escape") {
        if (lbRadialRef.current) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (isLbFullscreen) {
          exitAllFullscreen();
        } else {
          requestClose();
        }
      } else if (e.key === "ArrowLeft" || (k === "a" && !hasMod)) {
        handlePrev();
      } else if (e.key === "ArrowRight" || (k === "d" && !hasMod)) {
        handleNext();
      } else if (k === "m" && !hasMod && activeItem.media_type === "video") {
        e.stopImmediatePropagation();
        setVMuted((m) => !m);
      } else if (k === "i" && !hasMod) {
        e.stopImmediatePropagation();
        patchCfg({ inspectorOpen: !cfg.inspectorOpen });
      } else if (k === "h" && !hasMod) {
        e.stopImmediatePropagation();
        setPureView((v) => !v);
      } else if (k === "f" && !hasMod) {
        e.stopImmediatePropagation();
        curation?.toggleFavorite?.(activeItem);
      } else if ((e.key === "Delete" || k === "x") && !hasMod) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.shiftKey) {
          handleBurnInsideLightbox(activeItem);
        } else if (curation?.isInPurgatory?.(activeItem)) {
          handleRescueInsideLightbox(activeItem);
        } else {
          handlePurgatoryInsideLightbox(activeItem);
        }
      } else if (e.key === "0" && !hasMod) {
        e.stopImmediatePropagation();
        if (activeItem.media_type === "video") {
          setVideoSizeMode("fit");
        } else {
          zoomTowardPoint(1, dest.stageCx, dest.stageCy, true);
        }
      } else if (e.key === "1" && !hasMod) {
        e.stopImmediatePropagation();
        if (activeItem.media_type === "video") {
          setVideoSizeMode("native");
        } else {
          zoomTowardPoint(native1to1Scale, dest.stageCx, dest.stageCy, true);
        }
      } else if (e.key === " " && activeItem.media_type === "video") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const vid = videoRef.current;
        if (vid) {
          if (vid.paused) vid.play().catch(() => {});
          else vid.pause();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    activeItem,
    isLbFullscreen,
    exitAllFullscreen,
    requestClose,
    handlePrev,
    handleNext,
    patchCfg,
    cfg.inspectorOpen,
    zoomTowardPoint,
    dest.stageCx,
    dest.stageCy,
    native1to1Scale,
    curation,
    handleBurnInsideLightbox,
    handleRescueInsideLightbox,
    handlePurgatoryInsideLightbox,
  ]);

  const stopFilmstripGlide = useCallback(() => {
    const g = filmstripGlideRef.current;
    if (g.raf) {
      cancelAnimationFrame(g.raf);
      g.raf = 0;
    }
    g.target = null;
    g.lastTs = 0;
  }, []);

  // Auto-scroll active thumbnail into view in filmstrip
  useEffect(() => {
    stopFilmstripGlide();
    if (!cfg.filmstripOpen || !filmstripRef.current || currentIdx < 0) return;
    const activeEl = filmstripRef.current.children?.[currentIdx];
    activeEl?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [cfg.filmstripOpen, currentIdx, stopFilmstripGlide]);

  // Smooth rAF wheel glide for the bottom filmstrip (tames stepped mouse wheels & supports trackpads)
  const filmstripVisible = Boolean(cfg.filmstripOpen && !pureView && scopedItems.length > 1);
  useEffect(() => {
    const box = filmstripBoxRef.current;
    if (!filmstripVisible || !box) {
      stopFilmstripGlide();
      return;
    }

    const g = filmstripGlideRef.current;
    const stepGlide = (ts) => {
      const trackEl = filmstripRef.current;
      if (!trackEl || g.target == null) {
        g.raf = 0;
        g.lastTs = 0;
        return;
      }
      const maxScroll = Math.max(0, trackEl.scrollWidth - trackEl.clientWidth);
      const target = Math.max(0, Math.min(maxScroll, g.target));
      g.target = target;

      const diff = target - g.pos;
      if (Math.abs(diff) <= 0.5) {
        trackEl.scrollLeft = target;
        g.pos = target;
        g.raf = 0;
        g.target = null;
        g.lastTs = 0;
        return;
      }

      const dt = g.lastTs ? Math.min(0.05, Math.max(0.001, (ts - g.lastTs) / 1000)) : 1 / 60;
      g.lastTs = ts;
      const alpha = 1 - Math.exp(-16 * dt);
      g.pos += diff * alpha;
      trackEl.scrollLeft = g.pos;
      g.raf = requestAnimationFrame(stepGlide);
    };

    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const trackEl = filmstripRef.current;
      if (!trackEl) return;

      let raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!raw) return;
      if (e.deltaMode === 1) raw *= 32;
      else if (e.deltaMode === 2) raw *= trackEl.clientWidth * 0.8;

      // Gently tame discrete notched mouse jumps (~75-90px = ~1.1-1.3 thumbs) while keeping trackpad 1:1
      const step = Math.abs(raw) >= 40 ? raw * 0.75 : raw;
      const maxScroll = Math.max(0, trackEl.scrollWidth - trackEl.clientWidth);
      if (maxScroll <= 0) return;

      if (!g.raf || g.target == null) {
        g.pos = trackEl.scrollLeft;
        g.target = trackEl.scrollLeft;
      }
      g.target = Math.max(0, Math.min(maxScroll, g.target + step));

      if (!g.raf) {
        g.lastTs = 0;
        g.raf = requestAnimationFrame(stepGlide);
      }
    };

    box.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      box.removeEventListener("wheel", onWheel);
      stopFilmstripGlide();
    };
  }, [filmstripVisible, stopFilmstripGlide]);

  const lbRadialState = useMemo(() => {
    if (!lbRadial || !activeItem) return null;
    return {
      ...lbRadial,
      kind: "lightbox",
      title: activeItem.filename,
      items: buildLightboxRadialItems({
        item: activeItem,
        curation,
        comfyState,
        isZoomed: zoom.scale > 1.02,
        pureView,
        onResetFit: () => zoomTowardPoint(1, dest.stageCx, dest.stageCy, true),
        onZoom1to1: () => zoomTowardPoint(native1to1Scale, dest.stageCx, dest.stageCy, true),
        onToggleInspector: () => {
          setPureView(false);
          patchCfg({ inspectorOpen: !cfg.inspectorOpen });
        },
        onTogglePureView: () => setPureView((v) => !v),
        onSendToPurgatory: handlePurgatoryInsideLightbox,
        onRescueFromPurgatory: handleRescueInsideLightbox,
        onBurnItem: handleBurnInsideLightbox,
      }),
    };
  }, [
    lbRadial,
    activeItem,
    curation,
    comfyState,
    zoom.scale,
    pureView,
    zoomTowardPoint,
    dest.stageCx,
    dest.stageCy,
    native1to1Scale,
    patchCfg,
    cfg.inspectorOpen,
    handlePurgatoryInsideLightbox,
    handleRescueInsideLightbox,
    handleBurnInsideLightbox,
  ]);

  if (!payload || !activeItem) return null;

  const isVideo = activeItem.media_type === "video";
  const mediaUrl = makeMediaUrl(activeItem);
  const thumbUrl = makeThumbUrl(activeItem);
  const hideHud = pureView || (hudIdle && !cfg.inspectorOpen && !isVideo);
  const zoomPct = Math.round(zoom.scale * 100);
  const spinParams = getStyleParams(cfg, "spin");

  return (
    portalTarget ? createPortal(
    <div
      ref={rootRef}
      className={`lb-root ${pureView ? "is-pure-view" : ""} ${hideHud ? "is-hud-hidden" : ""} ${
        isLbFullscreen ? "is-true-fs" : ""
      } ${isLbFullscreen && !fsMouseAwake ? "is-fs-idle" : ""} ${
        cfg.inspectorOpen && !pureView && !isLbFullscreen ? "with-inspector" : ""
      } ${closing ? "is-closing" : ""}`}
      style={{ "--lb-exit-ms": `${exitDurationMs}ms` }}
      onMouseMove={() => {
        kickIdleTimer();
        wakeFsHud();
      }}
      onContextMenu={(e) => {
        if (e.target?.closest?.("input, textarea, .lb-inspector")) return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.button !== 2 || closingRef.current) return;
        if (e.target?.closest?.("input, textarea, .lb-inspector")) return;
        requestComfyRefresh();
        setLbRadial({
          x: e.clientX,
          y: e.clientY,
          openedAt: performance.now(),
          fromPointerDown: true,
        });
      }}
    >
      {/* Full-Viewport Cinema Backdrop */}
      <div
        ref={backdropRef}
        className="lb-backdrop"
        onClick={() => {
          if (
            typeof window !== "undefined" &&
            performance.now() - (window.__hmRadialDismissedAt || 0) < 260
          ) {
            return;
          }
          panRef.current.moved = false;
          if (isLbFullscreen) {
            exitAllFullscreen();
          } else {
            requestClose();
          }
        }}
      />

      {/* Active Stage Area (Shrinks cleanly when Inspector opens on wide screens) */}
      <div
        ref={stageAreaRef}
        className="lb-stage-area"
        style={{
          right: pureView || isLbFullscreen ? 0 : dest.inspectorW,
          bottom: pureView || isLbFullscreen ? 0 : dest.filmstripH,
        }}
        onWheel={handleWheelZoom}
        onDoubleClick={(e) => {
          if (
            e.target?.closest?.(
              ".lb-nav-arrow, .lb-hud-top, .lb-video-bar, .lb-filmstrip, .lb-pure-exit, .lb-fs-whisper, button, input, select, textarea, a"
            )
          ) {
            return;
          }
          if (activeItem?.media_type === "video") {
            toggleLightboxFullscreen();
          } else {
            handleDoubleClick(e);
          }
        }}
        onPointerDown={handleStagePointerDown}
        onClick={(e) => {
          if (
            typeof window !== "undefined" &&
            performance.now() - (window.__hmRadialDismissedAt || 0) < 260
          ) {
            return;
          }
          const wasMoved = panRef.current.moved;
          panRef.current.moved = false;
          const clickedCardOrHud = e.target?.closest?.(
            ".lb-hero-card, .lb-hud-top, .lb-nav-arrow, .lb-video-bar, .lb-filmstrip, .lb-inspector, .lb-pure-exit, .lb-fs-whisper"
          );
          if (!clickedCardOrHud && !wasMoved) {
            if (isLbFullscreen) {
              exitAllFullscreen();
            } else {
              requestClose();
            }
          }
        }}
      >
        {/* Ambient Ambilight Halo spilling uniformly outward around every aspect ratio */}
        {cfg.ambientGlow && (
          <div
            className={`lb-ambient-halo ${flightRunning ? "is-entering" : ""}`}
            style={{
              width: dest.w + 170,
              height: dest.h + 150,
            }}
          >
            <img src={thumbUrl} alt="" className="lb-ambient-art" draggable={false} />
          </div>
        )}

        {/* Teleport Holographic Destination Frame */}
        <div
          ref={teleHoloRef}
          className="lb-tele-holo"
          style={{ width: dest.w, height: dest.h }}
        />

        {/* Zoom & Pan Plane */}
        <div
          className={`lb-zoom-plane ${zoomSmooth ? "is-smooth" : ""} ${
            zoom.scale > 1.02 ? (isPanning ? "is-panning" : "is-zoomed") : ""
          }`}
          style={{
            width: dest.w,
            height: dest.h,
            transform: `translate3d(${zoom.tx.toFixed(1)}px, ${zoom.ty.toFixed(1)}px, 0px) scale(${zoom.scale.toFixed(
              4
            )})`,
          }}
        >
          {/* 3D Photo Card with White Hammelart Crest Back (spins cleanly on entry!) */}
          <div
            ref={heroCardRef}
            className={`lb-hero-card ${flightRunning ? "is-flying" : ""}`}
          >
            {/* Front Face */}
            <div ref={frontFaceRef} className="lb-card-face lb-card-front">
              {isVideo ? (
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  poster={thumbUrl}
                  autoPlay
                  loop={vLoop}
                  muted={vMuted}
                  playsInline
                  style={{ cursor: zoom.scale > 1.02 && isPanning ? "grabbing" : "pointer" }}
                  onClick={(e) => {
                    if (panRef.current.moved) return;
                    if (
                      typeof window !== "undefined" &&
                      performance.now() - (window.__hmRadialDismissedAt || 0) < 260
                    ) {
                      return;
                    }
                    toggleVideoPlayPause();
                  }}
                  onPlay={() => setVPlaying(true)}
                  onPause={() => setVPlaying(false)}
                  onTimeUpdate={(e) => setVTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => {
                    const vid = e.currentTarget;
                    setVDur(vid.duration || 0);
                    if (vid.videoWidth > 0 && vid.videoHeight > 0) {
                      setVideoDims({ w: vid.videoWidth, h: vid.videoHeight });
                    }
                    vid.playbackRate = vRate;
                  }}
                />
              ) : (
                <>
                  <img
                    src={thumbUrl}
                    alt=""
                    className={`lb-img-layer thumb ${hiResLoaded ? "is-faded" : ""}`}
                    draggable={false}
                  />
                  <img
                    src={mediaUrl}
                    alt={activeItem.filename}
                    className={`lb-img-layer full ${hiResLoaded ? "is-loaded" : ""}`}
                    onLoad={() => setHiResLoaded(true)}
                    draggable={false}
                  />
                </>
              )}
            </div>

            {/* Photo-Paper / Studio Backside with Optional Hammelart Crest */}
            <div
              ref={backFaceRef}
              className={`lb-card-face lb-card-back style-${spinParams.cardBackStyle || "white"}`}
              aria-hidden="true"
            >
              <div className="lb-photo-back-frame">
                {(spinParams.showBackLogo ?? true) && (
                  <>
                    <svg
                      viewBox="0 0 1024 960"
                      className="lb-photo-back-crest"
                      fill="currentColor"
                    >
                      <path d={HAMMELART_CREST_PATH} />
                    </svg>
                    <span className="lb-photo-back-wordmark">HAMMELART</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Floating Top HUD Bar */}
        <div
          className="lb-hud-top"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="lb-hud-pill lb-hud-left">
            {scopedItems.length > 0 && (
              <span className="lb-hud-index">
                {(currentIdx >= 0 ? currentIdx : 0) + 1} / {scopedItems.length}
              </span>
            )}
            {sourceLabel && <span className="lb-hud-zone">{sourceLabel}</span>}
            <span className="lb-hud-filename" title={activeItem.filename}>
              {activeItem.filename}
            </span>
          </div>

          <div className="lb-hud-pill lb-hud-right">
            {isVideo ? (
              <>
                <button
                  type="button"
                  className={`lb-hud-btn text ${videoSizeMode === "native" && !isLbFullscreen ? "active" : ""}`}
                  onClick={() => {
                    if (isLbFullscreen) document.exitFullscreen?.().catch(() => {});
                    setVideoSizeMode("native");
                  }}
                  title="Native 1:1 Pixels (1) — avoids stretching small videos"
                >
                  1:1
                </button>
                <button
                  type="button"
                  className={`lb-hud-btn text ${videoSizeMode === "fit" || isLbFullscreen ? "active" : ""}`}
                  onClick={() => setVideoSizeMode("fit")}
                  title="Fit Video to Stage (0)"
                >
                  Fit
                </button>
                <button
                  type="button"
                  className={`lb-hud-btn ${isLbFullscreen ? "active" : ""}`}
                  onClick={toggleLightboxFullscreen}
                  title={isLbFullscreen ? "Exit Fullscreen" : "Fullscreen Monitor"}
                >
                  {isLbFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                <span className="lb-hud-sep" />
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="lb-hud-btn"
                  onClick={() => zoomTowardPoint(zoom.scale / 1.35, dest.stageCx, dest.stageCy, true)}
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <button
                  type="button"
                  className={`lb-hud-btn text zoom-readout ${zoom.scale <= 1.02 ? "active" : ""}`}
                  onClick={() => zoomTowardPoint(1, dest.stageCx, dest.stageCy, true)}
                  title="Reset to Fit (0)"
                >
                  {zoom.scale <= 1.02 ? "Fit" : `${zoomPct}%`}
                </button>
                <button
                  type="button"
                  className={`lb-hud-btn text ${
                    Math.abs(zoom.scale - native1to1Scale) < 0.08 && native1to1Scale > 1.08
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    zoomTowardPoint(native1to1Scale, dest.stageCx, dest.stageCy, true)
                  }
                  title="Native 1:1 Pixels (1)"
                >
                  1:1
                </button>
                <button
                  type="button"
                  className="lb-hud-btn"
                  onClick={() => zoomTowardPoint(zoom.scale * 1.35, dest.stageCx, dest.stageCy, true)}
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  type="button"
                  className={`lb-hud-btn ${isLbFullscreen ? "active" : ""}`}
                  onClick={toggleLightboxFullscreen}
                  title={isLbFullscreen ? "Exit Fullscreen" : "Fullscreen Monitor"}
                >
                  {isLbFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                <span className="lb-hud-sep" />
              </>
            )}

            {scopedItems.length > 1 && (
              <button
                type="button"
                className={`lb-hud-btn ${cfg.filmstripOpen ? "active" : ""}`}
                onClick={() => patchCfg({ filmstripOpen: !cfg.filmstripOpen })}
                title="Toggle Thumbnail Filmstrip"
              >
                <Film size={14} />
              </button>
            )}

            <button
              type="button"
              className={`lb-hud-btn ${curation?.isFavorited?.(activeItem) ? "active" : ""}`}
              onClick={() => curation?.toggleFavorite?.(activeItem)}
              title="Toggle Favorite (F)"
            >
              <FavMark
                favIcon={favIcon}
                filled={Boolean(curation?.isFavorited?.(activeItem))}
                size={14}
              />
            </button>

            <button
              type="button"
              className={`lb-hud-btn ${curation?.isPinned?.(activeItem) ? "active" : ""}`}
              onClick={() => curation?.togglePin?.(activeItem)}
              title="Pin to top of gallery"
            >
              <Pin size={14} />
            </button>

            <button
              type="button"
              className={`lb-hud-btn ${curation?.isInPurgatory?.(activeItem) ? "active" : ""}`}
              onClick={(e) => {
                if (e.shiftKey) {
                  handleBurnInsideLightbox(activeItem);
                } else if (curation?.isInPurgatory?.(activeItem)) {
                  handleRescueInsideLightbox(activeItem);
                } else {
                  handlePurgatoryInsideLightbox(activeItem);
                }
              }}
              title={
                curation?.isInPurgatory?.(activeItem)
                  ? "Rescue from Purgatory (Del/X • Shift = Delete)"
                  : "Move to Purgatory (Del/X • Shift = Delete)"
              }
            >
              <Flame size={14} />
            </button>

            {!isVideo && (
              <button
                type="button"
                className="lb-hud-btn"
                onClick={() => curation?.copyCleanImage?.(activeItem)}
                title="Copy clean original PNG (metadata stripped)"
              >
                <Copy size={14} />
              </button>
            )}

            <button
              type="button"
              className={`lb-hud-btn ${pureView ? "active" : ""}`}
              onClick={() => setPureView((v) => !v)}
              title="Toggle Pure View (H)"
            >
              {pureView ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>

            <button
              type="button"
              className={`lb-hud-btn ${cfg.inspectorOpen ? "active" : ""}`}
              onClick={() => patchCfg({ inspectorOpen: !cfg.inspectorOpen })}
              title="Toggle Metadata & Lightbox FX Drawer (I)"
            >
              <Info size={14} />
            </button>

            <button
              type="button"
              className="lb-hud-btn close"
              onClick={requestClose}
              title="Close Lightbox (Esc)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Left / Right Edge Navigation Chevrons */}
        {scopedItems.length > 1 && (
          <>
            <button
              type="button"
              className="lb-nav-arrow prev"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              title="Previous (←)"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              type="button"
              className="lb-nav-arrow next"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              title="Next (→)"
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}

        {/* Custom Sleek Video Transport Bar */}
        {isVideo && (
          <div
            className="lb-video-bar"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="lb-hud-btn"
              onClick={toggleVideoPlayPause}
              title="Play / Pause (Space)"
            >
              {vPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>

            <span className="lb-video-time">
              {fmtTime(vTime)} / {fmtTime(vDur)}
            </span>

            <input
              type="range"
              className="lb-video-scrub"
              min={0}
              max={vDur || 1}
              step={0.02}
              value={Math.min(vTime, vDur || 1)}
              onChange={(e) => {
                const t = Number(e.target.value);
                if (videoRef.current) videoRef.current.currentTime = t;
                setVTime(t);
              }}
            />

            <button
              type="button"
              className="lb-hud-btn text"
              onClick={() => {
                const rates = [0.5, 1, 1.5, 2];
                const next = rates[(rates.indexOf(vRate) + 1) % rates.length];
                setVRate(next);
                if (videoRef.current) videoRef.current.playbackRate = next;
              }}
              title="Playback Speed"
            >
              {vRate}×
            </button>

            <button
              type="button"
              className={`lb-hud-btn ${vMuted ? "active" : ""}`}
              onClick={() => setVMuted((m) => !m)}
              title="Mute / Unmute"
            >
              {vMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>

            <button
              type="button"
              className={`lb-hud-btn ${vLoop ? "active" : ""}`}
              onClick={() => setVLoop((l) => !l)}
              title="Loop Playback"
            >
              <Repeat size={13} />
            </button>

            <button
              type="button"
              className={`lb-hud-btn ${isLbFullscreen ? "active" : ""}`}
              onClick={toggleLightboxFullscreen}
              title={isLbFullscreen ? "Exit Fullscreen" : "Fullscreen Video"}
            >
              {isLbFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        )}
      </div>

      {/* Minimal Ghost Chip to Exit Pure View */}
      {pureView && !isLbFullscreen && (
        <button
          type="button"
          className="lb-pure-exit"
          onClick={(e) => {
            e.stopPropagation();
            setPureView(false);
          }}
          title="Show HUD Controls (H)"
        >
          <Eye size={13} /> Show HUD (H)
        </button>
      )}

      {/* Whisper-quiet Fullscreen exit & keyboard hint — only appears briefly on mouse move */}
      {isLbFullscreen && (
        <div
          className={`lb-fs-whisper ${fsMouseAwake ? "is-awake" : ""}`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="lb-fs-exit-btn"
            onClick={exitAllFullscreen}
            title="Exit Fullscreen (Esc)"
          >
            <Minimize2 size={13} /> Exit Fullscreen (Esc)
          </button>
          <span className="lb-fs-keyhint">
            ← / → or A / D · {isVideo ? "Space · M Mute · " : ""}Esc
          </span>
        </div>
      )}

      {/* Collapsible Scoped Bottom Filmstrip */}
      {cfg.filmstripOpen && !pureView && scopedItems.length > 1 && (
        <div
          ref={filmstripBoxRef}
          className="lb-filmstrip"
          style={{ right: dest.inspectorW }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            e.stopPropagation();
            stopFilmstripGlide();
          }}
        >
          <div ref={filmstripRef} className="lb-filmstrip-track">
            {scopedItems.map((it, idx) => {
              const isAct = idx === currentIdx;
              return (
                <button
                  key={itemKey(it)}
                  type="button"
                  className={`lb-film-item ${isAct ? "active" : ""}`}
                  onClick={() => selectItem(it)}
                  title={it.filename}
                >
                  <img src={makeThumbUrl(it)} alt={it.filename} loading="lazy" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Slide-Over Metadata & Lightbox Behavior Drawer */}
      {cfg.inspectorOpen && !pureView && (
        <LightboxInspector
          item={activeItem}
          sourceLabel={sourceLabel}
          cfg={cfg}
          onPatchCfg={patchCfg}
          onSearchTag={onSearchTag}
          onCloseDrawer={() => patchCfg({ inspectorOpen: false })}
        />
      )}

      {/* Teleport & WebGL Fluid Membrane Overlays */}
      <div ref={teleOriginRef} className="lb-tele-origin" style={{ display: "none" }}>
        {payload?.item && (
          <img src={makeThumbUrl(payload.item)} alt="" draggable={false} />
        )}
      </div>
      <canvas ref={teleCanvasRef} className="lb-tele-canvas" />
      <canvas ref={glCanvasRef} className="lb-gl-canvas" />
      <div ref={irisVeilRef} className="lb-iris-veil" />
      <RadialMenu
        menuState={lbRadialState}
        onClose={() => setLbRadial(null)}
        onRightClickSwitch={(e, under) => {
          if (under?.closest?.("input, textarea, .lb-inspector")) {
            setLbRadial(null);
            return;
          }
          requestComfyRefresh();
          setLbRadial({
            x: e.clientX,
            y: e.clientY,
            openedAt: performance.now(),
            fromPointerDown: true,
          });
        }}
      />
    </div>
    , portalTarget) : null
  );
}

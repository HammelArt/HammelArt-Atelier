import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  Pause,
  Pin,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { captureInspectPayload, getMediaUrl, getThumbnailUrl, itemKey } from "../utils/lightboxFlight";
import { clamp, computePilePrintBox, createThrownBody, stepTablePile } from "../utils/tablePilePhysics";
import { buildTablePileCardRadialItems, buildTablePileDeskRadialItems } from "../utils/radialBuilders";
import { useStageFullscreen } from "../utils/stageFullscreen";
import RadialMenu from "./RadialMenu";
import warmStudioOakUrl from "../assets/textures/warm_studio_oak.avif";
import brandedStudioOakUrl from "../assets/textures/warm_studio_oak_hammelart.avif";

const DESK_TEXTURES = {
  warm_studio_oak_hammelart: brandedStudioOakUrl,
  warm_studio_oak: warmStudioOakUrl,
};

const CARD_SIZE_SCALES = {
  S: 0.72,
  M: 1.0,
  L: 1.28,
  XL: 1.54,
};

const PERMA_PINS_KEY = "argon_cb_perma_pins_v1";

function loadSavedPermaPins() {
  try {
    const raw = localStorage.getItem(PERMA_PINS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p) => p && p.key && p.item) : [];
  } catch {
    return [];
  }
}

function writeSavedPermaPins(list) {
  try {
    localStorage.setItem(PERMA_PINS_KEY, JSON.stringify(list));
  } catch {}
}

/**
 * Generates an organic serrated sawtooth clip-path polygon matching torn dispenser edges.
 */
function buildSerratedTapeClipPath(seed = 1) {
  const pts = [];
  const teeth = 7;
  const jit = (i, salt) => {
    const x = Math.sin(seed * 12.9898 + i * 78.233 + salt * 43.17) * 43758.5453;
    return x - Math.floor(x);
  };

  // Top edge -> Right serrated cut down
  for (let i = 0; i <= teeth * 2; i++) {
    const yPct = (i / (teeth * 2)) * 100;
    const isPeak = i % 2 === 0;
    const xPct = isPeak ? 100 - jit(i, 1) * 1.1 : 96.2 - jit(i, 2) * 1.3;
    pts.push(`${xPct.toFixed(1)}% ${yPct.toFixed(1)}%`);
  }
  // Bottom edge -> Left serrated cut up
  for (let i = teeth * 2; i >= 0; i--) {
    const yPct = (i / (teeth * 2)) * 100;
    const isPeak = i % 2 === 0;
    const xPct = isPeak ? jit(i, 3) * 1.1 : 3.8 + jit(i, 4) * 1.3;
    pts.push(`${xPct.toFixed(1)}% ${yPct.toFixed(1)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

function ScotchTapeStrip({ style, seed = 1 }) {
  const clipPath = buildSerratedTapeClipPath(seed);
  return (
    <div
      className="cb-scotch-tape"
      style={{ ...style, clipPath, WebkitClipPath: clipPath }}
      aria-hidden="true"
    >
      <svg className="cb-scotch-tape-glint" viewBox="0 0 120 32" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`tapeGlint_${seed}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.0)" />
            <stop offset="32%" stopColor="rgba(255,255,255,0.28)" />
            <stop offset="48%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="72%" stopColor="rgba(255,255,255,0.22)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.0)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="120" height="32" fill={`url(#tapeGlint_${seed})`} />
        <line x1="8" y1="4" x2="112" y2="4" stroke="rgba(255,255,255,0.34)" strokeWidth="0.8" />
        <line x1="10" y1="28" x2="110" y2="28" stroke="rgba(0,0,0,0.16)" strokeWidth="0.7" />
        <path
          d="M 28 2 Q 44 16 36 30 M 76 3 Q 84 14 78 29"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="0.9"
          fill="none"
        />
      </svg>
    </div>
  );
}

function ScotchTapeOverlay({ seed = 1 }) {
  const variant = Math.abs(seed) % 3;
  const tiltMicro = (((seed % 19) - 9) / 9) * 4.2;

  if (variant === 1) {
    return (
      <>
        <ScotchTapeStrip
          seed={seed}
          style={{
            width: "76px",
            height: "23px",
            top: "1px",
            left: "-20px",
            transform: `rotate(${(-38 + tiltMicro).toFixed(1)}deg)`,
          }}
        />
        <ScotchTapeStrip
          seed={seed + 77}
          style={{
            width: "74px",
            height: "22px",
            top: "1px",
            right: "-20px",
            transform: `rotate(${(36 - tiltMicro).toFixed(1)}deg)`,
          }}
        />
      </>
    );
  }

  if (variant === 2) {
    return (
      <>
        <ScotchTapeStrip
          seed={seed}
          style={{
            width: "84px",
            height: "24px",
            top: "2px",
            left: "-22px",
            transform: `rotate(${(-31 + tiltMicro).toFixed(1)}deg)`,
          }}
        />
        <ScotchTapeStrip
          seed={seed + 31}
          style={{
            width: "72px",
            height: "22px",
            bottom: "2px",
            right: "-19px",
            transform: `rotate(${(-33 - tiltMicro).toFixed(1)}deg)`,
          }}
        />
      </>
    );
  }

  return (
    <ScotchTapeStrip
      seed={seed}
      style={{
        width: "108px",
        height: "26px",
        top: "-13px",
        left: "50%",
        marginLeft: "-54px",
        transform: `rotate(${tiltMicro.toFixed(1)}deg)`,
      }}
    />
  );
}

function isVideoItem(item) {
  if (!item) return false;
  return Boolean(item.is_video) || /\.(mp4|webm|mov|mkv)$/i.test(item.filename || "");
}

function getFullResUrl(item) {
  return getMediaUrl(item);
}

function getThumbUrl(item) {
  return getThumbnailUrl(item);
}

export default function TablePileStage({
  playlist = [],
  playlistLen = 0,
  cfg = {},
  params = {},
  isActiveZone = true,
  lightboxOpen = false,
  screensaverMode = false,
  editing = false,
  onInspect,
  onReshufflePlaylist,
  onPatchParams,
  onOpenDrawer,
}) {
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ w: 960, h: 600 });
  const [localPaused, setLocalPaused] = useState(false);
  const [hudActive, setHudActive] = useState(false);
  const { isFullscreen, toggleFullscreen: handleToggleFullscreen } = useStageFullscreen(stageRef, {
    escapeDisabled: Boolean(lightboxOpen),
  });
  const hudTimerRef = useRef(null);
  const isHoverStageRef = useRef(false);

  const shuffleOn = cfg.shuffle !== false;
  const ambientHaloOn = cfg.ambientHalo !== false;
  const haloStrength = clamp(Number(cfg.haloStrength ?? 55), 0, 100);
  const holdMs = clamp(Number(cfg.holdSec ?? 6), 1.5, 60) * 1000;
  const cornerRadius = clamp(Number(cfg.cornerRadius ?? 12), 0, 32);

  const hoverControlsOn = screensaverMode ? false : isFullscreen || cfg.hoverControls !== false;
  const showProgressOn = !screensaverMode && !isFullscreen && Boolean(cfg.showTimerBar);
  const allowInspect = !screensaverMode && Boolean(onInspect);
  const allowFlick = !screensaverMode && params.handFlick !== false;
  const allowRadial = !screensaverMode && !editing && !lightboxOpen;
  const paperBorderOn = params.paperBorder !== false;
  const paperTone =
    params.paperTone === "white" ? "white" : params.paperTone === "charcoal" ? "charcoal" : "cotton";
  const matPx = paperBorderOn ? clamp(Math.round(Number(params.borderThickness ?? 14)), 4, 36) : 0;
  const pileDepth = clamp(Math.round(Number(params.pileDepth ?? 14)), 4, 24);
  const deskSurface = params.deskSurface || "warm_studio_oak_hammelart";
  const deskTextureUrl = DESK_TEXTURES[deskSurface] || null;
  const deskVignette = clamp(Number(params.deskVignette ?? 42), 0, 85) * 0.01;

  // Measure viewport cleanly across Single, Wall Zone, Fullscreen, Screensaver
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 30 && r.height > 30) {
        stageMeasuredRef.current = true;
        setStageSize({ w: r.width, h: r.height });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Simulated body state lives in refs so rAF runs at 120fps without React overhead;
  // `renderIds` triggers React DOM mounts/unmounts ONLY when cards spawn or finish fading out.
  const bodiesRef = useRef([]);
  const nodeMapRef = useRef(new Map());
  const progressBarRef = useRef(null);
  const haloLayerRef = useRef(null);
  const uidCounterRef = useRef(1);
  const lastEdgeRef = useRef(null);
  const holdElapsedRef = useRef(0);
  const curPlaylistIdxRef = useRef(0);
  const dragSessionRef = useRef(null);
  const stageMeasuredRef = useRef(false);
  const permaRestoredRef = useRef(false);

  const [renderList, setRenderList] = useState([]);
  const [activeIdxUi, setActiveIdxUi] = useState(0);
  const [topHaloItem, setTopHaloItem] = useState(null);
  const [hiResUids, setHiResUids] = useState(() => new Set());
  const [pinnedUids, setPinnedUids] = useState(() => new Set());
  const [permaUids, setPermaUids] = useState(() => new Set());
  const [pileRadial, setPileRadial] = useState(null);
  const decodeCacheRef = useRef(new Map());

  const persistPermaPins = useCallback(
    (wOverride, hOverride) => {
      const sw = Math.max(100, wOverride || stageSize.w);
      const sh = Math.max(100, hOverride || stageSize.h);
      const list = bodiesRef.current
        .filter((b) => b.permaPinned && !b.exiting)
        .map((b) => {
          const nx = clamp(b.x / sw, -0.46, 0.46);
          const ny = clamp(b.y / sh, -0.46, 0.46);
          b.nx = nx;
          b.ny = ny;
          return {
            key: itemKey(b.item),
            item: {
              filename: b.item.filename,
              subfolder: b.item.subfolder || "",
              aspect_ratio: b.item.aspect_ratio,
              width: b.item.width,
              height: b.item.height,
              is_video: b.item.is_video,
            },
            nx,
            ny,
            angle: Number(b.angle.toFixed(2)),
            sizeKey: b.sizeKey || "M",
            sizeScale: b.sizeScale || 1.0,
            tapeSeed: b.tapeSeed || 1,
          };
        });
      writeSavedPermaPins(list);
      setPermaUids(new Set(bodiesRef.current.filter((b) => b.permaPinned).map((b) => b.uid)));
    },
    [stageSize.w, stageSize.h]
  );

  const enforcePileDepth = useCallback((depth) => {
    const arr = bodiesRef.current;
    // Session-pinned and perma-pinned prints never fade under Pile Depth
    const unpinnedLive = arr.filter((b) => !b.exiting && !b.tablePinned && !b.permaPinned);
    const excess = unpinnedLive.length - depth;
    if (excess > 0) {
      for (let i = 0; i < excess; i++) {
        unpinnedLive[i].exiting = true;
      }
    }
  }, []);

  const spawnSlideAt = useCallback(
    (idx, reverseBias = false) => {
      if (playlistLen === 0) return;
      const permaKeySet = new Set(
        bodiesRef.current.filter((b) => b.permaPinned).map((b) => itemKey(b.item))
      );
      let wrapped = ((idx % playlistLen) + playlistLen) % playlistLen;
      const dirStep = reverseBias ? -1 : 1;
      for (let tries = 0; tries < playlistLen; tries++) {
        const candIdx = (((idx + tries * dirStep) % playlistLen) + playlistLen) % playlistLen;
        if (!permaKeySet.has(itemKey(playlist[candIdx]))) {
          wrapped = candIdx;
          break;
        }
      }
      const item = playlist[wrapped];
      if (!item) return;

      const uid = `pile_${uidCounterRef.current++}`;
      const body = createThrownBody({
        uid,
        item,
        stageW: stageSize.w,
        stageH: stageSize.h,
        params,
        lastEdge: lastEdgeRef.current,
        reverseBias,
      });

      lastEdgeRef.current = body.edge;
      bodiesRef.current.push(body);
      enforcePileDepth(pileDepth);

      holdElapsedRef.current = 0;
      curPlaylistIdxRef.current = wrapped;
      setActiveIdxUi(wrapped);
      setTopHaloItem(item);
      const topLive = bodiesRef.current.filter((b) => !b.exiting).slice(-6);
      setHiResUids(new Set(topLive.map((b) => b.uid)));
      setRenderList((prev) => [
        ...prev.filter((e) => bodiesRef.current.some((b) => b.uid === e.uid)),
        { uid: body.uid, item: body.item, w: body.w, h: body.h, tapeSeed: body.tapeSeed },
      ]);
    },
    [playlist, playlistLen, stageSize.w, stageSize.h, params, pileDepth, enforcePileDepth]
  );

  // Enforce pile depth immediately when user adjusts Pile Depth slider
  useEffect(() => {
    enforcePileDepth(pileDepth);
  }, [pileDepth, enforcePileDepth]);

  // Recalculate card dimensions smoothly when container, Print Size, or Matte Thickness changes
  useEffect(() => {
    const arr = bodiesRef.current;
    if (arr.length === 0) return;
    let changed = false;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      const box = computePilePrintBox(
        b.item,
        stageSize.w,
        stageSize.h,
        params.printScale,
        matPx,
        b.sizeScale || 1.0
      );
      if (box.w !== b.w || box.h !== b.h) {
        b.w = box.w;
        b.h = box.h;
        changed = true;
      }
      if (b.permaPinned && !b.dragging && Number.isFinite(b.nx) && Number.isFinite(b.ny)) {
        b.x = clamp(b.nx * stageSize.w, -stageSize.w * 0.46, stageSize.w * 0.46);
        b.y = clamp(b.ny * stageSize.h, -stageSize.h * 0.46, stageSize.h * 0.46);
      }
    }
    if (changed) {
      setRenderList(
        arr.map((b) => ({ uid: b.uid, item: b.item, w: b.w, h: b.h, tapeSeed: b.tapeSeed }))
      );
    }
  }, [stageSize.w, stageSize.h, params.printScale, matPx]);

  // Restore Perma-Pinned favorites once real stage dimensions are measured, then seed first throw
  const seededPlaylistRef = useRef(null);
  useEffect(() => {
    if (!stageMeasuredRef.current) return;

    if (!permaRestoredRef.current) {
      permaRestoredRef.current = true;
      const saved = loadSavedPermaPins();
      if (saved.length > 0) {
        const restored = saved.map((rec) => {
          const rawScale = Number(rec.sizeScale);
          const hasCustomScale = Number.isFinite(rawScale) && rawScale > 0;
          const sizeKey = CARD_SIZE_SCALES[rec.sizeKey] ? rec.sizeKey : "M";
          const sizeScale = hasCustomScale
            ? clamp(rawScale, 0.25, 2.0)
            : CARD_SIZE_SCALES[sizeKey] || 1.0;
          const box = computePilePrintBox(
            rec.item,
            stageSize.w,
            stageSize.h,
            params.printScale,
            matPx,
            sizeScale
          );
          const uid = `perma_${uidCounterRef.current++}`;
          const nx = clamp(Number(rec.nx) || 0, -0.46, 0.46);
          const ny = clamp(Number(rec.ny) || 0, -0.46, 0.46);
          return {
            uid,
            item: rec.item,
            edge: "S",
            w: box.w,
            h: box.h,
            x: nx * stageSize.w,
            y: ny * stageSize.h,
            nx,
            ny,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            angle: Number(rec.angle) || 0,
            vAngle: 0,
            pitchX: 0,
            pitchY: 0,
            kAir: 1.55,
            kSlide: 6.0,
            touchedDown: true,
            settled: true,
            exiting: false,
            opacity: 1,
            dragging: false,
            sizeKey,
            sizeScale,
            tablePinned: false,
            permaPinned: true,
            tapeSeed: Number(rec.tapeSeed) || Math.floor(Math.random() * 10000),
          };
        });
        bodiesRef.current = [...bodiesRef.current, ...restored];
        setPermaUids(new Set(restored.map((b) => b.uid)));
        setHiResUids((prev) => new Set([...prev, ...restored.map((b) => b.uid)]));
        setRenderList(
          bodiesRef.current.map((b) => ({
            uid: b.uid,
            item: b.item,
            w: b.w,
            h: b.h,
            tapeSeed: b.tapeSeed,
          }))
        );
      }
    }

    if (playlistLen === 0) return;
    if (seededPlaylistRef.current !== playlist) {
      seededPlaylistRef.current = playlist;
      const unpinnedCount = bodiesRef.current.filter((b) => !b.permaPinned && !b.exiting).length;
      if (unpinnedCount === 0) {
        spawnSlideAt(0, false);
      } else {
        curPlaylistIdxRef.current = clamp(curPlaylistIdxRef.current, 0, playlistLen - 1);
      }
    }
  }, [playlist, playlistLen, stageSize.w, stageSize.h, params.printScale, matPx, spawnSlideAt]);

  const handleNext = useCallback(() => {
    if (playlistLen <= 1) return;
    spawnSlideAt(curPlaylistIdxRef.current + 1, false);
  }, [playlistLen, spawnSlideAt]);

  const handlePrev = useCallback(() => {
    if (playlistLen <= 1) return;
    spawnSlideAt(curPlaylistIdxRef.current - 1, true);
  }, [playlistLen, spawnSlideAt]);

  // Preload & GPU-decode next 3 prints (both fast thumb + full-res) well ahead of toss
  useEffect(() => {
    if (playlistLen <= 1) return;
    const cache = decodeCacheRef.current;
    const lookahead = Math.min(3, playlistLen - 1);
    for (let offset = 1; offset <= lookahead; offset++) {
      const candidate = playlist[(activeIdxUi + offset) % playlistLen];
      if (!candidate) continue;
      const thumbUrl = getThumbUrl(candidate);
      if (thumbUrl && !cache.has(thumbUrl)) {
        const tImg = new Image();
        tImg.src = thumbUrl;
        tImg.decode?.().catch(() => {});
        cache.set(thumbUrl, tImg);
      }
      if (!isVideoItem(candidate)) {
        const fullUrl = getFullResUrl(candidate);
        if (fullUrl && !cache.has(fullUrl)) {
          const fImg = new Image();
          fImg.src = fullUrl;
          fImg.decode?.().catch(() => {});
          cache.set(fullUrl, fImg);
        }
      }
    }
    // Keep predecode cache bounded so memory stays trim during long sessions
    if (cache.size > 36) {
      const excess = cache.size - 24;
      const keys = cache.keys();
      for (let i = 0; i < excess; i++) {
        const k = keys.next().value;
        if (k) cache.delete(k);
      }
    }
  }, [playlist, playlistLen, activeIdxUi]);

  // Keep latest reactive settings in ref for clean 120fps physics stepping
  const latestRef = useRef({});
  latestRef.current = {
    stageSize,
    holdMs,
    playlistLen,
    paused: Boolean(cfg.paused) || localPaused || lightboxOpen,
    shearNudge: params.shearNudge !== false,
    paperBorderOn,
    handleNext,
    persistPermaPins,
  };

  // Master 120fps Physics Loop
  useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      const L = latestRef.current;
      const bodies = bodiesRef.current;

      const anyWind = bodies.some((b) => b.blownAway || b.windDelay > 0);
      if ((!L.paused || anyWind) && bodies.length > 0) {
        const hadUnsettledPerma = bodies.some((b) => b.permaPinned && !b.settled);
        const stepSubset = L.paused
          ? bodies.filter((b) => b.blownAway || b.windDelay > 0)
          : bodies;
        const { removedAny } = stepTablePile(stepSubset, dt, {
          stageW: L.stageSize.w,
          stageH: L.stageSize.h,
          shearNudge: L.shearNudge,
        });

        if (hadUnsettledPerma && !bodies.some((b) => b.permaPinned && !b.settled)) {
          L.persistPermaPins(L.stageSize.w, L.stageSize.h);
        }

        if (removedAny) {
          bodiesRef.current = bodies.filter((b) => b.opacity > 0.004);
          setRenderList(
            bodiesRef.current.map((b) => ({
              uid: b.uid,
              item: b.item,
              w: b.w,
              h: b.h,
              tapeSeed: b.tapeSeed,
            }))
          );
        }

        // Hold timer advances once the top thrown sheet has landed & skidded to rest
        const activeBodies = bodiesRef.current;
        const unpinnedList = activeBodies.filter((b) => !b.permaPinned);
        const top = unpinnedList[unpinnedList.length - 1] || activeBodies[activeBodies.length - 1];
        const anyDragging = Boolean(dragSessionRef.current);

        if (top && !top.blownAway && top.settled && !anyDragging && L.playlistLen > 1 && !L.paused) {
          holdElapsedRef.current += dt * 1000;
          if (holdElapsedRef.current >= L.holdMs) {
            holdElapsedRef.current = 0;
            L.handleNext();
          }
        }
      } else if (!L.paused && L.playlistLen > 0 && bodies.length === 0) {
        holdElapsedRef.current += dt * 1000;
        if (holdElapsedRef.current >= 1400) {
          holdElapsedRef.current = 0;
          L.handleNext();
        }
      }

      // Sync DOM node transforms & physical air-to-desk shadow directly at monitor refresh rate
      const activeList = bodiesRef.current;
      let permaRank = 0;

      for (let i = 0; i < activeList.length; i++) {
        const b = activeList[i];
        const el = nodeMapRef.current.get(b.uid);
        if (!el) continue;

        const zLiftScale = 1 + b.z * 0.0016;
        const hasPitch = Math.abs(b.pitchX) > 0.05 || Math.abs(b.pitchY) > 0.05;
        const pitchStr = hasPitch
          ? ` perspective(1100px) rotateX(${b.pitchX.toFixed(2)}deg) rotateY(${b.pitchY.toFixed(2)}deg)`
          : "";
        el.style.transform = `translate3d(${b.x.toFixed(2)}px, ${b.y.toFixed(2)}px, 0px)${pitchStr} rotate(${b.angle.toFixed(2)}deg) scale(${zLiftScale.toFixed(4)})`;
        el.setAttribute("data-lb-rot", b.angle.toFixed(2));
        el.style.opacity = b.opacity.toFixed(3);
        el.style.zIndex = b.permaPinned ? String(10 + permaRank++) : String(60 + i);

        // Taped-down sheets sit flush against the wood; loose prints cast deeper depth shadows over them
        if (b.permaPinned) {
          el.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.44), 0 0 1px rgba(0, 0, 0, 0.35)";
        } else {
          const shBlur = 12 + b.z * 0.45;
          const shY = 5 + b.z * 0.34;
          const shAlpha = clamp(0.62 - b.z * 0.0024, 0.34, 0.65);
          el.style.boxShadow = `0 ${shY.toFixed(1)}px ${shBlur.toFixed(1)}px rgba(0, 0, 0, ${shAlpha.toFixed(
            2
          )}), 0 1px 3px rgba(0, 0, 0, 0.32)`;
        }
      }

      if (progressBarRef.current) {
        const frac = L.playlistLen > 1 ? clamp(holdElapsedRef.current / L.holdMs, 0, 1) : 0;
        progressBarRef.current.style.transform = `scaleX(${frac.toFixed(4)})`;
        progressBarRef.current.style.opacity = L.paused ? "0.25" : "0.72";
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Gentle auto-fading ghost controls when cursor moves
  const wakeHud = useCallback(() => {
    if (!hoverControlsOn) return;
    setHudActive(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      setHudActive(false);
    }, 2200);
  }, [hoverControlsOn]);

  useEffect(() => {
    if (!hoverControlsOn) setHudActive(false);
  }, [hoverControlsOn]);

  useEffect(() => {
    return () => {
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (lightboxOpen || screensaverMode) return;
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!isActiveZone && !isHoverStageRef.current && !isFullscreen) return;

      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        wakeHud();
        handleNext();
      } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        wakeHud();
        handlePrev();
      } else if (e.code === "Space") {
        e.preventDefault();
        wakeHud();
        setLocalPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxOpen, screensaverMode, isActiveZone, isFullscreen, handleNext, handlePrev, wakeHud]);

  // Interactive Grab / Fling Physics vs Click-to-Inspect (Taped trophies stay locked in place, still clickable to inspect!)
  const handleCardPointerDown = (e, uid) => {
    if (e.button !== 0) return;
    const body = bodiesRef.current.find((b) => b.uid === uid);
    if (!body) return;
    const isTaped = Boolean(body.permaPinned);
    if (isTaped ? !allowInspect : !allowInspect && !allowFlick) return;

    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);

    const now = performance.now();
    dragSessionRef.current = {
      uid,
      pointerId: e.pointerId,
      tapedClickOnly: isTaped,
      movedPastClick: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBodyX: body.x,
      startBodyY: body.y,
      draggingStarted: false,
      samples: [{ x: e.clientX, y: e.clientY, t: now }],
    };
  };

  const promoteBodyToTop = useCallback((uid) => {
    const arr = bodiesRef.current;
    const idx = arr.findIndex((b) => b.uid === uid);
    if (idx < 0) return;
    const [picked] = arr.splice(idx, 1);
    picked.exiting = false;
    picked.opacity = 1;
    arr.push(picked);
    holdElapsedRef.current = 0;
    // Update halo & top-6 hi-res window without reordering DOM nodes so setPointerCapture stays rock-solid
    setTopHaloItem(picked.item);
    setHiResUids(
      new Set([
        ...arr.filter((b) => b.permaPinned).map((b) => b.uid),
        ...arr.filter((b) => !b.exiting).slice(-6).map((b) => b.uid),
      ])
    );
  }, []);

  const activateCardDrag = useCallback(
    (sess, body) => {
      if (sess.draggingStarted) return;
      sess.draggingStarted = true;
      body.dragging = true;
      body.settled = false;
      body.z = 22;
      body.vx = 0;
      body.vy = 0;
      body.vAngle = 0;
      promoteBodyToTop(sess.uid);
    },
    [promoteBodyToTop]
  );

  const pileRadialRef = useRef(false);
  pileRadialRef.current = Boolean(pileRadial);

  // Scoped Wheel Rotate on this stage: works both on simple Hover (rotates in-place) AND during Drag!
  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl || !allowFlick) return;

    const onWheel = (e) => {
      if (pileRadialRef.current || lightboxOpen || screensaverMode) return;
      const sess = dragSessionRef.current;

      if (sess) {
        const body = bodiesRef.current.find((b) => b.uid === sess.uid);
        if (!body || body.permaPinned) return;
        e.preventDefault();
        e.stopPropagation();
        activateCardDrag(sess, body);
        sess.usedWheel = true;

        const normDelta = clamp(e.deltaY, -180, 180);
        const stepDeg = (normDelta / 100) * 5.5;
        body.angle += stepDeg;
        body.vAngle = 0;
        return;
      }

      // Hover rotate (stays cleanly at current stack order without jumping buried cards to top)
      const cardEl = e.target?.closest?.(".cb-pile-card[data-pile-uid]");
      const uid = cardEl?.getAttribute?.("data-pile-uid");
      if (!uid) return;
      const body = bodiesRef.current.find((b) => b.uid === uid);
      if (!body || body.permaPinned) return;

      e.preventDefault();
      e.stopPropagation();
      const normDelta = clamp(e.deltaY, -180, 180);
      const stepDeg = (normDelta / 100) * 5.5;
      body.angle += stepDeg;
      body.vAngle = 0;
      holdElapsedRef.current = Math.max(0, holdElapsedRef.current - 1200);
    };

    stageEl.addEventListener("wheel", onWheel, { passive: false });
    return () => stageEl.removeEventListener("wheel", onWheel);
  }, [allowFlick, activateCardDrag, lightboxOpen, screensaverMode, playlistLen]);

  const handleCardPointerMove = (e, uid) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.uid !== uid || sess.pointerId !== e.pointerId) return;

    const dx = e.clientX - sess.startClientX;
    const dy = e.clientY - sess.startClientY;
    const body = bodiesRef.current.find((b) => b.uid === uid);
    if (!body) return;

    // Taped prints stay anchored strictly in place; only detect pointer jitter past click threshold
    if (sess.tapedClickOnly || body.permaPinned) {
      if (Math.hypot(dx, dy) > 8) {
        sess.movedPastClick = true;
      }
      return;
    }
    if (!allowFlick) return;

    if (!sess.draggingStarted && Math.hypot(dx, dy) > 6) {
      activateCardDrag(sess, body);
    }

    if (sess.draggingStarted) {
      body.x = sess.startBodyX + dx;
      body.y = sess.startBodyY + dy;
      const now = performance.now();
      sess.samples.push({ x: e.clientX, y: e.clientY, t: now });
      if (sess.samples.length > 5) sess.samples.shift();
    }
  };

  const finishCardPointer = (e, uid, canceled = false) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.uid !== uid || sess.pointerId !== e.pointerId) return;
    dragSessionRef.current = null;

    const body = bodiesRef.current.find((b) => b.uid === uid);
    if (!body) return;
    const dist = Math.hypot(
      (e.clientX ?? sess.startClientX) - sess.startClientX,
      (e.clientY ?? sess.startClientY) - sess.startClientY
    );

    if (sess.tapedClickOnly || body.permaPinned) {
      if (!canceled && !sess.movedPastClick && dist <= 8 && allowInspect) {
        const cardEl = nodeMapRef.current.get(uid) || e.currentTarget;
        const clickedKey = itemKey(body.item);
        const inActiveList = playlist.some((it) => itemKey(it) === clickedKey);
        let inspectList = playlist;
        if (!inActiveList) {
          const seen = new Set();
          const trophies = [];
          for (const b of bodiesRef.current) {
            if (!b.permaPinned || !b.item) continue;
            const k = itemKey(b.item);
            if (!seen.has(k)) {
              seen.add(k);
              trophies.push(b.item);
            }
          }
          inspectList = trophies.length > 0 ? trophies : [body.item];
        }
        onInspect?.(
          captureInspectPayload(cardEl, body.item, inspectList, { rz: body.angle })
        );
      }
      return;
    }

    const wasDragged = sess.draggingStarted;
    body.dragging = false;

    if (!wasDragged && !canceled && allowInspect) {
      const cardEl = nodeMapRef.current.get(uid) || e.currentTarget;
      onInspect?.(
        captureInspectPayload(cardEl, body.item, playlist, { rz: body.angle })
      );
      return;
    }

    // Release: keep exact dialed-in tilt when wheel-rotated or placed gently; only add wrist spin on brisk throws
    const samples = sess.samples;
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const movedDist = Math.hypot(last.x - first.x, last.y - first.y);
      if (movedDist > 4) {
        const dtSec = Math.max(0.016, (last.t - first.t) / 1000);
        body.vx = clamp((last.x - first.x) / dtSec, -2200, 2200);
        body.vy = clamp((last.y - first.y) / dtSec, -2200, 2200);
        const flingSpeed = Math.hypot(body.vx, body.vy);
        if (!sess.usedWheel && flingSpeed > 260) {
          body.vAngle = clamp((body.vx - body.vy * 0.4) * 0.04, -150, 150);
        } else {
          body.vAngle = 0;
        }
      } else {
        body.vAngle = 0;
      }
    } else {
      body.vAngle = 0;
    }
      body.touchedDown = true;
      body.vz = -40;
      if (body.permaPinned) {
        persistPermaPins();
      }
    };

  const effectivePaused = Boolean(cfg.paused) || localPaused || lightboxOpen;
  const topActiveItem = topHaloItem || renderList[renderList.length - 1]?.item || playlist[0] || null;

  const syncPinnedState = useCallback(() => {
    setPinnedUids(new Set(bodiesRef.current.filter((b) => b.tablePinned).map((b) => b.uid)));
  }, []);

  const setCardSizeScaleByUid = useCallback(
    (uid, nextScale, isFinal = true) => {
      const b = bodiesRef.current.find((x) => x.uid === uid);
      if (!b) return;
      const clamped = clamp(Number(nextScale) || 1.0, 0.32, 1.56);
      b.sizeScale = clamped;
      b.sizeKey = clamped < 0.86 ? "S" : clamped < 1.14 ? "M" : clamped < 1.42 ? "L" : "XL";
      const box = computePilePrintBox(
        b.item,
        stageSize.w,
        stageSize.h,
        params.printScale,
        matPx,
        clamped
      );
      b.w = box.w;
      b.h = box.h;
      setRenderList((prev) =>
        prev.map((e) => (e.uid === uid ? { ...e, w: box.w, h: box.h, sizeScale: clamped } : e))
      );
      if (b.permaPinned && isFinal !== false) {
        persistPermaPins();
      }
    },
    [stageSize.w, stageSize.h, params.printScale, matPx, persistPermaPins]
  );

  const setCardSizeByUid = useCallback(
    (uid, nextKey) => {
      setCardSizeScaleByUid(uid, CARD_SIZE_SCALES[nextKey] || 1.0, true);
    },
    [setCardSizeScaleByUid]
  );

  const toggleCardPinByUid = useCallback(
    (uid) => {
      const b = bodiesRef.current.find((x) => x.uid === uid);
      if (!b) return;
      b.tablePinned = !b.tablePinned;
      if (b.tablePinned) {
        b.exiting = false;
        b.opacity = 1;
      } else {
        enforcePileDepth(pileDepth);
      }
      syncPinnedState();
    },
    [enforcePileDepth, pileDepth, syncPinnedState]
  );

  const togglePermaPinByUid = useCallback(
    (uid) => {
      const b = bodiesRef.current.find((x) => x.uid === uid);
      if (!b) return;
      b.permaPinned = !b.permaPinned;
      if (b.permaPinned) {
        b.exiting = false;
        b.opacity = 1;
        b.vx = 0;
        b.vy = 0;
        b.vAngle = 0;
        b.z = 0;
        b.settled = true;
        if (!b.tapeSeed) b.tapeSeed = Math.floor(Math.random() * 10000);
        setHiResUids((prev) => new Set([...prev, b.uid]));
      } else {
        enforcePileDepth(pileDepth);
      }
      persistPermaPins();
    },
    [enforcePileDepth, pileDepth, persistPermaPins]
  );

  const straightenCardByUid = useCallback(
    (uid) => {
      const b = bodiesRef.current.find((x) => x.uid === uid);
      if (!b) return;
      b.angle = 0;
      b.vAngle = 0;
      b.settled = true;
      if (b.permaPinned) persistPermaPins();
    },
    [persistPermaPins]
  );

  const unpinAllCards = useCallback(() => {
    for (let i = 0; i < bodiesRef.current.length; i++) {
      bodiesRef.current[i].tablePinned = false;
    }
    syncPinnedState();
    enforcePileDepth(pileDepth);
  }, [syncPinnedState, enforcePileDepth, pileDepth]);

  const buildGustImpulse = (baseAngle, gustSpd) => {
    const spreadAng = baseAngle + (Math.random() - 0.5) * 0.42;
    const windCos = Math.cos(baseAngle);
    return {
      vx: Math.cos(spreadAng) * gustSpd,
      vy: Math.sin(spreadAng) * gustSpd + (Math.random() - 0.5) * 280,
      vz: 155 + Math.random() * 135,
      vAngle: (Math.random() < 0.5 ? -1 : 1) * (85 + Math.random() * 145),
      pitchX: (Math.random() - 0.5) * 26,
      pitchY: windCos * -18 + (Math.random() - 0.5) * 12,
    };
  };

  const wipeCardByUid = useCallback(
    (uid) => {
      const b = bodiesRef.current.find((x) => x.uid === uid);
      if (!b || b.blownAway || b.dragging) return;
      if (b.tablePinned) {
        b.tablePinned = false;
        syncPinnedState();
      }
      if (b.permaPinned) {
        // Untape permanently before blowing away
        b.permaPinned = false;
        persistPermaPins();
      }
      const dirSign = b.x >= 0 ? 1 : -1;
      const baseAngle = dirSign > 0 ? (Math.random() - 0.5) * 0.52 : Math.PI + (Math.random() - 0.5) * 0.52;
      const g = buildGustImpulse(baseAngle, 2100 + Math.random() * 900);
      b.windDelay = 0;
      b.pendingGust = null;
      b.exiting = false;
      b.blownAway = true;
      b.blownElapsed = 0;
      b.settled = false;
      b.kAir = 0.28;
      b.kSlide = 0.45;
      b.vx = g.vx;
      b.vy = g.vy;
      b.vz = g.vz;
      b.vAngle = g.vAngle;
      b.pitchX = g.pitchX;
      b.pitchY = g.pitchY;
      holdElapsedRef.current = 0;
    },
    [persistPermaPins, syncPinnedState]
  );

  const triggerWipeGust = useCallback(() => {
    const arr = bodiesRef.current;
    const candidates = arr.filter(
      (b) => !b.permaPinned && !b.tablePinned && !b.blownAway && !b.dragging
    );
    if (candidates.length === 0) return;

    // Pick a dynamic cross-table gust direction (e.g. sweeping mostly left-to-right or right-to-left)
    const dirSign = Math.random() < 0.5 ? 1 : -1;
    const baseAngle = dirSign > 0 ? (Math.random() - 0.5) * 0.52 : Math.PI + (Math.random() - 0.5) * 0.52;
    const windCos = Math.cos(baseAngle);
    const windSin = Math.sin(baseAngle);

    // Order wind arrival smoothly along the gust travel axis so sheets ripple away like paper in wind
    const projected = candidates.map((b) => ({
      b,
      proj: b.x * windCos + b.y * windSin,
    }));
    const minP = Math.min(...projected.map((p) => p.proj));
    const maxP = Math.max(...projected.map((p) => p.proj));
    const spanP = Math.max(1, maxP - minP);

    for (let i = 0; i < projected.length; i++) {
      const { b, proj } = projected[i];
      const waveT = (proj - minP) / spanP;
      const delay = 0.02 + waveT * 0.16 + Math.random() * 0.04;
      b.windDelay = delay;
      b.pendingGust = buildGustImpulse(baseAngle, 1950 + Math.random() * 1150);
    }
    holdElapsedRef.current = 0;
  }, []);

  const openPileRadialAt = useCallback(
    (clientX, clientY, targetEl) => {
      if (!allowRadial) return;
      const cardEl = targetEl?.closest?.(".cb-pile-card[data-pile-uid]");
      const uid = cardEl?.getAttribute?.("data-pile-uid") || null;
      const validBody = uid ? bodiesRef.current.find((b) => b.uid === uid) : null;
      setPileRadial({
        kind: validBody ? "card" : "desk",
        uid: validBody ? validBody.uid : null,
        x: clientX,
        y: clientY,
        openedAt: performance.now(),
        fromPointerDown: true,
      });
    },
    [allowRadial]
  );

  const resolvedPileRadial = useMemo(() => {
    if (!pileRadial) return null;
    if (pileRadial.kind === "card" && pileRadial.uid) {
      const body = bodiesRef.current.find((b) => b.uid === pileRadial.uid);
      if (body) {
        return {
          ...pileRadial,
          title: body.item.filename,
          items: buildTablePileCardRadialItems({
            sizeKey: body.sizeKey || "M",
            sizeScale: Number(body.sizeScale || CARD_SIZE_SCALES[body.sizeKey] || 1.0),
            permaPinned: Boolean(body.permaPinned),
            paperBorder: paperBorderOn,
            borderThickness: Number(params.borderThickness ?? 14),
            paperTone,
            allowInspect,
            onSetCardSize: (k) => setCardSizeByUid(body.uid, k),
            onSetCardSizeScale: (s, isFinal) => setCardSizeScaleByUid(body.uid, s, isFinal),
            onWipeCard: () => wipeCardByUid(body.uid),
            onTogglePermaPin: () => togglePermaPinByUid(body.uid),
            onPopTop: () => promoteBodyToTop(body.uid),
            onStraighten: () => straightenCardByUid(body.uid),
            onInspectCard: () => {
              const cardEl = nodeMapRef.current.get(body.uid);
              onInspect?.(captureInspectPayload(cardEl, body.item, playlist, { rz: body.angle }));
            },
            onPatchParams,
          }),
        };
      }
    }
    const looseCount = bodiesRef.current.filter(
      (b) => !b.permaPinned && !b.tablePinned && !b.blownAway && !b.exiting
    ).length;
    return {
      ...pileRadial,
      title: "Tabletop Studio",
      items: buildTablePileDeskRadialItems({
        deskSurface,
        deskVignette: Number(params.deskVignette ?? 42),
        throwFrom: params.throwFrom || "random",
        messiness: Number(params.messiness ?? 62),
        pinnedCount: pinnedUids.size,
        looseCount,
        effectivePaused,
        isFullscreen,
        onPatchParams,
        onTogglePause: () => setLocalPaused((p) => !p),
        onNext: handleNext,
        onWipeDesk: triggerWipeGust,
        onUnpinAll: unpinAllCards,
        onOpenDrawer,
      }),
    };
  }, [
    pileRadial,
    paperBorderOn,
    params,
    paperTone,
    allowInspect,
    setCardSizeByUid,
    wipeCardByUid,
    togglePermaPinByUid,
    promoteBodyToTop,
    straightenCardByUid,
    onInspect,
    playlist,
    onPatchParams,
    deskSurface,
    pinnedUids,
    effectivePaused,
    isFullscreen,
    handleNext,
    triggerWipeGust,
    unpinAllCards,
    onOpenDrawer,
  ]);

  if (playlistLen === 0) {
    return (
      <div ref={stageRef} className="cb-stage cb-slideshow-stage">
        <div className="cb-slideshow-empty">
          <p>No renders match this folder or filter.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className={`cb-stage cb-slideshow-stage cb-pile-stage ${
        hoverControlsOn && (hudActive || localPaused) ? "is-hud-open" : ""
      } ${isFullscreen ? "is-native-fs is-true-fs" : ""} ${screensaverMode ? "is-screensaver" : ""} ${
        !allowInspect && !allowFlick ? "is-no-inspect" : ""
      }`}
      onContextMenu={(e) => {
        if (!allowRadial) return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.button === 2 && allowRadial) {
          e.preventDefault();
          e.stopPropagation();
          openPileRadialAt(e.clientX, e.clientY, e.target);
        }
      }}
      onMouseMove={() => {
        isHoverStageRef.current = true;
        wakeHud();
      }}
      onMouseEnter={() => {
        isHoverStageRef.current = true;
        wakeHud();
      }}
      onMouseLeave={() => {
        isHoverStageRef.current = false;
      }}
    >
      {/* Physical Tabletop Texture OR Ambient Color Halo */}
      {deskTextureUrl ? (
        <div
          className="cb-pile-surface-bg"
          style={{ backgroundImage: `url("${deskTextureUrl}")` }}
          aria-hidden="true"
        >
          <div
            className="cb-pile-surface-vignette"
            style={{ opacity: deskVignette }}
          />
        </div>
      ) : (
        ambientHaloOn &&
        topActiveItem && (
          <div className="cb-slideshow-halo-wrap" aria-hidden="true">
            <div
              ref={haloLayerRef}
              className="cb-slideshow-halo-layer is-pile-halo"
              style={{
                backgroundImage: `url("${getThumbUrl(topActiveItem)}")`,
                opacity: (haloStrength / 100) * 0.5,
              }}
            />
          </div>
        )
      )}

      {/* Overhead Desk Sheet Stack */}
      <div className="cb-pile-desk">
        {renderList.map((entry, idx) => {
          const key = itemKey(entry.item);
          const isTop = idx === renderList.length - 1;
          return (
            <div
              key={entry.uid}
              ref={(el) => {
                if (el) nodeMapRef.current.set(entry.uid, el);
                else nodeMapRef.current.delete(entry.uid);
              }}
              className={`cb-tile-fx cb-pile-card ${
                paperBorderOn ? `has-matte tone-${paperTone}` : ""
              } ${permaUids.has(entry.uid) ? "is-perma-pinned" : ""} ${
                isTop ? "is-pile-top" : ""
              }`}
              data-lb-key={key}
              data-pile-uid={entry.uid}
              onPointerDown={(e) => handleCardPointerDown(e, entry.uid)}
              onPointerMove={(e) => handleCardPointerMove(e, entry.uid)}
              onPointerUp={(e) => finishCardPointer(e, entry.uid, false)}
              onPointerCancel={(e) => finishCardPointer(e, entry.uid, true)}
              style={{
                width: `${entry.w}px`,
                height: `${entry.h}px`,
                marginLeft: `${-Math.round(entry.w * 0.5)}px`,
                marginTop: `${-Math.round(entry.h * 0.5)}px`,
                padding: matPx > 0 ? `${matPx}px` : 0,
                borderRadius: `${paperBorderOn ? Math.min(cornerRadius, 6) : cornerRadius}px`,
              }}
            >
              {permaUids.has(entry.uid) ? (
                <ScotchTapeOverlay seed={entry.tapeSeed || 1} />
              ) : (
                pinnedUids.has(entry.uid) && (
                  <span className="cb-pile-pin-seal" title="Pinned for session">
                    <Pin size={10} />
                  </span>
                )
              )}
              <div className="cb-pile-art-window">
                {isVideoItem(entry.item) ? (
                  <video
                    src={getFullResUrl(entry.item)}
                    poster={getThumbUrl(entry.item)}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="cb-slide-print-img"
                  />
                ) : (
                  <>
                    <img
                      src={getThumbUrl(entry.item)}
                      alt=""
                      decoding="sync"
                      draggable={false}
                      className="cb-slide-print-img is-pile-layer"
                    />
                    {hiResUids.has(entry.uid) && (
                      <img
                        src={getFullResUrl(entry.item)}
                        alt={entry.item.filename}
                        decoding="async"
                        draggable={false}
                        className="cb-slide-print-img is-pile-layer"
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ghost Transport Pill */}
      {hoverControlsOn && (
        <div
          className={`cb-slideshow-hud ${hudActive || localPaused ? "is-visible" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {playlistLen > 1 && (
            <>
              <button
                type="button"
                className="cb-slide-hud-btn"
                onClick={handlePrev}
                title="Previous slide (← / A)"
              >
                <SkipBack size={13} />
              </button>

              <button
                type="button"
                className={`cb-slide-hud-btn is-primary ${effectivePaused ? "is-paused" : ""}`}
                onClick={() => setLocalPaused((p) => !p)}
                title={effectivePaused ? "Resume slideshow (Space)" : "Pause slideshow (Space)"}
              >
                {effectivePaused ? <Play size={13} /> : <Pause size={13} />}
              </button>

              <button
                type="button"
                className="cb-slide-hud-btn"
                onClick={handleNext}
                title="Throw next print (→ / D)"
              >
                <SkipForward size={13} />
              </button>

              <span className="cb-slide-hud-sep" />

              <span className="cb-slide-hud-count">
                {activeIdxUi + 1} / {playlistLen}
              </span>

              {shuffleOn && onReshufflePlaylist && (
                <button
                  type="button"
                  className="cb-slide-hud-btn"
                  onClick={onReshufflePlaylist}
                  title="Reshuffle playlist"
                >
                  <Shuffle size={12} />
                </button>
              )}

              <span className="cb-slide-hud-sep" />
            </>
          )}

          <button
            type="button"
            className="cb-slide-hud-btn"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen (Esc)" : "Fullscreen Pure Showcase"}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      )}

      {/* Optional Timer Bar */}
      {showProgressOn && playlistLen > 1 && (
        <div className="cb-slideshow-progress-track" aria-hidden="true">
          <div ref={progressBarRef} className="cb-slideshow-progress-fill" />
        </div>
      )}

      {/* Self-Contained Studio Craft Wheel (Works in Windowed & Manual Fullscreen) */}
      <RadialMenu
        menuState={resolvedPileRadial}
        onClose={() => setPileRadial(null)}
        onRightClickSwitch={(e, under) => {
          if (!allowRadial) {
            setPileRadial(null);
            return;
          }
          openPileRadialAt(e.clientX, e.clientY, under);
        }}
      />
    </div>
  );
}

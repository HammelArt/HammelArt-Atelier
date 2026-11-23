import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Pause, Play, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { captureInspectPayload, getMediaUrl, getThumbnailUrl, itemKey } from "../utils/lightboxFlight";
import { useStageFullscreen } from "../utils/stageFullscreen";
import {
  clamp,
  easeCubicInOut,
  getSlideshowStyle,
  getSlideshowStyleParams,
} from "../utils/slideshowStyles";
import TablePileStage from "./TablePileStage";

function shuffleArraySeeded(arr, seed) {
  const out = arr.slice();
  let s = (seed * 1664525 + 1013904223) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function getItemAspect(item) {
  if (!item) return 1;
  if (Number.isFinite(item.aspect_ratio) && item.aspect_ratio > 0) return item.aspect_ratio;
  if (Number.isFinite(item.aspect) && item.aspect > 0) return item.aspect;
  if (item.width > 0 && item.height > 0) return item.width / item.height;
  return 1;
}

function isVideoItem(item) {
  if (!item) return false;
  return Boolean(item.is_video) || /\.(mp4|webm|mov|mkv)$/i.test(item.filename || "");
}

function computePrintBox(item, stageW, stageH) {
  const pad = Math.round(clamp(Math.min(stageW, stageH) * 0.045, 14, 46));
  const availW = Math.max(80, stageW - pad * 2);
  const availH = Math.max(80, stageH - pad * 2);
  const asp = getItemAspect(item);
  let w = availW;
  let h = w / asp;
  if (h > availH) {
    h = availH;
    w = h * asp;
  }
  return {
    w: Math.max(48, Math.round(w)),
    h: Math.max(48, Math.round(h)),
  };
}

function getFullResUrl(item) {
  return getMediaUrl(item);
}

function getThumbUrl(item) {
  return getThumbnailUrl(item);
}

export default function SlideshowEngine({
  items = [],
  cfg = {},
  isActiveZone = true,
  lightboxOpen = false,
  screensaverMode = false,
  editing = false,
  queuedPushItems = [],
  queuedPushNonce = 0,
  onConsumeQueuedPush,
  onInspect,
  onPatchCfg,
  onOpenDrawer,
}) {
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ w: 960, h: 600 });
  const [localPaused, setLocalPaused] = useState(false);
  const [localShuffleNonce, setLocalShuffleNonce] = useState(1);
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

  const activeStyle = getSlideshowStyle(cfg.styleId);
  const isStackMode = activeStyle.mode === "stack";
  const styleParams = useMemo(
    () => getSlideshowStyleParams(cfg, activeStyle.id),
    [cfg, activeStyle.id]
  );
  const transitionMs = clamp(Number(styleParams.transitionMs) || 1000, 200, 5000);

  // Build stable shuffled or ordered playlist
  const playlist = useMemo(() => {
    if (!items || items.length === 0) return [];
    if (!shuffleOn) return items;
    return shuffleArraySeeded(items, localShuffleNonce);
  }, [items, shuffleOn, localShuffleNonce]);

  const playlistLen = playlist.length;

  // Measure viewport cleanly across Single Mode & resizable Wall Zones
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 30 && r.height > 30) {
        setStageSize({ w: r.width, h: r.height });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isStackMode, playlistLen === 0]);

  // Render state: holds settled active index + optional active transition pair
  const [slideState, setSlideState] = useState({
    currentIdx: 0,
    transition: null, // { fromIdx, toIdx, direction, startProgress, fromItem, toItem }
  });

  // Preserve currently viewed artwork if background item order shifts slightly
  const currentVisibleKeyRef = useRef("");
  useEffect(() => {
    setSlideState((prev) => {
      if (playlistLen === 0) {
        currentVisibleKeyRef.current = "";
        return { currentIdx: 0, transition: null };
      }
      const wantedKey = currentVisibleKeyRef.current;
      let nextIdx = clamp(prev.currentIdx, 0, playlistLen - 1);
      if (wantedKey) {
        const found = playlist.findIndex((it) => itemKey(it) === wantedKey);
        if (found >= 0) nextIdx = found;
      }
      currentVisibleKeyRef.current = itemKey(playlist[nextIdx]);
      return { currentIdx: nextIdx, transition: null };
    });
  }, [playlist, playlistLen]);

  // Continuous GPU-clock animation state (0 React re-renders per frame!)
  const clockRef = useRef({
    holdElapsedMs: 0,
    transElapsedMs: 0,
    currentAgeMs: 0,
    fromAgeMs: 0,
    toAgeMs: 0,
  });

  const fromFrameRef = useRef(null);
  const fromImgRef = useRef(null);
  const fromSheenRef = useRef(null);

  const toFrameRef = useRef(null);
  const toImgRef = useRef(null);
  const toSheenRef = useRef(null);

  const restFrameRef = useRef(null);
  const restImgRef = useRef(null);
  const restFxRef = useRef(null);

  const haloFromRef = useRef(null);
  const haloToRef = useRef(null);
  const progressBarRef = useRef(null);

  const latestRef = useRef({});
  latestRef.current = {
    slideState,
    playlist,
    playlistLen,
    activeStyle,
    styleParams,
    holdMs,
    transitionMs,
    stageSize,
    paused: Boolean(cfg.paused) || localPaused || lightboxOpen,
    ambientHaloOn,
    haloStrength,
  };

  const stepToIndex = useCallback(
    (targetIdx, dir = 1) => {
      const len = playlistLen;
      if (len <= 1) return;
      setSlideState((prev) => {
        const baseIdx = prev.transition ? prev.transition.toIdx : prev.currentIdx;
        const wrappedIdx = ((targetIdx % len) + len) % len;
        if (wrappedIdx === baseIdx) return prev;
        const fromItem = playlist[baseIdx];
        const toItem = playlist[wrappedIdx];
        if (!fromItem || !toItem) return prev;

        const c = clockRef.current;
        c.fromAgeMs = prev.transition ? c.toAgeMs : c.currentAgeMs;
        c.toAgeMs = 0;
        c.transElapsedMs = 0;
        c.holdElapsedMs = 0;
        currentVisibleKeyRef.current = itemKey(toItem);

        return {
          currentIdx: wrappedIdx,
          transition: {
            fromIdx: baseIdx,
            toIdx: wrappedIdx,
            direction: dir >= 0 ? 1 : -1,
            fromItem,
            toItem,
          },
        };
      });
    },
    [playlist, playlistLen]
  );

  const handleNext = useCallback(() => {
    if (playlistLen <= 1) return;
    const base = slideState.transition ? slideState.transition.toIdx : slideState.currentIdx;
    stepToIndex(base + 1, 1);
  }, [playlistLen, slideState, stepToIndex]);

  const handlePrev = useCallback(() => {
    if (playlistLen <= 1) return;
    const base = slideState.transition ? slideState.transition.toIdx : slideState.currentIdx;
    stepToIndex(base - 1, -1);
  }, [playlistLen, slideState, stepToIndex]);

  // Immediately preview when user picks a different transition style in CustomizeDrawer
  const prevStyleIdRef = useRef(activeStyle.id);
  useEffect(() => {
    if (prevStyleIdRef.current !== activeStyle.id) {
      prevStyleIdRef.current = activeStyle.id;
      if (playlistLen > 1 && !lightboxOpen) {
        stepToIndex(slideState.currentIdx + 1, 1);
      }
    }
  }, [activeStyle.id, playlistLen, lightboxOpen, slideState.currentIdx, stepToIndex]);

  // Preload the upcoming slide's full-res image cleanly during hold so transitions never flash
  const upcomingItem = useMemo(() => {
    if (playlistLen <= 1) return null;
    const baseIdx = slideState.transition ? slideState.transition.toIdx : slideState.currentIdx;
    return playlist[(baseIdx + 1) % playlistLen] || null;
  }, [playlist, playlistLen, slideState]);

  useEffect(() => {
    if (!upcomingItem || isVideoItem(upcomingItem)) return;
    const pre = new Image();
    pre.src = getFullResUrl(upcomingItem);
  }, [upcomingItem]);

  // Helper applying a computed style frame directly to DOM refs
  const applyLayerStyle = (frameEl, imgEl, sheenEl, frame) => {
    if (!frameEl || !frame) return;
    if (frame.visible === false) {
      frameEl.style.opacity = "0";
      frameEl.style.visibility = "hidden";
      frameEl.style.zIndex = String(frame.zIndex ?? 1);
      return;
    }
    frameEl.style.visibility = "visible";
    frameEl.style.opacity = String(clamp(frame.opacity ?? 1, 0, 1));
    frameEl.style.transform = frame.transform || "none";
    frameEl.style.filter = frame.filter || "none";
    frameEl.style.zIndex = String(frame.zIndex ?? 2);
    if (imgEl && frame.imgTransform) {
      imgEl.style.transform = frame.imgTransform;
    }
    if (sheenEl) {
      const sop = clamp(frame.sheenOpacity ?? 0, 0, 1);
      if (sop > 0.005) {
        sheenEl.style.opacity = String(sop);
        sheenEl.style.backgroundPosition = `${Math.round(frame.sheenPos ?? 50)}% 50%`;
      } else {
        sheenEl.style.opacity = "0";
      }
    }
  };

  // Master 120fps rAF loop (re-arms cleanly whenever leaving stack mode like Table Pile)
  useEffect(() => {
    if (isStackMode) {
      clockRef.current.holdElapsedMs = 0;
      clockRef.current.transElapsedMs = 0;
      setSlideState((prev) => (prev.transition ? { ...prev, transition: null } : prev));
      return undefined;
    }
    clockRef.current.holdElapsedMs = 0;
    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now) => {
      const dt = Math.min(80, Math.max(0, now - lastTs));
      lastTs = now;

      const L = latestRef.current;
      const c = clockRef.current;
      const trans = L.slideState.transition;
      const visibleLifetime = L.holdMs + L.transitionMs * 2;
      const haloBaseOp = L.ambientHaloOn ? (L.haloStrength / 100) * 0.58 : 0;

      if (trans) {
        if (!L.paused) {
          c.transElapsedMs += dt;
          c.fromAgeMs += dt;
          c.toAgeMs += dt;
        }
        const progress = clamp(c.transElapsedMs / Math.max(120, L.transitionMs), 0, 1);

        const fromFrame = L.activeStyle.buildTransitionFrame({
          role: "from",
          progress,
          direction: trans.direction,
          stageW: L.stageSize.w,
          stageH: L.stageSize.h,
          seedKey: itemKey(trans.fromItem),
          slideIndex: trans.fromIdx,
          motionProgress: clamp(c.fromAgeMs / Math.max(1000, visibleLifetime), 0, 1),
          params: L.styleParams,
        });
        const toFrame = L.activeStyle.buildTransitionFrame({
          role: "to",
          progress,
          direction: trans.direction,
          stageW: L.stageSize.w,
          stageH: L.stageSize.h,
          seedKey: itemKey(trans.toItem),
          slideIndex: trans.toIdx,
          motionProgress: clamp(c.toAgeMs / Math.max(1000, visibleLifetime), 0, 1),
          params: L.styleParams,
        });

        applyLayerStyle(fromFrameRef.current, fromImgRef.current, fromSheenRef.current, fromFrame);
        applyLayerStyle(toFrameRef.current, toImgRef.current, toSheenRef.current, toFrame);

        const haloE = easeCubicInOut(progress);
        if (haloFromRef.current) {
          haloFromRef.current.style.opacity = String(haloBaseOp * (1 - haloE));
        }
        if (haloToRef.current) {
          haloToRef.current.style.opacity = String(haloBaseOp * haloE);
        }
        if (progressBarRef.current) {
          progressBarRef.current.style.transform = `scaleX(${progress.toFixed(4)})`;
          progressBarRef.current.style.opacity = "0.55";
        }

        if (progress >= 1) {
          c.currentAgeMs = c.toAgeMs;
          c.holdElapsedMs = 0;
          c.transElapsedMs = 0;
          setSlideState((prev) =>
            prev.transition
              ? { currentIdx: prev.transition.toIdx, transition: null }
              : prev
          );
        }
      } else {
        const currentItem = L.playlist[L.slideState.currentIdx] || null;
        if (currentItem) {
          if (!L.paused && L.playlistLen > 1) {
            c.holdElapsedMs += dt;
            c.currentAgeMs += dt;
          }
          const restFrame = L.activeStyle.buildRestFrame({
            seedKey: itemKey(currentItem),
            slideIndex: L.slideState.currentIdx,
            motionProgress: clamp(c.currentAgeMs / Math.max(1000, visibleLifetime), 0, 1),
            params: L.styleParams,
          });
          applyLayerStyle(restFrameRef.current, restImgRef.current, null, restFrame);

          if (haloFromRef.current) {
            haloFromRef.current.style.opacity = String(haloBaseOp);
          }
          if (haloToRef.current) {
            haloToRef.current.style.opacity = "0";
          }

          const holdFrac = L.playlistLen > 1 ? clamp(c.holdElapsedMs / L.holdMs, 0, 1) : 0;
          if (progressBarRef.current) {
            progressBarRef.current.style.transform = `scaleX(${holdFrac.toFixed(4)})`;
            progressBarRef.current.style.opacity = L.paused ? "0.25" : "0.72";
          }

          if (!L.paused && L.playlistLen > 1 && c.holdElapsedMs >= L.holdMs) {
            const nextIdx = (L.slideState.currentIdx + 1) % L.playlistLen;
            const nextItem = L.playlist[nextIdx];
            if (nextItem) {
              c.fromAgeMs = c.currentAgeMs;
              c.toAgeMs = 0;
              c.transElapsedMs = 0;
              c.holdElapsedMs = 0;
              currentVisibleKeyRef.current = itemKey(nextItem);
              setSlideState({
                currentIdx: nextIdx,
                transition: {
                  fromIdx: L.slideState.currentIdx,
                  toIdx: nextIdx,
                  direction: 1,
                  fromItem: currentItem,
                  toItem: nextItem,
                },
              });
            }
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isStackMode]);

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

  // Light keyboard navigation when hovered / active zone & lightbox/screensaver closed
  useEffect(() => {
    if (isStackMode || lightboxOpen || screensaverMode) return;
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
  }, [isStackMode, lightboxOpen, screensaverMode, isActiveZone, isFullscreen, handleNext, handlePrev, wakeHud]);

  const trans = slideState.transition;
  const activeItem = playlist[slideState.currentIdx] || null;
  const effectivePaused = Boolean(cfg.paused) || localPaused || lightboxOpen;

  if (isStackMode && activeStyle.id === "table_pile") {
    return (
      <TablePileStage
        playlist={playlist}
        playlistLen={playlistLen}
        cfg={cfg}
        params={styleParams}
        isActiveZone={isActiveZone}
        lightboxOpen={lightboxOpen}
        screensaverMode={screensaverMode}
        editing={editing}
        queuedPushItems={queuedPushItems}
        queuedPushNonce={queuedPushNonce}
        onConsumeQueuedPush={onConsumeQueuedPush}
        onInspect={onInspect}
        onReshufflePlaylist={() => setLocalShuffleNonce((n) => n + 1)}
        onPatchParams={(patch) =>
          onPatchCfg?.({
            styleParams: {
              ...(cfg.styleParams || {}),
              table_pile: { ...styleParams, ...patch },
            },
          })
        }
        onOpenDrawer={onOpenDrawer}
      />
    );
  }

  if (playlistLen === 0) {
    return (
      <div ref={stageRef} className="cb-stage cb-slideshow-stage">
        <div className="cb-slideshow-empty">
          <p>No renders match this folder or filter.</p>
        </div>
      </div>
    );
  }

  const haloFromItem = trans ? trans.fromItem : activeItem;
  const haloToItem = trans ? trans.toItem : null;

  const handleOpenInspect = (item, originEl) => {
    if (!allowInspect || !item) return;
    onInspect(captureInspectPayload(originEl, item, playlist));
  };

  return (
    <div
      ref={stageRef}
      className={`cb-stage cb-slideshow-stage ${
        hoverControlsOn && (hudActive || localPaused) ? "is-hud-open" : ""
      } ${isFullscreen ? "is-native-fs is-true-fs" : ""} ${screensaverMode ? "is-screensaver" : ""} ${
        !allowInspect ? "is-no-inspect" : ""
      }`}
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
      {/* Ambient Color Halo matched smoothly behind non-filling ratios */}
      {ambientHaloOn && (
        <div className="cb-slideshow-halo-wrap" aria-hidden="true">
          {haloFromItem && (
            <div
              ref={haloFromRef}
              className="cb-slideshow-halo-layer"
              style={{
                backgroundImage: `url("${getThumbUrl(haloFromItem)}")`,
                opacity: trans ? undefined : (haloStrength / 100) * 0.58,
              }}
            />
          )}
          {haloToItem && (
            <div
              ref={haloToRef}
              className="cb-slideshow-halo-layer"
              style={{
                backgroundImage: `url("${getThumbUrl(haloToItem)}")`,
                opacity: 0,
              }}
            />
          )}
        </div>
      )}

      {/* Main Showcase Stage */}
      <div className="cb-slideshow-viewport">
        {trans ? (
          <>
            {(() => {
              const box = computePrintBox(trans.fromItem, stageSize.w, stageSize.h);
              return (
                <div
                  ref={fromFrameRef}
                  className="cb-slideshow-frame-layer"
                >
                  <div
                    className="cb-slide-print-box"
                    onClick={(e) => handleOpenInspect(trans.fromItem, e.currentTarget)}
                    style={{
                      width: `${box.w}px`,
                      height: `${box.h}px`,
                      borderRadius: `${cornerRadius}px`,
                    }}
                  >
                    {isVideoItem(trans.fromItem) ? (
                      <video
                        ref={fromImgRef}
                        src={getFullResUrl(trans.fromItem)}
                        poster={getThumbUrl(trans.fromItem)}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="cb-slide-print-img"
                      />
                    ) : (
                      <img
                        ref={fromImgRef}
                        src={getFullResUrl(trans.fromItem)}
                        alt={trans.fromItem.filename}
                        draggable={false}
                        className="cb-slide-print-img"
                      />
                    )}
                    <div ref={fromSheenRef} className="cb-slide-sheen" />
                  </div>
                </div>
              );
            })()}
            {(() => {
              const box = computePrintBox(trans.toItem, stageSize.w, stageSize.h);
              return (
                <div
                  ref={toFrameRef}
                  className="cb-slideshow-frame-layer"
                  style={{ opacity: 0 }}
                >
                  <div
                    className="cb-slide-print-box"
                    onClick={(e) => handleOpenInspect(trans.toItem, e.currentTarget)}
                    style={{
                      width: `${box.w}px`,
                      height: `${box.h}px`,
                      borderRadius: `${cornerRadius}px`,
                    }}
                  >
                    {isVideoItem(trans.toItem) ? (
                      <video
                        ref={toImgRef}
                        src={getFullResUrl(trans.toItem)}
                        poster={getThumbUrl(trans.toItem)}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="cb-slide-print-img"
                      />
                    ) : (
                      <img
                        ref={toImgRef}
                        src={getFullResUrl(trans.toItem)}
                        alt={trans.toItem.filename}
                        draggable={false}
                        className="cb-slide-print-img"
                      />
                    )}
                    <div ref={toSheenRef} className="cb-slide-sheen" />
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          activeItem &&
          (() => {
            const box = computePrintBox(activeItem, stageSize.w, stageSize.h);
            const key = itemKey(activeItem);
            return (
              <div
                ref={restFrameRef}
                className="cb-slideshow-frame-layer is-resting"
              >
                <div
                  ref={restFxRef}
                  className="cb-tile-fx cb-slide-print-box"
                  data-lb-key={key}
                  onClick={() => handleOpenInspect(activeItem, restFxRef.current)}
                  style={{
                    width: `${box.w}px`,
                    height: `${box.h}px`,
                    borderRadius: `${cornerRadius}px`,
                  }}
                >
                  {isVideoItem(activeItem) ? (
                    <video
                      ref={restImgRef}
                      src={getFullResUrl(activeItem)}
                      poster={getThumbUrl(activeItem)}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="cb-slide-print-img"
                    />
                  ) : (
                    <img
                      ref={restImgRef}
                      src={getFullResUrl(activeItem)}
                      alt={activeItem.filename}
                      draggable={false}
                      className="cb-slide-print-img"
                    />
                  )}
                </div>
              </div>
            );
          })()
        )}
      </div>

      {/* Subtle auto-hiding Ghost Transport Pill (stops propagation so clicks don't open Lightbox) */}
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
                title="Next slide (→ / D)"
              >
                <SkipForward size={13} />
              </button>

              <span className="cb-slide-hud-sep" />

              <span className="cb-slide-hud-count">
                {slideState.currentIdx + 1} / {playlistLen}
              </span>

              {shuffleOn && (
                <button
                  type="button"
                  className="cb-slide-hud-btn"
                  onClick={() => setLocalShuffleNonce((n) => n + 1)}
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

      {/* Optional whisper-thin hairline progress bar (OFF by default, never in Fullscreen/Screensaver) */}
      {showProgressOn && playlistLen > 1 && (
        <div className="cb-slideshow-progress-track" aria-hidden="true">
          <div ref={progressBarRef} className="cb-slideshow-progress-fill" />
        </div>
      )}
    </div>
  );
}

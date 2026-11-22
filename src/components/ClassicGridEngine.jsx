import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import TileInner from "./TileInner";
import HoldDragRing, {
  HOLD_DRAG_DELAY_MS,
  HOLD_DRAG_FILL_MS,
  HOLD_DRAG_MOVE_PX,
  HOLD_DRAG_MAX_VEL,
} from "./HoldDragRing";
import { captureInspectPayload, itemKey } from "../utils/lightboxFlight";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function posMod(a, n) {
  return ((a % n) + n) % n;
}

/**
 * ClassicGridEngine
 * -----------------
 * Strictly sorted 2D folder/grid & masonry waterfall engine with spatial windowed
 * virtualization so 64 or 20,000+ renders stay locked at 120 FPS, plus interactive
 * right-edge theme scrollbar & smooth auto-hiding Back-to-Top button.
 */
export default function ClassicGridEngine({
  items = [],
  layoutStyle = "masonry", // grid | masonry
  cols = 5,
  sizeFill = 100, // 20..100 % width of stage centered
  tileShape = "natural", // natural | cube (for grid mode)
  ratioTame = 0, // 0..100 pulls tall/wide masonry cards smoothly toward 1:1
  wideSpan = false, // 2-col Bento span for wide landscapes in Masonry
  gap = 14,
  cornerRadius = 12,
  autoSpeed = 0, // 0 = dead still Explorer; >0 = calm drifting wall
  edgeFX = "fade", // fade | tilt | pop | curtain
  cursorSteer = true,
  hoverBrake = true,
  loopWrap = false,
  edgeFade = true,
  hoverFX = "pop_tilt",
  uncropHover = false,
  showMetadata = true,
  isActiveZone = true,
  resetKey = "",
  selectedKeys = null,
  vanishingKeys = null,
  onTileClick = null,
  onClearSelection = null,
  dragToMoveEnabled = false,
  isDraggingFiles = false,
  onBeginTileDrag = null,
  isPurgatoryView = false,
  onInspect,
}) {
  const hostRef = useRef(null);
  const slotRefs = useRef(new Map());
  const animPosRef = useRef(new Map());
  const scrollTrackRef = useRef(null);
  const scrollThumbRef = useRef(null);
  const lastLayoutMetaRef = useRef({ cols, layoutStyle, w: 0, resetKey });
  const vanishingKeysRef = useRef(vanishingKeys);
  vanishingKeysRef.current = vanishingKeys;
  const dragToMoveRef = useRef(dragToMoveEnabled);
  dragToMoveRef.current = dragToMoveEnabled;
  const onBeginTileDragRef = useRef(onBeginTileDrag);
  onBeginTileDragRef.current = onBeginTileDrag;
  const holdDragRef = useRef(null);
  const lastTotalVelRef = useRef(0);
  const hasSelection = Boolean(selectedKeys && selectedKeys.size > 0);
  const [size, setSize] = useState({ w: 1200, h: 560 });
  const [hoverItemId, setHoverItemId] = useState(null);
  const [steerPct, setSteerPct] = useState(0);
  const [dragRing, setDragRing] = useState(null);
  const [windowSeed, setWindowSeed] = useState(0);
  const [showTopBtn, setShowTopBtn] = useState(false);
  const [scrubberActive, setScrubberActive] = useState(false);

  const windowScrollRef = useRef(0);
  const windowDirRef = useRef(1);
  const visibleCardsRef = useRef([]);
  const showTopRef = useRef(false);

  useEffect(() => {
    if (hasSelection || isDraggingFiles) setSteerPct(0);
  }, [hasSelection, isDraggingFiles]);

  useEffect(() => {
    if (!dragToMoveEnabled) {
      holdDragRef.current = null;
      setDragRing(null);
    }
  }, [dragToMoveEnabled]);

  const simRef = useRef({
    scrollY: 0,
    velY: 0,
    keyDir: 0,
    pointerInside: false,
    pointerNormY: 0,
    dragging: false,
    draggingScrollbar: false,
    scrollbarHovered: false,
    dragStartY: 0,
    dragStartScroll: 0,
    dragMoved: false,
    glideTargetY: null,
    brakeFactor: 1,
    hovered: false,
    hoverGraceUntil: 0,
  });

  const cfgRef = useRef({
    autoSpeed,
    edgeFX,
    cursorSteer,
    hoverBrake,
    loopWrap,
    gap,
    hasSelection,
    isDraggingFiles,
  });
  cfgRef.current = {
    autoSpeed,
    edgeFX,
    cursorSteer,
    hoverBrake,
    loopWrap,
    gap,
    hasSelection,
    isDraggingFiles,
  };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      setSize({
        w: Math.max(110, el.clientWidth || 1200),
        h: Math.max(90, el.clientHeight || 560),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Strict top-to-bottom / left-to-right 2D layout coordinates
  const layoutData = useMemo(() => {
    if (!items.length) return { cards: [], contentHeight: size.h, maxCardH: 0, colW: 200 };

    const safeCols = clamp(cols, 1, 14);
    const maxAvailW = Math.max(220, size.w - 44);
    const gridW = maxAvailW * (clamp(sizeFill, 20, 100) / 100);
    const colW = Math.max(54, Math.floor((gridW - gap * (safeCols - 1)) / safeCols));
    const usedGridW = colW * safeCols + gap * (safeCols - 1);
    const leftOrigin = (size.w - usedGridW) * 0.5;
    const padTop = 22;

    const seenKeys = new Map();
    const makeStableUid = (prefix, it) => {
      const k = itemKey(it);
      const count = (seenKeys.get(k) || 0) + 1;
      seenKeys.set(k, count);
      return count > 1 ? `${prefix}__${k}__${count}` : `${prefix}__${k}`;
    };

    const cards = [];

    if (layoutStyle === "grid") {
      let curY = padTop;
      for (let rStart = 0; rStart < items.length; rStart += safeCols) {
        const rowItems = items.slice(rStart, rStart + safeCols);
        let rowH = colW;
        if (tileShape === "natural") {
          const avgAsp =
            rowItems.reduce((acc, it) => {
              const a =
                it.aspect_ratio > 0
                  ? it.aspect_ratio
                  : it.width && it.height
                  ? it.width / it.height
                  : 0.85;
              return acc + clamp(a, 0.52, 1.85);
            }, 0) / rowItems.length;
          rowH = Math.round(colW / avgAsp);
        }

        for (let c = 0; c < rowItems.length; c++) {
          cards.push({
            uid: makeStableUid("CG", rowItems[c]),
            item: rowItems[c],
            x: leftOrigin + c * (colW + gap),
            y: curY,
            w: colW,
            h: rowH,
          });
        }
        curY += rowH + gap;
      }
      const maxCardH = cards.reduce((m, c) => Math.max(m, c.h), 0);
      return { cards, contentHeight: curY, maxCardH, colW };
    }

    // True Masonry Waterfall
    const colHeights = Array.from({ length: safeCols }, () => padTop);
    const normHeights = Array.from({ length: safeCols }, () => 0);
    const normGap = 0.055;
    const tameNorm = clamp(ratioTame, 0, 100) / 100;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rawAsp = it.aspect_ratio > 0 ? it.aspect_ratio : it.width && it.height ? it.width / it.height : 1;
      const baseAsp = clamp(rawAsp, 0.45, 2.1);
      const asp = Math.pow(baseAsp, 1 - tameNorm);

      let placedWide = false;
      if (wideSpan && safeCols >= 2 && tileShape !== "cube" && rawAsp >= 1.32) {
        let bestPair = 0;
        let bestScore = Infinity;
        for (let c = 0; c < safeCols - 1; c++) {
          const topU = Math.max(normHeights[c], normHeights[c + 1]);
          const skewU = Math.abs(normHeights[c] - normHeights[c + 1]);
          const score = topU + skewU * 0.45;
          if (score < bestScore) {
            bestScore = score;
            bestPair = c;
          }
        }
        const pairTopU = Math.max(normHeights[bestPair], normHeights[bestPair + 1]);
        const minColU = Math.min(...normHeights);
        if (pairTopU - minColU <= 0.92) {
          const spanW = colW * 2 + gap;
          const cardH = Math.round(spanW / asp);
          const pairTopPx = Math.max(colHeights[bestPair], colHeights[bestPair + 1]);
          cards.push({
            uid: makeStableUid("CM", it),
            item: it,
            x: leftOrigin + bestPair * (colW + gap),
            y: pairTopPx,
            w: spanW,
            h: cardH,
          });
          colHeights[bestPair] = pairTopPx + cardH + gap;
          colHeights[bestPair + 1] = pairTopPx + cardH + gap;
          const nextU = pairTopU + 2 / asp + normGap;
          normHeights[bestPair] = nextU;
          normHeights[bestPair + 1] = nextU;
          placedWide = true;
        }
      }

      if (!placedWide) {
        let bestCol = 0;
        for (let c = 1; c < safeCols; c++) {
          if (normHeights[c] < normHeights[bestCol] - 0.002) bestCol = c;
        }
        const cardH = tileShape === "cube" ? colW : Math.round(colW / asp);

        cards.push({
          uid: makeStableUid("CM", it),
          item: it,
          x: leftOrigin + bestCol * (colW + gap),
          y: colHeights[bestCol],
          w: colW,
          h: cardH,
        });
        colHeights[bestCol] += cardH + gap;
        normHeights[bestCol] += (tileShape === "cube" ? 1 : 1 / asp) + normGap;
      }
    }

    const contentHeight = Math.max(...colHeights);
    const maxCardH = cards.reduce((m, c) => Math.max(m, c.h), 0);
    return { cards, contentHeight, maxCardH, colW };
  }, [items, layoutStyle, cols, sizeFill, tileShape, ratioTame, wideSpan, gap, size.w, size.h]);

  // Reset animated position cache on structural layout changes; keep surviving cards lerping when items are culled
  useEffect(() => {
    const prev = lastLayoutMetaRef.current;
    const structural =
      prev.cols !== cols ||
      prev.layoutStyle !== layoutStyle ||
      prev.resetKey !== resetKey ||
      Math.abs((prev.w || 0) - size.w) > 4;
    lastLayoutMetaRef.current = { cols, layoutStyle, w: size.w, resetKey };
    if (structural) {
      animPosRef.current.clear();
      return;
    }
    const valid = new Set(layoutData.cards.map((c) => c.uid));
    for (const k of animPosRef.current.keys()) {
      if (!valid.has(k)) animPosRef.current.delete(k);
    }
  }, [layoutData, cols, layoutStyle, size.w, resetKey]);

  // Reset scroll cleanly near top ONLY when folder/search/layout changes
  useEffect(() => {
    simRef.current.scrollY = 0;
    simRef.current.velY = 0;
    simRef.current.glideTargetY = null;
    windowScrollRef.current = 0;
    if (showTopRef.current) {
      showTopRef.current = false;
      setShowTopBtn(false);
    }
    setWindowSeed((s) => s + 1);
  }, [resetKey, cols, layoutStyle]);

  // Windowed Virtualization Slice with Directional Lookahead:
  // Keeps ahead-buffer generously mounted (~1.9x screens) so thumbnails preload
  // and Border Enter FX (Curtain Wipe / Fold / Pop) trigger cleanly even during fast scrolling.
  const visibleCards = useMemo(() => {
    const { cards, contentHeight, maxCardH } = layoutData;
    if (cards.length <= 140) {
      visibleCardsRef.current = cards;
      return cards;
    }
    const sy = windowScrollRef.current;
    const dir = windowDirRef.current;
    const canWrap = loopWrap && contentHeight > size.h + 20;
    const wrapPeriod = Math.max(contentHeight, size.h + (maxCardH || 0) + 28);
    const backBuf = Math.max(480, size.h * 0.75);
    const aheadBuf = Math.max(1150, size.h * 1.9);
    const minVy = dir >= 0 ? -backBuf : -aheadBuf;
    const maxVy = dir >= 0 ? size.h + aheadBuf : size.h + backBuf;

    const out = [];
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      let vy = c.y - sy;
      if (canWrap) {
        if (vy + c.h < -14) vy += wrapPeriod;
        else if (vy > size.h + 14) vy -= wrapPeriod;
      }
      if (vy + c.h >= minVy && vy <= maxVy) {
        out.push(c);
      }
    }
    visibleCardsRef.current = out;
    return out;
  }, [layoutData, size.h, loopWrap, windowSeed]);

  // Keyboard scrolling (W/S, ArrowUp/ArrowDown, A/D)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!isActiveZone || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "s" || k === "arrowdown" || k === "d" || k === "arrowright") {
        simRef.current.glideTargetY = null;
        simRef.current.keyDir = 1;
      } else if (k === "w" || k === "arrowup" || k === "a" || k === "arrowleft") {
        simRef.current.glideTargetY = null;
        simRef.current.keyDir = -1;
      }
    };
    const onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (["a", "d", "w", "s", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k)) {
        simRef.current.keyDir = 0;
      }
    };
    const onBlur = () => {
      simRef.current.keyDir = 0;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isActiveZone]);

  // Main 120 FPS Direct-Transform Vertical Engine (Virtualization-scoped!)
  useEffect(() => {
    let rafId = 0;
    let lastT = performance.now();

    const applyHidden = (el) => {
      if (!el) return;
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      el.style.transform = "translate3d(-9999px, -9999px, 0)";
    };

    const frame = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;

      const sim = simRef.current;
      const cfg = cfgRef.current;

      const hd = holdDragRef.current;
      const isHoldingTile = Boolean(hd && !hd.triggered);
      const isDragLocked = Boolean(cfg.isDraggingFiles || isHoldingTile);
      const isMotionPaused = Boolean(cfg.hasSelection || isDragLocked);

      const isHoverHeld =
        cfg.hoverBrake && (sim.hovered || now < sim.hoverGraceUntil) && !sim.dragging && sim.keyDir === 0;
      const wantBrake = isHoverHeld || isDragLocked || sim.scrollbarHovered || sim.draggingScrollbar ? 0 : 1;
      sim.brakeFactor += (wantBrake - sim.brakeFactor) * Math.min(1, dt * 11);

      let proxVel = 0;
      if (
        cfg.cursorSteer &&
        !isMotionPaused &&
        sim.pointerInside &&
        !sim.dragging &&
        !sim.draggingScrollbar &&
        !sim.scrollbarHovered
      ) {
        const absP = Math.abs(sim.pointerNormY);
        if (absP > 0.44) {
          const normEdge = (absP - 0.44) / 0.56;
          proxVel = Math.sign(sim.pointerNormY) * Math.pow(normEdge, 1.45) * 440;
        }
      }

      if (sim.glideTargetY !== null) {
        const diff = sim.glideTargetY - sim.scrollY;
        sim.velY = 0;
        if (Math.abs(diff) < 1.5) {
          sim.scrollY = sim.glideTargetY;
          sim.glideTargetY = null;
        } else {
          sim.scrollY += diff * Math.min(1, dt * 13);
        }
      } else if (!sim.dragging && !sim.draggingScrollbar) {
        const keyVel = sim.keyDir * 480;
        const autoCruise = isMotionPaused ? 0 : cfg.autoSpeed * sim.brakeFactor;
        const targetCruise = autoCruise + proxVel + keyVel;
        sim.velY *= Math.pow(isDragLocked ? 0.002 : 0.07, dt);
        sim.scrollY += (targetCruise + sim.velY) * dt;
        lastTotalVelRef.current = Math.abs(targetCruise + sim.velY);
      } else {
        lastTotalVelRef.current = 999;
      }

      // Hold-to-Drag Cursor Ring
      if (hd && !hd.triggered) {
        if (!dragToMoveRef.current || (!hd.filling && Math.abs(sim.velY) > HOLD_DRAG_MAX_VEL)) {
          holdDragRef.current = null;
          setDragRing(null);
        } else {
          const elapsed = now - hd.startTime;
          if (elapsed >= HOLD_DRAG_DELAY_MS) {
            if (!hd.filling) {
              hd.filling = true;
              sim.dragging = false;
            }
            const prog = clamp((elapsed - HOLD_DRAG_DELAY_MS) / HOLD_DRAG_FILL_MS, 0, 1);
            if (prog >= 1) {
              hd.triggered = true;
              holdDragRef.current = null;
              sim.dragging = false;
              sim.dragMoved = true;
              setDragRing(null);
              onBeginTileDragRef.current?.(hd.item, { x: hd.curX, y: hd.curY });
            } else {
              setDragRing({ x: hd.curX, y: hd.curY, progress: prog });
            }
          }
        }
      }

      const { cards, contentHeight, maxCardH } = layoutData;
      const canWrap = cfg.loopWrap && contentHeight > size.h + 20;
      const wrapPeriod = Math.max(contentHeight, size.h + maxCardH + 28);
      const maxBounded = Math.max(0, contentHeight - size.h);

      if (!canWrap) {
        if (sim.scrollY < 0) {
          sim.scrollY = 0;
          sim.velY = 0;
        } else if (sim.scrollY > maxBounded) {
          sim.scrollY = maxBounded;
          sim.velY = 0;
        }
      } else {
        sim.scrollY = posMod(sim.scrollY, wrapPeriod);
      }

      // Update Back-to-Top pill visibility cleanly only when crossing threshold
      const awayFromTop = sim.scrollY > 360 && (!canWrap || sim.scrollY < wrapPeriod - 120);
      if (awayFromTop !== showTopRef.current) {
        showTopRef.current = awayFromTop;
        setShowTopBtn(awayFromTop);
      }

      // Sync Slim Right-Edge Scrollbar Thumb directly via GPU transform (zero React renders)
      const trackEl = scrollTrackRef.current;
      const thumbEl = scrollThumbRef.current;
      if (trackEl && thumbEl && contentHeight > size.h + 16) {
        const trackH = trackEl.clientHeight || Math.max(40, size.h - 20);
        const totalSpan = canWrap ? wrapPeriod : contentHeight;
        const thumbH = clamp((size.h / Math.max(size.h, totalSpan)) * trackH, 28, Math.max(36, trackH * 0.85));
        const maxRange = canWrap ? wrapPeriod : Math.max(1, maxBounded);
        const normPos = clamp(sim.scrollY / Math.max(1, maxRange), 0, 1);
        const thumbY = normPos * Math.max(0, trackH - thumbH);
        thumbEl.style.height = `${thumbH.toFixed(1)}px`;
        thumbEl.style.transform = `translate3d(0, ${thumbY.toFixed(1)}px, 0)`;
      }

      // Advance visible virtualization window smoothly with directional lookahead
      if (cards.length > 140) {
        const stepThreshold = Math.max(96, size.h * 0.16);
        const signedDelta = sim.scrollY - windowScrollRef.current;
        const rawDelta = Math.abs(signedDelta);
        const wrapJump = canWrap ? Math.abs(rawDelta - wrapPeriod) : rawDelta;
        if (Math.min(rawDelta, wrapJump) > stepThreshold) {
          if (canWrap && wrapJump < rawDelta) {
            windowDirRef.current = signedDelta > 0 ? -1 : 1;
          } else if (signedDelta !== 0) {
            windowDirRef.current = signedDelta > 0 ? 1 : -1;
          }
          windowScrollRef.current = sim.scrollY;
          setWindowSeed((s) => s + 1);
        }
      }

      const lerpAlpha = 1 - Math.exp(-15 * dt);
      const vanish = vanishingKeysRef.current;
      const activeCards = visibleCardsRef.current;

      for (let i = 0; i < activeCards.length; i++) {
        const c = activeCards[i];
        const el = slotRefs.current.get(c.uid);
        if (!el) continue;

        if (vanish && vanish.has(itemKey(c.item))) {
          applyHidden(el);
          continue;
        }

        let pos = animPosRef.current.get(c.uid);
        if (!pos) {
          pos = { x: c.x, y: c.y };
          animPosRef.current.set(c.uid, pos);
        } else {
          const dx = c.x - pos.x;
          const dy = c.y - pos.y;
          if (Math.abs(dx) + Math.abs(dy) < 0.35) {
            pos.x = c.x;
            pos.y = c.y;
          } else {
            pos.x += dx * lerpAlpha;
            pos.y += dy * lerpAlpha;
          }
        }

        let vy = pos.y - sim.scrollY;
        if (canWrap) {
          if (vy + c.h < -14) vy += wrapPeriod;
          else if (vy > size.h + 14) vy -= wrapPeriod;
        }

        if (vy + c.h <= 0 || vy >= size.h) {
          applyHidden(el);
          continue;
        }

        const visTop = Math.max(0, vy);
        const visBot = Math.min(size.h, vy + c.h);
        const clipTop = Math.max(0, -vy);
        const clipBot = Math.max(0, vy + c.h - size.h);

        const edgeBand = clamp(Math.min(c.h * 0.92, size.h * 0.16), 14, 96);
        const topProg = clamp((vy + c.h) / edgeBand, 0, 1);
        const botProg = clamp((size.h - vy) / edgeBand, 0, 1);
        const edgeProg = Math.min(topProg, botProg);
        const isTopEdge = vy + c.h * 0.5 < size.h * 0.5;

        el.style.pointerEvents = visBot - visTop > 22 ? "auto" : "none";

        if (cfg.edgeFX === "tilt" && edgeProg < 1) {
          const rotX = (1 - edgeProg) * 44 * (isTopEdge ? -1 : 1);
          const sc = 0.84 + 0.16 * edgeProg;
          el.style.transformOrigin = isTopEdge ? "50% 100%" : "50% 0%";
          el.style.clipPath = "none";
          el.style.opacity = String(clamp(Math.pow(edgeProg, 0.7), 0.05, 1).toFixed(3));
          el.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${vy.toFixed(
            1
          )}px, 0) perspective(1400px) rotateX(${rotX.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
        } else if (cfg.edgeFX === "pop" && edgeProg < 1) {
          const sc = 0.72 + 0.28 * edgeProg;
          el.style.transformOrigin = "50% 50%";
          el.style.clipPath = "none";
          el.style.opacity = String(clamp(edgeProg, 0.05, 1).toFixed(3));
          el.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${vy.toFixed(
            1
          )}px, 0) scale(${sc.toFixed(3)})`;
        } else if (cfg.edgeFX === "curtain" && (clipTop > 0.4 || clipBot > 0.4)) {
          el.style.transformOrigin = "50% 50%";
          el.style.opacity = "1";
          el.style.clipPath = `inset(${clipTop.toFixed(1)}px 0px ${clipBot.toFixed(1)}px 0px)`;
          el.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${vy.toFixed(1)}px, 0)`;
        } else {
          el.style.transformOrigin = "50% 50%";
          el.style.clipPath = "none";
          el.style.opacity = String(clamp(edgeProg < 1 ? edgeProg : 1, 0.08, 1).toFixed(3));
          el.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${vy.toFixed(1)}px, 0)`;
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [layoutData, size.w, size.h]);

  const scrollToTrackClientY = (clientY) => {
    const trackEl = scrollTrackRef.current;
    const thumbEl = scrollThumbRef.current;
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const thumbH = thumbEl ? thumbEl.clientHeight : 36;
    const availH = Math.max(1, rect.height - thumbH);
    const ratio = clamp((clientY - rect.top - thumbH * 0.5) / availH, 0, 1);

    const { contentHeight, maxCardH } = layoutData;
    const canWrap = loopWrap && contentHeight > size.h + 20;
    const wrapPeriod = Math.max(contentHeight, size.h + maxCardH + 28);
    const maxBounded = Math.max(0, contentHeight - size.h);
    const targetScroll = ratio * (canWrap ? wrapPeriod : maxBounded);

    simRef.current.glideTargetY = null;
    simRef.current.velY = 0;
    simRef.current.scrollY = targetScroll;
    if (Math.abs(targetScroll - windowScrollRef.current) > Math.max(150, size.h * 0.25)) {
      windowScrollRef.current = targetScroll;
      setWindowSeed((s) => s + 1);
    }
  };

  const handleScrollbarPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    simRef.current.draggingScrollbar = true;
    setScrubberActive(true);
    scrollToTrackClientY(e.clientY);

    const onMove = (ev) => {
      scrollToTrackClientY(ev.clientY);
    };
    const onUp = () => {
      simRef.current.draggingScrollbar = false;
      setScrubberActive(false);
      windowScrollRef.current = simRef.current.scrollY;
      setWindowSeed((s) => s + 1);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const hasScrollbar = layoutData.contentHeight > size.h + 16;
  const compactThumb = layoutData.colW < 235;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      simRef.current.glideTargetY = null;
      if (holdDragRef.current) {
        holdDragRef.current = null;
        setDragRing(null);
      }
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      simRef.current.velY += delta * 2.4;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={hostRef}
      className={`cb-stage ${edgeFade ? "edge-fade" : ""} vertical`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        simRef.current.glideTargetY = null;
        const sim = simRef.current;
        sim.dragging = true;
        sim.dragMoved = false;
        sim.dragStartY = e.clientY;
        sim.dragStartScroll = sim.scrollY;
      }}
      onPointerMove={(e) => {
        const el = hostRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const sim = simRef.current;
        sim.pointerInside = true;
        const norm = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
        sim.pointerNormY = clamp(norm, -1, 1);

        const hd = holdDragRef.current;
        if (hd) {
          hd.curX = e.clientX;
          hd.curY = e.clientY;
          const elapsed = performance.now() - hd.startTime;
          if (!hd.filling && elapsed < HOLD_DRAG_DELAY_MS) {
            if (Math.hypot(e.clientX - hd.startX, e.clientY - hd.startY) > HOLD_DRAG_MOVE_PX) {
              holdDragRef.current = null;
              setDragRing(null);
            }
          } else {
            hd.filling = true;
            sim.dragging = false;
          }
        }

        if (
          cursorSteer &&
          !hasSelection &&
          !isDraggingFiles &&
          !sim.dragging &&
          !sim.draggingScrollbar &&
          !sim.scrollbarHovered &&
          !holdDragRef.current &&
          Math.abs(norm) > 0.44
        ) {
          setSteerPct(Math.sign(norm) * ((Math.abs(norm) - 0.44) / 0.56));
        } else {
          setSteerPct(0);
        }

        if (sim.dragging && !holdDragRef.current) {
          const diff = e.clientY - sim.dragStartY;
          if (Math.abs(diff) > 5) sim.dragMoved = true;
          const prev = sim.scrollY;
          sim.scrollY = sim.dragStartScroll - diff;
          sim.velY = (sim.scrollY - prev) * 18;
        }
      }}
      onPointerUp={() => {
        simRef.current.dragging = false;
        if (holdDragRef.current) {
          holdDragRef.current = null;
          setDragRing(null);
        }
      }}
      onPointerCancel={() => {
        simRef.current.dragging = false;
        holdDragRef.current = null;
        setDragRing(null);
      }}
      onPointerLeave={() => {
        const sim = simRef.current;
        sim.pointerInside = false;
        sim.dragging = false;
        sim.hovered = false;
        sim.hoverGraceUntil = 0;
        sim.scrollbarHovered = false;
        holdDragRef.current = null;
        setDragRing(null);
        setSteerPct(0);
        setHoverItemId(null);
      }}
      onClick={(e) => {
        if (hasSelection && !simRef.current.dragMoved && !e.target?.closest?.(".cb-tile")) {
          onClearSelection?.();
        }
      }}
    >
      {cursorSteer && !hasSelection && !isDraggingFiles && steerPct < -0.04 && (
        <div className="cb-steer-glow top" style={{ opacity: Math.min(0.85, Math.abs(steerPct)) }} />
      )}
      {cursorSteer && !hasSelection && !isDraggingFiles && steerPct > 0.04 && (
        <div className="cb-steer-glow bottom" style={{ opacity: Math.min(0.85, Math.abs(steerPct)) }} />
      )}

      {visibleCards.map((c) => {
        const isHovered = hoverItemId === c.uid;
        return (
          <div
            key={c.uid}
            ref={(el) => {
              if (el) slotRefs.current.set(c.uid, el);
              else slotRefs.current.delete(c.uid);
            }}
            className={`cb-tile ${isHovered ? "is-hovered" : ""}`}
            style={{ width: c.w, height: c.h }}
            onPointerDown={(e) => {
              if (
                e.button === 0 &&
                dragToMoveRef.current &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.shiftKey &&
                Math.abs(simRef.current.velY) < HOLD_DRAG_MAX_VEL
              ) {
                holdDragRef.current = {
                  item: c.item,
                  startX: e.clientX,
                  startY: e.clientY,
                  curX: e.clientX,
                  curY: e.clientY,
                  startTime: performance.now(),
                  filling: false,
                  triggered: false,
                };
              }
            }}
            onMouseEnter={() => {
              simRef.current.hovered = true;
              simRef.current.hoverGraceUntil = 0;
              setHoverItemId(c.uid);
            }}
            onMouseLeave={() => {
              simRef.current.hovered = false;
              simRef.current.hoverGraceUntil = performance.now() + 220;
              setHoverItemId(null);
            }}
            onClick={(e) => {
              if (!simRef.current.dragMoved) {
                if (onTileClick?.(e, c.item, e.currentTarget)) return;
                onInspect?.(captureInspectPayload(e.currentTarget, c.item, items));
              }
            }}
          >
            <TileInner
              item={c.item}
              hoverFX={hoverFX}
              showMetadata={showMetadata}
              cornerRadius={cornerRadius}
              uncropHover={uncropHover}
              slotW={c.w}
              slotH={c.h}
              compactThumb={compactThumb}
              isSelected={Boolean(selectedKeys?.has(itemKey(c.item)))}
              isPurgatoryView={isPurgatoryView}
            />
          </div>
        );
      })}

      {/* Sleek Themed Right-Edge Scrubbing Scrollbar */}
      {hasScrollbar && (
        <div
          ref={scrollTrackRef}
          className={`hm-grid-scrollbar ${scrubberActive ? "is-active" : ""}`}
          onPointerDown={handleScrollbarPointerDown}
          onMouseEnter={() => {
            simRef.current.scrollbarHovered = true;
            setSteerPct(0);
          }}
          onMouseLeave={() => {
            simRef.current.scrollbarHovered = false;
          }}
          title="Drag or click to scrub gallery"
        >
          <div ref={scrollThumbRef} className="hm-grid-scroll-thumb" />
        </div>
      )}

      {/* Auto-Hiding Back-to-Top Pill */}
      {showTopBtn && (
        <button
          type="button"
          className="hm-back-to-top"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            simRef.current.velY = 0;
            simRef.current.glideTargetY = 0;
          }}
          onMouseEnter={() => {
            simRef.current.scrollbarHovered = true;
          }}
          onMouseLeave={() => {
            simRef.current.scrollbarHovered = false;
          }}
          title="Scroll smoothly back to top"
        >
          <ArrowUp size={13} />
          <span>Top</span>
        </button>
      )}

      {!items.length && (
        <div className="cb-empty">No matching renders for this search / folder filter.</div>
      )}

      <HoldDragRing ring={dragRing} />
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
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

export default function ConveyorBrick({
  items = [],
  axis = "horizontal",
  flowMode = "snake",
  turnStyle = "split",
  lanes = 3,
  laneFill = 100,
  tileShape = "natural",
  gap = 12,
  cornerRadius = 12,
  bend = 0,
  autoSpeed = 54,
  cursorSteer = true,
  hoverBrake = true,
  edgeFade = true,
  showGuideWire = true,
  seamlessFill = true,
  hoverFX = "pop_tilt",
  uncropHover = false,
  showMetadata = true,
  isActiveZone = true,
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
  const vanishingKeysRef = useRef(vanishingKeys);
  vanishingKeysRef.current = vanishingKeys;
  const dragToMoveRef = useRef(dragToMoveEnabled);
  dragToMoveRef.current = dragToMoveEnabled;
  const onBeginTileDragRef = useRef(onBeginTileDrag);
  onBeginTileDragRef.current = onBeginTileDrag;
  const holdDragRef = useRef(null);
  const hasSelection = Boolean(selectedKeys && selectedKeys.size > 0);
  const [size, setSize] = useState({ w: 1200, h: 560 });
  const [hoverItemId, setHoverItemId] = useState(null);
  const [steerPct, setSteerPct] = useState(0);
  const [dragRing, setDragRing] = useState(null);
  const [beltWindowSeed, setBeltWindowSeed] = useState(0);
  const windowBeltScrollRef = useRef(0);
  const visibleBeltNodesRef = useRef([]);

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
    scroll: 0,
    vel: 0,
    keyDir: 0,
    pointerInside: false,
    pointerNorm: 0,
    dragging: false,
    dragStartMain: 0,
    dragStartScroll: 0,
    dragMoved: false,
    brakeFactor: 1,
    hovered: false,
    hoverGraceUntil: 0,
  });

  const cfgRef = useRef({
    axis,
    flowMode,
    turnStyle,
    lanes,
    gap,
    bend,
    autoSpeed,
    cursorSteer,
    hoverBrake,
    cornerRadius,
    hasSelection,
    isDraggingFiles,
  });
  cfgRef.current = {
    axis,
    flowMode,
    turnStyle,
    lanes,
    gap,
    bend,
    autoSpeed,
    cursorSteer,
    hoverBrake,
    cornerRadius,
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

  const mainPad = 26;
  const maxCrossAvail = Math.max(80, (axis === "horizontal" ? size.h : size.w) - 40);
  const groupCross = maxCrossAvail * (clamp(laneFill, 18, 100) / 100);

  const laneSize = useMemo(() => {
    return Math.max(44, Math.floor((groupCross - gap * (lanes - 1)) / Math.max(1, lanes)));
  }, [groupCross, gap, lanes]);

  const totalGroupCross = lanes * laneSize + Math.max(0, lanes - 1) * gap;
  const crossPad = Math.max(16, ((axis === "horizontal" ? size.h : size.w) - totalGroupCross) * 0.5);

  const padX = axis === "horizontal" ? mainPad : crossPad;
  const padY = axis === "horizontal" ? crossPad : mainPad;

  const span = useMemo(
    () => Math.max(160, axis === "horizontal" ? size.w - padX * 2 : size.h - padY * 2),
    [axis, size.w, size.h, padX, padY]
  );

  // Total visible snake span (Parallel uses single-lane `span` per lane)
  const snakeTrackSpan = useMemo(() => lanes * span, [lanes, span]);

  // Measure cards & distribute either onto one Snake chain OR N truly independent Parallel lanes
  const ribbonData = useMemo(() => {
    if (!items.length) return { nodes: [], snakePeriod: snakeTrackSpan, lanePeriods: [] };

    const measureSingle = (it) => {
      const rawAsp = it.aspect_ratio > 0 ? it.aspect_ratio : it.width && it.height ? it.width / it.height : 1;
      const asp = clamp(rawAsp, 0.48, 2.05);
      if (tileShape === "cube") return { w: laneSize, h: laneSize };
      if (axis === "horizontal") return { w: Math.round(laneSize * asp), h: laneSize };
      return { w: laneSize, h: Math.round(laneSize / asp) };
    };

    if (flowMode === "parallel") {
      // Independent round-robin lane feeds: scrolling reveals `lanes` new distinct images!
      const buckets = Array.from({ length: lanes }, () => []);
      for (let i = 0; i < items.length; i++) {
        buckets[i % lanes].push(items[i]);
      }
      for (let k = 0; k < lanes; k++) {
        if (!buckets[k].length) buckets[k].push(items[k % items.length]);
      }

      const nodes = [];
      const lanePeriods = [];

      for (let k = 0; k < lanes; k++) {
        const measured = buckets[k].map((it) => ({ item: it, ...measureSingle(it) }));
        const stepFn = (m) => (axis === "horizontal" ? m.w : m.h) + gap;
        const singleSum = measured.reduce((acc, m) => acc + stepFn(m), 0);
        const maxMain = measured.reduce((mx, m) => Math.max(mx, axis === "horizontal" ? m.w : m.h), laneSize);

        const reps =
          seamlessFill && singleSum > 0 && singleSum < span + maxMain
            ? Math.ceil((span + maxMain) / singleSum)
            : 1;

        let sAcc = 0;
        for (let r = 0; r < reps; r++) {
          for (let i = 0; i < measured.length; i++) {
            const m = measured[i];
            const mainSize = axis === "horizontal" ? m.w : m.h;
            nodes.push({
              uid: `L${k}__${itemKey(m.item) || m.item.filename}__r${r}`,
              laneIdx: k,
              item: m.item,
              w: m.w,
              h: m.h,
              mainSize,
              sCenter: sAcc + mainSize * 0.5,
            });
            sAcc += mainSize + gap;
          }
        }
        lanePeriods[k] = Math.max(span + gap, sAcc);
      }

      return { nodes, snakePeriod: span, lanePeriods };
    }

    // Snake mode: continuous sequential chain across lanes
    const measured = items.map((it) => ({ item: it, ...measureSingle(it) }));
    const stepFn = (m) => (axis === "horizontal" ? m.w : m.h) + gap;
    const singleSum = measured.reduce((acc, m) => acc + stepFn(m), 0);
    const maxMain = measured.reduce((mx, m) => Math.max(mx, axis === "horizontal" ? m.w : m.h), laneSize);

    const reps =
      seamlessFill && singleSum > 0 && singleSum < snakeTrackSpan + maxMain
        ? Math.ceil((snakeTrackSpan + maxMain) / singleSum)
        : 1;

    const nodes = [];
    let sAcc = 0;
    for (let r = 0; r < reps; r++) {
      for (let i = 0; i < measured.length; i++) {
        const m = measured[i];
        const mainSize = axis === "horizontal" ? m.w : m.h;
        nodes.push({
          uid: `S__${itemKey(m.item) || m.item.filename}__r${r}`,
          laneIdx: 0,
          item: m.item,
          w: m.w,
          h: m.h,
          mainSize,
          sCenter: sAcc + mainSize * 0.5,
        });
        sAcc += mainSize + gap;
      }
    }

    const snakePeriod = Math.max(snakeTrackSpan + gap, sAcc);
    return { nodes, snakePeriod, lanePeriods: [] };
  }, [items, axis, flowMode, lanes, tileShape, laneSize, gap, snakeTrackSpan, span, seamlessFill]);

  const visibleBeltNodes = useMemo(() => {
    const { nodes, snakePeriod, lanePeriods } = ribbonData;
    if (nodes.length <= 160) {
      visibleBeltNodesRef.current = nodes;
      return nodes;
    }
    const sc = windowBeltScrollRef.current;
    const buf = Math.max(880, span * 1.35);
    const out = [];
    if (flowMode === "parallel") {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const p = lanePeriods[n.laneIdx] || span;
        const s0 = posMod(n.sCenter + sc, p);
        const half = n.mainSize * 0.5;
        if (s0 - half <= span + buf || s0 + half >= p - buf) {
          out.push(n);
        }
      }
    } else {
      const p = snakePeriod || span;
      const trackLim = snakeTrackSpan + buf;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const s0 = posMod(n.sCenter + sc, p);
        const half = n.mainSize * 0.5;
        if (s0 - half <= trackLim || s0 + half >= p - buf) {
          out.push(n);
        }
      }
    }
    visibleBeltNodesRef.current = out;
    return out;
  }, [ribbonData, flowMode, span, snakeTrackSpan, beltWindowSeed]);

  // Keyboard support (A/D, W/S, Arrows) - scoped to active focused zone
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!isActiveZone || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "d" || k === "arrowright" || k === "s" || k === "arrowdown") {
        simRef.current.keyDir = 1;
      } else if (k === "a" || k === "arrowleft" || k === "w" || k === "arrowup") {
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

  // Main 120 FPS Direct DOM Transform Loop
  useEffect(() => {
    let rafId = 0;
    let lastT = performance.now();

    const applyHidden = (el) => {
      if (!el) return;
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      el.style.transform = "translate3d(-9999px, -9999px, 0)";
    };

    const renderLaneSlice = (el, n, k, localCenter, cfg) => {
      const isHoriz = cfg.axis === "horizontal";
      const forward = cfg.flowMode === "parallel" ? true : k % 2 === 0;
      const laneStep = laneSize + cfg.gap;
      const laneCenterCross = (isHoriz ? padY : padX) + laneSize * 0.5 + k * laneStep;
      const startEdge = isHoriz ? padX : padY;
      const endEdge = startEdge + span;
      const half = n.mainSize * 0.5;

      let mainCenter = forward ? startEdge + localCenter : endEdge - localCenter;
      let crossCenter = laneCenterCross;
      let rotDeg = 0;

      const effBend = isHoriz ? cfg.bend : 0;
      if (Math.abs(effBend) > 0.05) {
        const nx = clamp(((mainCenter - startEdge) / span) * 2 - 1, -1.25, 1.25);
        const curveAmp = effBend * clamp(laneSize / 165, 0.55, 1.25) * 12;
        crossCenter += curveAmp * (nx * nx - 0.35);
        rotDeg += effBend * 2.0 * nx;
      }

      const txBase = (isHoriz ? mainCenter : crossCenter) - n.w * 0.5;
      const tyBase = (isHoriz ? crossCenter : mainCenter) - n.h * 0.5;

      const visStart = Math.max(0, localCenter - half);
      const visEnd = Math.min(span, localCenter + half);
      const visibleFrac = clamp((visEnd - visStart) / Math.max(1, n.mainSize), 0, 1);

      const isSplitStyle = cfg.turnStyle === "split" || cfg.turnStyle === "arc";
      const rotReach = isSplitStyle && Math.abs(effBend) > 0.05 ? Math.ceil(n.h * 0.18) : 0;
      const extVisPx = Math.min(span, localCenter + half + rotReach) - Math.max(0, localCenter - half - rotReach);

      if ((isSplitStyle ? extVisPx <= 1 : visibleFrac <= 0.002)) {
        applyHidden(el);
        return;
      }

      const enteringEdge = localCenter - half < 0;
      const exitingEdge = localCenter + half > span;
      const onSeam = enteringEdge || exitingEdge;

      // 1. PURE SEAM SPLIT (clipped cleanly in screen space by .cb-belt-clip so tilted cards never get diagonal slivers)
      if (isSplitStyle || !onSeam) {
        el.style.clipPath = "none";
        el.style.transformOrigin = "50% 50%";
        el.style.opacity = "1";
        el.style.filter = "none";
        el.style.pointerEvents = visibleFrac > 0.12 ? "auto" : "none";
        el.style.transform = `translate3d(${txBase.toFixed(2)}px, ${tyBase.toFixed(
          2
        )}px, 0) rotate(${rotDeg.toFixed(2)}deg)`;
        return;
      }

      const touchRightWall = (forward && exitingEdge) || (!forward && enteringEdge);
      const wallCoord = touchRightWall ? endEdge : startEdge;

      let pinnedTx = txBase;
      let pinnedTy = tyBase;
      if (isHoriz) {
        pinnedTx = touchRightWall ? wallCoord - n.w : wallCoord;
      } else {
        pinnedTy = touchRightWall ? wallCoord - n.h : wallCoord;
      }

      // Keep 50% 50% origin so rotate(rotDeg) matches the lane body seamlessly with zero frame-1 snap
      el.style.transformOrigin = "50% 50%";
      const hingeHalf = (isHoriz ? n.w : n.h) * 0.5;
      const hingeSign = touchRightWall ? 1 : -1;
      const hingeShift = (hingeSign * hingeHalf).toFixed(2);
      const hingeNeg = (-hingeSign * hingeHalf).toFixed(2);
      const hingeTo = isHoriz ? `translateX(${hingeShift}px)` : `translateY(${hingeShift}px)`;
      const hingeBack = isHoriz ? `translateX(${hingeNeg}px)` : `translateY(${hingeNeg}px)`;
      const tiltPrefix = Math.abs(rotDeg) > 0.01 ? ` rotate(${rotDeg.toFixed(2)}deg)` : "";

      // 2. 3D FLIP-BOOK HINGE (swings cleanly inward into -Z depth along the tilted edge)
      if (cfg.turnStyle === "flip3d") {
        const foldDeg = (1 - visibleFrac) * 78;
        const angleY = foldDeg * (touchRightWall ? -1 : 1);
        const angleX = foldDeg * (touchRightWall ? 1 : -1);
        const persp = Math.max(1500, Math.round(Math.max(n.w, n.h) * 3.2));
        const rotProp = isHoriz ? `rotateY(${angleY.toFixed(1)}deg)` : `rotateX(${angleX.toFixed(1)}deg)`;
        const tuckScale = 0.92 + 0.08 * visibleFrac;
        el.style.clipPath = "none";
        el.style.opacity = String(clamp(Math.pow(visibleFrac, 0.55), 0.08, 1).toFixed(3));
        el.style.filter = `brightness(${(0.55 + 0.45 * visibleFrac).toFixed(2)})`;
        el.style.pointerEvents = visibleFrac > 0.25 ? "auto" : "none";
        el.style.transform = `translate3d(${pinnedTx.toFixed(2)}px, ${pinnedTy.toFixed(
          2
        )}px, 0)${tiltPrefix} ${hingeTo} perspective(${persp}px) ${rotProp} scale(${tuckScale.toFixed(3)}) ${hingeBack}`;
        return;
      }

      // 3. ELASTIC ACCORDION WALL SQUISH
      if (cfg.turnStyle === "accordion") {
        const sq = clamp(0.06 + 0.94 * visibleFrac, 0.06, 1);
        const crossStretch = 1 + (1 - sq) * 0.08;
        const scaleStr = isHoriz
          ? `scale(${sq.toFixed(3)}, ${crossStretch.toFixed(3)})`
          : `scale(${crossStretch.toFixed(3)}, ${sq.toFixed(3)})`;
        el.style.clipPath = "none";
        el.style.opacity = String(clamp(visibleFrac * 1.4, 0.15, 1).toFixed(3));
        el.style.filter = "none";
        el.style.pointerEvents = visibleFrac > 0.2 ? "auto" : "none";
        el.style.transform = `translate3d(${pinnedTx.toFixed(2)}px, ${pinnedTy.toFixed(
          2
        )}px, 0)${tiltPrefix} ${hingeTo} ${scaleStr} ${hingeBack}`;
        return;
      }

      // 4. LASER SHUTTER WIPE
      const hidePx = Math.max(0, (1 - visibleFrac) * n.mainSize);
      if (isHoriz) {
        const cL = touchRightWall ? hidePx : 0;
        const cR = touchRightWall ? 0 : hidePx;
        el.style.clipPath = `inset(0px ${cR.toFixed(1)}px 0px ${cL.toFixed(1)}px)`;
      } else {
        const cT = touchRightWall ? hidePx : 0;
        const cB = touchRightWall ? 0 : hidePx;
        el.style.clipPath = `inset(${cT.toFixed(1)}px 0px ${cB.toFixed(1)}px 0px)`;
      }
      el.style.opacity = "1";
      el.style.filter = `brightness(${(1 + (1 - visibleFrac) * 0.35).toFixed(2)})`;
      el.style.pointerEvents = visibleFrac > 0.2 ? "auto" : "none";
      el.style.transform = `translate3d(${pinnedTx.toFixed(2)}px, ${pinnedTy.toFixed(
        2
      )}px, 0)${tiltPrefix} scale(${(0.94 + 0.06 * visibleFrac).toFixed(3)})`;
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
      const wantBrake = isHoverHeld || isDragLocked ? 0 : 1;
      sim.brakeFactor += (wantBrake - sim.brakeFactor) * Math.min(1, dt * 11);

      let proxVel = 0;
      if (cfg.cursorSteer && !isMotionPaused && sim.pointerInside && !sim.dragging) {
        const absP = Math.abs(sim.pointerNorm);
        if (absP > 0.42) {
          const normEdge = (absP - 0.42) / 0.58;
          proxVel = Math.sign(sim.pointerNorm) * Math.pow(normEdge, 1.45) * 440;
        }
      }

      const keyVel = sim.keyDir * 460;
      const autoCruise = isMotionPaused ? 0 : cfg.autoSpeed * sim.brakeFactor;
      const targetCruise = autoCruise + proxVel + keyVel;

      if (!sim.dragging) {
        sim.vel *= Math.pow(isDragLocked ? 0.002 : 0.08, dt);
        sim.scroll += (targetCruise + sim.vel) * dt;
      }

      // Hold-to-Drag Cursor Ring (freezes Steer/Cruise on LMB hold & ignores hand jitter while filling)
      if (hd && !hd.triggered) {
        if (!dragToMoveRef.current || (!hd.filling && Math.abs(sim.vel) > HOLD_DRAG_MAX_VEL)) {
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

      const { nodes, snakePeriod, lanePeriods } = ribbonData;
      if (nodes.length > 160) {
        const step = Math.max(110, span * 0.16);
        if (Math.abs(sim.scroll - windowBeltScrollRef.current) > step) {
          windowBeltScrollRef.current = sim.scroll;
          setBeltWindowSeed((v) => v + 1);
        }
      }

      const vanish = vanishingKeysRef.current;
      const activeNodes = visibleBeltNodesRef.current;

      for (let i = 0; i < activeNodes.length; i++) {
        const n = activeNodes[i];
        const slots = slotRefs.current.get(n.uid);
        if (!slots) continue;

        if (vanish && vanish.has(itemKey(n.item))) {
          applyHidden(slots.a);
          applyHidden(slots.b);
          continue;
        }

        const isSplitFlow = cfg.turnStyle === "split" || cfg.turnStyle === "arc";
        const rotReach =
          isSplitFlow && cfg.axis === "horizontal" && Math.abs(cfg.bend) > 0.05
            ? Math.ceil(n.h * 0.18)
            : 0;

        if (cfg.flowMode === "parallel") {
          // Each lane wraps strictly within its own independent belt [0 .. span]!
          const p = lanePeriods[n.laneIdx] || span;
          const s0 = posMod(n.sCenter + sim.scroll, p);
          const half = n.mainSize * 0.5 + rotReach;
          const hits = [];
          if (s0 + half > 0 && s0 - half < span) hits.push(s0);
          if (s0 > p - half) {
            const sw = s0 - p;
            if (sw + half > 0 && sw - half < span) hits.push(sw);
          }

          if (hits[0] !== undefined && slots.a) {
            renderLaneSlice(slots.a, n, n.laneIdx, hits[0], cfg);
          } else {
            applyHidden(slots.a);
          }
          if (hits[1] !== undefined && slots.b) {
            renderLaneSlice(slots.b, n, n.laneIdx, hits[1], cfg);
          } else {
            applyHidden(slots.b);
          }
          continue;
        }

        const s0 = posMod(n.sCenter + sim.scroll, snakePeriod);
        const half = n.mainSize * 0.5 + rotReach;
        const candidates = [s0];
        if (s0 > snakePeriod - half) candidates.push(s0 - snakePeriod);

        const hits = [];
        for (let c = 0; c < candidates.length; c++) {
          const s = candidates[c];
          const sMin = s - half;
          const sMax = s + half;
          if (sMax <= 0 || sMin >= cfg.lanes * span) continue;
          const kFirst = Math.max(0, Math.floor(sMin / span));
          const kLast = Math.min(cfg.lanes - 1, Math.floor(sMax / span));
          for (let k = kFirst; k <= kLast; k++) {
            hits.push({ k, localCenter: s - k * span });
          }
        }

        if (hits[0] && slots.a) {
          renderLaneSlice(slots.a, n, hits[0].k, hits[0].localCenter, cfg);
        } else {
          applyHidden(slots.a);
        }

        if (hits[1] && slots.b) {
          renderLaneSlice(slots.b, n, hits[1].k, hits[1].localCenter, cfg);
        } else {
          applyHidden(slots.b);
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [ribbonData, snakeTrackSpan, span, size.w, size.h, padX, padY, laneSize]);

  const guideSvgPath = useMemo(() => {
    if (!showGuideWire) return "";
    const isHoriz = axis === "horizontal";
    const laneStep = laneSize + gap;
    const laneCenter = (k) => (isHoriz ? padY : padX) + laneSize * 0.5 + k * laneStep;
    const startEdge = isHoriz ? padX : padY;
    const endEdge = startEdge + span;

    let d = "";
    for (let k = 0; k < lanes; k++) {
      const fwd = flowMode === "parallel" ? true : k % 2 === 0;
      const aMain = fwd ? startEdge : endEdge;
      const bMain = fwd ? endEdge : startEdge;
      const c = laneCenter(k);
      d += isHoriz ? ` M ${aMain} ${c} L ${bMain} ${c}` : ` M ${c} ${aMain} L ${c} ${bMain}`;

      if (flowMode === "snake" && k < lanes - 1) {
        const nextC = laneCenter(k + 1);
        const dir = fwd ? 1 : -1;
        const reach = 18;
        if (isHoriz) {
          d += ` C ${bMain + dir * reach} ${c}, ${bMain + dir * reach} ${nextC}, ${bMain} ${nextC}`;
        } else {
          d += ` C ${c} ${bMain + dir * reach}, ${nextC} ${bMain + dir * reach}, ${nextC} ${bMain}`;
        }
      }
    }
    return d;
  }, [showGuideWire, axis, flowMode, lanes, span, padX, padY, laneSize, gap]);

  const setSlotRef = (uid, key, el) => {
    const cur = slotRefs.current.get(uid) || {};
    if (el) {
      cur[key] = el;
      slotRefs.current.set(uid, cur);
    } else {
      delete cur[key];
      if (!cur.a && !cur.b) slotRefs.current.delete(uid);
    }
  };

  const renderTile = (n, slotKey) => {
    const isHovered = hoverItemId === n.uid;

    return (
      <div
        key={`${n.uid}_${slotKey}`}
        ref={(el) => setSlotRef(n.uid, slotKey, el)}
        className={`cb-tile ${isHovered ? "is-hovered" : ""}`}
        style={{
          width: n.w,
          height: n.h,
        }}
        onPointerDown={(e) => {
          if (
            e.button === 0 &&
            dragToMoveRef.current &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey &&
            Math.abs(simRef.current.vel) < HOLD_DRAG_MAX_VEL
          ) {
            holdDragRef.current = {
              item: n.item,
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
          setHoverItemId(n.uid);
        }}
        onMouseLeave={() => {
          simRef.current.hovered = false;
          simRef.current.hoverGraceUntil = performance.now() + 220;
          setHoverItemId(null);
        }}
        onClick={(e) => {
          if (!simRef.current.dragMoved) {
            if (onTileClick?.(e, n.item, e.currentTarget)) return;
            onInspect?.(captureInspectPayload(e.currentTarget, n.item, items));
          }
        }}
      >
        <TileInner
          item={n.item}
          hoverFX={hoverFX}
          showMetadata={showMetadata}
          cornerRadius={cornerRadius}
          uncropHover={uncropHover}
          slotW={n.w}
          slotH={n.h}
          compactThumb={laneSize < 235}
          isSelected={Boolean(selectedKeys?.has(itemKey(n.item)))}
          isPurgatoryView={isPurgatoryView}
        />
      </div>
    );
  };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (holdDragRef.current) {
        holdDragRef.current = null;
        setDragRing(null);
      }
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      simRef.current.vel += delta * 2.2;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={hostRef}
      className={`cb-stage ${edgeFade ? "edge-fade" : ""} ${axis}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const sim = simRef.current;
        sim.dragging = true;
        sim.dragMoved = false;
        sim.dragStartMain = axis === "horizontal" ? e.clientX : e.clientY;
        sim.dragStartScroll = sim.scroll;
      }}
      onPointerMove={(e) => {
        const el = hostRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const sim = simRef.current;
        sim.pointerInside = true;
        const norm =
          axis === "horizontal"
            ? ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
            : ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
        sim.pointerNorm = clamp(norm, -1, 1);

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

        if (cursorSteer && !hasSelection && !isDraggingFiles && !sim.dragging && !holdDragRef.current && Math.abs(norm) > 0.42) {
          setSteerPct(Math.sign(norm) * ((Math.abs(norm) - 0.42) / 0.58));
        } else {
          setSteerPct(0);
        }

        if (sim.dragging && !holdDragRef.current) {
          const curMain = axis === "horizontal" ? e.clientX : e.clientY;
          const diff = curMain - sim.dragStartMain;
          if (Math.abs(diff) > 5) sim.dragMoved = true;
          const prev = sim.scroll;
          sim.scroll = sim.dragStartScroll + diff;
          sim.vel = (sim.scroll - prev) * 18;
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
      {showGuideWire && guideSvgPath && (
        <svg className="cb-guide-svg" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          <path d={guideSvgPath} className="cb-guide-path" />
        </svg>
      )}

      {cursorSteer && !hasSelection && !isDraggingFiles && steerPct < -0.04 && (
        <div
          className={`cb-steer-glow ${axis === "horizontal" ? "left" : "top"}`}
          style={{ opacity: Math.min(0.85, Math.abs(steerPct)) }}
        />
      )}
      {cursorSteer && !hasSelection && !isDraggingFiles && steerPct > 0.04 && (
        <div
          className={`cb-steer-glow ${axis === "horizontal" ? "right" : "bottom"}`}
          style={{ opacity: Math.min(0.85, Math.abs(steerPct)) }}
        />
      )}

      <div
        className="cb-belt-clip"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 5,
          pointerEvents: "none",
          clipPath:
            turnStyle === "split" || turnStyle === "arc"
              ? axis === "horizontal"
                ? `inset(0px ${padX}px)`
                : `inset(${padY}px 0px)`
              : "none",
        }}
      >
        {visibleBeltNodes.map((n) => (
          <React.Fragment key={n.uid}>
            {renderTile(n, "a")}
            {renderTile(n, "b")}
          </React.Fragment>
        ))}
      </div>

      {!items.length && (
        <div className="cb-empty">No matching renders for this search / folder filter.</div>
      )}

      <HoldDragRing ring={dragRing} />
    </div>
  );
}

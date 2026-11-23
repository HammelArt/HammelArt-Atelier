import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { HAMMELART_CREST_PATH } from "../theme";

const RING_RADIUS = 108;
const SUB_RADIUS = 174;
const ARC_RADIUS = 182;
const ARC_SPAN = Math.PI * 0.56;

function polarPoint(cx, cy, r, angle) {
  return {
    x: cx + Math.cos(angle) * r,
    y: cy + Math.sin(angle) * r,
  };
}

function describeArcPath(cx, cy, r, startAngle, endAngle) {
  const delta = endAngle - startAngle;
  if (Math.abs(delta) < 1e-4) return "";
  const p0 = polarPoint(cx, cy, r, startAngle);
  const p1 = polarPoint(cx, cy, r, endAngle);
  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta >= 0 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

function clampArcValue(val, spec) {
  const min = Number(spec?.min ?? 0);
  const max = Number(spec?.max ?? 1);
  const step = Number(spec?.step ?? 0.01);
  const clamped = Math.max(min, Math.min(max, val));
  if (step > 0) {
    const snapped = Math.round((clamped - min) / step) * step + min;
    return Number(Math.max(min, Math.min(max, snapped)).toFixed(4));
  }
  return clamped;
}

function projectArcValue(clientX, clientY, cx, cy, parentAngle, flipBottom, spec) {
  let diff = Math.atan2(clientY - cy, clientX - cx) - parentAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  const halfSpan = ARC_SPAN / 2;
  const clampedDiff = Math.max(-halfSpan, Math.min(halfSpan, diff));
  const t = flipBottom
    ? (halfSpan - clampedDiff) / ARC_SPAN
    : (clampedDiff + halfSpan) / ARC_SPAN;
  const min = Number(spec?.min ?? 0);
  const max = Number(spec?.max ?? 1);
  return clampArcValue(min + (max - min) * t, spec);
}
const BUBBLE_SPRING = {
  type: "spring",
  stiffness: 560,
  damping: 24,
  mass: 0.7,
};
const BUBBLE_EXIT_TRANSITION = {
  duration: 0.11,
  ease: [0.4, 0, 1, 1],
};

function clampCenter(x, y, hasSubmenus) {
  if (typeof window === "undefined") return { cx: x, cy: y };
  const margin = hasSubmenus ? 228 : 154;
  const maxX = Math.max(margin, window.innerWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - margin);
  return {
    cx: Math.max(margin, Math.min(maxX, x)),
    cy: Math.max(margin, Math.min(maxY, y)),
  };
}

function resolveBubbleView(bubble, shiftHeld) {
  if (!bubble) return null;
  const shifted = Boolean(shiftHeld);
  return {
    label: (shifted && bubble.shiftLabel) || bubble.label,
    hint: (shifted && bubble.shiftHint) || bubble.hint,
    icon: (shifted && bubble.shiftIcon) || bubble.icon,
    danger:
      shifted && typeof bubble.shiftDanger === "boolean"
        ? bubble.shiftDanger
        : Boolean(bubble.danger),
    active:
      shifted && typeof bubble.shiftActive === "boolean"
        ? bubble.shiftActive
        : Boolean(bubble.active),
  };
}

/**
 * Shared Elastic Floating Bubble Radial Menu supporting:
 * - Quick Right-Click -> stays open until item picked or dismissed
 * - Hold Right-Mouse -> Drag -> Release -> triggers hovered bubble cleanly or pops back
 * - Hovering `children` bubbles expands a crisp outer arc of sub-bubbles
 * - Two-stage confirmation on destructive actions (`requiresConfirm`), bypassed when Shift is held
 */
export default function RadialMenu({ menuState, onClose, onRightClickSwitch }) {
  const [hoveredId, setHoveredId] = useState(null);
  const [hoverArmed, setHoverArmed] = useState(false);
  const [openSubParentId, setOpenSubParentId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [arcDraftVal, setArcDraftVal] = useState(null);
  const [arcDragging, setArcDragging] = useState(false);
  const [arcHovered, setArcHovered] = useState(false);
  const [portalTarget, setPortalTarget] = useState(() =>
    typeof document !== "undefined" ? document.fullscreenElement || document.body : null
  );
  const subCloseTimerRef = useRef(null);
  const holdActiveRef = useRef(false);
  const arcDragRef = useRef(null);
  const justFinishedArcDragRef = useRef(0);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const syncPortal = () => {
      setPortalTarget(document.fullscreenElement || document.body);
    };
    syncPortal();
    document.addEventListener("fullscreenchange", syncPortal);
    return () => document.removeEventListener("fullscreenchange", syncPortal);
  }, []);

  const items = menuState?.items || [];
  const hasSubmenus = items.some(
    (b) => (Array.isArray(b.children) && b.children.length > 0) || Boolean(b.arcSlider)
  );
  const { cx, cy } = useMemo(
    () => clampCenter(menuState?.x ?? 0, menuState?.y ?? 0, hasSubmenus),
    [menuState?.x, menuState?.y, hasSubmenus]
  );

  // Reset arc slider local draft whenever menu reopens or target parent changes
  useEffect(() => {
    setArcDraftVal(null);
    setArcDragging(false);
    setArcHovered(false);
    arcDragRef.current = null;
  }, [menuState, openSubParentId]);

  // Global drag tracking for the curved arc slider
  useEffect(() => {
    if (!arcDragging) return;
    const onMove = (ev) => {
      const ctx = arcDragRef.current;
      if (!ctx) return;
      const nextVal = projectArcValue(
        ev.clientX,
        ev.clientY,
        ctx.cx,
        ctx.cy,
        ctx.parentAngle,
        ctx.flipBottom,
        ctx.spec
      );
      if (nextVal !== ctx.lastVal) {
        ctx.lastVal = nextVal;
        setArcDraftVal(nextVal);
        ctx.spec.onChange?.(nextVal, false);
      }
    };
    const onFinish = () => {
      const ctx = arcDragRef.current;
      arcDragRef.current = null;
      justFinishedArcDragRef.current = performance.now();
      setArcDragging(false);
      if (ctx) {
        ctx.spec.onCommit?.(ctx.lastVal);
        ctx.spec.onChange?.(ctx.lastVal, true);
      }
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onFinish, true);
    window.addEventListener("pointercancel", onFinish, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onFinish, true);
      window.removeEventListener("pointercancel", onFinish, true);
    };
  }, [arcDragging]);

  const menuSessionId = menuState?.openedAt || 0;

  useEffect(() => {
    setHoveredId(null);
    setHoverArmed(false);
    setOpenSubParentId(null);
    setConfirmId(null);
    setShiftHeld(Boolean(menuState?.shiftHeld));
    holdActiveRef.current = Boolean(menuState?.fromPointerDown);

    if (!menuSessionId) return;
    // Lock bubble hover highlights until spring is halfway out unless cursor actively leaves center
    const armTimer = setTimeout(() => setHoverArmed(true), 135);
    const onMoveArm = (e) => {
      if (Math.hypot(e.clientX - cx, e.clientY - cy) >= 48) {
        setHoverArmed(true);
      }
    };
    window.addEventListener("pointermove", onMoveArm, { passive: true });
    return () => {
      clearTimeout(armTimer);
      window.removeEventListener("pointermove", onMoveArm);
      if (subCloseTimerRef.current) clearTimeout(subCloseTimerRef.current);
    };
  }, [menuSessionId]);

  const bubbleMap = useMemo(() => {
    const map = new Map();
    for (const b of items) {
      map.set(b.id, b);
      if (b.children) {
        for (const sub of b.children) {
          map.set(sub.id, sub);
        }
      }
    }
    return map;
  }, [items]);

  const triggerBubble = useCallback(
    (bubble, event) => {
      if (!bubble || bubble.disabled) return;
      const effectiveShift = Boolean(event?.shiftKey || shiftHeld);
      if ((bubble.children && bubble.children.length > 0) || bubble.arcSlider) {
        setOpenSubParentId((prev) => (prev === bubble.id ? null : bubble.id));
        return;
      }
      if (bubble.requiresConfirm && !effectiveShift && confirmId !== bubble.id) {
        setConfirmId(bubble.id);
        return;
      }
      onClose?.();
      bubble.onSelect?.(effectiveShift && !event?.shiftKey ? { ...event, shiftKey: true } : event);
    },
    [confirmId, onClose, shiftHeld]
  );

  // Dismiss on Esc / outside left pointerdown + support Hold-Drag-Release on right mouseup
  useEffect(() => {
    if (!menuState) return;

    const onKey = (e) => {
      if (e.key === "Shift" || e.shiftKey) {
        setShiftHeld(true);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    };

    const onKeyUp = (e) => {
      if (e.key === "Shift" || !e.shiftKey) {
        setShiftHeld(false);
      }
    };

    const onBlur = () => setShiftHeld(false);

    const onDown = (e) => {
      if (arcDragRef.current || performance.now() - justFinishedArcDragRef.current < 160) return;
      if (e.target?.closest?.('[data-radial-root="true"]')) return;
      if (e.button === 2) {
        if (onRightClickSwitch) {
          e.preventDefault();
          e.stopPropagation();
          onRightClickSwitch(e, e.target);
        } else {
          onClose?.();
        }
        return;
      }
      if (typeof window !== "undefined") {
        window.__hmRadialDismissedAt = performance.now();
      }
      onClose?.();
    };

    const onUp = (e) => {
      if (e.button !== 2 || !holdActiveRef.current) return;
      holdActiveRef.current = false;
      const elapsed = performance.now() - (menuState.openedAt || 0);
      const dist = Math.hypot(e.clientX - (menuState.x || 0), e.clientY - (menuState.y || 0));
      // Quick click tap -> keep pinned open for normal click selection
      if (elapsed < 210 && dist <= 16) return;

      // Press-and-hold gesture -> trigger bubble under cursor on release, or pop back if empty
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      const hitEl = stack.find((el) => el?.getAttribute?.("data-radial-id"));
      const hitId = hitEl?.getAttribute?.("data-radial-id");
      const hitBubble = hitId ? bubbleMap.get(hitId) : null;
      const effectiveShift = Boolean(e?.shiftKey || shiftHeld);
      if (hitBubble && !hitBubble.disabled && !hitBubble.children?.length && !hitBubble.arcSlider) {
        if (hitBubble.requiresConfirm && !effectiveShift) {
          // Arm safety confirmation and keep menu open instead of accidentally trashing on drag-release
          setConfirmId(hitBubble.id);
          return;
        }
        onClose?.();
        hitBubble.onSelect?.(effectiveShift && !e?.shiftKey ? { ...e, shiftKey: true } : e);
      } else {
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, [menuState, bubbleMap, onClose]);

  const scheduleCloseSub = () => {
    if (arcDragRef.current) return;
    if (subCloseTimerRef.current) clearTimeout(subCloseTimerRef.current);
    subCloseTimerRef.current = setTimeout(() => {
      if (!arcDragRef.current) {
        setOpenSubParentId(null);
      }
    }, 260);
  };

  const keepSubOpen = (parentId) => {
    if (subCloseTimerRef.current) clearTimeout(subCloseTimerRef.current);
    if (parentId) setOpenSubParentId(parentId);
  };

  // Lock highlight & submenu triggers until ring is halfway open AND cursor is outside center hub
  const shouldAcceptHover = (e) => {
    if (!menuState || !hoverArmed) return false;
    const distFromCenter = Math.hypot((e?.clientX ?? cx) - cx, (e?.clientY ?? cy) - cy);
    return distFromCenter >= 50;
  };

  const activeParentIdx = items.findIndex((b) => b.id === openSubParentId);
  const activeParent = activeParentIdx >= 0 ? items[activeParentIdx] : null;
  const activeParentAngle =
    activeParentIdx >= 0
      ? -Math.PI / 2 + (activeParentIdx * 2 * Math.PI) / Math.max(1, items.length)
      : 0;

  const activeArcVal =
    activeParent?.arcSlider
      ? arcDraftVal !== null
        ? arcDraftVal
        : Number(activeParent.arcSlider.value ?? activeParent.arcSlider.min ?? 1)
      : null;

  const hoveredBubble = hoveredId ? bubbleMap.get(hoveredId) : null;
  const hoveredView = resolveBubbleView(hoveredBubble, shiftHeld);
  const armedBubble = confirmId ? bubbleMap.get(confirmId) : null;
  const centerIsDanger = Boolean(armedBubble || (hoveredView?.danger && shiftHeld));
  const centerCaption = armedBubble
    ? armedBubble.confirmCaption || "Click again to Delete file • Shift = instant"
    : activeParent?.arcSlider && (arcDragging || arcHovered)
    ? activeParent.arcSlider.formatValue
      ? activeParent.arcSlider.formatValue(activeArcVal)
      : `${Math.round(activeArcVal * 100)}%`
    : hoveredBubble
    ? hoveredBubble.disabled
      ? `${hoveredView.label} (Unavailable)`
      : hoveredView.hint || hoveredView.label
    : menuState?.title || "";

  const content = (
    <AnimatePresence>
      {menuState && (
        <motion.div
          key={`${menuState.kind}-${menuState.openedAt}`}
          className="hm-radial-overlay"
          data-radial-root="true"
          style={{ left: cx, top: cy }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.12 }}
          onContextMenu={(e) => e.preventDefault()}
        >
            {/* Ambient Soft Ring Halo */}
            <motion.div
              className="hm-radial-halo"
              initial={{ scale: 0.25, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, transition: BUBBLE_SPRING }}
              exit={{ scale: 0.35, opacity: 0, transition: BUBBLE_EXIT_TRANSITION }}
            />

            {/* Center Pivot & Subtle Hammelart Crest + Live Label Readout */}
            <motion.div
              className={`hm-radial-center ${centerIsDanger ? "is-danger" : ""} ${
                hoveredId ? "has-hover" : ""
              }`}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, transition: BUBBLE_SPRING }}
              exit={{ scale: 0.45, opacity: 0, transition: BUBBLE_EXIT_TRANSITION }}
            >
              <svg
                viewBox="0 0 1024 960"
                className="hm-radial-center-crest"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d={HAMMELART_CREST_PATH} />
              </svg>
              <span className="hm-radial-center-text">{centerCaption}</span>
            </motion.div>

            {/* Primary Bubble Ring */}
            {items.map((bubble, idx) => {
              const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / Math.max(1, items.length);
              const dx = Math.cos(angle) * RING_RADIUS;
              const dy = Math.sin(angle) * RING_RADIUS;
              const isConfirm = confirmId === bubble.id;
              const isSubOpen = openSubParentId === bubble.id;
              const hasChildren = Boolean(bubble.children?.length || bubble.arcSlider);
              const view = resolveBubbleView(bubble, shiftHeld);

              return (
                <motion.button
                  key={bubble.id}
                  type="button"
                  data-radial-id={bubble.id}
                  disabled={bubble.disabled}
                  className={`hm-radial-bubble ${view.active ? "active" : ""} ${
                    view.danger || isConfirm ? "danger" : ""
                  } ${isConfirm ? "is-armed" : ""} ${isSubOpen ? "sub-open" : ""} ${
                    hoveredId === bubble.id ? "is-hovered" : ""
                  } ${bubble.disabled ? "disabled" : ""}`}
                  initial={{ x: 0, y: 0, scale: 0.22, opacity: 0 }}
                  animate={{
                    x: dx,
                    y: dy,
                    scale: 1,
                    opacity: 1,
                    transition: { ...BUBBLE_SPRING, delay: idx * 0.012 },
                  }}
                  exit={{
                    x: 0,
                    y: 0,
                    scale: 0.28,
                    opacity: 0,
                    pointerEvents: "none",
                    transition: BUBBLE_EXIT_TRANSITION,
                  }}
                  onPointerEnter={(e) => {
                    if (!shouldAcceptHover(e)) return;
                    setHoveredId(bubble.id);
                    if (hasChildren) keepSubOpen(bubble.id);
                    else scheduleCloseSub();
                  }}
                  onPointerMove={(e) => {
                    if (hoveredId === bubble.id || !shouldAcceptHover(e)) return;
                    setHoveredId(bubble.id);
                    if (hasChildren) keepSubOpen(bubble.id);
                    else scheduleCloseSub();
                  }}
                  onPointerLeave={() => {
                    setHoveredId((prev) => (prev === bubble.id ? null : prev));
                    if (hasChildren) scheduleCloseSub();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerBubble(bubble, e);
                  }}
                >
                  <span className="hm-radial-bubble-icon">{view.icon}</span>
                  <span className="hm-radial-bubble-lbl">
                    {isConfirm
                      ? "Confirm?"
                      : bubble.id === activeParent?.id && bubble.arcSlider?.bubbleLabel && activeArcVal != null
                      ? bubble.arcSlider.bubbleLabel(activeArcVal)
                      : view.label}
                    {hasChildren && <ChevronRight size={9} style={{ marginLeft: 1, opacity: 0.75 }} />}
                  </span>
                </motion.button>
              );
            })}

            {/* Outer Arc Slider (continuous curved capsule track, e.g. Print Size) */}
            <AnimatePresence>
              {activeParent?.arcSlider &&
                (() => {
                  const spec = activeParent.arcSlider;
                  const min = Number(spec.min ?? 0.32);
                  const max = Number(spec.max ?? 1.56);
                  const step = Number(spec.step ?? 0.01);
                  const flipBottom = Math.sin(activeParentAngle) > 0.25;
                  const aStart = flipBottom
                    ? activeParentAngle + ARC_SPAN / 2
                    : activeParentAngle - ARC_SPAN / 2;
                  const aEnd = flipBottom
                    ? activeParentAngle - ARC_SPAN / 2
                    : activeParentAngle + ARC_SPAN / 2;
                  const val = Math.max(min, Math.min(max, activeArcVal ?? min));
                  const t = max > min ? (val - min) / (max - min) : 0;
                  const valAngle = aStart + (aEnd - aStart) * t;
                  const trackPath = describeArcPath(0, 0, ARC_RADIUS, aStart, aEnd);
                  const fillPath =
                    t > 0.004 ? describeArcPath(0, 0, ARC_RADIUS, aStart, valAngle) : "";
                  const knobPos = polarPoint(0, 0, ARC_RADIUS, valAngle);
                  const endMinPos = polarPoint(0, 0, ARC_RADIUS + 26, aStart);
                  const endMaxPos = polarPoint(0, 0, ARC_RADIUS + 26, aEnd);
                  const ticks = Array.isArray(spec.ticks) ? spec.ticks : [];

                  const handleArcPointerDown = (e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    e.preventDefault();
                    keepSubOpen(activeParent.id);
                    const nextVal = projectArcValue(
                      e.clientX,
                      e.clientY,
                      cx,
                      cy,
                      activeParentAngle,
                      flipBottom,
                      spec
                    );
                    setArcDraftVal(nextVal);
                    setArcDragging(true);
                    arcDragRef.current = {
                      cx,
                      cy,
                      spec,
                      parentAngle: activeParentAngle,
                      flipBottom,
                      lastVal: nextVal,
                    };
                    spec.onChange?.(nextVal, false);
                  };

                  const handleArcWheel = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    keepSubOpen(activeParent.id);
                    const dir = e.deltaY < 0 ? 1 : -1;
                    const nextVal = clampArcValue(val + dir * step * 4, spec);
                    setArcDraftVal(nextVal);
                    spec.onChange?.(nextVal, true);
                    spec.onCommit?.(nextVal);
                  };

                  const handleArcDoubleClick = (e) => {
                    e.stopPropagation();
                    if (spec.defaultValue == null) return;
                    const nextVal = clampArcValue(Number(spec.defaultValue), spec);
                    setArcDraftVal(nextVal);
                    spec.onChange?.(nextVal, true);
                    spec.onCommit?.(nextVal);
                  };

                  return (
                    <motion.svg
                      key={`arc-${activeParent.id}`}
                      className={`hm-radial-arc-svg ${arcDragging ? "is-dragging" : ""}`}
                      viewBox="-240 -240 480 480"
                      initial={{ opacity: 0, scale: 0.88 }}
                      animate={{ opacity: 1, scale: 1, transition: BUBBLE_SPRING }}
                      exit={{ opacity: 0, scale: 0.9, transition: BUBBLE_EXIT_TRANSITION }}
                      onWheel={handleArcWheel}
                    >
                      <g
                        className="hm-radial-arc-hit"
                        onPointerEnter={() => {
                          keepSubOpen(activeParent.id);
                          setArcHovered(true);
                        }}
                        onPointerLeave={() => {
                          setArcHovered(false);
                          if (!arcDragRef.current) scheduleCloseSub();
                        }}
                        onPointerDown={handleArcPointerDown}
                        onDoubleClick={handleArcDoubleClick}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <path d={trackPath} className="hm-radial-arc-shell" />
                        <path d={trackPath} className="hm-radial-arc-bg" />
                        <path d={trackPath} className="hm-radial-arc-groove" />
                        {ticks.map((tv) => {
                          if (tv <= min || tv >= max) return null;
                          const tt = (tv - min) / (max - min);
                          const ta = aStart + (aEnd - aStart) * tt;
                          const isDefault = spec.defaultValue != null && Math.abs(tv - spec.defaultValue) < 0.02;
                          const pIn = polarPoint(0, 0, ARC_RADIUS - (isDefault ? 9 : 6), ta);
                          const pOut = polarPoint(0, 0, ARC_RADIUS + (isDefault ? 9 : 6), ta);
                          return (
                            <line
                              key={tv}
                              x1={pIn.x}
                              y1={pIn.y}
                              x2={pOut.x}
                              y2={pOut.y}
                              className={`hm-radial-arc-tick ${isDefault ? "is-default" : ""}`}
                            />
                          );
                        })}
                        {fillPath && <path d={fillPath} className="hm-radial-arc-fill" />}
                        <g
                          className="hm-radial-arc-knob-group"
                          transform={`translate(${knobPos.x.toFixed(2)}, ${knobPos.y.toFixed(2)})`}
                        >
                          <circle r={12} className="hm-radial-arc-knob-halo" />
                          <circle r={7.5} className="hm-radial-arc-knob" />
                          <circle r={2.6} className="hm-radial-arc-knob-core" />
                        </g>
                        <text
                          x={endMinPos.x}
                          y={endMinPos.y}
                          className="hm-radial-arc-end-lbl"
                          textAnchor="middle"
                          dominantBaseline="central"
                        >
                          {spec.minLabel || `${Math.round(min * 100)}%`}
                        </text>
                        <text
                          x={endMaxPos.x}
                          y={endMaxPos.y}
                          className="hm-radial-arc-end-lbl"
                          textAnchor="middle"
                          dominantBaseline="central"
                        >
                          {spec.maxLabel || `${Math.round(max * 100)}%`}
                        </text>
                      </g>
                    </motion.svg>
                  );
                })()}
            </AnimatePresence>

            {/* Outer Arc Sub-Bubbles (e.g. Open ▸, Mode ▸, Sort ▸, Copy ▸) */}
            <AnimatePresence>
              {activeParent &&
                activeParent.children?.map((sub, sIdx) => {
                  const count = activeParent.children.length;
                  const spread = Math.min(0.42, 1.55 / Math.max(1, count));
                  const offsetIdx = sIdx - (count - 1) / 2;
                  const sAngle = activeParentAngle + offsetIdx * spread;
                  const sx = Math.cos(sAngle) * SUB_RADIUS;
                  const sy = Math.sin(sAngle) * SUB_RADIUS;
                  const subView = resolveBubbleView(sub, shiftHeld);

                  return (
                    <motion.button
                      key={sub.id}
                      type="button"
                      data-radial-id={sub.id}
                      disabled={sub.disabled}
                      className={`hm-radial-bubble is-sub ${subView.active ? "active" : ""} ${
                        subView.danger ? "danger" : ""
                      } ${hoveredId === sub.id ? "is-hovered" : ""} ${sub.disabled ? "disabled" : ""}`}
                      initial={{
                        x: Math.cos(activeParentAngle) * RING_RADIUS,
                        y: Math.sin(activeParentAngle) * RING_RADIUS,
                        scale: 0.25,
                        opacity: 0,
                      }}
                      animate={{
                        x: sx,
                        y: sy,
                        scale: 1,
                        opacity: 1,
                        transition: { ...BUBBLE_SPRING, delay: sIdx * 0.015 },
                      }}
                      exit={{
                        x: Math.cos(activeParentAngle) * RING_RADIUS,
                        y: Math.sin(activeParentAngle) * RING_RADIUS,
                        scale: 0.3,
                        opacity: 0,
                        pointerEvents: "none",
                        transition: BUBBLE_EXIT_TRANSITION,
                      }}
                      onPointerEnter={() => {
                        keepSubOpen(activeParent.id);
                        setHoveredId(sub.id);
                      }}
                      onPointerLeave={() => {
                        setHoveredId((prev) => (prev === sub.id ? null : prev));
                        scheduleCloseSub();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerBubble(sub, e);
                      }}
                    >
                      <span className="hm-radial-bubble-icon">{subView.icon}</span>
                      <span className="hm-radial-bubble-lbl">{subView.label}</span>
                    </motion.button>
                  );
                })}
            </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return portalTarget ? createPortal(content, portalTarget) : content;
}

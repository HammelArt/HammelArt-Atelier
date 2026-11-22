import React, { useCallback, useEffect, useState } from "react";

const TOUR_STOPS = [
  {
    id: "modes",
    selectors: [".hm-mode-nav"],
    title: "Switch Gallery Modes",
    badge: "Step 1 of 5",
    body: "Jump seamlessly between Classic Grid, Conveyor streams, Slideshow / Table Pile, and full-screen Wall Mode. Every mode keeps its own tailored feel.",
    placement: "bottom",
  },
  {
    id: "folders",
    selectors: [".hm-folder-sidebar", ".hm-folder-source-bar"],
    title: "Folder Tree & Drag-to-Sort",
    badge: "Step 2 of 5",
    body: "Filter by subfolder, build new directories, or hold-and-drag any card straight onto a folder here to organize your output cleanly.",
    placement: "right",
  },
  {
    id: "purgatory",
    selectors: [".hm-purgatory-pill"],
    title: "Safe Purgatory Tray",
    badge: "Step 3 of 5",
    body: "Deletion starts safely here. Stage rejects in Purgatory while browsing, then review everything together to either restore or permanently purge.",
    placement: "bottom-end",
  },
  {
    id: "search",
    selectors: [".hm-search-box"],
    title: "Prompt, Model & Fav Search",
    badge: "Step 4 of 5",
    body: "Search embedded prompts, models, seeds, or notes. Toggle the Favorites heart or hit 'All' to expand search across every folder.",
    placement: "bottom",
  },
  {
    id: "customize",
    selectors: [".hm-customize-btn"],
    title: "Customize & Options Drawer",
    badge: "Step 5 of 5",
    body: "Your creative cockpit: tweak layouts, conveyor FX, button themes, and visual polish live while previewing the stage — and soon add extra root folders right here too.",
    placement: "bottom-end",
  },
];

function findVisibleRect(selectors) {
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) {
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      }
    }
  }
  return null;
}

export default function SpotlightTour({ isOpen, onClose, onReopenWelcome }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  }));

  const currentStop = TOUR_STOPS[stepIdx] || TOUR_STOPS[0];

  const measure = useCallback(() => {
    if (!isOpen) return;
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    const stop = TOUR_STOPS[stepIdx] || TOUR_STOPS[0];
    setTargetRect(findVisibleRect(stop.selectors));
  }, [isOpen, stepIdx]);

  useEffect(() => {
    if (isOpen) {
      setStepIdx(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    measure();
    const t = setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [isOpen, stepIdx, measure]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setStepIdx((i) => (i < TOUR_STOPS.length - 1 ? i + 1 : i));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStepIdx((i) => (i > 0 ? i - 1 : i));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const vw = viewport.w;
  const vh = viewport.h;
  const pad = 8;

  const cut = targetRect
    ? {
        left: Math.max(0, targetRect.left - pad),
        top: Math.max(0, targetRect.top - pad),
        right: Math.min(vw, targetRect.right + pad),
        bottom: Math.min(vh, targetRect.bottom + pad),
      }
    : {
        left: Math.round(vw / 2 - 120),
        top: Math.round(vh / 2 - 40),
        right: Math.round(vw / 2 + 120),
        bottom: Math.round(vh / 2 + 40),
      };

  const cutW = Math.max(0, cut.right - cut.left);
  const cutH = Math.max(0, cut.bottom - cut.top);

  const cardW = Math.min(360, vw - 32);
  const cardH = 215;

  let cardLeft = vw / 2 - cardW / 2;
  let cardTop = vh / 2 - cardH / 2;
  let arrowStart = { x: vw / 2, y: vh / 2 };
  let arrowEnd = { x: cut.left + cutW / 2, y: cut.top + cutH / 2 };

  if (targetRect) {
    if (currentStop.placement === "right" && cut.right + cardW + 48 < vw) {
      cardLeft = cut.right + 44;
      cardTop = Math.min(Math.max(88, cut.top + Math.min(180, cutH * 0.25)), vh - cardH - 24);
      arrowStart = { x: cardLeft, y: cardTop + 44 };
      arrowEnd = { x: cut.right + 6, y: Math.min(cut.bottom - 20, Math.max(cut.top + 36, cardTop + 44)) };
    } else if (cut.bottom + cardH + 56 < vh) {
      if (currentStop.placement === "bottom-end") {
        cardLeft = Math.min(Math.max(16, cut.right - cardW), vw - cardW - 16);
      } else {
        cardLeft = Math.min(Math.max(16, cut.left + cutW / 2 - cardW / 2), vw - cardW - 16);
      }
      cardTop = cut.bottom + 46;
      arrowEnd = {
        x: Math.min(Math.max(cut.left + 16, cardLeft + cardW * 0.5), cut.right - 16),
        y: cut.bottom + 4,
      };
      arrowStart = {
        x: Math.min(Math.max(cardLeft + 28, arrowEnd.x + (arrowEnd.x > vw * 0.6 ? -24 : 24)), cardLeft + cardW - 28),
        y: cardTop,
      };
    } else {
      cardLeft = Math.min(Math.max(16, cut.left + cutW / 2 - cardW / 2), vw - cardW - 16);
      cardTop = Math.max(16, cut.top - cardH - 46);
      arrowStart = { x: cardLeft + cardW / 2, y: cardTop + cardH };
      arrowEnd = { x: cut.left + cutW / 2, y: cut.top - 4 };
    }
  }

  const midX = (arrowStart.x + arrowEnd.x) / 2;
  const midY = (arrowStart.y + arrowEnd.y) / 2;
  const ctrlOffset = currentStop.placement === "right" ? -18 : 16;
  const pathD = `M ${arrowStart.x} ${arrowStart.y} Q ${midX + ctrlOffset} ${midY - 12} ${arrowEnd.x} ${arrowEnd.y}`;

  const isFirst = stepIdx === 0;
  const isLast = stepIdx === TOUR_STOPS.length - 1;

  return (
    <div className="hm-tour-root" role="dialog" aria-modal="true" aria-label="Interactive UI Spotlight Tour">
      {/* Four blurred backdrop curtains leaving the live targetRect crisp & un-blurred */}
      <div
        className="hm-tour-curtain"
        style={{ left: 0, top: 0, width: vw, height: cut.top }}
        onClick={onClose}
      />
      <div
        className="hm-tour-curtain"
        style={{ left: 0, top: cut.bottom, width: vw, height: Math.max(0, vh - cut.bottom) }}
        onClick={onClose}
      />
      <div
        className="hm-tour-curtain"
        style={{ left: 0, top: cut.top, width: cut.left, height: cutH }}
        onClick={onClose}
      />
      <div
        className="hm-tour-curtain"
        style={{ left: cut.right, top: cut.top, width: Math.max(0, vw - cut.right), height: cutH }}
        onClick={onClose}
      />

      {/* Glowing purple highlight frame around the un-blurred target */}
      {targetRect && (
        <div
          className="hm-tour-ring"
          style={{
            left: cut.left,
            top: cut.top,
            width: cutW,
            height: cutH,
          }}
        />
      )}

      {/* Curved pointer arrow from tooltip to live element */}
      {targetRect && (
        <svg className="hm-tour-arrow-layer" width={vw} height={vh} aria-hidden="true">
          <defs>
            <marker
              id="hm-tour-arrowhead"
              markerWidth="10"
              markerHeight="10"
              refX="7"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 8 3.5, 0 7" fill="#c084fc" />
            </marker>
          </defs>
          <path
            d={pathD}
            fill="none"
            stroke="#c084fc"
            strokeWidth="2.5"
            strokeLinecap="round"
            markerEnd="url(#hm-tour-arrowhead)"
          />
        </svg>
      )}

      <div
        className="hm-tour-card"
        style={{ left: Math.round(cardLeft), top: Math.round(cardTop), width: cardW }}
      >
        <div className="hm-tour-card-top">
          <span className="hm-tour-badge">{currentStop.badge}</span>
          <button
            type="button"
            className="hm-tour-close"
            onClick={onClose}
            aria-label="Exit spotlight tour"
            title="Exit tour (Esc)"
          >
            ✕
          </button>
        </div>

        <h3 className="hm-tour-title">{currentStop.title}</h3>
        <p className="hm-tour-body">{currentStop.body}</p>

        <div className="hm-tour-dots" aria-hidden="true">
          {TOUR_STOPS.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              className={`hm-tour-dot ${idx === stepIdx ? "is-active" : ""}`}
              onClick={() => setStepIdx(idx)}
              title={s.title}
            />
          ))}
        </div>

        <div className="hm-tour-actions">
          {onReopenWelcome && (
            <button
              type="button"
              className="hm-tour-btn-link"
              onClick={() => {
                onClose();
                onReopenWelcome();
              }}
            >
              Welcome Guide
            </button>
          )}
          <div className="hm-tour-actions-right">
            {!isFirst && (
              <button type="button" className="hm-tour-btn-ghost" onClick={() => setStepIdx((i) => i - 1)}>
                ← Back
              </button>
            )}
            {!isLast ? (
              <button type="button" className="hm-tour-btn-primary" onClick={() => setStepIdx((i) => i + 1)}>
                Next →
              </button>
            ) : (
              <button type="button" className="hm-tour-btn-primary" onClick={onClose}>
                Finish Tour ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

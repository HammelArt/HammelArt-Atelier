import React from "react";

export const HOLD_DRAG_DELAY_MS = 115;
export const HOLD_DRAG_FILL_MS = 250;
export const HOLD_DRAG_MOVE_PX = 7;
export const HOLD_DRAG_MAX_VEL = 45;

/**
 * Shared SVG cursor hold ring for arming drag-to-move tiles across grids and belts.
 */
export default function HoldDragRing({ ring }) {
  if (!ring) return null;
  const pct = Math.max(0, Math.min(1, ring.progress || 0));
  return (
    <div
      className="hm-hold-drag-ring"
      style={{ left: ring.x, top: ring.y }}
      aria-hidden="true"
    >
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="15" className="hm-hold-ring-track" />
        <circle
          cx="20"
          cy="20"
          r="15"
          className="hm-hold-ring-fill"
          strokeDasharray="94.25"
          strokeDashoffset={(94.25 * (1 - pct)).toFixed(2)}
        />
      </svg>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  FastForward,
  Flame,
  RotateCcw,
  AlertTriangle,
  Trash2,
  Sparkles,
  Zap,
} from "lucide-react";
import ClassicGridEngine from "./ClassicGridEngine";
import { useCuration } from "../utils/curation";
import { DELETE_FX_OPTIONS } from "../utils/deletionFx";

export const DEFAULT_PURGATORY_CFG = {
  layoutStyle: "masonry", // "masonry" | "grid"
  cols: 10,
};

const FX_ICON_MAP = {
  ember: Flame,
  lightning: Zap,
  poof: Sparkles,
  instant: FastForward,
};

export default function PurgatoryView({
  items = [],
  cfg = DEFAULT_PURGATORY_CFG,
  vanishingKeys = null,
  purging = false,
  onExit,
  onRescueAll,
  onPurgeAll,
  onInspect,
}) {
  const curation = useCuration();
  const deleteFx = curation?.deleteFx || "ember";
  const fxIndex = Math.max(
    0,
    DELETE_FX_OPTIONS.findIndex((opt) => opt.id === deleteFx)
  );
  const activeFxOption = DELETE_FX_OPTIONS[fxIndex] || DELETE_FX_OPTIONS[0];
  const nextFxOption = DELETE_FX_OPTIONS[(fxIndex + 1) % DELETE_FX_OPTIONS.length];
  const FxIcon = FX_ICON_MAP[activeFxOption.id] || Sparkles;

  const handleCycleDeleteFx = () => {
    curation?.setDeleteFx?.(nextFxOption.id);
  };

  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (items.length === 0) setConfirmOpen(false);
  }, [items.length]);

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setConfirmOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmOpen]);

  return (
    <div className="hm-purg-view">
      {/* Minimal Purgatory Header Strip (Full Tuning Lives in Customize Drawer!) */}
      <div className="hm-purg-bar">
        <div className="hm-purg-bar-left">
          <button
            type="button"
            className="hm-btn"
            onClick={onExit}
            title="Return to active gallery view"
          >
            <ArrowLeft size={13} />
            <span>Back</span>
          </button>

          <div className="hm-purg-title-group">
            <span className="hm-purg-icon-seal">
              <Flame size={15} />
            </span>
            <div>
              <div className="hm-purg-title">Purgatory Mode</div>
              <div className="hm-purg-sub">
                {items.length} {items.length === 1 ? "render" : "renders"} staged for permanent drive erase
              </div>
            </div>
          </div>
        </div>

        <div className="hm-purg-bar-controls">
          <button
            type="button"
            className="hm-btn hm-purg-fx-btn"
            data-fx={activeFxOption.id}
            onClick={handleCycleDeleteFx}
            title={`Burn FX: ${activeFxOption.label} — ${activeFxOption.hint}. Click to switch to ${nextFxOption.label}.`}
          >
            <span className="hm-purg-fx-icon" aria-hidden="true">
              <FxIcon size={12} />
            </span>
            <span className="hm-purg-fx-kicker">Burn FX</span>
            <span className="hm-purg-fx-val">{activeFxOption.label}</span>
          </button>

          <button
            type="button"
            className="hm-btn"
            disabled={items.length === 0 || purging}
            onClick={onRescueAll}
            title="Restore all staged images back to the gallery"
          >
            <RotateCcw size={13} />
            <span>Rescue All</span>
          </button>
        </div>
      </div>

      {/* Main Stage Grid */}
      <div className="hm-purg-stage">
        {items.length === 0 ? (
          <div className="hm-purg-empty">
            <div className="hm-purg-empty-orb">
              <Flame size={28} />
            </div>
            <h3>Purgatory is Clear</h3>
            <p>
              Press <kbd>Delete</kbd> or <kbd>X</kbd> while hovering any render (or right-click &rarr;{" "}
              <strong>Purgatory</strong>) to beam it here for review without touching your drive.
            </p>
            <button type="button" className="hm-btn hm-customize-btn" onClick={onExit}>
              <ArrowLeft size={13} /> Return to Gallery
            </button>
          </div>
        ) : (
          <ClassicGridEngine
            items={items}
            layoutStyle={cfg.layoutStyle || "masonry"}
            cols={cfg.cols || 10}
            sizeFill={98}
            gap={14}
            cornerRadius={12}
            autoSpeed={0}
            cursorSteer={false}
            hoverBrake={false}
            loopWrap={false}
            edgeFade={true}
            hoverFX="pop_tilt"
            showMetadata={true}
            isActiveZone={true}
            isPurgatoryView={true}
            vanishingKeys={vanishingKeys}
            onInspect={onInspect}
            resetKey="purgatory"
          />
        )}
      </div>

      {/* Prominent Bottom PURGE CTA */}
      <div className="hm-purg-dock">
        <button
          type="button"
          className="hm-purg-btn"
          disabled={items.length === 0 || purging}
          onClick={() => setConfirmOpen(true)}
        >
          <Flame size={17} />
          <span>{purging ? "BURNING..." : `PURGE (${items.length})`}</span>
        </button>
      </div>

      {/* Final Irreversible Drive-Delete Confirmation Modal */}
      {confirmOpen && (
        <div
          className="hm-purg-confirm-backdrop"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="hm-purg-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="purg-confirm-title"
          >
            <div className="hm-purg-confirm-icon">
              <AlertTriangle size={24} />
            </div>
            <h3 id="purg-confirm-title">Permanent Drive Deletion</h3>
            <p>
              All <strong>{items.length}</strong>{" "}
              {items.length === 1 ? "image" : "images"} in Purgatory will be{" "}
              <strong>permanently deleted on your drive</strong> (bypassing the Windows Recycle
              Bin). This cannot be undone — are you really sure?
            </p>
            <div className="hm-purg-confirm-actions">
              <button
                type="button"
                className="hm-btn"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hm-btn hm-purg-confirm-fire"
                onClick={() => {
                  setConfirmOpen(false);
                  onPurgeAll?.(items);
                }}
              >
                <Trash2 size={14} />
                <span>Yes, Burn Forever ({items.length})</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Pin, StickyNote, Check, X, Folder, Flame, Play } from "lucide-react";
import { getThumbnailUrl, itemKey } from "../utils/lightboxFlight";
import { DEFAULT_CARD_LABELS, FavMark, useCuration } from "../utils/curation";

function getFolderBadgeName(subfolder) {
  if (!subfolder || subfolder === "(Root)") return "Root";
  const clean = String(subfolder).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean) return "Root";
  const parts = clean.split("/").filter(Boolean);
  return parts[parts.length - 1] || "Root";
}

/**
 * Shared inner card visual layer handling the 5 Lego Hover FX cleanly
 * on a nested GPU layer so outer conveyor / grid transforms never collide.
 * Also supports `uncropHover`: unfolds cropped tiles to full natural aspect ratio
 * on hover while preserving the exact parent hitbox (`slotW × slotH`).
 */
export default function TileInner({
  item,
  hoverFX = "pop_tilt",
  showMetadata = true,
  cornerRadius = 12,
  uncropHover = false,
  slotW = 0,
  slotH = 0,
  compactThumb = false,
  isSelected = false,
  isPurgatoryView = false,
}) {
  const fxRef = useRef(null);
  const [slotHovered, setSlotHovered] = useState(false);
  const curation = useCuration();
  const myKey = itemKey(item);
  const isFav = curation?.isFavorited?.(item) || false;
  const isPin = curation?.isPinned?.(item) || false;
  const isPurg = isPurgatoryView || curation?.isInPurgatory?.(item) || false;
  const noteText = curation?.getNote?.(item) || "";
  const hasNote = Boolean(noteText);
  const favIcon = curation?.favIcon || "star";
  const labelCfg = curation?.cardLabels || DEFAULT_CARD_LABELS;
  const isRadialLocked = Boolean(curation?.radialLockedKey && curation.radialLockedKey === myKey);
  const lockedRef = useRef(false);
  lockedRef.current = isRadialLocked;

  const dpr =
    typeof window !== "undefined" ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1;
  const neededPx = Math.max(slotW || 0, slotH || 0) * dpr;
  const thumbEdge =
    neededPx > 0
      ? neededPx <= 350
        ? 360
        : neededPx <= 660
        ? 640
        : 960
      : compactThumb
      ? 360
      : 640;
  const thumbUrl = getThumbnailUrl(item, { maxEdge: thumbEdge });

  const wantsTilt = hoverFX === "tilt" || hoverFX === "pop_tilt";

  const handleMouseMove = (e) => {
    const el = fxRef.current;
    if (!el || !wantsTilt) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
    const ny = (e.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
    const rx = (-ny * 13).toFixed(2);
    const ry = (nx * 13).toFixed(2);
    const lift = hoverFX === "pop_tilt" ? 1.07 : 1.015;
    el.style.transform = `perspective(720px) scale(${lift}) rotateX(${rx}deg) rotateY(${ry}deg)`;
    el.style.setProperty("--mx", `${((nx + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${((ny + 0.5) * 100).toFixed(1)}%`);
  };

  const handleMouseLeave = () => {
    setSlotHovered(false);
    if (!lockedRef.current && fxRef.current) {
      fxRef.current.style.transform = "";
    }
  };

  // De-animate cleanly like a cursor-leave once radial lock releases (unless pointer is hovering)
  useEffect(() => {
    if (!isRadialLocked && !slotHovered && fxRef.current) {
      fxRef.current.style.transform = "";
    }
  }, [isRadialLocked, slotHovered]);

  // Compute unfolded dimensions centered inside the fixed slot hitbox
  let fxStyle = { borderRadius: cornerRadius };
  let isUnfolded = false;

  if (uncropHover && (slotHovered || isRadialLocked) && slotW > 12 && slotH > 12) {
    const natAsp =
      item.aspect_ratio > 0
        ? item.aspect_ratio
        : item.width && item.height
        ? item.width / item.height
        : slotW / slotH;
    const slotAsp = slotW / slotH;
    const mismatch = Math.max(natAsp / slotAsp, slotAsp / natAsp);

    if (mismatch > 1.05) {
      let targetW = slotW;
      let targetH = slotH;
      if (natAsp < slotAsp) {
        // Tall portrait inside wider frame -> keep full width, expand height
        targetH = Math.min(slotH * 2.35, slotW / Math.max(0.28, natAsp));
      } else {
        // Wide landscape inside narrower frame -> keep full height, expand width
        targetW = Math.min(slotW * 2.35, slotH * Math.min(3.2, natAsp));
      }
      isUnfolded = true;
      fxStyle = {
        borderRadius: cornerRadius,
        position: "absolute",
        left: "50%",
        top: "50%",
        width: `${Math.round(targetW)}px`,
        height: `${Math.round(targetH)}px`,
        marginLeft: `${-Math.round(targetW / 2)}px`,
        marginTop: `${-Math.round(targetH / 2)}px`,
      };
    } else {
      fxStyle = {
        borderRadius: cornerRadius,
        position: "absolute",
        left: "50%",
        top: "50%",
        width: `${Math.round(slotW)}px`,
        height: `${Math.round(slotH)}px`,
        marginLeft: `${-Math.round(slotW / 2)}px`,
        marginTop: `${-Math.round(slotH / 2)}px`,
      };
    }
  } else if (uncropHover && slotW > 12 && slotH > 12) {
    // Keep same positioning properties at rest so width/height/margin animate smoothly
    fxStyle = {
      borderRadius: cornerRadius,
      position: "absolute",
      left: "50%",
      top: "50%",
      width: `${Math.round(slotW)}px`,
      height: `${Math.round(slotH)}px`,
      marginLeft: `${-Math.round(slotW / 2)}px`,
      marginTop: `${-Math.round(slotH / 2)}px`,
    };
  }

  return (
    <div
      className="cb-tile-slot-wrap"
      onMouseEnter={() => setSlotHovered(true)}
      onMouseMove={wantsTilt ? handleMouseMove : undefined}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={fxRef}
        className={`cb-tile-fx hover-${hoverFX} ${isUnfolded ? "is-unfolded" : ""} ${
          isRadialLocked ? "is-radial-locked" : ""
        } ${isSelected ? "is-selected" : ""}`}
        data-lb-key={myKey}
        style={fxStyle}
      >
        <img src={thumbUrl} alt={item.filename} loading="eager" decoding="async" draggable={false} />
        <div className="cb-tile-sheen" />
        {isRadialLocked && <div className="cb-radial-lock-wash" />}
        {isSelected && (
          <span className="cb-select-check" title="Selected">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
        {(isPurg || isFav || isPin || hasNote) && (
          <div className="cb-curation-seals">
            {isPurg && (
              <span className="cb-curation-seal is-purgatory" title="Marked for Purgatory">
                <Flame size={11} />
              </span>
            )}
            {hasNote && (
              <span className="cb-curation-seal is-note" title="Has personal note">
                <StickyNote size={10} />
              </span>
            )}
            {isPin && (
              <span className="cb-curation-seal is-pin" title="Pinned to top">
                <Pin size={10} />
              </span>
            )}
            {isFav && (
              <span className="cb-curation-seal is-fav" title="Favorited">
                <FavMark favIcon={favIcon} filled size={11} />
              </span>
            )}
          </div>
        )}
        {showMetadata &&
          (() => {
            const alwaysSet = new Set(labelCfg.always || []);
            const hoverTopSet = new Set(labelCfg.hoverTop || []);
            const hoverBotList = labelCfg.hoverBottom || [];

            const folderName = getFolderBadgeName(item.subfolder);
            const showFolderAlways = alwaysSet.has("folder");
            const showWfAlways = alwaysSet.has("wf");
            const showFolderHover = hoverTopSet.has("folder") && !showFolderAlways;
            const showWfHover = hoverTopSet.has("wf") && !showWfAlways;

            const showResAlways = alwaysSet.has("resolution");
            const showFileAlways = alwaysSet.has("filename");
            const hasAlwaysBottom = showResAlways || showFileAlways;
            const hasAlwaysTop = showFolderAlways || showWfAlways;

            const sizeText =
              item.media_type === "video" && item.duration_sec
                ? `${item.duration_sec}s${item.file_size_mb ? ` • ${item.file_size_mb} MB` : ""}`
                : item.file_size_mb
                ? `${item.file_size_mb} MB`
                : "";

            const renderBottomField = (fieldKey, keyPrefix) => {
              if (fieldKey === "filename") {
                return (
                  <div key={`${keyPrefix}-fn`} className="cb-tile-name">
                    {item.filename}
                  </div>
                );
              }
              if (fieldKey === "resolution" && item.resolution) {
                return (
                  <div key={`${keyPrefix}-res`} className="cb-tile-sub">
                    {item.resolution}
                  </div>
                );
              }
              if (fieldKey === "note" && noteText) {
                return (
                  <div key={`${keyPrefix}-note`} className="cb-tile-note-peek">
                    <StickyNote size={10} />
                    <span>{noteText}</span>
                  </div>
                );
              }
              if (fieldKey === "model" && (item.model_short || item.model)) {
                return (
                  <div key={`${keyPrefix}-mod`} className="cb-tile-sub">
                    {item.model_short || item.model}
                  </div>
                );
              }
              if (fieldKey === "prompt" && item.raw_prompt) {
                return (
                  <div key={`${keyPrefix}-prm`} className="cb-tile-prompt-peek">
                    {item.raw_prompt}
                  </div>
                );
              }
              if (fieldKey === "size" && sizeText) {
                return (
                  <div key={`${keyPrefix}-sz`} className="cb-tile-sub">
                    {sizeText}
                  </div>
                );
              }
              return null;
            };

            const hoverOnlyBottom = hoverBotList.filter(
              (k) => !((k === "resolution" && showResAlways) || (k === "filename" && showFileAlways))
            );

            return (
              <>
                {(hasAlwaysTop || hasAlwaysBottom) && (
                  <div className="cb-tile-always-layer">
                    <div className="cb-tile-tl">
                      {showFolderAlways && (
                        <span className="cb-tile-badge" title={`Folder: ${item.subfolder || "Root"}`}>
                          <Folder size={9} />
                          <span>{folderName}</span>
                        </span>
                      )}
                      {showWfAlways && (
                        <span
                          className={`cb-tile-wf ${item.has_workflow ? "is-yes" : "is-no"}`}
                          title={
                            item.has_workflow
                              ? "Embedded workflow ready"
                              : "No embedded workflow"
                          }
                        >
                          <span>WF</span>
                          {item.has_workflow ? <Check size={9} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}
                        </span>
                      )}
                    </div>
                    {hasAlwaysBottom && (
                      <div className="cb-tile-always-bottom">
                        {showFileAlways && renderBottomField("filename", "al")}
                        {showResAlways && renderBottomField("resolution", "al")}
                      </div>
                    )}
                  </div>
                )}

                {(showFolderHover || showWfHover || hoverOnlyBottom.length > 0) && (
                  <div className="cb-tile-overlay">
                    <div className="cb-tile-tl">
                      {showFolderHover && (
                        <span className="cb-tile-badge" title={`Folder: ${item.subfolder || "Root"}`}>
                          <Folder size={9} />
                          <span>{folderName}</span>
                        </span>
                      )}
                      {showWfHover && (
                        <span
                          className={`cb-tile-wf ${item.has_workflow ? "is-yes" : "is-no"}`}
                          title={
                            item.has_workflow
                              ? "Embedded workflow ready"
                              : "No embedded workflow"
                          }
                        >
                          <span>WF</span>
                          {item.has_workflow ? <Check size={9} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}
                        </span>
                      )}
                    </div>
                    {hoverOnlyBottom.length > 0 && (
                      <div className="cb-tile-meta">
                        {hoverOnlyBottom.map((k) => renderBottomField(k, "hv"))}
                      </div>
                    )}
                  </div>
                )}

                {item.media_type === "video" && (curation?.videoBadgeMode || "always") !== "off" && (
                  <span
                    className={`cb-tile-video-pill ${
                      (curation?.videoBadgeMode || "always") === "hover" ? "is-hover-only" : ""
                    }`}
                    title={item.duration_sec ? `Video · ${item.duration_sec}s` : "Video"}
                  >
                    <Play size={10} fill="currentColor" strokeWidth={2} />
                  </span>
                )}
              </>
            );
          })()}
      </div>
    </div>
  );
}

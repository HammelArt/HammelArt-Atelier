import React, { useState } from "react";
import {
  X,
  Copy,
  Check,
  Download,
  Cpu,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Info,
  Wand2,
  Pin,
  StickyNote,
} from "lucide-react";
import { FavMark, useCuration } from "../utils/curation";
import ThemedSelect from "./ThemedSelect";
import {
  DEFAULT_LIGHTBOX_CFG,
  getStyleParams,
  getExitStyleParams,
} from "../utils/lightboxFlight";

const INSPECTOR_FIELD_DEFS = [
  { key: "resolution", label: "Resolution" },
  { key: "fileSize", label: "File Size" },
  { key: "model", label: "Model" },
  { key: "seed", label: "Seed" },
  { key: "sampler", label: "Sampler" },
  { key: "scheduler", label: "Scheduler" },
  { key: "steps", label: "Steps" },
  { key: "cfg", label: "CFG Scale" },
  { key: "guidance", label: "Guidance" },
  { key: "denoise", label: "Denoise" },
  { key: "shift", label: "Shift" },
  { key: "vae", label: "VAE" },
  { key: "clip", label: "CLIP" },
  { key: "loras", label: "LoRAs" },
  { key: "negativePrompt", label: "Neg Prompt" },
];

function assetFilename(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s || s === "Unknown" || s === "—") return "";
  return s.replace(/\\/g, "/").split("/").pop() || s;
}

function copyTextWithFlash(text, setCopied) {
  if (text == null || text === "" || text === "Unknown" || text === "—") return;
  navigator.clipboard?.writeText(String(text)).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  });
}

function CopyChip({ text, label = "Copy", compact = false }) {
  const [copied, setCopied] = useState(false);
  if (!text || text === "Unknown" || text === "—") return null;

  const handleCopy = (e) => {
    e.stopPropagation();
    copyTextWithFlash(text, setCopied);
  };

  return (
    <button
      type="button"
      className={`lb-copy-btn ${copied ? "copied" : ""} ${compact ? "compact" : ""}`}
      onClick={handleCopy}
      title={`Copy ${label}`}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {!compact && <span>{copied ? "Copied!" : label}</span>}
    </button>
  );
}

function SpecCard({ label, display, copyValue, title, wide = false }) {
  const [copied, setCopied] = useState(false);
  const canCopy =
    copyValue != null &&
    copyValue !== "" &&
    copyValue !== "Unknown" &&
    copyValue !== "—";

  if (!canCopy) {
    return (
      <div className={`lb-spec-card ${wide ? "wide" : ""}`}>
        <span>{label}</span>
        <strong title={title || undefined}>{display || "—"}</strong>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`lb-spec-card is-clickable ${wide ? "wide" : ""} ${copied ? "is-copied" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        copyTextWithFlash(copyValue, setCopied);
      }}
      title={title || `Click to copy: ${copyValue}`}
    >
      <div className="lb-spec-top">
        <span>{label}</span>
        <span className="lb-spec-copy-icon">
          {copied ? (
            <>
              <Check size={10} /> Copied
            </>
          ) : (
            <Copy size={10} />
          )}
        </span>
      </div>
      <strong>{display}</strong>
    </button>
  );
}

function AssetPillChip({ display, copyValue, weightText = null, title }) {
  const [copied, setCopied] = useState(false);
  if (!display || display === "Unknown") return null;
  const textToCopy = copyValue || display;

  return (
    <button
      type="button"
      className={`lb-asset-pill ${copied ? "is-copied" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        copyTextWithFlash(textToCopy, setCopied);
      }}
      title={title || `Click to copy: ${textToCopy}`}
    >
      <span className="lb-asset-pill-name">{display}</span>
      {weightText != null && <span className="lb-asset-pill-weight">{weightText}</span>}
      {copied && <Check size={11} />}
    </button>
  );
}

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      className={`hm-drawer-toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <div className="hm-drawer-label-wrap">
        <span className="hm-drawer-label">{label}</span>
        {hint && <span className="hm-drawer-hint">{hint}</span>}
      </div>
      <span className={`hm-switch ${checked ? "on" : ""}`}>
        <span className="hm-switch-knob" />
      </span>
    </button>
  );
}

export default function LightboxInspector({
  item,
  sourceLabel,
  cfg,
  onPatchCfg,
  onSearchTag,
  onCloseDrawer,
}) {
  const [tab, setTab] = useState("info"); // "info" | "settings"
  const curation = useCuration();

  if (!item) return null;

  const mp =
    item.width && item.height ? ((item.width * item.height) / 1_000_000).toFixed(2) : null;

  const fieldsCfg = {
    ...DEFAULT_LIGHTBOX_CFG.inspectorFields,
    ...(cfg?.inspectorFields || {}),
  };
  const showField = (key) => fieldsCfg[key] !== false;
  const hasVal = (v) => v != null && v !== "" && v !== "Unknown" && v !== "—";
  const clipList = Array.isArray(item.clips) ? item.clips.filter(hasVal) : [];
  const loraList = Array.isArray(item.loras) ? item.loras.filter((l) => l && hasVal(l.name)) : [];
  const anyTelemetryEnabled =
    showField("resolution") ||
    showField("fileSize") ||
    showField("model") ||
    showField("seed") ||
    showField("sampler") ||
    showField("scheduler") ||
    showField("steps") ||
    showField("cfg") ||
    showField("guidance") ||
    showField("denoise") ||
    showField("shift") ||
    showField("vae") ||
    showField("clip") ||
    showField("loras");

  const handleDownloadWorkflow = () => {
    if (!item.workflow) return;
    try {
      const blob = new Blob([JSON.stringify(item.workflow, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = (item.filename || "workflow").replace(/\.[^.]+$/, "");
      a.download = `${base}_workflow.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <aside
      className="lb-inspector"
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Top Header + Tabs */}
      <div className="lb-insp-head">
        <div className="lb-insp-tabs">
          <button
            type="button"
            className={`lb-insp-tab ${tab === "info" ? "active" : ""}`}
            onClick={() => setTab("info")}
          >
            <Info size={12} /> Info &amp; Prompts
          </button>
          <button
            type="button"
            className={`lb-insp-tab ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <SlidersHorizontal size={12} /> Lightbox FX
          </button>
        </div>

        <button
          type="button"
          className="hm-icon-btn"
          onClick={onCloseDrawer}
          title="Collapse Inspector (I)"
        >
          <X size={14} />
        </button>
      </div>

      <div className="lb-insp-scroll">
        {tab === "info" ? (
          <>
            {/* File Identity */}
            <div className="lb-insp-file">
              <div className="lb-insp-kicker">
                <Sparkles size={11} />
                <span>{item.dialect || "COMFY"}</span>
                <span>•</span>
                <span>{item.subfolder || "Root"}</span>
                {sourceLabel && (
                  <>
                    <span>•</span>
                    <span>{sourceLabel}</span>
                  </>
                )}
              </div>
              <div className="lb-insp-title-row">
                <h3 title={item.filename}>{item.filename}</h3>
                <CopyChip text={item.filename} compact />
              </div>
            </div>

            {curation && (() => {
              const isFav = curation.isFavorited(item);
              const isPin = curation.isPinned(item);
              const noteText = curation.getNote(item);
              return (
                <div className="lb-curation-card">
                  <div className="lb-curation-actions">
                    <button
                      type="button"
                      className={`lb-cur-btn ${isFav ? "active" : ""}`}
                      onClick={() => curation.toggleFavorite(item)}
                      title="Toggle Favorite (F)"
                    >
                      <FavMark favIcon={curation.favIcon} filled={isFav} size={13} />
                      <span>{isFav ? "Favorited" : "Favorite"}</span>
                    </button>
                    <button
                      type="button"
                      className={`lb-cur-btn ${isPin ? "active" : ""}`}
                      onClick={() => curation.togglePin(item)}
                      title="Pin to top of gallery"
                    >
                      <Pin size={12} />
                      <span>{isPin ? "Pinned" : "Pin"}</span>
                    </button>
                    {item.media_type !== "video" && (
                      <button
                        type="button"
                        className="lb-cur-btn"
                        onClick={() => curation.copyCleanImage(item)}
                        title="Copy original resolution PNG without metadata"
                      >
                        <Copy size={12} />
                        <span>Clean PNG</span>
                      </button>
                    )}
                  </div>
                  <div className="lb-note-wrap">
                    <div className="lb-prompt-head">
                      <span>
                        <StickyNote size={11} /> Personal Note
                      </span>
                      {noteText && (
                        <button
                          type="button"
                          className="lb-copy-btn compact"
                          onClick={() => curation.setNote(item, "")}
                          title="Clear personal note"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <textarea
                      className="lb-note-input"
                      rows={2}
                      value={noteText}
                      onChange={(e) => curation.setNote(item, e.target.value)}
                      placeholder="Jot down tweaks, LoRA ideas, or reminders (searchable)..."
                    />
                  </div>
                </div>
              );
            })()}

            {/* Technical Specs Matrix */}
            <div className="lb-spec-section-head">
              <span>Generation Telemetry</span>
              <button
                type="button"
                onClick={() => setTab("settings")}
                title="Choose which readout fields appear here"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: "var(--hm-accent-bright)",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <SlidersHorizontal size={10} /> Fields
              </button>
            </div>

            {anyTelemetryEnabled && (
              <div className="lb-spec-grid">
                {showField("resolution") && (
                  <SpecCard
                    label="Resolution"
                    display={`${item.resolution || "—"}${mp ? ` (${mp} MP)` : ""}`}
                    copyValue={item.resolution}
                  />
                )}
                {showField("fileSize") && (
                  <SpecCard
                    label="File Size"
                    display={`${item.file_size_mb ? `${item.file_size_mb} MB` : "—"}${
                      item.media_type === "video" && item.duration_sec
                        ? ` • ${item.duration_sec}s`
                        : ""
                    }`}
                    copyValue={item.file_size_mb ? `${item.file_size_mb} MB` : null}
                  />
                )}
                {showField("model") && (() => {
                  const modelFile = assetFilename(item.model);
                  const modelCopy = modelFile || (hasVal(item.model_short) ? item.model_short : null);
                  return (
                    <SpecCard
                      label="Model"
                      wide
                      display={item.model_short || "Unknown"}
                      copyValue={modelCopy}
                      title={modelFile || undefined}
                    />
                  );
                })()}
                {showField("seed") && (
                  <SpecCard label="Seed" display={item.seed || "—"} copyValue={item.seed} />
                )}
                {showField("sampler") && (
                  <SpecCard
                    label="Sampler"
                    display={item.sampler || "—"}
                    copyValue={item.sampler}
                  />
                )}
                {showField("scheduler") && hasVal(item.scheduler) && (
                  <SpecCard
                    label="Scheduler"
                    display={item.scheduler}
                    copyValue={item.scheduler}
                  />
                )}
                {showField("steps") && (
                  <SpecCard label="Steps" display={item.steps || "—"} copyValue={item.steps} />
                )}
                {showField("cfg") && (
                  <SpecCard label="CFG Scale" display={item.cfg || "—"} copyValue={item.cfg} />
                )}
                {showField("guidance") && hasVal(item.guidance) && (
                  <SpecCard
                    label="Guidance"
                    display={item.guidance}
                    copyValue={item.guidance}
                  />
                )}
                {showField("denoise") && hasVal(item.denoise) && (
                  <SpecCard label="Denoise" display={item.denoise} copyValue={item.denoise} />
                )}
                {showField("shift") && hasVal(item.shift) && (
                  <SpecCard label="Shift" display={item.shift} copyValue={item.shift} />
                )}
                {showField("vae") && hasVal(item.vae_short) && (() => {
                  const vaeFile = assetFilename(item.vae_raw) || item.vae_short;
                  return (
                    <SpecCard
                      label="VAE"
                      wide
                      display={item.vae_short}
                      copyValue={vaeFile}
                      title={vaeFile}
                    />
                  );
                })()}
                {showField("clip") && clipList.length > 0 && (
                  <div className="lb-spec-card wide">
                    <span>{clipList.length > 1 ? "CLIP Encoders" : "CLIP Encoder"}</span>
                    <div className="lb-pill-strip">
                      {clipList.map((clipName, idx) => {
                        const rawClip = Array.isArray(item.clips_raw) ? item.clips_raw[idx] : "";
                        const clipFile = assetFilename(rawClip) || clipName;
                        return (
                          <AssetPillChip
                            key={`${clipName}-${idx}`}
                            display={clipName}
                            copyValue={clipFile}
                            title={clipFile}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {showField("loras") && loraList.length > 0 && (
                  <div className="lb-spec-card wide">
                    <span>Active LoRAs ({loraList.length})</span>
                    <div className="lb-pill-strip">
                      {loraList.map((lora, idx) => {
                        const loraFile = assetFilename(lora.filename) || lora.name;
                        return (
                          <AssetPillChip
                            key={`${lora.name}-${idx}`}
                            display={lora.name}
                            copyValue={loraFile}
                            weightText={
                              lora.strength != null ? Number(lora.strength).toFixed(2) : null
                            }
                            title={loraFile}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Workflow JSON Action */}
            {item.has_workflow && item.workflow && (
              <button
                type="button"
                className="lb-workflow-btn"
                onClick={handleDownloadWorkflow}
                title="Download embedded workflow JSON"
              >
                <Download size={13} />
                <span>Download Workflow (.json)</span>
              </button>
            )}

            {/* Prompts */}
            {item.raw_prompt && (
              <div className="lb-prompt-card">
                <div className="lb-prompt-head">
                  <span>
                    <Cpu size={12} /> Positive Prompt
                  </span>
                  <CopyChip text={item.raw_prompt} label="Copy" />
                </div>
                <p>{item.raw_prompt}</p>
              </div>
            )}

            {showField("negativePrompt") && item.negative_prompt && (
              <div className="lb-prompt-card neg">
                <div className="lb-prompt-head">
                  <span>Negative Prompt</span>
                  <CopyChip text={item.negative_prompt} label="Copy" />
                </div>
                <p>{item.negative_prompt}</p>
              </div>
            )}

            {/* Extracted Tags */}
            {Array.isArray(item.tags) && item.tags.length > 0 && (
              <div className="lb-tags-section">
                <div className="lb-prompt-head">
                  <span>
                    <Tag size={11} /> Extracted Tags ({item.tags.length})
                  </span>
                </div>
                <div className="lb-tags-wrap">
                  {item.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="lb-tag-pill"
                      onClick={() => onSearchTag?.(t)}
                      title={`Filter gallery by "${t}"`}
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Lightbox Behavior & Visual Preferences */
          <div className="lb-settings-group">
            {(() => {
              const entryStyle = cfg.entryStyle || "spin";
              const sp = getStyleParams(cfg, entryStyle);
              const patchStyleParam = (patch) =>
                onPatchCfg({
                  styleParams: {
                    ...(cfg.styleParams || {}),
                    [entryStyle]: { ...sp, ...patch },
                  },
                });

              return (
                <>
                  <div className="hm-drawer-row-block">
                    <div className="hm-drawer-label-wrap">
                      <span className="hm-drawer-label">Opening Entry Style</span>
                      <span className="hm-drawer-hint">
                        Each style remembers its own speed &amp; strength
                      </span>
                    </div>
                    <ThemedSelect
                      value={entryStyle}
                      leadingIcon={<Wand2 size={13} style={{ color: "var(--hm-accent-bright)" }} />}
                      onChange={(v) => onPatchCfg({ entryStyle: v })}
                      options={[
                        { value: "instant", label: "Instant Pop", meta: "0ms" },
                        { value: "glide", label: "Hero Glide", meta: "Smooth" },
                        { value: "spin", label: "360° Photo Spin", meta: "Card Back" },
                        { value: "teleport", label: "Teleport", meta: "Beam + Sparks" },
                        { value: "venom", label: "Venom Splash", meta: "Liquid Goo" },
                        { value: "cloth", label: "Silk Cloth", meta: "Fabric Whip" },
                      ]}
                    />
                  </div>

                  {entryStyle !== "instant" && (
                    <div className="lb-fx-box">
                      <div className="lb-fx-box-title">
                        {entryStyle === "glide"
                          ? "Hero Glide Options"
                          : entryStyle === "teleport"
                          ? "Teleport Beam Options"
                          : entryStyle === "venom"
                          ? "Venom Splash Options"
                          : entryStyle === "cloth"
                          ? "Silk Cloth Options"
                          : "360° Photo Spin Options"}
                      </div>

                      <div className="hm-drawer-row-block">
                        <div className="hm-drawer-row-top">
                          <div className="hm-drawer-label-wrap">
                            <span className="hm-drawer-label">Animation Duration</span>
                            <span className="hm-drawer-hint">Saved individually for this style</span>
                          </div>
                          <span className="hm-drawer-val">{sp.durationMs}ms</span>
                        </div>
                        <input
                          className="hm-drawer-range"
                          type="range"
                          min={240}
                          max={1200}
                          step={20}
                          value={sp.durationMs}
                          onChange={(e) => patchStyleParam({ durationMs: Number(e.target.value) })}
                        />
                      </div>

                      {(entryStyle === "glide" || entryStyle === "spin") && (
                        <ToggleRow
                          label="Soft Glass-Kiss Cushion"
                          hint="Subtle elastic settle when card lands at full viewport size"
                          checked={sp.cushionSlap ?? true}
                          onChange={(v) => patchStyleParam({ cushionSlap: v })}
                        />
                      )}

                      {entryStyle === "spin" && (
                        <>
                          <div className="lb-settings-kicker" style={{ marginTop: 4 }}>
                            Card Backside Style
                          </div>
                          <div className="hm-drawer-seg-row">
                            {[
                              { label: "White Paper", val: "white" },
                              { label: "Dark Studio", val: "dark" },
                              { label: "Accent Silk", val: "accent" },
                            ].map((opt) => (
                              <button
                                key={opt.val}
                                type="button"
                                className={`hm-drawer-seg-btn ${
                                  (sp.cardBackStyle || "white") === opt.val ? "active" : ""
                                }`}
                                onClick={() => patchStyleParam({ cardBackStyle: opt.val })}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <ToggleRow
                            label="Show Hammelart Crest"
                            hint="Embossed crest & studio stamp centered on the card back"
                            checked={sp.showBackLogo ?? true}
                            onChange={(v) => patchStyleParam({ showBackLogo: v })}
                          />
                        </>
                      )}

                      {entryStyle === "teleport" && (
                        <ToggleRow
                          label="Glowing Spawn Rim"
                          hint="Trace theme border & Lock-In Flash before fading out"
                          checked={sp.teleportHoloRim ?? true}
                          onChange={(v) => patchStyleParam({ teleportHoloRim: v })}
                        />
                      )}

                      {(entryStyle === "venom" || entryStyle === "cloth") && (
                        <div className="hm-drawer-row-block">
                          <div className="hm-drawer-row-top">
                            <div className="hm-drawer-label-wrap">
                              <span className="hm-drawer-label">
                                {entryStyle === "venom"
                                  ? "Viscosity & Stretch"
                                  : "Cloth Ripple Wave"}
                              </span>
                              <span className="hm-drawer-hint">
                                {entryStyle === "venom"
                                  ? "Saved per style • how hard corners cling & stretch"
                                  : "Saved per style • amplitude of billowing folds"}
                              </span>
                            </div>
                            <span className="hm-drawer-val">{sp.intensity}%</span>
                          </div>
                          <input
                            className="hm-drawer-range"
                            type="range"
                            min={25}
                            max={150}
                            step={5}
                            value={Math.max(25, Math.min(150, sp.intensity ?? 100))}
                            onChange={(e) => patchStyleParam({ intensity: Number(e.target.value) })}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {(() => {
              const exitStyle = cfg.exitStyle || "silk";
              const ep = getExitStyleParams(cfg, exitStyle);
              const patchExitParam = (patch) =>
                onPatchCfg({
                  exitStyleParams: {
                    ...(cfg.exitStyleParams || {}),
                    [exitStyle]: { ...ep, ...patch },
                  },
                });

              return (
                <>
                  <div className="hm-drawer-row-block" style={{ marginTop: 8 }}>
                    <div className="hm-drawer-label-wrap">
                      <span className="hm-drawer-label">Close Transition</span>
                      <span className="hm-drawer-hint">
                        Featherweight exit animation &amp; socket return
                      </span>
                    </div>
                    <ThemedSelect
                      value={exitStyle}
                      leadingIcon={<Sparkles size={13} style={{ color: "var(--hm-accent-bright)" }} />}
                      onChange={(v) => onPatchCfg({ exitStyle: v })}
                      options={[
                        { value: "silk", label: "Silk Dissolve", meta: "Soft Blur" },
                        { value: "drift", label: "Velvet Drift", meta: "Lens Sink" },
                        { value: "tuck", label: "Quiet Tuck", meta: "To Socket" },
                        { value: "iris", label: "Lens Iris", meta: "Vignette" },
                        { value: "instant", label: "Instant Cut", meta: "0ms" },
                      ]}
                    />
                  </div>

                  {exitStyle !== "instant" && (
                    <div className="lb-fx-box">
                      <div className="lb-fx-box-title">
                        {exitStyle === "drift"
                          ? "Velvet Drift Options"
                          : exitStyle === "tuck"
                          ? "Quiet Tuck Options"
                          : exitStyle === "iris"
                          ? "Lens Iris Options"
                          : "Silk Dissolve Options"}
                      </div>

                      <div className="hm-drawer-row-block">
                        <div className="hm-drawer-row-top">
                          <div className="hm-drawer-label-wrap">
                            <span className="hm-drawer-label">Exit Duration</span>
                            <span className="hm-drawer-hint">Saved individually for this style</span>
                          </div>
                          <span className="hm-drawer-val">{ep.durationMs}ms</span>
                        </div>
                        <input
                          className="hm-drawer-range"
                          type="range"
                          min={120}
                          max={500}
                          step={10}
                          value={ep.durationMs}
                          onChange={(e) =>
                            patchExitParam({ durationMs: Number(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            <div className="lb-settings-kicker" style={{ marginTop: 10 }}>
              Canvas Atmosphere &amp; HUD
            </div>
            <ToggleRow
              label="Ambient Color Halo"
              hint="Blurred Ambilight glow matching your image's own colors"
              checked={cfg.ambientGlow}
              onChange={(v) => onPatchCfg({ ambientGlow: v })}
            />
            <ToggleRow
              label="Auto-Fade Floating HUD"
              hint="Hides corner controls quietly after 2.4s of idle cursor"
              checked={cfg.autoHideHud}
              onChange={(v) => onPatchCfg({ autoHideHud: v })}
            />
            <ToggleRow
              label="Video Default: 1:1 Pixels"
              hint="Play small videos at native 1:1 pixels instead of stretching to screen (downscales large videos to fit)"
              checked={cfg.videoDefault1to1 ?? true}
              onChange={(v) => onPatchCfg({ videoDefault1to1: v })}
            />
            <ToggleRow
              label="Show Scoped Filmstrip"
              hint="Thumbnail strip along the bottom for quick hopping"
              checked={cfg.filmstripOpen}
              onChange={(v) => onPatchCfg({ filmstripOpen: v })}
            />

            <div className="lb-settings-kicker" style={{ marginTop: 10 }}>
              Viewport Fit Margin
            </div>
            <div className="hm-drawer-seg-row">
              {[
                { label: "0px Edge", val: 0 },
                { label: "14px Cinema", val: 14 },
                { label: "36px Frame", val: 36 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  className={`hm-drawer-seg-btn ${cfg.edgePadding === opt.val ? "active" : ""}`}
                  onClick={() => onPatchCfg({ edgePadding: opt.val })}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="lb-spec-section-head" style={{ marginTop: 12 }}>
              <span>Visible Readout Fields</span>
              <button
                type="button"
                onClick={() =>
                  onPatchCfg({
                    inspectorFields: Object.fromEntries(
                      INSPECTOR_FIELD_DEFS.map((f) => [f.key, true])
                    ),
                  })
                }
                title="Show all telemetry fields"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: "var(--hm-accent-bright)",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Show All
              </button>
            </div>
            <div className="lb-field-toggles-grid">
              {INSPECTOR_FIELD_DEFS.map((field) => {
                const isOn = showField(field.key);
                return (
                  <button
                    key={field.key}
                    type="button"
                    className={`lb-field-chip ${isOn ? "is-on" : ""}`}
                    onClick={() =>
                      onPatchCfg({
                        inspectorFields: {
                          [field.key]: !isOn,
                        },
                      })
                    }
                    aria-pressed={isOn}
                  >
                    {isOn && <Check size={10} />}
                    <span>{field.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="lb-shortcuts-card">
              <div className="lb-settings-kicker">Keyboard Shortcuts</div>
              <div className="lb-shortcut-row">
                <span>Prev / Next Render</span>
                <code>← / → or A / D</code>
              </div>
              <div className="lb-shortcut-row">
                <span>Toggle Info Drawer</span>
                <code>I</code>
              </div>
              <div className="lb-shortcut-row">
                <span>Pure View (Hide HUD)</span>
                <code>H</code>
              </div>
              <div className="lb-shortcut-row">
                <span>Fit / 1:1 Native Pixels</span>
                <code>0 / 1</code>
              </div>
              <div className="lb-shortcut-row">
                <span>Close Lightbox</span>
                <code>Esc</code>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

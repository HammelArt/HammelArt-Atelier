import React, { useEffect, useMemo, useState } from "react";
import {
  SlidersHorizontal,
  X,
  RotateCcw,
  Check,
  Film,
  Image as ImageIcon,
  Workflow,
  HardDrive,
  Maximize2,
  Calendar,
  Cpu,
  Pin,
  StickyNote,
  Volume2,
} from "lucide-react";
import {
  ASPECT_RATIO_PRESETS,
  DATE_PRESETS,
  DEFAULT_ADVANCED_FILTER,
  FORMAT_OPTIONS,
  MP_PRESETS,
  SIZE_PRESETS,
  cloneAdvancedFilter,
  countActiveAdvancedFilters,
} from "../utils/advancedFilter";
import { formatCompactFolderSize } from "../utils/folderTree";
import { filterAndSortItems } from "../utils/presets";
import ThemedSelect from "./ThemedSelect";

export default function FilterOverlayModal({
  isOpen,
  onClose,
  activeFilter,
  onApplyFilter,
  onClearFilter,
  rawItems = [],
  folderFilter = "ALL",
  search = "",
  folderCombos = [],
  favSet = null,
  pinSet = null,
  purgatorySet = null,
  notesMap = null,
  searchFavOnly = false,
  searchAllFolders = false,
  scopeLabel = "Current View",
}) {
  const [draft, setDraft] = useState(() => cloneAdvancedFilter(activeFilter));

  useEffect(() => {
    if (isOpen) {
      setDraft(cloneAdvancedFilter(activeFilter));
    }
  }, [isOpen, activeFilter]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (document.querySelector(".hm-select-menu")) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, onClose]);

  const modelOptions = useMemo(() => {
    const counts = new Map();
    for (const it of rawItems) {
      const m = (it?.model_short || "").trim();
      if (!m || m === "Unknown") continue;
      counts.set(m, (counts.get(m) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 60);
  }, [rawItems]);

  const baseCount = useMemo(() => {
    if (!isOpen) return 0;
    return filterAndSortItems(rawItems, folderFilter, search, "newest", 0, folderCombos, {
      favSet,
      pinSet,
      purgatorySet,
      notesMap,
      favoritesOnly: searchFavOnly,
      searchAllFolders,
      advancedFilter: null,
    }).length;
  }, [
    isOpen,
    rawItems,
    folderFilter,
    search,
    folderCombos,
    favSet,
    pinSet,
    purgatorySet,
    notesMap,
    searchFavOnly,
    searchAllFolders,
  ]);

  const draftMatches = useMemo(() => {
    if (!isOpen) return { count: 0, totalMb: 0 };
    const matched = filterAndSortItems(rawItems, folderFilter, search, "newest", 0, folderCombos, {
      favSet,
      pinSet,
      purgatorySet,
      notesMap,
      favoritesOnly: searchFavOnly,
      searchAllFolders,
      advancedFilter: draft,
    });
    let totalMb = 0;
    for (const it of matched) {
      totalMb += Number(it?.file_size_mb) || 0;
    }
    return { count: matched.length, totalMb };
  }, [
    isOpen,
    rawItems,
    folderFilter,
    search,
    folderCombos,
    favSet,
    pinSet,
    purgatorySet,
    notesMap,
    searchFavOnly,
    searchAllFolders,
    draft,
  ]);

  if (!isOpen) return null;

  const draftRuleCount = countActiveAdvancedFilters(draft);
  const appliedRuleCount = countActiveAdvancedFilters(activeFilter);

  const patchDraft = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  const toggleArrayVal = (field, val) => {
    setDraft((prev) => {
      const cur = Array.isArray(prev[field]) ? prev[field] : [];
      const next = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val];
      return { ...prev, [field]: next };
    });
  };

  const handleSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    onApplyFilter(cloneAdvancedFilter(draft));
    onClose();
  };

  const handleDeactivateAll = () => {
    setDraft(cloneAdvancedFilter(DEFAULT_ADVANCED_FILTER));
    onClearFilter?.();
    onClose();
  };

  return (
    <div
      className="hm-welcome-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hm-filter-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="hm-filter-modal" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="hm-filter-head">
          <div className="hm-filter-title-wrap">
            <div className="hm-filter-icon-badge" aria-hidden="true">
              <SlidersHorizontal size={16} />
            </div>
            <div>
              <div className="hm-filter-eyebrow">
                TEMPORARY LIBRARY FILTER • {searchAllFolders ? "ALL FOLDERS" : scopeLabel.toUpperCase()}
                {searchFavOnly ? " • FAVORITES" : ""}
              </div>
              <h2 id="hm-filter-modal-title" className="hm-filter-title">
                Detailed Media Filters
              </h2>
            </div>
          </div>

          <button
            type="button"
            className="hm-icon-btn"
            onClick={onClose}
            title="Cancel without changing active filters (Esc)"
            aria-label="Close Detailed Filters"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable 2-Column Filter Cards */}
        <div className="hm-filter-body">
          <div className="hm-filter-grid">
            {/* 1. Media, Formats & Workflow */}
            <section className="hm-flt-card">
              <div className="hm-flt-card-head">
                <Film size={13} className="hm-flt-ico" />
                <h3>Media, Formats &amp; Workflow</h3>
              </div>

              <div className="hm-flt-seg-row">
                {[
                  { id: "all", label: "All Media" },
                  { id: "image", label: "Images", icon: <ImageIcon size={11} /> },
                  { id: "video", label: "Videos", icon: <Film size={11} /> },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`hm-flt-pill ${draft.mediaType === opt.id ? "active" : ""}`}
                    onClick={() => patchDraft({ mediaType: opt.id })}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>

              <div className="hm-flt-sub-label">File Format</div>
              <div className="hm-flt-chip-grid-4">
                {FORMAT_OPTIONS.map((fmt) => {
                  const active = draft.formats.includes(fmt.id);
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      className={`hm-flt-chip ${active ? "active" : ""}`}
                      onClick={() => toggleArrayVal("formats", fmt.id)}
                    >
                      {fmt.label}
                    </button>
                  );
                })}
              </div>

              <div className="hm-flt-sub-label">
                <Workflow size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                Embedded Workflow Metadata
              </div>
              <div className="hm-flt-seg-row">
                {[
                  { id: "all", label: "Any" },
                  { id: "with", label: "With Workflow ✓" },
                  { id: "without", label: "No Workflow ✗" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`hm-flt-pill ${draft.workflow === opt.id ? "active" : ""}`}
                    onClick={() => patchDraft({ workflow: opt.id })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>

            {/* 2. Model, Video & Curation */}
            <section className="hm-flt-card">
              <div className="hm-flt-card-head">
                <Cpu size={13} className="hm-flt-ico" />
                <h3>Model, Video &amp; Curation</h3>
              </div>

              <div className="hm-flt-sub-label">Checkpoint / Model</div>
              <ThemedSelect
                value={draft.model}
                onChange={(v) => patchDraft({ model: v })}
                ariaLabel="Filter by Checkpoint Model"
              >
                <option value="all">All Models ({modelOptions.length})</option>
                {modelOptions.map(([m, cnt]) => (
                  <option key={m} value={m}>
                    {m} ({cnt})
                  </option>
                ))}
              </ThemedSelect>

              <div className="hm-flt-sub-label">Curation Flags</div>
              <div className="hm-flt-chip-wrap">
                <button
                  type="button"
                  className={`hm-flt-chip ${draft.pinnedOnly ? "active" : ""}`}
                  onClick={() => patchDraft({ pinnedOnly: !draft.pinnedOnly })}
                >
                  <Pin size={10} /> Pinned Only
                </button>
                <button
                  type="button"
                  className={`hm-flt-chip ${draft.hasNoteOnly ? "active" : ""}`}
                  onClick={() => patchDraft({ hasNoteOnly: !draft.hasNoteOnly })}
                >
                  <StickyNote size={10} /> Has Note
                </button>
              </div>

              {draft.mediaType !== "image" && (
                <>
                  <div className="hm-flt-sub-label">
                    <Volume2 size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    Video Duration &amp; Audio
                  </div>
                  <div className="hm-flt-range-row">
                    <label className="hm-flt-num-field">
                      <span>Min Sec</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="0"
                        value={draft.minDurationSec}
                        onChange={(e) => patchDraft({ minDurationSec: e.target.value })}
                      />
                    </label>
                    <span className="hm-flt-range-dash">–</span>
                    <label className="hm-flt-num-field">
                      <span>Max Sec</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="∞"
                        value={draft.maxDurationSec}
                        onChange={(e) => patchDraft({ maxDurationSec: e.target.value })}
                      />
                    </label>
                    <div className="hm-flt-audio-seg">
                      {[
                        { id: "all", label: "Any" },
                        { id: "yes", label: "Audio" },
                        { id: "no", label: "Silent" },
                      ].map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={`hm-flt-chip ${draft.hasAudio === a.id ? "active" : ""}`}
                          onClick={() => patchDraft({ hasAudio: a.id })}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* 3. Megapixels & Resolution */}
            <section className="hm-flt-card">
              <div className="hm-flt-card-head">
                <Maximize2 size={13} className="hm-flt-ico" />
                <h3>Megapixels &amp; Dimensions</h3>
              </div>

              <div className="hm-flt-chip-row-nowrap">
                {MP_PRESETS.map((p) => {
                  const isMatch = String(draft.minMp) === p.min && String(draft.maxMp) === p.max;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`hm-flt-chip ${isMatch ? "active" : ""}`}
                      onClick={() => patchDraft({ minMp: p.min, maxMp: p.max })}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div className="hm-flt-range-row">
                <label className="hm-flt-num-field">
                  <span>Min MP</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={draft.minMp}
                    onChange={(e) => patchDraft({ minMp: e.target.value })}
                  />
                </label>
                <span className="hm-flt-range-dash">–</span>
                <label className="hm-flt-num-field">
                  <span>Max MP</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="∞"
                    value={draft.maxMp}
                    onChange={(e) => patchDraft({ maxMp: e.target.value })}
                  />
                </label>
              </div>

              <div className="hm-flt-range-row">
                <label className="hm-flt-num-field">
                  <span>Min Width (px)</span>
                  <input
                    type="number"
                    min="0"
                    step="64"
                    placeholder="Any"
                    value={draft.minWidth}
                    onChange={(e) => patchDraft({ minWidth: e.target.value })}
                  />
                </label>
                <span className="hm-flt-range-dash">×</span>
                <label className="hm-flt-num-field">
                  <span>Min Height (px)</span>
                  <input
                    type="number"
                    min="0"
                    step="64"
                    placeholder="Any"
                    value={draft.minHeight}
                    onChange={(e) => patchDraft({ minHeight: e.target.value })}
                  />
                </label>
              </div>
            </section>

            {/* 4. Aspect Ratio & Orientation */}
            <section className="hm-flt-card">
              <div className="hm-flt-card-head">
                <Maximize2 size={13} className="hm-flt-ico" />
                <h3>Aspect Ratio &amp; Orientation</h3>
              </div>

              <div className="hm-flt-seg-row">
                {[
                  { id: "all", label: "Any" },
                  { id: "portrait", label: "Portrait" },
                  { id: "square", label: "Square" },
                  { id: "landscape", label: "Landscape" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`hm-flt-pill ${draft.orientation === opt.id ? "active" : ""}`}
                    onClick={() => patchDraft({ orientation: opt.id })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="hm-flt-sub-label">Target Ratios (±8.5% tolerance)</div>
              <div className="hm-flt-chip-grid-4">
                {ASPECT_RATIO_PRESETS.map((r) => {
                  const active = draft.aspectPresets.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`hm-flt-chip ${active ? "active" : ""}`}
                      onClick={() => toggleArrayVal("aspectPresets", r.id)}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 5. File Size (MB) */}
            <section className="hm-flt-card">
              <div className="hm-flt-card-head">
                <HardDrive size={13} className="hm-flt-ico" />
                <h3>File Size (MB)</h3>
              </div>

              <div className="hm-flt-chip-row-nowrap">
                {SIZE_PRESETS.map((p) => {
                  const isMatch =
                    String(draft.minSizeMb) === p.min && String(draft.maxSizeMb) === p.max;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`hm-flt-chip ${isMatch ? "active" : ""}`}
                      onClick={() => patchDraft({ minSizeMb: p.min, maxSizeMb: p.max })}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div className="hm-flt-range-row">
                <label className="hm-flt-num-field">
                  <span>Min MB</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={draft.minSizeMb}
                    onChange={(e) => patchDraft({ minSizeMb: e.target.value })}
                  />
                </label>
                <span className="hm-flt-range-dash">–</span>
                <label className="hm-flt-num-field">
                  <span>Max MB</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="∞"
                    value={draft.maxSizeMb}
                    onChange={(e) => patchDraft({ maxSizeMb: e.target.value })}
                  />
                </label>
              </div>
            </section>

            {/* 6. Date / Age */}
            <section className="hm-flt-card">
              <div className="hm-flt-card-head">
                <Calendar size={13} className="hm-flt-ico" />
                <h3>Date &amp; File Age</h3>
              </div>

              <div className="hm-flt-chip-row-nowrap">
                {DATE_PRESETS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`hm-flt-chip ${draft.datePreset === d.id ? "active" : ""}`}
                    onClick={() =>
                      patchDraft({
                        datePreset: d.id,
                        ...(d.id !== "custom" ? { dateFrom: "", dateTo: "" } : {}),
                      })
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              <div className="hm-flt-range-row">
                <label className="hm-flt-num-field">
                  <span>From Date</span>
                  <input
                    type="date"
                    value={draft.dateFrom}
                    onChange={(e) =>
                      patchDraft({
                        datePreset: e.target.value || draft.dateTo ? "custom" : "all",
                        dateFrom: e.target.value,
                      })
                    }
                  />
                </label>
                <span className="hm-flt-range-dash">→</span>
                <label className="hm-flt-num-field">
                  <span>To Date</span>
                  <input
                    type="date"
                    value={draft.dateTo}
                    onChange={(e) =>
                      patchDraft({
                        datePreset: draft.dateFrom || e.target.value ? "custom" : "all",
                        dateTo: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
            </section>          </div>
        </div>

        {/* Modal Footer with Live Matching Preview & Actions */}
        <div className="hm-filter-foot">
          <div className="hm-filter-match-pill">
            <strong>{draftMatches.count}</strong> / {baseCount} matching
            <span>·</span>
            <span>{formatCompactFolderSize(draftMatches.totalMb)}</span>
            {draftRuleCount > 0 && (
              <>
                <span>·</span>
                <span className="hm-filter-rule-tag">
                  {draftRuleCount} {draftRuleCount === 1 ? "rule" : "rules"}
                </span>
              </>
            )}
          </div>

          <div className="hm-filter-foot-btns">
            <button
              type="button"
              className="hm-btn"
              disabled={draftRuleCount === 0}
              onClick={() => setDraft(cloneAdvancedFilter(DEFAULT_ADVANCED_FILTER))}
              title="Reset fields inside modal"
            >
              <RotateCcw size={12} /> Clear Fields
            </button>
            {appliedRuleCount > 0 && (
              <button
                type="button"
                className="hm-btn hm-btn-discard"
                onClick={handleDeactivateAll}
                title="Turn off Detailed Filters and snap back to your saved view"
              >
                Turn Off
              </button>
            )}
            <button type="button" className="hm-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="hm-btn hm-save-cta is-dirty">
              <Check size={13} /> Apply Filters
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

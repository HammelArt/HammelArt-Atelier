import React, { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, RefreshCw, RotateCw, Search } from "lucide-react";
import { HAMMELART_CREST_PATH } from "../theme";

const TABS = [
  { id: "welcome", num: "01", label: "Welcome" },
  { id: "root", num: "02", label: "First Root Folder" },
  { id: "modes", num: "03", label: "Mode Overview" },
  { id: "shortcuts", num: "04", label: "Shortcuts & Controls" },
  { id: "updates", num: "05", label: "Updates" },
];

const SHORTCUT_GROUPS = [
  {
    id: "browsing",
    badge: "Browsing",
    accent: "#a855f7",
    title: "Gallery Stage (Classic · Conveyor · Wall · Purgatory)",
    items: [
      { keys: ["Ctrl", "+", "Wheel"], desc: "Zoom card density (Columns / Lanes / hovered Wall Zone)" },
      { keys: ["Hold V"], desc: "Peek card filenames & metadata badges across all tiles" },
      { keys: ["F"], desc: "Toggle Favorite (selected cards or hovered card)" },
      { keys: ["Ctrl", "+", "A"], desc: "Select all visible cards (or active Wall Zone)" },
      { keys: ["X", "/", "Del"], desc: "Send to Purgatory (or Rescue when inside Purgatory)" },
      { keys: ["Shift", "+", "X", "/", "Del"], desc: "Permanently erase from SSD (bypass Purgatory)" },
      { keys: ["Right-Click"], desc: "Open Context Radial Wheel on card or stage" },
      { keys: ["Esc"], desc: "Clear multi-selection or close active modal" },
    ],
  },
  {
    id: "folders",
    badge: "Folders",
    accent: "#34d399",
    title: "Multi-Select, Hold-Drag & Folder Tree",
    items: [
      { keys: ["Ctrl", "+", "Click"], desc: "Add / remove individual card in multi-selection" },
      { keys: ["Shift", "+", "Click"], desc: "Range-select all cards between last click and current" },
      { keys: ["Hold Drag"], desc: "Hold on card to drag into Folder Tree or Purgatory (Esc cancels)" },
      { keys: ["Ctrl", "/", "Shift", "+", "Drop"], desc: "Force Copy (Ctrl) or Move (Shift) directly onto folder" },
      { keys: ["Click #/GB"], desc: "Switch sidebar readouts between render count & disk size" },
      { keys: ["Right-Click"], desc: "Folder menu: Subfolder, Rename, Explorer, Hide, Recycle Bin" },
      { keys: ["Dbl-Click Edge"], desc: "Reset Folder Sidebar width to 248px" },
    ],
  },
  {
    id: "lightbox",
    badge: "Lightbox",
    accent: "#38bdf8",
    title: "Lightbox Viewer (Images & Videos)",
    items: [
      { keys: ["←", "/", "→", "or", "A", "/", "D"], desc: "Previous / Next render" },
      { keys: ["Space", "or", "Click Video"], desc: "Play / Pause active video" },
      { keys: ["M"], desc: "Mute / Unmute video audio" },
      { keys: ["Wheel", "or", "Dbl-Click Image"], desc: "Zoom toward cursor + drag to pan when zoomed" },
      { keys: ["Dbl-Click Video"], desc: "Toggle native monitor Fullscreen" },
      { keys: ["0", "/", "1"], desc: "Fit to viewport (0) or crisp 1:1 native pixels (1)" },
      { keys: ["I", "/", "H"], desc: "Toggle Info & FX drawer (I) or Pure View hide HUD (H)" },
      { keys: ["F", "/", "X", "/", "Del"], desc: "Favorite (F) · Purgatory (X/Del) · Burn SSD (+ Shift)" },
      { keys: ["Right-Click"], desc: "Open Lightbox Radial Menu" },
      { keys: ["Esc", "or", "Backdrop"], desc: "Exit Fullscreen first, or close Lightbox" },
    ],
  },
  {
    id: "showcase",
    badge: "Table & Show",
    accent: "#f472b6",
    title: "Table Pile & Slideshow",
    items: [
      { keys: ["←", "/", "→", "or", "A", "/", "D"], desc: "Step Previous / Next card when hovered or active" },
      { keys: ["Space"], desc: "Pause / Resume automatic advancing" },
      { keys: ["Wheel ↑/↓"], desc: "Rotate Table Pile card tilt gently while hovering or dragging" },
      { keys: ["Grab & Fling"], desc: "Toss scattered photo prints; Radial Tape Pin locks position" },
      { keys: ["Maximize"], desc: "Enter distraction-free Fullscreen Showcase (Esc exits)" },
    ],
  },
  {
    id: "wall",
    badge: "Wall & Desktop",
    accent: "#fbbf24",
    title: "Wall Architect & Desktop App",
    items: [
      { keys: ["Ctrl", "+", "Wheel"], desc: "Zoom Columns / Lanes inside whichever Wall Zone you hover" },
      { keys: ["Click Zone"], desc: "Select individual Zone to tune when Edit Wall is open" },
      { keys: ["Drag Dividers"], desc: "Resize Zone split proportions live on the Wall" },
      { keys: ["Hover Edges"], desc: "Activate Blueprint Splits to Split, Swap, or Remove Zones" },
      { keys: ["F11"], desc: "Desktop Fullscreen (position, size & mode saved on exit)" },
    ],
  },
];

const MODE_CARDS = [
  {
    id: "classic",
    badge: "Classic",
    accent: "#a855f7",
    title: "Classic Grid",
    keywords: ["Folder Tree", "Fast Multi-Select", "Instant Scrubbing"],
    desc: "Clean structured tiles per folder with adjustable density, metadata badges, and instant drag-to-organize.",
  },
  {
    id: "conveyor",
    badge: "Conveyor",
    accent: "#22d3ee",
    title: "Conveyor Streams",
    keywords: ["Auto-Flow Lanes", "Vertical / Horizontal", "Stage FX"],
    desc: "Continuous flowing media belts with configurable direction, speed curves, lane sync, and focus pause.",
  },
  {
    id: "table",
    badge: "Table & Show",
    accent: "#f472b6",
    title: "Table Pile & Slideshow",
    keywords: ["Physics Scatter", "Cinema Stage", "Idle Screensaver"],
    desc: "Tactile scattered photo table you can fling and inspect, plus distraction-free timed slideshows.",
  },
  {
    id: "wall",
    badge: "Wall",
    accent: "#fbbf24",
    title: "Infinite Wall",
    keywords: ["Edge-to-Edge", "Zero Chrome", "Pure Inspiration"],
    desc: "Immersive borderless visual wall built for big monitors, mood-boarding, and effortless browsing.",
  },
  {
    id: "toolkit",
    badge: "Toolkit",
    accent: "#34d399",
    title: "Studio Shortcuts",
    keywords: ["Hold-to-Drag", "Purgatory Trash", "Metadata Peek"],
    desc: "Hold & drag items straight into folders, stage deletions safely in Purgatory, and inspect prompt & media metadata.",
  },
];

export default function WelcomeModal({
  isOpen,
  initialTab = "welcome",
  activeRootPath = "",
  roots = [],
  totalItems = 0,
  totalFolders = 0,
  welcomeDismissed = false,
  onToggleDismissed,
  updateInfo = null,
  checkingUpdates = false,
  applyingUpdate = false,
  updateActionResult = null,
  onCheckUpdates,
  onApplyUpdate,
  onRestartApp,
  onRootApplied,
  onClose,
  onStartTour,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [pathInput, setPathInput] = useState(activeRootPath || "");
  const [browsing, setBrowsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null); // { type: 'ok' | 'err' | 'info', text: string }
  const [shortcutFilter, setShortcutFilter] = useState("all");
  const [shortcutQuery, setShortcutQuery] = useState("");

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || "welcome");
      setPathInput(activeRootPath || "");
      setStatusMsg(null);
      setShortcutQuery("");
    }
  }, [isOpen, initialTab, activeRootPath, roots.length]);

  const filteredShortcutGroups = useMemo(() => {
    const q = shortcutQuery.trim().toLowerCase();
    return SHORTCUT_GROUPS.filter((grp) => shortcutFilter === "all" || grp.id === shortcutFilter)
      .map((grp) => {
        if (!q) return grp;
        const matched = grp.items.filter(
          (item) =>
            item.desc.toLowerCase().includes(q) ||
            item.keys.some((k) => k.toLowerCase().includes(q)) ||
            grp.badge.toLowerCase().includes(q) ||
            grp.title.toLowerCase().includes(q)
        );
        return matched.length > 0 ? { ...grp, items: matched } : null;
      })
      .filter(Boolean);
  }, [shortcutFilter, shortcutQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activeIdx = TABS.findIndex((t) => t.id === activeTab);
  const isFirstTab = activeIdx <= 0;
  const isLastTab = activeIdx >= TABS.length - 1;

  const handleBrowse = async () => {
    setBrowsing(true);
    setStatusMsg({ type: "info", text: "Waiting for Windows folder picker…" });
    try {
      const res = await fetch("/api/roots/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialDir: pathInput || activeRootPath || "" }),
      });
      const data = await res.json();
      if (data.ok && data.path) {
        setPathInput(data.path);
        setStatusMsg({ type: "info", text: "Folder selected — click Apply Root Folder to load your media." });
      } else if (data.cancelled) {
        setStatusMsg(null);
      } else {
        setStatusMsg({ type: "err", text: data.error || "Could not open folder picker — paste a path manually." });
      }
    } catch {
      setStatusMsg({ type: "err", text: "Failed to contact gallery backend." });
    } finally {
      setBrowsing(false);
    }
  };

  const handleApplyRoot = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const candidate = (pathInput || "").trim();
    if (!candidate) {
      setStatusMsg({ type: "err", text: "Please enter or browse to a valid folder path first." });
      return;
    }
    setApplying(true);
    setStatusMsg({ type: "info", text: "Scanning folder & updating library…" });
    try {
      const res = await fetch("/api/roots/set-first", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: candidate }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatusMsg({ type: "err", text: data.error || "Failed to set root folder." });
        return;
      }
      setPathInput(data.activeRootPath || candidate);
      setStatusMsg({
        type: "ok",
        text: `Active root set to ${data.activeRootPath} · ${data.imageCount ?? 0} files across ${data.folderCount ?? 0} folders.`,
      });
      if (onRootApplied) {
        await onRootApplied(data);
      }
    } catch {
      setStatusMsg({ type: "err", text: "Could not apply root folder." });
    } finally {
      setApplying(false);
    }
  };

  const handlePrev = () => {
    if (activeIdx > 0) setActiveTab(TABS[activeIdx - 1].id);
  };

  const handleNext = () => {
    if (activeIdx < TABS.length - 1) setActiveTab(TABS[activeIdx + 1].id);
  };

  return (
    <div
      className="hm-welcome-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hm-welcome-heading"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="hm-welcome-modal">
        <div className="hm-welcome-header">
          <div className="hm-welcome-brand-row">
            <div className="hm-welcome-crest" aria-hidden="true">
              <svg viewBox="0 0 1024 960" width="26" height="25" fill="currentColor">
                <path d={HAMMELART_CREST_PATH} />
              </svg>
            </div>
            <div>
              <div className="hm-welcome-eyebrow">HAMMELART STUDIO · FIRST-LAUNCH GUIDE</div>
              <h1 id="hm-welcome-heading" className="hm-welcome-title">
                Welcome to HammelArt Atelier
              </h1>
            </div>
          </div>
          <button
            type="button"
            className="hm-welcome-close"
            onClick={onClose}
            title="Close welcome guide (Esc)"
            aria-label="Close welcome guide"
          >
            ✕
          </button>
        </div>

        <div className="hm-welcome-tabs" role="tablist" aria-label="Welcome guide sections">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const needsRootWarn = tab.id === "root" && !activeRootPath;
            const hasUpdateDot = tab.id === "updates" && Boolean(updateInfo?.updateAvailable);
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-tab-id={tab.id}
                className={`hm-welcome-tab ${active ? "is-active" : ""} ${needsRootWarn ? "is-warn" : ""} ${
                  hasUpdateDot ? "is-update" : ""
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="hm-welcome-tab-num">{tab.num}</span>
                <span>{tab.label}</span>
                {hasUpdateDot ? (
                  <span className="hm-welcome-tab-dot is-update" title="Update available" />
                ) : needsRootWarn ? (
                  <span className="hm-welcome-tab-dot" title="Folder setup needed" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="hm-welcome-body">
          {activeTab === "welcome" && (
            <div className="hm-welcome-pane" data-pane="welcome">
              <div className="hm-welcome-hero-card">
                <p className="hm-welcome-lead">
                  This little pile of code is a lot more than a simple image browser. My intention was to build
                  something fast and focused that genuinely supports visual creative work — cutting out repetitive
                  sorting tasks and endless window-switching while still feeling sharp and fun to look at.
                </p>
                <p className="hm-welcome-copy">
                  Over time it grew into a compact studio toolkit that keeps your visuals, folders, embedded prompts,
                  and quick actions together in one place. This guide gives you a crisp overview of the essentials so
                  your first steps feel effortless — and from there, the real magic is sculpting a gallery layout that
                  matches exactly how you sort, compare, and curate your media.
                </p>
              </div>

              <div className="hm-welcome-quick-steps">
                <div className="hm-welcome-step-pill" onClick={() => setActiveTab("root")} role="button" tabIndex={0}>
                  <span className="hm-step-badge">Step 1</span>
                  <div>
                    <strong>Pick your First Root Folder</strong>
                    <span>Point HammelArt Atelier to your main renders or media folder.</span>
                  </div>
                </div>
                <div className="hm-welcome-step-pill" onClick={() => setActiveTab("modes")} role="button" tabIndex={0}>
                  <span className="hm-step-badge">Step 2</span>
                  <div>
                    <strong>Explore the Display Modes</strong>
                    <span>Switch live between Classic, Conveyor, Table Pile, Slideshow, and Wall.</span>
                  </div>
                </div>
                <div className="hm-welcome-step-pill" onClick={onStartTour} role="button" tabIndex={0}>
                  <span className="hm-step-badge">Step 3</span>
                  <div>
                    <strong>Take the Un-Blur UI Spotlight Tour</strong>
                    <span>We spotlight each real button right on your live screen with arrows.</span>
                  </div>
                </div>
                <div className="hm-welcome-step-pill" onClick={() => setActiveTab("shortcuts")} role="button" tabIndex={0}>
                  <span className="hm-step-badge">Step 4</span>
                  <div>
                    <strong>Keyboard &amp; Mouse Cheat Sheet</strong>
                    <span>Browse every shortcut &amp; gesture sorted cleanly by mode.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "root" && (
            <div className="hm-welcome-pane" data-pane="root">
              <div className="hm-welcome-root-status">
                <div>
                  <div className="hm-root-label">CURRENT PRIMARY ROOT</div>
                  <div className="hm-root-path">
                    {activeRootPath ? activeRootPath : "No folder configured yet — choose one below"}
                  </div>
                </div>
                <div className="hm-root-counts">
                  <span>{totalItems} files</span>
                  <span>·</span>
                  <span>{totalFolders} folders</span>
                </div>
              </div>

              <form className="hm-welcome-root-form" onSubmit={handleApplyRoot}>
                <label htmlFor="hm-first-root-input" className="hm-root-input-label">
                  First Root Directory
                </label>
                <div className="hm-root-input-row">
                  <input
                    id="hm-first-root-input"
                    type="text"
                    className="hm-root-input"
                    value={pathInput}
                    onChange={(e) => setPathInput(e.target.value)}
                    placeholder="e.g. E:\Photography or D:\Renders"
                  />
                  <button
                    type="button"
                    className="hm-root-browse-btn"
                    onClick={handleBrowse}
                    disabled={browsing || applying}
                  >
                    {browsing ? "Picking…" : "Browse Folder…"}
                  </button>
                  <button
                    type="submit"
                    className="hm-root-apply-btn"
                    disabled={applying || !pathInput.trim()}
                  >
                    {applying ? "Scanning…" : "Apply Folder"}
                  </button>
                </div>
              </form>

              {statusMsg && (
                <div className={`hm-welcome-status is-${statusMsg.type}`}>{statusMsg.text}</div>
              )}

              <div className="hm-welcome-callout">
                <div className="hm-callout-icon" aria-hidden="true">✦</div>
                <div>
                  <strong>Want multiple drives or folders too?</strong>
                  <p>
                    This first folder gets you rolling right away. You can mount additional root folders across
                    any SSD anytime via <strong>Mount Root Folder…</strong> at the bottom of the{" "}
                    <strong>Folders</strong> sidebar or inside <strong>Customize → Mounted Root Libraries</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "modes" && (
            <div className="hm-welcome-pane" data-pane="modes">
              <div className="hm-welcome-modes-grid">
                {MODE_CARDS.map((card) => (
                  <div key={card.id} className="hm-mode-card" style={{ "--mode-accent": card.accent }}>
                    <div className="hm-mode-card-head">
                      <span className="hm-welcome-mode-pill">{card.badge}</span>
                      <h3>{card.title}</h3>
                    </div>
                    <div className="hm-mode-keywords">
                      {card.keywords.map((kw) => (
                        <span key={kw} className="hm-mode-kw">
                          {kw}
                        </span>
                      ))}
                    </div>
                    <p>{card.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div className="hm-welcome-pane" data-pane="shortcuts">
              <div className="hm-sc-toolbar">
                <div className="hm-sc-pills" role="group" aria-label="Filter shortcuts by mode">
                  <button
                    type="button"
                    className={`hm-sc-pill ${shortcutFilter === "all" ? "is-active" : ""}`}
                    onClick={() => setShortcutFilter("all")}
                  >
                    All Modes
                  </button>
                  {SHORTCUT_GROUPS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`hm-sc-pill ${shortcutFilter === g.id ? "is-active" : ""}`}
                      onClick={() => setShortcutFilter(g.id)}
                    >
                      {g.badge}
                    </button>
                  ))}
                </div>

                <div className="hm-sc-search">
                  <Search size={12} style={{ opacity: 0.7, flexShrink: 0 }} />
                  <input
                    type="text"
                    value={shortcutQuery}
                    onChange={(e) => setShortcutQuery(e.target.value)}
                    placeholder="Filter shortcuts…"
                    aria-label="Filter keyboard and mouse shortcuts"
                  />
                  {shortcutQuery && (
                    <button
                      type="button"
                      className="hm-sc-search-clr"
                      onClick={() => setShortcutQuery("")}
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              <div className="hm-sc-grid">
                {filteredShortcutGroups.length === 0 ? (
                  <div className="hm-sc-empty">
                    No shortcuts matched “{shortcutQuery.trim()}”. Try “wheel”, “zoom”, “drag”, or “video”.
                  </div>
                ) : (
                  filteredShortcutGroups.map((grp) => (
                    <section
                      key={grp.id}
                      className="hm-sc-card"
                      style={{ "--sc-accent": grp.accent }}
                    >
                      <div className="hm-sc-card-head">
                        <div className="hm-sc-card-title">
                          <span className="hm-welcome-mode-pill" style={{ "--mode-accent": grp.accent }}>
                            {grp.badge}
                          </span>
                          <h3>{grp.title}</h3>
                        </div>
                        <span className="hm-sc-count">{grp.items.length}</span>
                      </div>

                      <div className="hm-sc-list">
                        {grp.items.map((item, idx) => (
                          <div key={`${grp.id}-${idx}`} className="hm-sc-row">
                            <div className="hm-sc-keys">
                              {item.keys.map((token, kIdx) =>
                                token === "+" || token === "/" || token === "or" ? (
                                  <span key={kIdx} className="hm-sc-sep">
                                    {token}
                                  </span>
                                ) : (
                                  <kbd key={kIdx} className="hm-sc-kbd">
                                    {token}
                                  </kbd>
                                )
                              )}
                            </div>
                            <span className="hm-sc-desc">{item.desc}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === "updates" && (
            <div className="hm-welcome-pane" data-pane="updates">
              <div className="hm-update-status-card">
                <div className="hm-update-head-info">
                  <div className="hm-root-label">HAMMELART ATELIER RELEASE TRACKER</div>
                  <div className="hm-update-title-row">
                    <span className="hm-update-ver-pill">
                      Installed: v{updateInfo?.currentVersion || "0.9.1-beta"}
                    </span>
                    <span className="hm-update-mode-pill">
                      {updateInfo?.installMode === "git" ? "Git Sync Install" : "Portable ZIP Install"}
                    </span>
                    {updateInfo?.updateAvailable ? (
                      <span className="hm-update-state-pill is-available">
                        Update Available · v{updateInfo.latestVersion}
                      </span>
                    ) : updateInfo?.unreachable ? (
                      <span className="hm-update-state-pill is-muted">Offline / Private Repo</span>
                    ) : (
                      <span className="hm-update-state-pill is-current">Up to Date ✓</span>
                    )}
                  </div>
                </div>
                <a
                  className="hm-update-gh-link"
                  href={updateInfo?.releaseUrl || "https://github.com/HammelArt/HammelArt-Atelier/releases"}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open release page on GitHub"
                >
                  <span>Open on GitHub</span>
                  <ExternalLink size={13} />
                </a>
              </div>

              <div className="hm-update-notes-wrap">
                <div className="hm-update-notes-head">
                  <span>
                    {updateInfo?.releaseName
                      ? `Patch Notes · ${updateInfo.releaseName}`
                      : "Release Patch Notes"}
                  </span>
                  {updateInfo?.publishedAt && (
                    <span className="hm-update-pub-date">
                      {new Date(updateInfo.publishedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="hm-update-notes-box">
                  {updateInfo?.patchNotes
                    ? updateInfo.patchNotes
                    : updateInfo?.statusNote ||
                      "Click “Check for Updates” to pull the latest release details and patch notes from GitHub."}
                </div>
              </div>

              {updateInfo?.statusNote && (
                <div className="hm-welcome-status is-info">{updateInfo.statusNote}</div>
              )}

              {updateActionResult?.message && (
                <div className={`hm-welcome-status ${updateActionResult.ok ? "is-ok" : "is-err"}`}>
                  {updateActionResult.message}
                </div>
              )}

              <div className="hm-update-actions-row">
                <button
                  type="button"
                  className="hm-root-browse-btn hm-update-btn"
                  onClick={onCheckUpdates}
                  disabled={checkingUpdates || applyingUpdate}
                >
                  <RefreshCw size={14} className={checkingUpdates ? "hm-spin" : ""} />
                  <span>{checkingUpdates ? "Checking…" : "Check for Updates"}</span>
                </button>

                {updateActionResult?.restartRequired && updateActionResult?.ok ? (
                  <button
                    type="button"
                    className="hm-root-apply-btn hm-update-btn is-restart"
                    onClick={onRestartApp}
                    disabled={updateActionResult?.restarting}
                  >
                    <RotateCw size={14} className={updateActionResult?.restarting ? "hm-spin" : ""} />
                    <span>{updateActionResult?.restarting ? "Restarting…" : "Restart Atelier"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`hm-root-apply-btn hm-update-btn ${
                      updateInfo?.updateAvailable ? "is-ready" : ""
                    }`}
                    onClick={onApplyUpdate}
                    disabled={applyingUpdate || checkingUpdates}
                    title={
                      updateInfo?.installMode === "git"
                        ? "Runs safe git pull --ff-only while preserving your userdata/ folder"
                        : "Downloads & extracts latest GitHub ZIP while preserving userdata/ & python_runtime/"
                    }
                  >
                    <Download size={14} />
                    <span>{applyingUpdate ? "Updating…" : "Run Update"}</span>
                  </button>
                )}
              </div>

              <div className="hm-welcome-callout">
                <div className="hm-callout-icon" aria-hidden="true">✦</div>
                <div>
                  <strong>Safe, non-destructive updates</strong>
                  <p>
                    Your <code>userdata/</code> folder (mounted roots, themes, taped trophies &amp; notes)
                    stays untouched — works cleanly for both Git clones and Portable ZIP installs.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="hm-welcome-footer">
          <label className="hm-welcome-checkbox">
            <input
              type="checkbox"
              checked={welcomeDismissed}
              onChange={(e) => onToggleDismissed && onToggleDismissed(e.target.checked)}
            />
            <span>Don’t show this welcome guide on future launches</span>
          </label>

          <div className="hm-welcome-actions">
            {!isFirstTab && (
              <button type="button" className="hm-welcome-btn-ghost" onClick={handlePrev}>
                ← Back
              </button>
            )}
            {!isLastTab ? (
              <button type="button" className="hm-welcome-btn-secondary" onClick={handleNext}>
                Next →
              </button>
            ) : null}
            <button
              type="button"
              className="hm-welcome-btn-tour"
              onClick={onStartTour}
              title="Blur the screen except key UI elements with an interactive pointer tour"
            >
              Start Un-Blur Tour →
            </button>
            <button type="button" className="hm-welcome-btn-primary" onClick={onClose}>
              Enter Atelier
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

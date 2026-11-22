import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CopyPlus, FolderInput, FolderPlus, HardDrive, Trash2, X } from "lucide-react";
import { analyzeRootRemovalImpact, parseScopedFolderPath } from "../utils/folderTree";

export function AddRootModal({ isOpen, onClose, onRootAdded }) {
  const [pathInput, setPathInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [scanProgress, setScanProgress] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setPathInput("");
      setLabelInput("");
      setStatusMsg(null);
      setScanProgress(null);
      setBrowsing(false);
      setAdding(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !adding) return undefined;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/roots/scan-status", { cache: "no-store" });
        const d = await res.json();
        if (alive && d?.active) {
          setScanProgress(d);
        }
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 180);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isOpen, adding]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const deriveFolderName = (p) => {
    const clean = String(p || "").replace(/[\\/]+$/, "");
    if (!clean) return "";
    const parts = clean.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || clean;
  };

  const handleBrowse = async () => {
    setBrowsing(true);
    setStatusMsg({ type: "info", text: "Waiting for Windows Explorer folder picker…" });
    try {
      const res = await fetch("/api/roots/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialDir: pathInput || "" }),
      });
      const data = await res.json();
      if (data.ok && data.path) {
        setPathInput(data.path);
        if (!labelInput.trim()) {
          setLabelInput(deriveFolderName(data.path));
        }
        setStatusMsg(null);
      } else if (data.cancelled) {
        setStatusMsg(null);
      } else {
        setStatusMsg({ type: "err", text: data.error || "Could not open folder picker." });
      }
    } catch {
      setStatusMsg({ type: "err", text: "Failed to contact gallery backend." });
    } finally {
      setBrowsing(false);
    }
  };

  const handleMount = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const candidate = (pathInput || "").trim();
    if (!candidate) {
      setStatusMsg({ type: "err", text: "Please browse to or enter a folder path first." });
      return;
    }
    setAdding(true);
    setStatusMsg({ type: "info", text: "Mounting & scanning root folder…" });
    try {
      const res = await fetch("/api/roots/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: candidate,
          label: labelInput.trim() || deriveFolderName(candidate),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatusMsg({ type: "err", text: data.error || "Could not add root folder." });
        return;
      }
      await onRootAdded?.(data);
      onClose();
    } catch {
      setStatusMsg({ type: "err", text: "Could not add root folder." });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className="hm-unsaved-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hm-add-root-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="hm-root-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hm-root-modal-head">
          <div className="hm-root-modal-title-wrap">
            <div className="hm-root-modal-icon">
              <FolderPlus size={16} />
            </div>
            <div>
              <h3 id="hm-add-root-title">Add Root Folder</h3>
              <p>Mount another folder or SSD library cleanly alongside your existing roots.</p>
            </div>
          </div>
          <button type="button" className="hm-icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleMount} className="hm-root-modal-body">
          <label className="hm-root-input-label" htmlFor="hm-add-root-path">
            Folder Path
          </label>
          <div className="hm-root-input-row">
            <input
              id="hm-add-root-path"
              type="text"
              className="hm-root-input"
              value={pathInput}
              onChange={(e) => {
                const v = e.target.value;
                setPathInput(v);
              }}
              placeholder="e.g. E:\Photography or D:\Renders"
              autoFocus
            />
            <button
              type="button"
              className="hm-root-browse-btn"
              onClick={handleBrowse}
              disabled={browsing || adding}
            >
              {browsing ? "Picking…" : "Browse…"}
            </button>
          </div>

          <label className="hm-root-input-label" htmlFor="hm-add-root-label" style={{ marginTop: 12 }}>
            Display Name (optional)
          </label>
          <input
            id="hm-add-root-label"
            type="text"
            className="hm-root-input"
            style={{ width: "100%" }}
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder={deriveFolderName(pathInput) || "Auto from folder name"}
          />

          {adding && (
            <div className="hm-scan-inline" style={{ marginTop: 12 }}>
              <div className="hm-scan-inline-head">
                <span>
                  {scanProgress?.total > 0
                    ? `Indexing ${scanProgress.rootLabel || "folder"}…`
                    : "Discovering files & videos…"}
                </span>
                {scanProgress?.total > 0 && (
                  <strong>
                    {scanProgress.scanned.toLocaleString()} / {scanProgress.total.toLocaleString()}
                  </strong>
                )}
              </div>
              <div className="hm-scan-bar-track">
                <div
                  className={`hm-scan-bar-fill ${!(scanProgress?.total > 0) ? "is-indeterminate" : ""}`}
                  style={
                    scanProgress?.total > 0
                      ? { width: `${Math.min(100, Math.round((scanProgress.scanned / scanProgress.total) * 100))}%` }
                      : undefined
                  }
                />
              </div>
            </div>
          )}

          {!adding && statusMsg && (
            <div className={`hm-welcome-status is-${statusMsg.type}`} style={{ marginTop: 12, marginBottom: 0 }}>
              {statusMsg.text}
            </div>
          )}

          <div className="hm-root-modal-actions">
            <button type="button" className="hm-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="hm-welcome-btn-primary"
              disabled={adding || !pathInput.trim()}
            >
              {adding ? "Mounting…" : "Mount Root Folder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function RemoveRootConfirmModal({
  root,
  folderCombos = [],
  userWallPresets = [],
  onCancel,
  onConfirm,
}) {
  const [mixedPolicy, setMixedPolicy] = useState("strip"); // "strip" | "delete"
  const [removing, setRemoving] = useState(false);

  const impact = useMemo(() => {
    if (!root) return { exclusiveCombos: [], mixedCombos: [], affectedWallPresets: [] };
    return analyzeRootRemovalImpact(root.id, folderCombos, userWallPresets);
  }, [root, folderCombos, userWallPresets]);

  useEffect(() => {
    if (root) {
      setMixedPolicy("strip");
      setRemoving(false);
    }
  }, [root]);

  useEffect(() => {
    if (!root) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [root, onCancel]);

  if (!root) return null;

  const { exclusiveCombos, mixedCombos, affectedWallPresets } = impact;
  const hasAnyImpact =
    exclusiveCombos.length > 0 || mixedCombos.length > 0 || affectedWallPresets.length > 0;

  return (
    <div
      className="hm-unsaved-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hm-remove-root-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="hm-root-modal is-warn" onClick={(e) => e.stopPropagation()}>
        <div className="hm-root-modal-head">
          <div className="hm-root-modal-title-wrap">
            <div className="hm-unsaved-icon">
              <AlertTriangle size={16} />
            </div>
            <div>
              <h3 id="hm-remove-root-title">Remove Root Folder from Gallery?</h3>
              <p>
                <HardDrive size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                <strong>{root.label}</strong> ({root.path})
              </p>
            </div>
          </div>
          <button type="button" className="hm-icon-btn sm" onClick={onCancel} aria-label="Cancel">
            <X size={14} />
          </button>
        </div>

        <div className="hm-root-modal-body">
          <div className="hm-remove-safe-note">
            This only unmounts <strong>{root.label}</strong> from HammelArt Atelier.{" "}
            <strong>Zero files or folders on your disk will be deleted or touched.</strong>
          </div>

          {hasAnyImpact && (
            <div className="hm-remove-impact-box">
              {exclusiveCombos.length > 0 && (
                <div className="hm-remove-impact-group">
                  <strong>
                    Saved Folder Combos exclusively in this root (will be deleted):
                  </strong>
                  <ul>
                    {exclusiveCombos.map((c) => (
                      <li key={c.id}>{c.label}</li>
                    ))}
                  </ul>
                </div>
              )}

              {mixedCombos.length > 0 && (
                <div className="hm-remove-impact-group">
                  <strong>
                    Cross-root Combos mixing {root.label} with other roots ({mixedCombos.length}):
                  </strong>
                  <ul>
                    {mixedCombos.map((c) => (
                      <li key={c.id}>{c.label}</li>
                    ))}
                  </ul>
                  <div className="hm-remove-policy-choice">
                    <label>
                      <input
                        type="radio"
                        name="hm_mixed_policy"
                        checked={mixedPolicy === "strip"}
                        onChange={() => setMixedPolicy("strip")}
                      />
                      <span>Keep Combos &amp; pull out folders from {root.label}</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="hm_mixed_policy"
                        checked={mixedPolicy === "delete"}
                        onChange={() => setMixedPolicy("delete")}
                      />
                      <span>Delete affected Combos completely</span>
                    </label>
                  </div>
                </div>
              )}

              {affectedWallPresets.length > 0 && (
                <div className="hm-remove-impact-group">
                  <strong>Saved Wall Presets (layout kept — dangling zone reset to All Folders):</strong>
                  <ul>
                    {affectedWallPresets.map((wp) => (
                      <li key={wp.id}>{wp.label}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="hm-root-modal-actions">
            <button type="button" className="hm-btn" onClick={onCancel} disabled={removing}>
              Keep Root
            </button>
            <button
              type="button"
              className="hm-btn hm-btn-discard"
              disabled={removing}
              onClick={async () => {
                setRemoving(true);
                await onConfirm?.(root, mixedPolicy);
                setRemoving(false);
              }}
            >
              <Trash2 size={12} /> {removing ? "Removing…" : "Remove Root Folder"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DropActionPopover({
  pendingDrop, // { x, y, items, targetScoped, targetLabel } | null
  roots = [],
  onMove,
  onCopy,
  onCancel,
}) {
  useEffect(() => {
    if (!pendingDrop) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pendingDrop, onCancel]);

  if (!pendingDrop) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const boxW = 248;
  const boxH = 148;
  const left = Math.min(Math.max(12, pendingDrop.x + 8), vw - boxW - 12);
  const top = Math.min(Math.max(12, pendingDrop.y + 8), vh - boxH - 12);

  const parsed = parseScopedFolderPath(pendingDrop.targetScoped, roots[0]?.id || "root_1");
  const targetRoot = roots.find((r) => r.id === parsed.rootId);
  const destLabel =
    roots.length > 1 && targetRoot
      ? `${targetRoot.label} · ${parsed.subfolder}`
      : parsed.subfolder;

  const count = pendingDrop.items?.length || 0;

  return (
    <div
      className="hm-drop-choice-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div className="hm-drop-choice-popover" style={{ left, top, width: boxW }} role="menu">
        <div className="hm-drop-choice-head">
          <span>
            {count} {count === 1 ? "file" : "files"} → <strong>{destLabel}</strong>
          </span>
        </div>
        <button
          type="button"
          className="hm-drop-choice-btn is-primary"
          onClick={() => onMove?.(pendingDrop)}
        >
          <FolderInput size={14} />
          <div>
            <strong>Move Here</strong>
            <span>Relocates files &amp; keeps Fav/Pin/Notes</span>
          </div>
        </button>
        <button
          type="button"
          className="hm-drop-choice-btn"
          onClick={() => onCopy?.(pendingDrop)}
        >
          <CopyPlus size={14} />
          <div>
            <strong>Copy Here</strong>
            <span>Exact clean copy (keeps original intact)</span>
          </div>
        </button>
        <button type="button" className="hm-drop-choice-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ScanProgressOverlay({ scanStatus }) {
  if (!scanStatus?.active) return null;
  const total = Number(scanStatus.total) || 0;
  const scanned = Number(scanStatus.scanned) || 0;
  const pct = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;

  return (
    <div
      className="hm-scan-backdrop"
      role="status"
      aria-live="polite"
      aria-label="Indexing media library"
    >
      <div className="hm-scan-card">
        <div className="hm-scan-card-top">
          <div className="hm-root-modal-icon">
            <HardDrive size={16} />
          </div>
          <div>
            <h3>
              {total > 0
                ? `Indexing ${scanStatus.rootLabel || "Library"}…`
                : `Scanning ${scanStatus.rootLabel || "Library"}…`}
            </h3>
            <p>Preparing media cache &amp; video metadata silently — gallery resumes automatically.</p>
          </div>
        </div>

        <div className="hm-scan-bar-track large">
          <div
            className={`hm-scan-bar-fill ${total <= 0 ? "is-indeterminate" : ""}`}
            style={total > 0 ? { width: `${pct}%` } : undefined}
          />
        </div>

        <div className="hm-scan-card-foot">
          <span>
            {total > 0
              ? `${scanned.toLocaleString()} / ${total.toLocaleString()} files indexed`
              : "Discovering subfolders & files…"}
          </span>
          {total > 0 && <strong>{pct}%</strong>}
        </div>
      </div>
    </div>
  );
}

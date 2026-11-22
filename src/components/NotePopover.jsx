import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { StickyNote, X, Check } from "lucide-react";
import { useCuration } from "../utils/curation";

/**
 * Compact frosted inline Personal Note editor opened directly from
 * a Thumbnail right-click radial menu bubble without leaving the gallery.
 */
export default function NotePopover({ target, onClose }) {
  const curation = useCuration();
  const item = target?.item || null;
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!item || !curation) return;
    setDraft(curation.getNote(item));
  }, [item, curation]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [target, onClose]);

  const left =
    typeof window !== "undefined" && target
      ? Math.max(14, Math.min(window.innerWidth - 314, target.x - 140))
      : 0;
  const top =
    typeof window !== "undefined" && target
      ? Math.max(14, Math.min(window.innerHeight - 190, target.y - 80))
      : 0;

  const commitAndClose = () => {
    if (item && curation) {
      curation.setNote(item, draft);
      curation.showToast(draft.trim() ? "Note saved" : "Note cleared");
    }
    onClose?.();
  };

  return (
    <AnimatePresence>
      {target && item && (
        <motion.div
          className="hm-note-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={commitAndClose}
        >
          <motion.div
            className="hm-note-popover"
            style={{ left, top }}
            initial={{ opacity: 0, scale: 0.9, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 6 }}
            transition={{ type: "spring", stiffness: 480, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hm-note-head">
              <span className="hm-note-title">
                <StickyNote size={12} style={{ color: "var(--hm-accent-bright)" }} />
                <span>Note • {item.filename}</span>
              </span>
              <button type="button" className="hm-note-x" onClick={onClose} title="Cancel (Esc)">
                <X size={13} />
              </button>
            </div>
            <textarea
              className="lb-note-input"
              rows={3}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitAndClose();
                }
              }}
              placeholder="Write a personal note (Enter to save, Shift+Enter for newline)..."
            />
            <div className="hm-note-foot">
              {draft.trim() ? (
                <button
                  type="button"
                  className="hm-btn"
                  onClick={() => {
                    curation?.setNote(item, "");
                    curation?.showToast("Note cleared");
                    onClose?.();
                  }}
                >
                  Clear
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="hm-btn hm-save-cta" onClick={commitAndClose}>
                <Check size={12} /> Save Note
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

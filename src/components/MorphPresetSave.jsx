import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, RefreshCw, Check, X } from "lucide-react";

const BOUNCE_SPRING = {
  type: "spring",
  stiffness: 460,
  damping: 19,
  mass: 0.85,
};

/**
 * Inline Toybox-style elastic morphing preset saver.
 * Offers one-click "Update <Name>" or "Save as New" when riffing on a custom preset,
 * without modal popups.
 */
export default function MorphPresetSave({ targetPreset, isDirty, onUpdate, onSaveNew }) {
  const [stage, setStage] = useState("idle"); // idle | choose | naming | done
  const [name, setName] = useState("");
  const [doneMsg, setDoneMsg] = useState("Saved!");
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const prevTargetIdRef = useRef(targetPreset?.id ?? null);

  // Snap safely back to idle if the target custom preset disappears, switches, or reverts clean
  useEffect(() => {
    const nextId = targetPreset?.id ?? null;
    if (stage === "choose" && (!nextId || !isDirty || prevTargetIdRef.current !== nextId)) {
      setStage("idle");
    }
    prevTargetIdRef.current = nextId;
  }, [stage, targetPreset?.id, isDirty]);

  const effectiveStage = stage === "choose" && (!targetPreset || !isDirty) ? "idle" : stage;

  const flashDone = (msg) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setDoneMsg(msg);
    setStage("done");
    timerRef.current = setTimeout(() => {
      setStage("idle");
    }, 1550);
  };

  const handleOpen = () => {
    if (targetPreset && isDirty) {
      setStage("choose");
    } else {
      setName("");
      setStage("naming");
    }
  };

  const handleUpdate = () => {
    if (!targetPreset) return;
    onUpdate(targetPreset.id);
    flashDone(`Updated "${targetPreset.label}"`);
  };

  const handleCommitNew = () => {
    const clean = name.trim();
    if (!clean) return;
    onSaveNew(clean);
    setName("");
    flashDone(`Saved "${clean}"`);
  };

  return (
    <motion.div
      layout
      transition={BOUNCE_SPRING}
      className={`hm-morph-save stage-${effectiveStage} ${isDirty && targetPreset ? "is-dirty" : ""}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {effectiveStage === "idle" && (
          <motion.button
            key="idle"
            type="button"
            className="hm-morph-trigger"
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.86 }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.94 }}
            transition={BOUNCE_SPRING}
            onClick={handleOpen}
            title={
              targetPreset
                ? `Update "${targetPreset.label}" or save as a new preset`
                : "Save current Lego settings as your own custom preset"
            }
          >
            {targetPreset && isDirty ? (
              <>
                <RefreshCw size={12} /> Save / Update…
              </>
            ) : (
              <>
                <Plus size={12} /> Save Preset
              </>
            )}
          </motion.button>
        )}

        {effectiveStage === "choose" && targetPreset && (
          <motion.div
            key="choose"
            className="hm-morph-row"
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.86 }}
            transition={BOUNCE_SPRING}
          >
            <motion.button
              type="button"
              className="hm-morph-action primary"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              transition={BOUNCE_SPRING}
              onClick={handleUpdate}
              title={`Overwrite "${targetPreset.label}" with current tweaks`}
            >
              <RefreshCw size={11} /> Update "{targetPreset.label}"
            </motion.button>
            <motion.button
              type="button"
              className="hm-morph-action"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              transition={BOUNCE_SPRING}
              onClick={() => {
                setName("");
                setStage("naming");
              }}
            >
              <Plus size={11} /> Save as New
            </motion.button>
            <button
              type="button"
              className="hm-morph-close"
              onClick={() => setStage("idle")}
              title="Cancel"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}

        {effectiveStage === "naming" && (
          <motion.div
            key="naming"
            className="hm-morph-row"
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.86 }}
            transition={BOUNCE_SPRING}
          >
            <input
              autoFocus
              className="hm-preset-input"
              placeholder="Preset name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitNew();
                if (e.key === "Escape") setStage("idle");
              }}
            />
            <motion.button
              type="button"
              className="hm-morph-action primary"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              transition={BOUNCE_SPRING}
              onClick={handleCommitNew}
            >
              Save
            </motion.button>
            <button
              type="button"
              className="hm-morph-close"
              onClick={() => setStage("idle")}
              title="Cancel"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}

        {effectiveStage === "done" && (
          <motion.div
            key="done"
            className="hm-morph-done"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={BOUNCE_SPRING}
          >
            <Check size={13} /> {doneMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

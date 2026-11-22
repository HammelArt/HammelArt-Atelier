import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";

/**
 * Recursively flatten <option> and <optgroup> children into normalized items
 * so ThemedSelect works seamlessly both with declarative `options` and JSX children.
 */
function parseChildrenOptions(children) {
  const items = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === "optgroup") {
      const groupLabel = child.props?.label || "";
      React.Children.forEach(child.props.children, (sub) => {
        if (React.isValidElement(sub) && sub.type === "option") {
          items.push({
            value: String(sub.props.value ?? ""),
            label: extractText(sub.props.children),
            group: groupLabel,
            disabled: Boolean(sub.props.disabled),
          });
        }
      });
    } else if (child.type === "option") {
      items.push({
        value: String(child.props.value ?? ""),
        label: extractText(child.props.children),
        group: "",
        disabled: Boolean(child.props.disabled),
      });
    } else if (child.props?.children) {
      items.push(...parseChildrenOptions(child.props.children));
    }
  });
  return items;
}

function extractText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) return extractText(node.props?.children);
  return "";
}

export default function ThemedSelect({
  value = "",
  onChange,
  options,
  children,
  placeholder = "Select...",
  leadingIcon = null,
  disabled = false,
  className = "",
  emptyText = "No options available",
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 200, maxHeight: 260, flipUp: false });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const normalizedOptions = useMemo(() => {
    if (Array.isArray(options)) return options;
    return parseChildrenOptions(children);
  }, [options, children]);

  const activeItem = normalizedOptions.find((o) => String(o.value) === String(value));
  const displayLabel = activeItem ? activeItem.label : placeholder;

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 14;
    const spaceAbove = rect.top - 14;
    const flipUp = spaceBelow < 170 && spaceAbove > spaceBelow;
    const width = Math.max(rect.width, 196);
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10));
    const availH = flipUp ? spaceAbove : spaceBelow;

    setPos({
      left,
      top: rect.bottom + 6,
      bottom: window.innerHeight - rect.top + 6,
      width,
      maxHeight: Math.max(120, Math.min(290, availH)),
      flipUp,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onScrollOrResize = () => updatePosition();

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updatePosition]);

  // Build grouped render list cleanly
  const groupedBlocks = useMemo(() => {
    const blocks = [];
    let currentGroup = null;
    for (const item of normalizedOptions) {
      const grp = item.group || "";
      if (!currentGroup || currentGroup.label !== grp) {
        currentGroup = { label: grp, items: [] };
        blocks.push(currentGroup);
      }
      currentGroup.items.push(item);
    }
    return blocks;
  }, [normalizedOptions]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={`hm-themed-select-btn ${open ? "is-open" : ""} ${
          !activeItem ? "is-placeholder" : ""
        } ${className}`}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span className="hm-themed-select-left">
          {leadingIcon && <span className="hm-themed-select-icon">{leadingIcon}</span>}
          <span className="hm-themed-select-text">{displayLabel}</span>
        </span>
        <ChevronDown
          size={13}
          className="hm-themed-select-chev"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={menuRef}
                data-themed-menu="true"
                className={`hm-themed-menu ${pos.flipUp ? "flip-up" : ""}`}
                style={{
                  position: "fixed",
                  left: pos.left,
                  ...(pos.flipUp ? { bottom: pos.bottom } : { top: pos.top }),
                  width: pos.width,
                  maxHeight: pos.maxHeight,
                  transformOrigin: pos.flipUp ? "bottom center" : "top center",
                }}
                initial={{
                  opacity: 0,
                  y: pos.flipUp ? 6 : -6,
                  scale: 0.97,
                }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: pos.flipUp ? 6 : -6,
                  scale: 0.97,
                }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                onMouseMove={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="hm-themed-menu-scroll" style={{ maxHeight: pos.maxHeight - 10 }}>
                  {normalizedOptions.length === 0 ? (
                    <div className="hm-themed-menu-empty">{emptyText}</div>
                  ) : (
                    groupedBlocks.map((blk, bIdx) => (
                      <div key={`${blk.label}_${bIdx}`} className="hm-themed-menu-group">
                        {blk.label && <div className="hm-themed-menu-glabel">{blk.label}</div>}
                        {blk.items.map((opt) => {
                          const isSel = String(opt.value) === String(value);
                          return (
                            <div
                              key={String(opt.value)}
                              className={`hm-themed-menu-item ${isSel ? "active" : ""} ${
                                opt.disabled ? "disabled" : ""
                              }`}
                              onClick={() => {
                                if (opt.disabled) return;
                                onChange(opt.value);
                                setOpen(false);
                              }}
                            >
                              <span className="hm-themed-menu-item-main">
                                {opt.depth > 0 && (
                                  <span
                                    className="hm-themed-tree-elbow"
                                    style={{ marginLeft: `${(opt.depth - 1) * 14}px` }}
                                    aria-hidden="true"
                                  />
                                )}
                                {opt.icon && <span className="hm-themed-menu-item-icon">{opt.icon}</span>}
                                <span className="hm-themed-menu-item-label">
                                  {opt.menuLabel || opt.label}
                                </span>
                              </span>

                              <span className="hm-themed-menu-item-right">
                                {opt.meta && <span className="hm-themed-menu-item-meta">{opt.meta}</span>}
                                {isSel && <Check size={12} className="hm-themed-menu-check" />}
                                {opt.onDelete && (
                                  <button
                                    type="button"
                                    className="hm-themed-menu-del"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      opt.onDelete(opt.value);
                                    }}
                                    title="Delete Combo"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Coordinates true borderless monitor fullscreen across Browser (`requestFullscreen`)
 * and Standalone Desktop (`pywebview` + `/api/desktop-fullscreen` Win32 bridge)
 * so Slideshow, Table Pile, and Screensaver hide window chrome and Windows taskbar.
 */
export function useStageFullscreen(stageRef, { escapeDisabled = false } = {}) {
  const [nativeFs, setNativeFs] = useState(false);
  const [desktopFs, setDesktopFs] = useState(false);
  const desktopFsOwnedRef = useRef(false);

  const isFullscreen = nativeFs || desktopFs;

  useEffect(() => {
    const onFsChange = () => {
      setNativeFs(Boolean(stageRef.current && document.fullscreenElement === stageRef.current));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      if (desktopFsOwnedRef.current) {
        desktopFsOwnedRef.current = false;
        fetch("/api/desktop-fullscreen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullscreen: false }),
        }).catch(() => {});
      }
    };
  }, [stageRef]);

  const exitFullscreen = useCallback(async () => {
    setDesktopFs(false);
    if (stageRef.current && document.fullscreenElement === stageRef.current) {
      try {
        await document.exitFullscreen?.();
      } catch {}
    }
    if (desktopFsOwnedRef.current) {
      desktopFsOwnedRef.current = false;
      fetch("/api/desktop-fullscreen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullscreen: false }),
      }).catch(() => {});
    }
  }, [stageRef]);

  const enterFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;

    if (typeof window !== "undefined" && window.pywebview) {
      setDesktopFs(true);
      desktopFsOwnedRef.current = true;
      try {
        const res = await fetch("/api/desktop-fullscreen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullscreen: true }),
        });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (data?.ok) {
          desktopFsOwnedRef.current = !data.already_fullscreen;
          return;
        }
      } catch {}
      desktopFsOwnedRef.current = false;
    }

    const alreadyFillingScreen =
      typeof window !== "undefined" &&
      window.screen?.width > 0 &&
      window.innerWidth >= window.screen.width - 2 &&
      window.innerHeight >= window.screen.height - 2;

    if (alreadyFillingScreen) {
      setDesktopFs(true);
      return;
    }

    try {
      await el.requestFullscreen?.();
    } catch {
      setDesktopFs(true);
    }
  }, [stageRef]);

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // Allow Esc to exit pure Desktop/overlay fullscreen cleanly when no modal/menu sits above it
  useEffect(() => {
    if (!desktopFs || escapeDisabled) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[data-radial-root="true"], .lb-root')) return;
      e.preventDefault();
      e.stopPropagation();
      exitFullscreen();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [desktopFs, escapeDisabled, exitFullscreen]);

  return {
    isFullscreen,
    toggleFullscreen,
    enterFullscreen,
    exitFullscreen,
  };
}

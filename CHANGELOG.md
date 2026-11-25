# Changelog

All notable changes to **HammelArt Atelier** are documented in this file.

## [v0.9.4-beta.1] - 2026-11-25 — Fixed-Size Help Modal & Unified Tab Layout
### Changed
- **Fixed-Height Welcome & Help Shell:** Locked `.hm-welcome-modal` to a steady middleground frame (`900px` wide, `min(86vh, 710px)` tall) with `scrollbar-gutter: stable` and automatic scroll-to-top on tab switch so the header, tabs, and footer buttons stay pixel-locked across all 5 tabs.
- **Reorganized 5-Tab Internals:** Switched `01 Welcome` quick-steps to a balanced 2×2 grid, added in-place indexing & media capability cards to `02 First Root Folder`, balanced `03 Mode Overview` grid alignment, pinned the search/filter toolbar inside `04 Shortcuts & Controls`, and made `05 Updates` patch notes flex-fill cleanly without double scrollbars or bottom clipping.

## [v0.9.4-beta] - 2026-11-25 — Lightbox UX Polish & Cumulative Release History
### Added
- **Mouse-Wheel Filmstrip Scrolling:** Vertical and horizontal mouse-wheel scrolling now smoothly scrubs `.lb-filmstrip-track` left and right inside the Lightbox.
- **Cumulative Release History (`05 Updates`):** `updater.py` now exposes all recent GitHub releases (with local `CHANGELOG.md` offline fallback), stacking "All New" notes when upgrading across multiple patches and providing version switcher pills + **All History** view.
- **Shortcuts Cheat Sheet Sync:** Added live `Shift + Radial` morphing, Lightbox click-to-copy telemetry pills & filmstrip scroll, and Table Pile `300ms` living-video hover audio + `M` mute shortcuts to **04 Shortcuts & Controls**.

### Changed
- **Default Lightbox Info Drawer Open:** `DEFAULT_LIGHTBOX_CFG.inspectorOpen` now defaults to `true` on fresh installs so prompts, LoRAs, and telemetry pills appear immediately.
- **Zoom Reset on Fullscreen Entry:** Entering edge-to-edge Lightbox Fullscreen now resets `{ scale: 1, tx: 0, ty: 0 }` so zoomed corners never clip on fullscreen launch.

## [v0.9.3-beta] - 2026-11-23 — Folder Sidebar Unpin Hotfix
### Fixed
- Resolved a stale `ReferenceError` (`setCreatingFolderRootId` → `setCreateTarget`) when unpinning the Folder Tree from **Static** to **Hover Edge** overlay or **Hidden** mode, as well as on fresh startup in Hover mode.

## [v0.9.2-beta] - 2026-11-23 — Telemetry Pills, Live Shift Radial & Living Video Desk
### Added
- **Filename-Pure Generation Telemetry & Click-to-Copy Inspector:** Extracts Model, Seed, Sampler, Scheduler, Steps, CFG, Guidance, Denoise, Shift, VAE, CLIP Encoders, active LoRAs + strengths, and Negative Prompt from ComfyUI graphs & A1111 metadata (`meta_version: 2`), honoring `HammelartLoraLoadout` Solo/Active/Bypass and `rgthree` active slots using real asset filenames only. Click any card or pill to copy exact readouts or bare filenames (with extension), hover for clean filename tooltips, and toggle visible fields in **Lightbox FX**.
- **Live `Shift`-Morphing 8-Slice Radial Wheel:** Holding `Shift` while the radial menu is open dynamically swaps bubble labels, icons, hints, and danger styling. Collapsed redundant normal delete into a symmetrical 8-slice ring (`Purgatory` live-morphs into red `Del Now!`).
- **Push to Table Pile (`Pile & Go` / `+ To Pile`):** Throw selected renders directly to an auto-paused Table Pile desk, or `Shift+Click` (`+ To Pile`) to stage across folders before throwing the whole queue at full live scale.
- **Living-Photo Video Hover Audio & Root Disconnect Safety:** Video cards on Table Pile fade in audio after a `300ms` hover dwell (`M` to mute, auto-silenced on leave/drag/Lightbox). `Remove Root Folder` now warns about Perma-Pinned Table Pile images & videos from that root (`root_id` preserved) and prunes orphaned pins on confirm.
- **Formatted Markdown Patch Notes:** Added XSS-safe Markdown rendering inside **05 Updates**.

## [v0.9.1-beta] - 2026-11-22 — In-App Updater & Launch Showcase
### Added
- **In-App Release Tracker (`05 Updates`):** Added `backend/updater.py` and safe Git Sync / Portable ZIP updating while preserving `userdata/` and `python_runtime/`.
- **Launch Showcase:** Embedded the 60fps Atelier showcase video and portable ZIP release links in `README.md`.

## [v0.9.0-beta] - 2026-11-21 — Initial Public Beta Release
### Added
- Five spatial gallery modes (**Classic Grid**, **Conveyor Mode**, **Slideshow**, **2.5D Table Pile**, **Wall Architect**), **Folder Tree Sidebar** with Hold-to-Drag & Combos, **Purgatory Staging** with deletion FX, and hardware-accelerated **Lightbox**.

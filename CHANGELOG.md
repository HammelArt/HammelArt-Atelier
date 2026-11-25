# Changelog

All notable changes to **HammelArt Atelier** are documented in this file.

## [v0.9.6-beta] - 2026-11-25 — ComfyUI Bridge, Auto-Installer & Smart Sleeping Mode
### Added
- **Zero-Node Companion Bridge (`bridge/ComfyUI-Atelier-Bridge/`):** Bundled lightweight extension (`NODE_CLASS_MAPPINGS = {}` + `WEB_DIRECTORY = "./web"`) that loads silently across every ComfyUI tab (Browser, Portable, Desktop Electron, EzI/Tauri) — no tracker nodes required on workflows.
- **1-Click "Torpedo" Installer & Auto-Path Detection:** Probes `127.0.0.1:8188` and `127.0.0.1:8000` (plus custom URL override) via ComfyUI's own `/internal/folder_paths` & `/system_stats` endpoints to resolve exact `custom_nodes` & root folders privately, installs with one click, remembers Comfy folders even when closed, and **automatically keeps an already-installed bridge updated** during normal Atelier Git/ZIP updates.
- **Top-Right ComfyUI Pill & Sleeping Mode (`App.jsx`):** Shows live `Off` / `Detected` / `Connected` / `Sleeping` / `Setup` states; remembers your ComfyUI link cleanly (`argon_cb_comfy_cfg_v1`) and dims Comfy actions into Sleeping mode with a helpful tooltip whenever ComfyUI is closed, waking automatically when ComfyUI starts.
- **`? → 05 ComfyUI` Hub & Quick-Open Folders (`06 Updates`):** Moved release updates cleanly to `06 Updates` and added the new `05 ComfyUI` tab with bridge controls, 1-click install/update/remove, Explorer Quick-Open buttons (`Workflows`, `Output`, `Input`, `Custom Nodes`, `Models`), and a preview of upcoming Phase 2 Hammelart Studio Nodes.
- **1-Click "Open in ComfyUI" & Window Focus:** Opens any render's workflow into a **brand-new temporary ComfyUI tab** (`app.loadGraphData` / `app.loadApiJson` fallback) without overwriting your active tab, targets the active client `sid` (with headless queue fallback), and brings the ComfyUI window to foreground cleanly on Windows (`Win32`).

### Fixed
- **Unified `Save Workflow (.json)` & Legacy `NaN` Sanitization:** Fixed missing workflows on indexed renders (`GET /api/workflow`), fixed Windows `IFileSaveDialog` COM interface GUID (`0x80004002`), unified saving into one `Save Workflow (.json)` button pre-pointed at `<comfy_root>\user\default\workflows`, and sanitized non-finite floats (`NaN`/`Infinity` inside Comfy `is_changed` prompt metadata) across both Atelier and Bridge so all existing ComfyUI renders open cleanly.

## [v0.9.5-beta.1] - 2026-11-25 — Theme-Synced Welcome, Updates & Tour Accents
### Fixed
- **Dynamic Accent Colors in Welcome, Updates & Spotlight Tour:** Replaced remaining hardcoded purple hexes (`#c084fc`, `#c4b5fd`, `#e9d5ff`, `#9333ea`) across `.hm-welcome-eyebrow`, tab numbers (`01`–`05`), `Git Sync Install` / `Patch Notes` headers, `STEP 1–4` badges, `✦` callout icon, Tour button, and the Un-Blur Spotlight Tour overlay/SVG arrows with `var(--hm-accent*)` theme variables so Solar Amber, Emerald, Cyan, and Obsidian tint cleanly everywhere.

## [v0.9.5-beta] - 2026-11-25 — Smart Saved Filter Presets & Pixaroma Node Support
### Added
- **Pixaroma Node Graph & LoRA Extraction (`metadata_engine.py`, `meta_version: 3`):** Added native support for `PixaromaPrompt` (`PromptState` + wired `text_in`), `PixaromaSwitch` (`SwitchState` / `input_N`), `PixaromaPauseText` (`PauseState`), `PixaromaAIPrompt`, `PixaromaLoraLoader` (`LoraLoaderState` active `on: true` LoRAs), and `PixaromaSaveImage` — automatically re-indexing existing library caches (`meta_version: 3`).
- **Smart Filter Preset Manager (`FilterOverlayModal`):** Save, load, update, and delete dynamic filter presets directly inside **Detailed Media Filters** (`argon_cb_saved_filters_v1`, synced across Desktop & Browser sessions), complete with live rule-summary chips showing every filter inside a preset.
- **Keywords, Favorites ★ & All Folders in Detailed Filters:** Added keyword search, **Favorites Only**, and **All Folders** toggles right inside the Detailed Filters modal (synced with the top bar) so saved presets capture the complete filter recipe in one click.
- **Top-Bar 1-Click Preset Picker:** Added a Bookmark menu beside the search & filter chips showing saved presets with live dynamic match counts, 1-click toggle ON/OFF, and inline quick-saving of the active search.
- **Multi-Select Aspect & Orientation Combos:** Orientation chips (`Portrait`, `Square`, `Landscape`) are now multi-selectable and combine cleanly (`OR`) with `Target Ratios` (e.g. `Portrait + 1:1`), alongside an always-present `Included:` summary line in the Detailed Filters modal so rule selection never shifts modal height.

### Fixed
- **Model Dropdown Visibility & Full SSD Filename Search:** Raised `.hm-themed-menu` stacking (`z-index: 9750`) so the **Checkpoint / Model** dropdown renders cleanly above the Detailed Media Filters modal (even with only 1 model), displays exact bare SSD model filenames, and updated keyword search (`presets.js`) to match full `search_blob` & real SSD model/LoRA filenames.

## [v0.9.4-beta.2] - 2026-11-25 — Desktop Fullscreen Ownership & Escape Hatches
### Fixed
- **Screensaver / Nested Fullscreen Ownership Trap (`app_desktop.py`):** Preserved existing temporary fullscreen ownership (`lb_entered_fs`) when a nested fullscreen request (such as the Idle Screensaver) runs over an already-fullscreen Stage or Lightbox, and finalized UI restoration before clearing flags — preventing temporary screensaver/stage fullscreen from accidentally locking `desktop_window_state.json` into `"mode": "fullscreen"`.
- **Global `F11` & Top-Bar Exit Fullscreen Button:** Moved `F11` into an always-active global listener (works even with modals/overlays open) and added a synced top-right Fullscreen / Exit Fullscreen button next to `?` so Desktop and Browser fullscreen are always one click away.

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

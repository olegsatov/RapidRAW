# AGENTS.md

## What this repository is

A long-lived **fork** of [RapidRAW](https://github.com/CyberTimon/RapidRAW) with
substantial local changes (film simulation/grain engine, session restore, and more
to come). We keep pulling updates from the original project while preserving our
modules. Every rule below exists to keep that delta small, obvious, and mergeable —
follow them on every change, and remind the user when a requested change would
violate them.

## Remotes

- `origin` — our fork (`github.com/olegsatov/RapidRAW`), the push target.
- `upstream` — the original repo (`github.com/CyberTimon/RapidRAW`), read-only
  sync source. Never push to it.

## Syncing with upstream

- Sync often (roughly weekly, and before starting a large feature), never let the
  base go stale for months:
  ```bash
  git fetch upstream
  git rebase upstream/main   # replay our commits onto fresh upstream
  git push origin main       # force only if the fork was already shared
  ```
- Many small syncs are cheap; one giant sync is a multi-day conflict resolution.
- After syncing, verify the integration builds: `cargo check` (in `src-tauri/`)
  and `npm run build`.

## Keeping the delta mergeable

- **New features go in new files/modules.** Our film engine lives in its own
  components/shaders/utils — that is the model to copy.
- **Touch shared upstream files surgically** (`App.tsx`, `useAppNavigation.ts`,
  `adjustments.ts`, `image_processing.rs`, locale JSONs, …): minimal edits only,
  no "while I'm here" changes.
- **No cosmetic edits to upstream code** — no reformatting, renaming, reordering,
  or style "fixes" in code you didn't need to change. Every such line becomes a
  future merge/rebase conflict.
- **Small, focused commits** in the repo's existing style (lowercase, concise,
  no conventional-commit prefixes), so conflicts and cherry-picks stay readable.
- Commit or push only when the user asks; never force-push `main` without an
  explicit request.

## What's ours (delta map)

Changes concentrated in these areas are ours — resolve upstream conflicts here
with extra care, and keep this list current as features are added:

- Film look (flim) & grain: `src/components/adjustments/Grain.tsx`,
  `src/components/panel/right/FilmPanel.tsx`,
  `src/hooks/useExportSettings.ts`, grain parts of
  `src/components/panel/right/ExportPanel.tsx`, grain mip/boost parts of
  `src/hooks/useImageProcessing.ts` (incl. the `grainPreviewMode`
  crisp/balanced/accurate display switch; nearest-only grain sampler),
  `src-tauri/src/shaders/film_post.wgsl`, flim cluster of
  `src-tauri/src/shaders/shader.wgsl`, halation in
  `src-tauri/src/shaders/pre_tone.wgsl`, film/grain parts of
  `src-tauri/src/gpu_processing.rs` / `image_processing.rs` /
  `export_processing.rs` (`crystal_grain.rs`, `film_grain.rs`),
  `src-tauri/examples/crystal_grain_check.rs` /
  `grain_preview_modes.rs`. The legacy
  Krea film module (`apply_film_look`, dye-curve LUTs, stock profiles) was
  removed in 2026-07 — restore from git history if ever needed.
- LUT engine (pre/post-tonemapper timing + HDR normalization; per-LUT saved
  application params restored on select/hover and used for list thumbnails):
  `src/components/ui/LUTControl.tsx`, `src/utils/lutSettings.ts`, LUT parts of
  `src/components/adjustments/Effects.tsx` /
  `src/components/panel/right/FilmPanel.tsx` / `src/hooks/useEditorActions.ts`,
  `src-tauri/src/lut_processing.rs`, LUT fields of
  `src-tauri/src/app_settings.rs` / `image_processing.rs` /
  `gpu_processing.rs`, LUT branches of `src-tauri/src/shaders/shader.wgsl` /
  `pre_tone.wgsl`.
- Session restore (Continue Session reopens last image + editor tab; now
  auto-restores on launch unless a startup modifier key is held):
  `src/hooks/useAppInitialization.ts`, `src/hooks/useAppNavigation.ts`,
  `src/App.tsx`, `src-tauri/src/app_settings.rs`,
  `src-tauri/src/startup_modifiers.rs`, and the `LaunchPayload` /
  `frontend_ready` changes in `src-tauri/src/lib.rs`.
- Flag/rejected culling (Lightroom-style pick/reject, `Z`/`X`/`U` hotkeys,
  auto-advance toggle, library flag filter, Delete Rejected): `flag` field in
  `src-tauri/src/image_processing.rs` (`ImageMetadata`) and
  `set_flag_for_paths` in `src-tauri/src/file_management.rs`,
  `handleSetFlag` in `src/hooks/useLibraryActions.ts`, flag parts of
  `src/store/useLibraryStore.ts`, `src/hooks/useAppNavigation.ts`,
  `src/hooks/useTauriListeners.ts`, `src/hooks/useKeyboardShortcuts.ts`,
  `src/utils/keyboardUtils.ts`, `src/components/panel/BottomBar.tsx`,
  `src/components/panel/Filmstrip.tsx`,
  `src/components/panel/library/LibraryItems.tsx` / `LibraryGrid.tsx`,
  `src/hooks/useAppContextMenus.ts`, `src/hooks/useSortedLibrary.ts`,
  `src/components/panel/MainLibrary.tsx`,
  `src/components/panel/library/LibraryHeader.tsx`, culling-apply in
  `src/components/modals/AppModals.tsx`.
- Preset adjustment selection (copy/paste-style merge/replace mode + per-key
  inclusion): `src/utils/presetUtils.ts`, `src/components/ui/PasteModeSwitch.tsx`,
  `src/components/ui/AdjustmentKeyPicker.tsx`, `src/hooks/usePresets.ts`,
  preset parts of `src/components/modals/ConfigurePresetModal.tsx`,
  `src/components/modals/CopyPasteSettingsModal.tsx`,
  `src/components/presets/PresetsBrowser.tsx`,
  `src-tauri/src/file_management.rs`.
- SIGBUS-safe file reads (upstream mmap'd image files; a page-in failure on a
  flaky/external volume crashed the process — now plain reads return errors):
  `read_file_bytes` in `src-tauri/src/file_management.rs` and its call sites in
  `src-tauri/src/image_loader.rs` / `export_processing.rs` /
  `negative_conversion.rs` / `lib.rs`.
- Non-blocking folder import / SQLite catalog (background folder scanning,
  thumbnail generation, delta sync, and relocate with `file_id` cache key
  plumbing): `src-tauri/src/library_db.rs`, `src-tauri/src/folder_import.rs`,
  `src-tauri/src/app_state.rs` (folder_import_jobs),
  `src-tauri/src/file_management.rs` (file_id cache key plumbing),
  `src-tauri/src/lib.rs` (command registration + init_catalog),
  `src/store/useFolderImportStore.ts`, `src/hooks/useFolderImport.ts`
  (exports `useFolderImportMirror`), `src/hooks/useTauriListeners.ts`
  (folder-import-* events), `src/hooks/useAppNavigation.ts` (openFolder wiring; selecting a cataloged
  folder must stay catalog-only and never auto-sync),
  `src/hooks/useAppContextMenus.ts` (sync/locate),
  `src/hooks/useAppInitialization.ts` (availability checks),
  `src/components/ui/ImportJobsIndicator.tsx`, `src/i18n/locales/*.json`.
- Archive-to-folder operation (context-menu "Archive to..." that moves imported
  images from an inbox/temporary folder into a date-structured archive,
  `YYYY/YYYY-MM/YYYY-MM-DD`, preserving catalog metadata and virtual-copy
  paths): `src-tauri/src/archive_operations.rs`, `src-tauri/src/library_db.rs`
  (archive helpers), `src/hooks/useArchiveToFolder.ts`,
  `src/store/useArchiveStore.ts`, `src/components/ui/ArchiveProgressIndicator.tsx`,
  archive parts of `src/hooks/useAppContextMenus.ts` /
  `src/hooks/useTauriListeners.ts` / `src/App.tsx`, `src/i18n/locales/*.json`.
- Gesture adjustment engine + overlay (hold-to-adjust image parameters directly
  with mouse/trackpad, visual overlay for A/S/D gestures):
  `src/utils/gestureEngine.ts`, `src/utils/gestureBindings.ts`,
  `src/hooks/useGestureAdjust.ts`, `src/store/useGestureStore.ts`,
  `src/components/ui/GestureOverlay.tsx`, gesture parts of
  `src/components/panel/Editor.tsx`, `gesture.*` / `gesture.overlay.*` keys in
  `src/i18n/locales/*.json`.
- Locale strings for the above: `src/i18n/locales/*.json`.

## Catalog and disk-access rules

The SQLite catalog is the source of truth for the library. The app must not
assume that a cataloged folder's source disk is online, fast, or even reachable.
To keep the UI responsive and to avoid hammering network volumes, touching the
source filesystem is allowed only in these cases:

1. **Manual import / sync / relocate** — the user explicitly chose
   "Import", "Sync folder", or "Locate folder" from the UI or context menu.
2. **Opening an image in the editor** — the user selected an image for editing,
   so the source file must be read to produce the preview and develop the RAW.
3. **Background root-folder availability probe** — a lightweight, async
   `path_exists` check is allowed for **root-level folders only**, to update the
   online/offline badge. It must not recurse into subfolders or read directory
   contents; a root path existing on disk means the volume is reachable.

In particular, **selecting a cataloged folder in the folder tree must not scan
disk or start a background sync**. It loads the known file list from the catalog
and nothing more. Any "auto-sync on select" behavior is a bug and must be
removed.

When implementing features that need source-disk access, gate them behind an
explicit user action and keep the catalog-only path as the default.

## Process management

- **Never run broad process killers** such as `pkill -f "vite"`,
  `pkill -f "node"`, `killall node`, etc. They kill unrelated neighbouring
  servers and services on the same machine.
- If you need to stop a dev server or background process, target the specific
  PID or port from the current task/session (e.g. `lsof -i :<port>` or the PID
  captured when the process was started).
- **Never start or restart the application** (`npm run tauri dev`, `npm run dev`,
  `cargo run`, etc.) on your own initiative. The user runs and restarts the app
  manually. Only start or stop processes when explicitly asked.

## Interaction rules

- **Direct questions are the highest-priority instruction.** When the user asks a
  direct question, stop all other work and answer it clearly and concisely first.
  Do not proceed with code changes, investigation, or tooling until the question
  is answered. After answering, wait for the next instruction.
- When the user asks a direct question, answer that question clearly and
  concisely, then stop and wait for the next instruction. Do not launch
  into unrelated investigation, tooling, or fixes unless explicitly asked.

## Verification

- `npm run build` — frontend bundle (the real gate; `tsc` has a pre-existing
  red baseline in this repo, so judge typecheck only by _new_ errors).
- `cargo check` in `src-tauri/` — Rust side.
- `npx prettier --check <files>` — formatting (the repo is Prettier-clean;
  eslint has a pre-existing `no-explicit-any` baseline, don't add new ones).

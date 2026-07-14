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

- Film simulation & grain: `src/components/adjustments/Film.tsx`,
  `src/components/adjustments/Grain.tsx`,
  `src/components/panel/right/FilmPanel.tsx`, `src/utils/filmProfiles.ts`,
  `src/hooks/useExportSettings.ts`, grain parts of
  `src/components/panel/right/ExportPanel.tsx`,
  `src-tauri/src/shaders/film_post.wgsl`, film/grain parts of
  `src-tauri/src/gpu_processing.rs` / `image_processing.rs` /
  `export_processing.rs` (`crystal_grain.rs`, `film_grain.rs`).
- Session restore (Continue Session reopens last image + editor tab):
  `src/hooks/useAppInitialization.ts`, `src/hooks/useAppNavigation.ts`,
  `src-tauri/src/app_settings.rs`.
- Preset adjustment selection (copy/paste-style merge/replace mode + per-key
  inclusion): `src/utils/presetUtils.ts`, `src/components/ui/PasteModeSwitch.tsx`,
  `src/components/ui/AdjustmentKeyPicker.tsx`, `src/hooks/usePresets.ts`,
  preset parts of `src/components/modals/ConfigurePresetModal.tsx`,
  `src/components/modals/CopyPasteSettingsModal.tsx`,
  `src/components/presets/PresetsBrowser.tsx`,
  `src-tauri/src/file_management.rs`.
- Locale strings for the above: `src/i18n/locales/*.json`.

## Verification

- `npm run build` — frontend bundle (the real gate; `tsc` has a pre-existing
  red baseline in this repo, so judge typecheck only by _new_ errors).
- `cargo check` in `src-tauri/` — Rust side.
- `npx prettier --check <files>` — formatting (the repo is Prettier-clean;
  eslint has a pre-existing `no-explicit-any` baseline, don't add new ones).

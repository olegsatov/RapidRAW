# Grain block: Pierre/IPOL mode toggle, section visibility, export linkage

Date: 2026-07-13. Status: approved by user, ready for implementation plan.

## Problem

The Grain section in the Film tab (`src/components/adjustments/Grain.tsx`) renders
both physical grain engines stacked: the IPOL 2017 card and the Pierre crystal
card. This clutters the panel. Additionally the export panel's grain option
(`fast`/`pierre`/`ipol`) is completely independent of the editor, so the user
configures grain twice.

## Goals

1. A `Pierre | IPOL` mode toggle in the Grain block; only the selected engine's
   card is shown.
2. The selected mode is persisted per image (sidecar) and drives the export
   panel's default grain mode.
3. An explicit on/off (eye) toggle on the Grain section; when grain is off for
   the image, the export panel's grain option is disabled.
4. In IPOL mode the main canvas shows no realtime grain (honest WYSIWYG: IPOL
   is CPU-only and has no GPU preview).

## Non-goals

- Unifying the two engines' parameters or the native RapidRAW grain (stays in
  the Effects section).
- Changing the offline "render to file" buttons' behavior.
- i18n beyond `en.json` and `ru.json` (other locales fall back to en).
- Removing the export panel's manual mode override (fast/pierre/ipol stays
  selectable).

## Data model (`src/utils/adjustments.ts`)

- New adjustment key `grainEngine: 'pierre' | 'ipol'`, default `'pierre'`:
  - add to the `FilmAdjustment` enum,
  - add to the `Adjustments` interface,
  - add to `INITIAL_ADJUSTMENTS`,
  - add to the sidecar load merge (the block around `adjustments.ts:990`),
  - add to the film copy/paste group so it travels with the other film keys.
- `SectionVisibility` gains `grain: boolean` (interface at `adjustments.ts:470`
  plus the initial value). Default `true`: old sidecars without the key keep
  today's behavior (grain section visible), matching the Rust
  `unwrap_or(true)` fallback.

## Editor UI

### `src/components/panel/right/FilmPanel.tsx`

- The Grain `CollapsibleSection` gets `canToggleVisibility` and is wired to
  `sectionVisibility.grain` via the existing `handleToggleVisibility` /
  `sectionVisibility` plumbing (same pattern as the Film and B&W sections).

### `src/components/adjustments/Grain.tsx`

- Header row: a segmented control `Pierre | IPOL` bound to `grainEngine`,
  styled like the Film-tab header toggle (`clsx`, accent background on the
  active segment).
- The **Amount** slider (existing `crystalGrainAmount`, 0–100) moves out of the
  Pierre card into the shared header area under the mode toggle. It is the
  grain strength for *both* engines at export time (the Rust CPU path already
  mixes by it for Pierre and IPOL alike); in Pierre mode it additionally
  drives the realtime canvas preview.
- Only the selected engine's card renders (params sliders, mono switch,
  Preview/Render buttons, progress/preview image, description). Hidden
  engine's adjustments are never written.
- The debounced `bake_crystal_grain_field` effect fires only when
  `grainEngine === 'pierre'` and `sectionVisibility.grain` is true (avoids
  pointless bakes).
- The IPOL card shows a hint that there is no realtime preview and grain is
  applied at export.
- `ipolMono` stays component-local state (unchanged); `crystalGrainMono` stays
  persisted (unchanged).

## Rust gating

### `src-tauri/src/image_processing.rs` (`get_global_adjustments_from_json`)

- Add `"grain"` to the flim-panel gating list (currently
  `matches!(section, "film" | "blackAndWhite")`): with the Film panel off,
  grain is off.
- Read `grainEngine` (string, default `"pierre"`).
- `crystal_grain_amount`: `get_val("grain", "crystalGrainAmount", 100.0, None)`,
  and forced to `0.0` when `grainEngine == "ipol"` (no GPU grain on the canvas
  in IPOL mode).
- `crystal_grain_mono`: `get_val("grain", "crystalGrainMono", 1.0, Some(0.0))`.
- Extend the `film_tab_modules_follow_panel_toggle` test with the grain
  section, and add a test that `grainEngine: "ipol"` zeroes
  `crystal_grain_amount`.

### `src-tauri/src/export_processing.rs`

- Fast path (`ExportGrainMode::Fast`, around `export_processing.rs:358-372`):
  it currently keys off `all_adjustments.global.crystal_grain_amount`, which
  will now be 0 in IPOL engine mode. Change it to read the raw
  `crystalGrainAmount` from `js_adjustments`, gated only by grain section
  visibility, so an explicit `fast` choice keeps working regardless of the
  editor engine mode.
- CPU path (`apply_export_grain_cpu`, `export_processing.rs:644`): add a
  defensive check — `sectionVisibility.grain == false` → return the image
  unchanged. (The UI disables the option anyway; this guards preset/manual
  calls.)

No changes needed in `gpu_processing.rs`: the realtime grain reads
`crystal_grain_amount` from the global adjustments, which the gating above
already zeroes.

## Export panel (`src/components/panel/right/ExportPanel.tsx`, `src/hooks/useExportSettings.ts`)

- Grain is available only when `adjustments.toneMapper === 'flim'` **and**
  `adjustments.sectionVisibility.grain` is true. Otherwise the "Add grain"
  switch is disabled (with a short hint why) and renders unchecked.
- `grainMode` syncs from the image's `grainEngine` when the selected image
  changes (`useEffect` on `selectedImage?.path` / `adjustments.grainEngine`).
  After the sync the user may still override via the dropdown; the override
  holds until the image changes.

## i18n

- Reuse `export.grain.modes.pierre` / `export.grain.modes.ipol` for the
  segmented control labels where practical.
- New keys (en + ru): IPOL no-preview hint in the Grain panel; disabled-grain
  hint in the export panel.

## Files touched

- `src/utils/adjustments.ts` — `grainEngine` key, `SectionVisibility.grain`,
  defaults, load merge, copy/paste group.
- `src/components/adjustments/Grain.tsx` — mode toggle, shared Amount,
  conditional cards, gated bake, IPOL hint.
- `src/components/panel/right/FilmPanel.tsx` — grain section visibility toggle.
- `src/components/panel/right/ExportPanel.tsx`,
  `src/hooks/useExportSettings.ts` — disabled state, mode sync.
- `src-tauri/src/image_processing.rs` — gating + tests.
- `src-tauri/src/export_processing.rs` — fast-path raw read, CPU visibility
  check.
- `src/i18n/locales/en.json`, `src/i18n/locales/ru.json`.

All of these are already listed in the AGENTS.md delta map (film parts of the
Rust files, FilmPanel/Grain, locale JSONs) except `ExportPanel.tsx` /
`useExportSettings.ts`, which already carry our grain-mode export feature.

## Verification

- `npm run build` (the real gate; ignore pre-existing `tsc` baseline errors).
- `cargo check` and `cargo test` in `src-tauri/` (gating tests).
- `npx prettier --check` on touched files.
- Manual smoke: toggle modes per image, verify sidecar persistence, verify
  export option disabled with grain section off, verify export mode follows
  the editor engine on image change, verify canvas shows no grain in IPOL mode.

## Alternatives rejected

- Session-only mode state — rejected; mode must persist per image and drive
  export defaults.
- `Amount = 0` as the "grain off" state — rejected in favor of an explicit
  section visibility toggle consistent with Film/B&W.
- Crystal grain on the canvas as a proxy preview in IPOL mode — rejected; the
  preview must match what export produces.

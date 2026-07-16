# Per-LUT Parameter Settings — Design

Status: implemented
Date: 2026-07-16

## Problem

The LUT application controls (`lutIntensity`, `lutTiming`, `lutInputRange`,
`lutInputOffset`) live only in the per-image `Adjustments`. They are not tied to
the LUT file they were dialed in for: switching LUTs keeps whatever values the
previous LUT (or image sidecar) happened to have, and the LUT list thumbnails
are always rendered with hardcoded `intensity=100, timing='after'` — which
misrepresents LUTs meant to be used in pre-tonemapper ("before") mode with a
custom input range/offset.

## Goal

Bind the LUT application parameters to the LUT file:

1. Selecting a LUT loads its saved parameters (or factory defaults) into the
   image adjustments — the editor preview uses them immediately.
2. Changing any LUT parameter while a LUT is selected auto-saves it for that
   LUT file (global, across images and sessions).
3. LUT list thumbnails render with the per-LUT saved parameters.
4. Hover preview in the LUT list uses the per-LUT saved parameters.

Non-goals: per-LUT settings are not per-image overrides (the image sidecar
still stores the concrete values applied to that image, as today); no UI for
managing/resetting stored entries; `lutShoulder` stays out of scope (no UI).

## Data model

Settings live in the app-level `settings.json` (`AppSettings`), keyed by the
LUT file path — the same identity used by `lut_cache` and `LutEntry`. Follows
the existing `keybinds` / `folder_icons` map-field precedent.

Rust (`src-tauri/src/app_settings.rs`):

```rust
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LutFileSettings {
    #[serde(default)] pub intensity: Option<i32>,      // 0..=100, default 100
    #[serde(default)] pub timing: Option<String>,      // "after" | "before", default "after"
    #[serde(default)] pub input_range: Option<f32>,    // 0..=32, default 6.0
    #[serde(default)] pub input_offset: Option<f32>,   // -16..=16, default 0.0
}

// in AppSettings:
#[serde(default)]
pub lut_settings: HashMap<String, LutFileSettings>,
```

TS (`src/components/ui/AppProperties.tsx`):

```ts
export interface LutFileSettings {
  intensity?: number;
  timing?: 'after' | 'before';
  inputRange?: number;
  inputOffset?: number;
}
// in AppSettings:
lutSettings?: Record<string, LutFileSettings>;
```

`lutNormalizeMode` is **not** stored: it is derived from `timing`
(`before → 'hdr'`, `after → 'clamp'`), exactly as the existing UI handlers do.

## Frontend

### New module `src/utils/lutSettings.ts`

- `DEFAULT_LUT_PARAMS` — resolved from `INITIAL_ADJUSTMENTS` (single source of
  truth for defaults).
- `resolveLutParams(appSettings, path)` — stored entry merged over defaults.
- `lutParamsToAdjustments(params)` — maps to the `Adjustments` partial
  (`lutIntensity`, `lutTiming`, derived `lutNormalizeMode`, `lutInputRange`,
  `lutInputOffset`).
- `saveLutParams(path | null, patch)` — no-op when no LUT is selected; merges
  `patch` into `appSettings.lutSettings[path]`, updates the zustand store
  immediately, persists `save_settings` debounced (~400 ms, slider drags emit
  many events).

### Selection & hover — `src/hooks/useEditorActions.ts`

- `handleLutSelect`: after `load_and_parse_lut` succeeds, resolve params for
  the path and spread `lutParamsToAdjustments(...)` into the new adjustments
  (saved values, or defaults for an unconfigured LUT — switching LUTs no longer
  inherits the previous LUT's values).
- `setLutPreviewOverride`: override uses the hovered LUT's resolved params
  instead of the image's current `lutIntensity`.

### Slider handlers — `Effects.tsx`, `FilmPanel.tsx`

Each of the four change handlers additionally calls
`saveLutParams(adjustments.lutPath, { <changed key> })`. `onClear` does not
touch stored settings (clearing an image's LUT must not forget the file's
params).

### Thumbnails — `src/components/ui/LUTControl.tsx`

- Subscribes to `appSettings?.lutSettings`.
- `generate_lut_previews` gains a `lutParams` argument:
  `Record<path, LutFileSettings>` for the paths being (re)generated.
- Preview cache becomes per-path: `Map<path, cacheKey>` where
  `cacheKey = selectedImagePath | JSON.stringify(storedEntry)`. Only entries
  whose key changed are regenerated; results merge into `previews` state.
  Import/remove keep clearing the whole cache (correct: full regen).
- Regeneration is debounced (~250 ms) so slider drags re-render the affected
  swatch only after settling.

## Backend — `src-tauri/src/lut_processing.rs`

`generate_lut_previews(lut_paths, size, lut_params: Option<HashMap<String,
LutFileSettings>>, state, app_handle)`:

- The adjustments JSON is now built **per path** inside the loop:
  `{"lutPath": "preview", "lutIntensity", "lutTiming", "lutInputRange",
"lutInputOffset", "sectionVisibility": {"effects": true}}` — values from the
  params map, falling back to the current hardcoded defaults when the path has
  no stored entry.
- `get_all_adjustments_from_json` already forces HDR normalize mode when
  `lutTiming == "before"` (`image_processing.rs:2735`), so pre-tonemapper
  swatches exercise the HDR LUT path with the stored range/offset; no shader
  or uniform changes.
- Missing `sectionVisibility.lut` defaults to visible (`is_visible` →
  `unwrap_or(true)`), so the flim-tonemapper gating needs no extra key.

## Interaction with existing behavior

- Editor preview/export are untouched: they render the image's `adjustments`,
  which now simply receive better values at LUT-selection time.
- Per-image sidecars keep storing concrete LUT values; opening an image does
  not re-read per-LUT settings (no retroactive changes to saved edits).
- Stale entries for deleted LUT files are harmless; `remove_lut` clears the
  frontend thumbnail cache, and the entry may optionally be dropped later.

## Verification

- `cargo check` in `src-tauri/`
- `npm run build`
- `npx prettier --check` on touched files
- Manual: select LUT → change intensity/timing/range → reselect another LUT →
  reselect first → params restored; thumbnail reflects stored params; restart
  app → settings.json round-trip.

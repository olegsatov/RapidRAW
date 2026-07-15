# LUT timing and HDR normalization

Date: 2026-07-15. Status: pending user review.

## Problem

The current LUT tool always applies the selected 3D LUT **after** the tonemapper,
on a display-referred sRGB signal (`shader.wgsl:1596`). This is correct for
print/display creative LUTs, but breaks video/LOG LUTs that expect a scene-referred
or log-encoded HDR input. The user sees crushed shadows and blown highlights.

We want an experimental switch that lets the LUT be applied **before** the
tonemapper, plus manual controls for mapping HDR-linear data into the LUT's
`[0..1]` input domain.

## Goals

1. Add a per-image toggle in the LUT panel:
   - **After tone mapper** (current behaviour, default).
   - **Before tone mapper** (LUT samples HDR-linear data before tonemapping).
2. Add HDR input normalization options, active only when LUT is applied before
   the tonemapper:
   - **Clamp** — `clamp(color, 0, 1)`.
   - **Linear** — `color * 2^offset / 2^range`, optional shoulder, then clamp.
   - **Log₂** — `log2(color * 2^offset) / range`, optional shoulder, then clamp.
3. Expose manual sliders for the normalization parameters:
   - **Input range** — stops above 1.0, range `0..32`, default `6`.
   - **Input offset** — exposure shift in stops, range `−16..+16`, default `0`.
   - **Shoulder** — highlight compression strength, range `0..400`, default `0` (stored divided by `100` so the usable factor is `0..4`).
4. Keep the existing post-tone LUT path untouched when the toggle is off.
5. Old sidecars without the new keys keep their current look.

## Non-goals

- Applying LUT before the film-look / curves / grain stages when in "after" mode.
- Auto-detecting LUT input space from the `.cube` / `.3dl` header.
- Per-mask LUT timing (LUT stays a global effect).
- i18n beyond `en.json` and `ru.json`.

## Data model (`src/utils/adjustments.ts`)

New adjustment keys:

- `lutTiming`: `'after' | 'before'`, default `'after'`.
- `lutNormalizeMode`: `'clamp' | 'linear' | 'log'`, default `'clamp'`.
- `lutInputRange`: number, default `6`, range `0..8`.
- `lutInputOffset`: number, default `0`, range `−4..+4`.
- `lutShoulder`: number, default `0`, range `0..100`.

Changes:

- Add `LutTiming`, `LutNormalizeMode`, `LutInputRange`, `LutInputOffset`,
  `LutShoulder` to the `Effect` enum.
- Add fields to the `Adjustments` interface.
- Add defaults to `INITIAL_ADJUSTMENTS`.
- Extend the LUT group in `ADJUSTMENT_GROUPS.effects.lut` with the new keys so
  copy/paste and presets carry them.
- Add the new keys to `ADJUSTMENT_SECTIONS.effects`.
- The existing spread over `INITIAL_ADJUSTMENTS` in `normalizeLoadedAdjustments`
  already backfills missing keys.

## Editor UI (`src/components/ui/LUTControl.tsx`)

Below the existing **Intensity** slider, show a settings block only when a LUT
is selected:

- **Segmented toggle** «After tone mapper / Before tone mapper» bound to
  `lutTiming`.
- **Dropdown** «Input normalization» bound to `lutNormalizeMode`:
  Clamp / Linear / Log.
- **Slider** «Input range» (stops, 0–8), active for Linear and Log.
- **Slider** «Input offset» (stops, −4–+4), active for Linear and Log.
- **Slider** «Shoulder» (0–100), active for Linear and Log.

When Clamp is selected, the three sliders are disabled. Defaults reset to the
values above when a new LUT is selected.

## Rust gating (`src-tauri/src/image_processing.rs`)

Add to `GpuGlobalAdjustments`:

```rust
pub lut_timing: u32,
pub lut_normalize_mode: u32,
pub lut_input_range: f32,
pub lut_input_offset: f32,
pub lut_shoulder: f32,
```

In `get_all_adjustments_from_json` read from the JSON adjustments:

```rust
lut_timing: match js["lutTiming"].as_str() { Some("before") => 1, _ => 0 },
lut_normalize_mode: match js["lutNormalizeMode"].as_str() {
    Some("linear") => 1,
    Some("log") => 2,
    _ => 0,
},
lut_input_range: js["lutInputRange"].as_f64().unwrap_or(6.0) as f32,
lut_input_offset: js["lutInputOffset"].as_f64().unwrap_or(0.0) as f32,
lut_shoulder: js["lutShoulder"].as_f64().unwrap_or(0.0) as f32 / 100.0,
```

## WGSL (`src-tauri/src/shaders/shader.wgsl`)

Add to the global adjustments struct:

```wgsl
lut_timing: u32,
lut_normalize_mode: u32,
lut_input_range: f32,
lut_input_offset: f32,
lut_shoulder: f32,
```

Add helper:

```wgsl
fn prepare_lut_input(hdr: vec3<f32>) -> vec3<f32> {
    if (adjustments.global.lut_normalize_mode == 0u) {
        return clamp(hdr, vec3(0.0), vec3(1.0));
    }

    let offset_lin = pow(2.0, adjustments.global.lut_input_offset);
    let range_lin  = pow(2.0, adjustments.global.lut_input_range);
    var t = hdr * offset_lin / range_lin;

    if (adjustments.global.lut_shoulder > 0.0) {
        let s = adjustments.global.lut_shoulder;
        t = t * (1.0 + s) / (1.0 + s * t);
    }

    if (adjustments.global.lut_normalize_mode == 1u) {
        return clamp(t, vec3(0.0), vec3(1.0));
    }

    // log mode
    return clamp(log2(max(t, vec3(1e-6))) / adjustments.global.lut_input_range + vec3(1.0),
                 vec3(0.0), vec3(1.0));
}
```

In the main function:

- If `lut_timing == 0u`, keep the current flow (tonemap → film look → curves →
  LUT at `shader.wgsl:1596`).
- If `lut_timing == 1u`, apply LUT **before** tonemapping:

  ```wgsl
  var lut_applied_linear = composite_rgb_linear;
  if (adjustments.global.has_lut == 1u) {
      let lut_in = prepare_lut_input(composite_rgb_linear);
      let lut_color = sample_lut_tetrahedral(lut_in);
      lut_applied_linear = mix(composite_rgb_linear, lut_color,
                               adjustments.global.lut_intensity);
  }
  ```

  Then replace `composite_rgb_linear` with `lut_applied_linear` in the
  tonemapper block (AGX / FLiM / basic).

## Export (`src-tauri/src/export_processing.rs`)

Export reuses `get_all_adjustments_from_json`, so the new fields are forwarded
automatically. No extra export code is required beyond verifying that the shader
logic applies the LUT before the tonemapper in the export pipeline as well.

## LUT previews (`src-tauri/src/lut_processing.rs`)

`generate_lut_previews` builds a minimal adjustments JSON without the new keys,
so previews continue to render with the default «after tone mapper» path. This
is intentional: swatches are only for identifying the LUT, not for previewing
the HDR-normalized variant.

## i18n

New keys under `ui.lut`:

- `timing` — "LUT timing" / "Применение LUT"
- `timingAfter` — "After tone mapper" / "После тонмаппера"
- `timingBefore` — "Before tone mapper" / "До тонмаппера"
- `normalizeMode` — "Input normalization" / "Нормализация входа"
- `normalizeClamp` — "Clamp" / "Клип"
- `normalizeLinear` — "Linear" / "Линейная"
- `normalizeLog` — "Log" / "Логарифмическая"
- `inputRange` — "Input range" / "Диапазон входа"
- `inputOffset` — "Input offset" / "Смещение входа"
- `shoulder` — "Shoulder" / "Плечо"

Add to `src/i18n/locales/en.json` and `src/i18n/locales/ru.json`.

## Files touched

- `src/utils/adjustments.ts` — new keys, interface, defaults, groups, sections.
- `src/components/ui/LUTControl.tsx` — timing toggle, normalization dropdown,
  range/offset/shoulder sliders.
- `src/i18n/locales/en.json`, `src/i18n/locales/ru.json` — new labels.
- `src-tauri/src/image_processing.rs` — `GpuGlobalAdjustments` fields and JSON
  parsing.
- `src-tauri/src/shaders/shader.wgsl` — uniforms, `prepare_lut_input`,
  conditional LUT application before tonemapper.
- `src-tauri/src/export_processing.rs` — verify no extra forwarding is needed.

## Verification

- `npm run build` (the real gate; ignore pre-existing `tsc` baseline errors).
- `cargo check` in `src-tauri/`.
- `npx prettier --check` on touched files.
- Manual smoke test:
  1. Load a RAW, apply a LOG LUT with default settings → still looks wrong.
  2. Switch to «Before tone mapper», Linear, range ~6–8, offset ~0 → LUT should
     produce a more reasonable image.
  3. Toggle back to «After tone mapper» → identical to the original look.
  4. Save/reopen the project — settings restore.

## Alternatives rejected

- Separate pre-tone LUT compute pass/pipeline — rejected; adds texture, bind
  group and dispatch overhead for a purely conditional code path.
- Two-pass LUT (pre-tone LUT pass + post-tone pass) — rejected; more state to
  manage without a visual benefit over the single-pass conditional approach.
- Auto-normalization based on image max luminance — rejected; unpredictable for
  the user and would hide what the LUT actually expects.

# LUT timing and HDR normalization

Date: 2026-07-15. Status: implemented.

## Problem

The current LUT tool always applies the selected 3D LUT **after** the tonemapper,
on a display-referred sRGB signal (`shader.wgsl:1596`). This is correct for
print/display creative LUTs, but breaks video/LOG LUTs that expect a scene-referred
or log-encoded HDR input. The user sees crushed shadows and blown highlights.

We want an experimental switch that lets the LUT be applied **before** the
tonemapper, plus manual controls for mapping HDR-linear data into the LUT's
`[0..1]` input domain. We also want an **HDR extrapolate** mode that reinterprets
a display-referred LUT on a log-symmetric HDR domain so it can be sampled with
HDR-linear input and produce HDR-linear output without clipping the signal.

## Goals

1. Add a per-image toggle in the LUT panel:
   - **After tone mapper** (current behaviour, default).
   - **Before tone mapper** (LUT samples HDR-linear data before tonemapping).
2. Add HDR input normalization options, active only when LUT is applied before
   the tonemapper:
   - **Clamp** — `clamp(color, 0, 1)`.
   - **Linear** — `color * 2^offset / 2^range`, optional shoulder, then clamp.
   - **Log₂** — `log2(color * 2^offset) / range`, optional shoulder, then clamp.
   - **HDR extrapolate** — resample the original display LUT into an HDR-linear
     LUT at load time. The LUT is reinterpreted on a log-symmetric domain
     (±16 stops, 32 stops total) so it can be sampled directly with HDR-linear
     input and produce HDR-linear output, preserving the signal volume.
3. Expose manual sliders for the normalization parameters:
   - **Input range** — stops above 1.0, range `0..32`, default `6`.
   - **Input offset** — exposure shift in stops, range `−16..+16`, default `0`.
   - **Shoulder** — highlight compression strength, range `0..400`, default `0`
     (stored divided by `100` so the usable factor is `0..4`). Disabled in HDR
     extrapolate mode because the LUT itself already operates on a wide
     scene-linear domain.
4. Keep the existing post-tone LUT path untouched when the toggle is off.
5. Old sidecars without the new keys keep their current look.

## Non-goals

- Applying LUT before the film-look / curves / grain stages when in "after" mode.
- Auto-detecting LUT input space from the `.cube` / `.3dl` header.
- Per-mask LUT timing (LUT stays a global effect).
- i18n beyond `en.json` and `ru.json`.
- Guaranteeing a mathematically perfect extrapolation of the LUT beyond its
  original `[0..1]` domain. HDR extrapolate is explicitly experimental: it
  stretches the same data over a wider domain, which can produce unpredictable
  colours for extreme inputs.

## Data model (`src/utils/adjustments.ts`)

New adjustment keys:

- `lutTiming`: `'after' | 'before'`, default `'after'`.
- `lutNormalizeMode`: `'clamp' | 'linear' | 'log' | 'hdr'`, default `'clamp'`.
- `lutInputRange`: number, default `6`, range `0..32`.
- `lutInputOffset`: number, default `0`, range `−16..+16`.
- `lutShoulder`: number, default `0`, range `0..400`.

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

- **Dropdown** «After tone mapper / Before tone mapper» bound to `lutTiming`.
- **Dropdown** «Input normalization» bound to `lutNormalizeMode`:
  Clamp / Linear / Log / HDR extrapolate.
- **Slider** «Input range» (stops, 0–32), active for Linear, Log and HDR.
- **Slider** «Input offset» (stops, −16–+16), active for Linear, Log and HDR.
- **Slider** «Shoulder» (0–400), active for Linear and Log. Disabled for Clamp
  and HDR extrapolate.

When Clamp is selected, the range/offset/shoulder sliders are disabled. In HDR
extrapolate mode, range/offset still let the user choose a sub-range inside the
LUT's ±16 stop domain, but shoulder is disabled.

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
    Some("hdr") => 3,
    _ => 0,
},
lut_input_range: js["lutInputRange"].as_f64().unwrap_or(6.0) as f32,
lut_input_offset: js["lutInputOffset"].as_f64().unwrap_or(0.0) as f32,
lut_shoulder: js["lutShoulder"].as_f64().unwrap_or(0.0) as f32 / 100.0,
```

## HDR LUT resampling (`src-tauri/src/lut_processing.rs`)

At load time, after parsing the original `[0..1]^3` LUT, build a second HDR
version of the table:

- Domain: log-symmetric, `[-16..+16]` stops, total range `32` stops.
- Size: `65^3` (configurable constant `HDR_LUT_SIZE`).
- For each output cell `(r, g, b)` in the HDR table, compute the corresponding
  normalized coordinates in the original LUT as if the output value were a
  display-referred `log2(value) / 32 + 0.5`. Then trilinearly sample the
  original LUT and convert the sampled display value back to scene-linear with
  `2^((sampled - 0.5) * 32)`.

The result is stored alongside the original LUT as `Lut::hdr_size` and
`Lut::hdr_data`. The original display LUT is preserved for the post-tone path.

## WGSL (`src-tauri/src/shaders/shader.wgsl`)

Add to the global adjustments struct:

```wgsl
lut_timing: u32,
lut_normalize_mode: u32,
lut_input_range: f32,
lut_input_offset: f32,
lut_shoulder: f32,
```

Add helper for clamp/linear/log normalization:

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

Add helper for HDR-extrapolated LUT sampling:

```wgsl
const HDR_LUT_TOTAL_RANGE: f32 = 32.0;

fn sample_hdr_lut_tetrahedral(hdr: vec3<f32>) -> vec3<f32> {
    let range = max(adjustments.global.lut_input_range, 0.5);
    let scale = HDR_LUT_TOTAL_RANGE / range;

    var log_rgb = log2(max(hdr, vec3(1e-6)));
    log_rgb += vec3(adjustments.global.lut_input_offset);
    log_rgb *= vec3(scale);

    let uvw = clamp(log_rgb / HDR_LUT_TOTAL_RANGE + vec3(0.5), vec3(0.0), vec3(1.0));
    let lut_hdr = sample_lut_tetrahedral(uvw);

    var log_out = log2(max(lut_hdr, vec3(1e-6)));
    log_out /= vec3(scale);
    return pow(vec3(2.0), log_out);
}
```

The `range` and `offset` sliders let the user zoom/pan inside the full ±16 stop
HDR LUT domain. The LUT output is still scene-linear HDR and is fed straight into
the tonemapper.

In the main function:

- If `lut_timing == 0u`, keep the current flow (tonemap → film look → curves →
  LUT at `shader.wgsl:1596`).
- If `lut_timing == 1u`, apply LUT **before** tonemapping:

  ```wgsl
  if (adjustments.global.lut_timing == 1u && adjustments.global.has_lut == 1u) {
      var lut_color: vec3<f32>;
      if (adjustments.global.lut_normalize_mode == 3u) {
          lut_color = sample_hdr_lut_tetrahedral(composite_rgb_linear);
      } else {
          let lut_in = prepare_lut_input(composite_rgb_linear);
          lut_color = sample_lut_tetrahedral(lut_in);
      }
      composite_rgb_linear = mix(composite_rgb_linear, lut_color,
                                 adjustments.global.lut_intensity);
  }
  ```

  Then replace `composite_rgb_linear` with the mixed result in the tonemapper
  block (AGX / FLiM / basic).

## GPU pipeline (`src-tauri/src/gpu_processing.rs`)

When binding the LUT texture, choose the HDR resampled data if the current
normalization mode is HDR:

```rust
let use_hdr = request.adjustments.global.lut_normalize_mode == 3;
let (lut_data, size) = if use_hdr && !lut_arc.hdr_data.is_empty() {
    (&lut_arc.hdr_data, lut_arc.hdr_size)
} else {
    (&lut_arc.data, lut_arc.size)
};
```

This keeps the existing texture/sampler plumbing unchanged; only the uploaded
payload differs.

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
- `normalizeHdr` — "HDR extrapolate" / "HDR экстраполяция"
- `inputRange` — "Input range" / "Диапазон входа"
- `inputOffset` — "Input offset" / "Смещение входа"
- `shoulder` — "Shoulder" / "Плечо"

Add to `src/i18n/locales/en.json` and `src/i18n/locales/ru.json`.

## Files touched

- `src/utils/adjustments.ts` — new keys, interface, defaults, groups, sections.
- `src/components/ui/LUTControl.tsx` — timing toggle, normalization dropdown,
  range/offset/shoulder sliders.
- `src/components/adjustments/Effects.tsx` — wire new props from adjustments.
- `src/components/panel/right/FilmPanel.tsx` — type update for `hdr` mode.
- `src/i18n/locales/en.json`, `src/i18n/locales/ru.json` — new labels.
- `src-tauri/src/image_processing.rs` — `GpuGlobalAdjustments` fields and JSON
  parsing.
- `src-tauri/src/shaders/shader.wgsl` — uniforms, `prepare_lut_input`,
  `sample_hdr_lut_tetrahedral`, conditional LUT application before tonemapper.
- `src-tauri/src/lut_processing.rs` — HDR LUT resampling at load time.
- `src-tauri/src/gpu_processing.rs` — HDR LUT texture selection.
- `src-tauri/src/export_processing.rs` — verify no extra forwarding is needed.

## Verification

- `npm run build` (the real gate; ignore pre-existing `tsc` baseline errors).
- `cargo check` in `src-tauri/`.
- `npx prettier --check` on touched files.
- Rust unit tests: `cargo test global_adjustments_layout_matches_wgsl`,
  `main_shader_validates`, `aux_shaders_validate`.
- Manual smoke test:
  1. Load a RAW, apply a LOG LUT with default settings → still looks wrong.
  2. Switch to «Before tone mapper», Linear, range ~6–8, offset ~0 → LUT should
     produce a more reasonable image.
  3. Switch to «HDR extrapolate», range ~6–8, offset ~0 → LUT maps a wide
     scene-linear range and the result stays HDR until the tonemapper.
  4. Toggle back to «After tone mapper» → identical to the original look.
  5. Save/reopen the project — settings restore.

## Alternatives rejected

- Separate pre-tone LUT compute pass/pipeline — rejected; adds texture, bind
  group and dispatch overhead for a purely conditional code path.
- Two-pass LUT (pre-tone LUT pass + post-tone pass) — rejected; more state to
  manage without a visual benefit over the single-pass conditional approach.
- Auto-normalization based on image max luminance — rejected; unpredictable for
  the user and would hide what the LUT actually expects.
- Mathematically inverting the display LUT to recover HDR — rejected because a
  display LUT is not guaranteed to be invertible, and the goal is to apply the
  same creative transform on a wider domain, not to undo it.

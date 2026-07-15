# LUT timing and HDR normalization implementation plan

> **For agentic workers:** This plan has been executed. The implementation is
> complete and the file is kept as a record of what was built.

**Goal:** Add a per-image LUT timing switch and HDR input normalization controls
so LUTs can be sampled before the tonemapper, plus an experimental
**HDR extrapolate** mode that resamples the display LUT onto a log-symmetric
HDR domain and applies it before tonemapping without clipping the signal.

**Architecture:** Extend the shared `Adjustments` model and the Rust
`GlobalAdjustments` mirror with five new fields. In the existing WGSL shader,
branch on `lut_timing` to either keep the current post-tone LUT application or
apply LUT to HDR-linear data before tonemapping. Add `prepare_lut_input` for
clamp/linear/log normalization plus shoulder, and `sample_hdr_lut_tetrahedral`
for HDR-extrapolated LUT sampling. Build the HDR LUT table in
`lut_processing.rs` at load time and bind the HDR data in `gpu_processing.rs`
when requested. Surface the controls in `LUTControl`.

**Tech stack:** TypeScript/React, Tailwind, WGSL, Rust (`bytemuck`/`wgpu`),
Tauri commands.

---

## File map

| File                                       | Responsibility                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `src/utils/adjustments.ts`                 | New adjustment keys, interface, defaults, copy/paste groups, section visibility.     |
| `src/i18n/locales/en.json`                 | English UI labels.                                                                   |
| `src/i18n/locales/ru.json`                 | Russian UI labels.                                                                   |
| `src-tauri/src/image_processing.rs`        | Rust `GlobalAdjustments` fields + JSON parsing.                                      |
| `src-tauri/src/shaders/shader.wgsl`        | Uniforms, `prepare_lut_input`, `sample_hdr_lut_tetrahedral`, conditional LUT.        |
| `src-tauri/src/lut_processing.rs`          | HDR LUT resampling at load time (`build_hdr_lut`).                                   |
| `src-tauri/src/gpu_processing.rs`          | Select original vs. HDR LUT data when binding the texture.                           |
| `src/components/ui/LUTControl.tsx`         | Timing dropdown, normalization dropdown, range/offset/shoulder sliders.              |
| `src/components/adjustments/Effects.tsx`   | Wire new props from `adjustments` into `LUTControl`.                                 |
| `src/components/panel/right/FilmPanel.tsx` | Type update to accept `hdr` normalization mode.                                      |
| `src-tauri/src/export_processing.rs`       | Verify no extra export wiring is needed (export reuses the same adjustments struct). |

---

## Task 1: Extend the adjustments data model

**Files:** `src/utils/adjustments.ts`

- Add `LutTiming`, `LutNormalizeMode`, `LutInputRange`, `LutInputOffset`,
  `LutShoulder` to the `Effect` enum after `LutSize`.
- Add fields to the `Adjustments` interface:
  - `lutTiming?: 'after' | 'before'`
  - `lutNormalizeMode?: 'clamp' | 'linear' | 'log' | 'hdr'`
  - `lutInputRange?: number`
  - `lutInputOffset?: number`
  - `lutShoulder?: number`
- Add defaults to `INITIAL_ADJUSTMENTS`:
  - `lutTiming: 'after'`
  - `lutNormalizeMode: 'clamp'`
  - `lutInputRange: 6`
  - `lutInputOffset: 0`
  - `lutShoulder: 0`
- Include the new keys in `ADJUSTMENT_GROUPS.effects.lut`.
- Add the new keys to `ADJUSTMENT_SECTIONS.effects`.

---

## Task 2: Add UI strings

**Files:** `src/i18n/locales/en.json`, `src/i18n/locales/ru.json`

Add under `ui.lut`:

- `timing`, `timingAfter`, `timingBefore`
- `normalizeMode`, `normalizeClamp`, `normalizeLinear`, `normalizeLog`,
  `normalizeHdr`
- `inputRange`, `inputOffset`, `shoulder`

---

## Task 3: Rust `GlobalAdjustments` and JSON parsing

**Files:** `src-tauri/src/image_processing.rs`

- Add to `GpuGlobalAdjustments`:
  ```rust
  pub lut_timing: u32,
  pub lut_normalize_mode: u32,
  pub lut_input_range: f32,
  pub lut_input_offset: f32,
  pub lut_shoulder: f32,
  ```
- Parse in `get_all_adjustments_from_json`:
  ```rust
  lut_timing: match js["lutTiming"].as_str() { Some("before") => 1, _ => 0 },
  lut_normalize_mode: match js["lutNormalizeMode"].as_str() {
      "linear" => 1,
      "log" => 2,
      "hdr" => 3,
      _ => 0,
  },
  lut_input_range: js["lutInputRange"].as_f64().unwrap_or(6.0) as f32,
  lut_input_offset: js["lutInputOffset"].as_f64().unwrap_or(0.0) as f32,
  lut_shoulder: js["lutShoulder"].as_f64().unwrap_or(0.0) as f32 / 100.0,
  ```
- Forward fields in the returned `GlobalAdjustments`.

---

## Task 4: HDR LUT resampling

**Files:** `src-tauri/src/lut_processing.rs`

- Add constants:
  ```rust
  const HDR_LUT_TOTAL_RANGE: f32 = 32.0;
  const HDR_LUT_SIZE: u32 = 65;
  ```
- Extend `Lut` with `hdr_size: u32` and `hdr_data: Vec<f32>`.
- Implement `build_hdr_lut(original: &Lut) -> (u32, Vec<f32>)`:
  - For each cell in a `HDR_LUT_SIZE^3` grid, compute the normalized coordinate
    in the original LUT using a log-symmetric mapping, trilinearly sample the
    original LUT, and convert the result back to scene-linear.
- Call `build_hdr_lut` at the end of `parse_cube`, `parse_3dl`, and `parse_hald`.

---

## Task 5: WGSL uniforms and conditional LUT

**Files:** `src-tauri/src/shaders/shader.wgsl`

- Append to `GlobalAdjustments`:
  ```wgsl
  lut_timing: u32,
  lut_normalize_mode: u32,
  lut_input_range: f32,
  lut_input_offset: f32,
  lut_shoulder: f32,
  ```
- Add `prepare_lut_input(hdr)` helper for clamp/linear/log modes.
- Add `sample_hdr_lut_tetrahedral(hdr)` helper for HDR extrapolate mode:
  - Map HDR-linear input to log space.
  - Apply range/offset to choose a sub-domain.
  - Sample the HDR LUT, then map back to scene-linear.
- Apply LUT before tonemapping when `lut_timing == 1u`:
  - Use `sample_hdr_lut_tetrahedral` when `lut_normalize_mode == 3u`.
  - Otherwise use `prepare_lut_input` + `sample_lut_tetrahedral`.
- Make the post-tone LUT application conditional on `lut_timing == 0u`.

---

## Task 6: GPU pipeline HDR LUT selection

**Files:** `src-tauri/src/gpu_processing.rs`

When binding the LUT texture:

```rust
let use_hdr = request.adjustments.global.lut_normalize_mode == 3;
let (lut_data, size) = if use_hdr && !lut_arc.hdr_data.is_empty() {
    (&lut_arc.hdr_data, lut_arc.hdr_size)
} else {
    (&lut_arc.data, lut_arc.size)
};
```

---

## Task 7: LUT panel UI controls

**Files:** `src/components/ui/LUTControl.tsx`

- Extend props interface and destructuring for the new fields.
- Add controls below the Intensity slider:
  - Timing dropdown (After / Before tone mapper).
  - Normalization dropdown (Clamp / Linear / Log / HDR extrapolate).
  - Input range slider (0–32).
  - Input offset slider (−16–+16).
  - Shoulder slider (0–400), disabled for Clamp and HDR.

---

## Task 8: Wire controls in `EffectsPanel` and `FilmPanel`

**Files:** `src/components/adjustments/Effects.tsx`,
`src/components/panel/right/FilmPanel.tsx`

- Add handlers in `Effects.tsx` and pass them to `LUTControl`.
- Update the `onNormalizeModeChange` type in `FilmPanel.tsx` to accept `hdr`.

---

## Task 9: Verify export path needs no extra work

**Files:** `src-tauri/src/export_processing.rs` (read-only)

- Confirm export uses `get_all_adjustments_from_json`.
- Confirm `GlobalAdjustments` is forwarded to the GPU export pipeline.
- No code change is required.

---

## Task 10: Final verification and formatting

- `npx prettier --check` on all touched files; write fixes if needed.
- `cargo check` in `src-tauri/`.
- `npm run build`.
- Rust tests:
  ```bash
  cargo test global_adjustments_layout_matches_wgsl
  cargo test main_shader_validates
  cargo test aux_shaders_validate
  ```

---

## Self-review checklist

- **Spec coverage:**
  - Timing toggle → covered.
  - Normalization modes (Clamp/Linear/Log/HDR) → covered.
  - Manual sliders → covered.
  - HDR LUT resampling and shader sampling → covered.
  - Backward compatibility → defaults and Rust `Default` → covered.
  - Export path → covered.
- **Placeholder scan:** no TBD/TODO; all code shown.
- **Type consistency:**
  - TS: `'after' | 'before'`, `'clamp' | 'linear' | 'log' | 'hdr'`, `number`.
  - Rust: `u32` for enums, `f32` for numeric parameters, shoulder pre-divided by 100.
  - WGSL: matching `u32`/`f32` fields at the end of `GlobalAdjustments`.
- **Alignment safety:** new WGSL fields are appended at the end of
  `GlobalAdjustments`, so they cannot shift existing members and break mat3x3
  alignment.

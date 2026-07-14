# Pre-tone emulsion diffusion (Amount + Radius)

Date: 2026-07-14. Status: pending user review.

## Problem

The current `Film Blur` slider in the Film Emulsion section replaces the graded
tile with a Gaussian-blurred copy. Physically this is wrong: real emulsion
diffusion is scattered light *added* to the latent linear image, not a
replacement. It also kills detail in mid-tones. We want a testable pre-tonemap
diffusion control that behaves like a soft focus / diffusion filter: highlights
bloom, mid-tones stay sharp, shadows are mostly untouched.

## Goals

1. Add a pre-tone emulsion diffusion block to the Film tab with two sliders:
   - **Amount** 0–100% (strength of the screen-blended diffusion).
   - **Radius** 0.5–4 px full-res (Gaussian sigma driver).
2. The blur is applied in the linear graded space **before** the tonemapper.
3. The blend is a screen blend with clamp: `1 - (1-sharp)(1-blur*amount)`.
4. Old sidecars without the new keys keep their previous look.
5. The existing `Film Blur` slider is left untouched for now.

## Non-goals

- Post-tone diffusion in this change (planned as a follow-up once pre-tone is
  validated).
- Removing or re-purposing the existing `Film Blur` slider.
- Radius larger than 4 px or non-Gaussian kernels.
- Masking the diffusion by depth/selection.
- i18n beyond `en.json` and `ru.json`.

## Data model (`src/utils/adjustments.ts`)

New adjustment keys:

- `filmBlurPreAmount`: number, default `0`, range `0..100`.
- `filmBlurPreRadius`: number, default `0.5`, range `0.5..4`.

Changes:

- Add `FilmBlurPreAmount` and `FilmBlurPreRadius` to the `FilmAdjustment` enum.
- Add fields to the `Adjustments` interface.
- Add defaults to `INITIAL_ADJUSTMENTS`.
- Add to the sidecar load merge block (around `adjustments.ts:990+`).
- Add to the film copy/paste group so the new dials travel with other film keys.

## Editor UI

### `src/components/panel/right/FilmPanel.tsx`

- In the **Look** section, below the `Adjacency` slider, add a new row with two
  `Slider` components side by side:
  - `Amount`: `w-2/3`, range `0..100`, step `1`.
  - `Radius`: `w-1/3`, range `0.5..4`, step `0.1`.
- Labels use i18n keys `editor.film.preToneDiffusionAmount` and
  `editor.film.preToneDiffusionRadius`.
- Both use the existing `onDragStateChange` plumbing.

## Rust gating

### `src-tauri/src/image_processing.rs`

- Read `filmBlurPreAmount` and `filmBlurPreRadius` in
  `get_global_adjustments_from_json` (the same gating section that handles film
  look dials). When the Film panel is off, force both to `0`.
- Add `film_blur_pre_amount: f32` and `film_blur_pre_radius: f32` to the
  `GlobalAdjustments` struct.
- `film_blur_pre_amount` is stored normalized to `0..1`.

## GPU pipeline (`src-tauri/src/gpu_processing.rs`)

1. Create a new reusable `pre_blur_texture` + `pre_blur_view` (Rgba16Float,
   `TEXTURE_BINDING | STORAGE_BINDING`) at init time.
2. Extend `main_bgl` with binding `11 + MAX_MASK_BINDINGS` (static `12` in
   `shader.wgsl`) for the pre-blur texture (`filterable: false`, `D2`).
3. In the per-tile render:
   - If `film_blur_pre_amount > 0`:
     - Run H-blur: `tile_output_texture` → `ping_pong_view`.
     - Run V-blur: `ping_pong_view` → `pre_blur_view`.
     - `sigma = film_blur_pre_radius * scale`, `radius = (sigma * 2).ceil()`.
   - Pass `pre_blur_view` to the main shader bind group at binding `12` (use a
     dummy `Rgba16Float` view when inactive).
4. The main compute shader runs after the optional pre-blur pass.

## WGSL (`src-tauri/src/shaders/shader.wgsl`)

- Add to the global adjustments struct:
  - `film_blur_pre_amount: f32`
  - `film_blur_pre_radius: f32` (used only for diagnostics, the GPU uses the
    pre-blurred texture directly).
- Add a new texture binding for the pre-blurred linear tile.
- Before tonemapping (around the existing `composite_rgb_linear` → `base_srgb`
  block), apply:

  ```wgsl
  if (adjustments.global.film_blur_pre_amount > 0.0) {
      let blurred = clamp(textureLoad(pre_blur_texture, absolute_coord_i, 0).rgb,
                          vec3<f32>(0.0), vec3<f32>(1.0));
      let amount = adjustments.global.film_blur_pre_amount;
      composite_rgb_linear = 1.0 - (1.0 - composite_rgb_linear) * (1.0 - blurred * amount);
  }
  ```

## Export (`src-tauri/src/export_processing.rs`)

- The export path reuses `GpuProcessor::run` (`render_image_headless` and the
  export pipeline both call it with `all_adjustments`). Because the pre-tone blur
  lives entirely inside `gpu_processing.rs` and reads `GlobalAdjustments`, no
  additional export code is required beyond verifying the new fields are parsed
  and forwarded.
- If a CPU-only export fallback exists that bypasses `GpuProcessor`, add the
  same pre-blur pass there; currently there is no such fallback.

## i18n

- `editor.film.preToneDiffusionAmount` — "Diffusion" / "Диффузия".
- `editor.film.preToneDiffusionRadius` — "Radius" / "Радиус".

Add to `src/i18n/locales/en.json` and `src/i18n/locales/ru.json`.

## Files touched

- `src/utils/adjustments.ts` — new keys, interface, defaults, load merge,
  copy/paste group.
- `src/components/panel/right/FilmPanel.tsx` — Amount + Radius sliders in Look
  section.
- `src/i18n/locales/en.json`, `src/i18n/locales/ru.json` — new labels.
- `src-tauri/src/image_processing.rs` — parsing, `GlobalAdjustments`, gating.
- `src-tauri/src/shaders/shader.wgsl` — uniforms, pre-blur texture binding,
  screen blend before tonemap.
- `src-tauri/src/gpu_processing.rs` — `pre_blur_texture/view`, BGL extension,
  optional pre-blur pass, bind group wiring.
- `src-tauri/src/export_processing.rs` — verify/forward pre-tone diffusion in
  export.

## Verification

- `npm run build` (the real gate; ignore pre-existing `tsc` baseline errors).
- `cargo check` in `src-tauri/`.
- `npx prettier --check` on touched files.
- Manual smoke: open a RAW with bright highlights, enable pre-tone diffusion,
  raise Amount — highlights should bloom while mid-tone detail remains sharp.
  Increasing Radius should widen the bloom.

## Alternatives rejected

- Replacing the existing `Film Blur` slider directly — rejected; the new control
  is an experiment and should coexist until its behavior is validated.
- Post-tone diffusion only — rejected; the user explicitly wants to test the
  pre-tone variant first.
- Fixed radius — rejected; a testable control needs to expose radius so the user
  can compare different diffusion widths.

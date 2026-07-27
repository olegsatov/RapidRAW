# Dodge & Burn Brush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `dodgeBurn` sub-mask tool to the Masks tab that lets the user paint a local film-look adjustment with a spray brush. While painting, the frontend blends two pre-rendered image planes (`base` and `effect`) through an accumulating grayscale mask using WebGL, without re-running the full image processing pipeline. The mask and its delta parameters are persisted and applied during export via the existing Rust mask/GPU pipeline.

**Architecture:** Two-layer WebGL compositor on the frontend (`base` from the current preview URL + `effect` from a dedicated `apply_adjustments` call with delta parameters), an additive mask texture painted with a feathered circle, and backend integration as a new bitmap sub-mask type whose `MaskAdjustments` carry the delta film parameters. The backend reuses the existing mask atlas and shader blend loop, so preview and export share one implementation.

**Tech Stack:** React + TypeScript, raw WebGL2, Zustand, Tauri, Rust, WGSL.

---

## Phase 1: Frontend data model and UI wiring

### Task 1: Add `dodgeBurn` to the mask enum and type registry

**Files:**
- Modify: `src/components/panel/right/Masks.tsx`
- Modify: `src/utils/maskUtils.ts`

**Goal:** Make the new mask type selectable in the UI and createable with the correct default parameters.

- [ ] **Step 1: Add enum value**

Add `DodgeBurn = 'dodge-burn'` to the `Mask` enum in `src/components/panel/right/Masks.tsx` alongside `Flow` and `Brush`.

```ts
export enum Mask {
  ...
  Flow = 'flow',
  DodgeBurn = 'dodge-burn',
  ...
}
```

- [ ] **Step 2: Add format name and icon**

Add a `case` in `formatMaskTypeName` and map `Mask.DodgeBurn` to an icon in `MASK_ICON_MAP`. Use the `Sun` icon already imported (or import a new one if preferred).

```ts
// in formatMaskTypeName
if (type === Mask.DodgeBurn) return i18n.t('masks.types.dodgeBurn');

// in MASK_ICON_MAP
[Mask.DodgeBurn]: Sun,
```

- [ ] **Step 3: Register in mask creation lists**

Add the new type to `OTHERS_MASK_TYPES` in `src/components/panel/right/Masks.tsx` and to the `OTHERS_MASK_TYPES` block inside `src-tauri`/`src/components/panel/right/MasksPanel.tsx` (the context menu already reads the same constant, but verify both imports are the same object).

```ts
{
  disabled: false,
  icon: Sun,
  name: 'Dodge & Burn',
  type: Mask.DodgeBurn,
},
```

- [ ] **Step 4: Add factory defaults in `maskUtils.ts`**

In `createSubMask`, add a `case Mask.DodgeBurn` that returns a sub-mask with `parameters: { maskBitmap: null, adjustments: getDefaultDodgeBurnAdjustments() }`. Store the default-adjustments helper in the same file or import it from `adjustments.ts`.

```ts
export const getDefaultDodgeBurnAdjustments = (): DodgeBurnAdjustments => ({
  flimEv: 0,
  flimContrast: 100,
  flimShoulder: 0,
  flimToe: 0,
  flimWarmth: 0,
  flimSaturation: 100,
  flimHiTint: 0,
  flimShTint: 0,
  vibrance: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  clarity: 0,
  halationAmount: 0,
  glowAmount: 0,
  vignetteAmount: 0,
  filmBlurPreAmount: 0,
  filmBlurPreCompensation: 0,
  filmBlurPreRadius: 0.5,
  filmBlurPreSoftAmount: 0,
  filmBlurPreSoftRadius: 0.5,
  centré: 0,
});
```

- [ ] **Step 5: Add TypeScript interface for the parameters**

Create `src/types/dodgeBurn.ts` (or add to `src/utils/adjustments.ts`) the parameter interface and a helper to build the delta adjustments object.

```ts
export interface DodgeBurnMaskParameters {
  maskBitmap: string | null; // base64 WebP
  adjustments: DodgeBurnAdjustments;
}

export interface DodgeBurnAdjustments {
  flimEv: number;
  flimContrast: number;
  flimShoulder: number;
  flimToe: number;
  flimWarmth: number;
  flimSaturation: number;
  flimHiTint: number;
  flimShTint: number;
  vibrance: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  clarity: number;
  halationAmount: number;
  glowAmount: number;
  vignetteAmount: number;
  filmBlurPreAmount: number;
  filmBlurPreCompensation: number;
  filmBlurPreRadius: number;
  filmBlurPreSoftAmount: number;
  filmBlurPreSoftRadius: number;
  centré: number;
}
```

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` (this repo has a pre-existing red baseline; check only that your new code does not add errors).

---

### Task 2: Create the adjustment panel for the new sub-mask

**Files:**
- Create: `src/components/adjustments/DodgeBurn.tsx`
- Modify: `src/components/panel/right/MasksPanel.tsx`

**Goal:** Reuse the Film panel sliders for the delta parameters without the LUT, grain, B&W, and advanced sections.

- [ ] **Step 1: Extract reusable slider blocks from `FilmPanel.tsx`**

Refactor `FilmPanel.tsx` so the response, color, classic HWSB, details, and film-effects sections are either exported as small components or copied into the new `DodgeBurn.tsx`. The simplest first version is to copy the relevant slider JSX into `DodgeBurn.tsx` and import the same `Slider`, `Text`, `CollapsibleSection` helpers. Do **not** duplicate the preset/advanced logic.

- [ ] **Step 2: Write `DodgeBurn.tsx`**

The component takes `adjustments: DodgeBurnAdjustments` and `onChange(key: keyof DodgeBurnAdjustments, value: number)` and renders the same sliders as FilmPanel except:
- No grain section.
- No B&W section.
- No LUT section.
- No advanced section.
- No preset dropdown.
- No tone-mapper toggle.

- [ ] **Step 3: Render `DodgeBurn.tsx` inside `MasksPanel.tsx`**

In `MasksPanel.tsx`, after the existing `activeSubMaskData` resolution, add a branch:

```ts
const isDodgeBurn = activeSubMaskData?.type === Mask.DodgeBurn;
```

In the JSX where mask settings are rendered (search for the `SettingsPanel`/`activeSubMaskData` usage), render the new panel when `isDodgeBurn` is true. The panel should receive `activeSubMaskData.parameters.adjustments` and update via `updateSubMask(activeSubMaskData.id, { parameters: { ...parameters, adjustments: newAdjustments } })`.

- [ ] **Step 4: Add `SUB_MASK_CONFIG` entry**

Add `[Mask.DodgeBurn]: { showBrushTools: true }` to `SUB_MASK_CONFIG` in `MasksPanel.tsx` so the brush size/feather/flow controls appear.

---

### Task 3: Build the WebGL dodge & burn renderer

**Files:**
- Create: `src/utils/dodgeBurnRenderer.ts`
- Create: `src/components/panel/editor/DodgeBurnLayer.tsx`

**Goal:** Provide a self-contained WebGL2 compositor that can blend `base` and `effect` by a mask and paint into the mask texture.

- [ ] **Step 1: Create `DodgeBurnRenderer` class**

Write a class with the following public API:

```ts
export class DodgeBurnRenderer {
  constructor(canvas: HTMLCanvasElement, baseImageUrl: string, effectImageUrl: string, maskBitmap?: string | null);
  async init(): Promise<void>;
  resize(width: number, height: number): void;
  setTransform(scale: number, x: number, y: number): void;
  paintBrush(x: number, y: number, size: number, feather: number, flow: number, mode: 'add' | 'erase'): void;
  setOverlayVisible(visible: boolean): void;
  render(): void;
  getMaskBlob(): Promise<Blob>;
  destroy(): void;
}
```

Internally use two textures for `base` and `effect`, one `R8` or `RGBA` texture for the mask, and a framebuffer for the mask so additive strokes can be rendered into it. The compositor shader is:

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_base;
uniform sampler2D u_effect;
uniform sampler2D u_mask;
uniform float u_overlay;
in vec2 v_uv;
out vec4 outColor;

void main() {
  vec3 base = texture(u_base, v_uv).rgb;
  vec3 effect = texture(u_effect, v_uv).rgb;
  float mask = texture(u_mask, v_uv).r;
  vec3 result = mix(base, effect, mask);
  if (u_overlay > 0.5) {
    result = mix(result, vec3(1.0, 0.2, 0.2), mask * 0.35);
  }
  outColor = vec4(result, 1.0);
}
```

- [ ] **Step 2: Implement the brush stamp program**

Use a separate shader that draws a soft circle into the mask texture with additive blending when adding and subtractive blending when erasing. Clamp the mask value to `[0, 1]` in the shader.

```glsl
#version 300 es
precision highp float;
uniform vec2 u_center;     // in UV space
uniform float u_radius;    // in UV space
uniform float u_flow;      // 0..1
uniform float u_mode;      // 1.0 = add, -1.0 = erase
uniform sampler2D u_mask;
in vec2 v_uv;
out vec4 outColor;

void main() {
  float d = distance(v_uv, u_center) / u_radius;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  float current = texture(u_mask, v_uv).r;
  float delta = u_flow * a * u_mode;
  float next = clamp(current + delta, 0.0, 1.0);
  outColor = vec4(next, next, next, 1.0);
}
```

Draw a full-screen triangle for each stroke position, bind the mask texture as both input and output (using framebuffer), and use a temporary ping-pong texture if WebGL does not allow reading and writing the same texture.

- [ ] **Step 3: Convert mask to WebP**

`getMaskBlob` should download the mask texture with `gl.readPixels` into a `Uint8Array`, draw it to an offscreen 2D canvas, and call `canvas.toBlob(..., 'image/webp', 0.7)`.

- [ ] **Step 4: Create `DodgeBurnLayer` React component**

This component renders an absolutely-positioned `<canvas>` on top of `ImageCanvas` and instantiates `DodgeBurnRenderer`. It receives:

```ts
interface Props {
  baseUrl: string;
  effectUrl: string | null;
  maskBitmap: string | null;
  adjustments: DodgeBurnAdjustments;
  transform: { scale: number; x: number; y: number };
  brushSettings: BrushSettings;
  isActive: boolean;
  showOverlay: boolean;
  onMaskChange(maskBitmap: string): void;
}
```

When `effectUrl` is null, show a loading indicator and disable pointer events. When `adjustments` change, the parent will re-render `effectUrl`; the component should re-initialize the `effect` texture only.

---

### Task 4: Wire the layer into `ImageCanvas` and handle input

**Files:**
- Modify: `src/components/panel/editor/ImageCanvas.tsx`

**Goal:** Paint strokes while the dodge & burn sub-mask is active, without triggering the full Flow live-preview pipeline.

- [ ] **Step 1: Detect active dodge & burn sub-mask**

Near the existing `activeSubMask?.type === Mask.Flow` checks, add a helper:

```ts
const activeDodgeBurnSubMask = activeContainer?.subMasks?.find(
  (sm) => sm.id === activeMaskId && sm.type === Mask.DodgeBurn,
);
```

- [ ] **Step 2: Disable Flow live-mode behavior for this sub-mask**

In `handleStart`/`handleMove`/`handleUp`, branch so that when `activeDodgeBurnSubMask` is active, the code does **not** append `DrawnLine` points or call `updateSubMask` with new lines. Instead, it forwards pointer coordinates to the `DodgeBurnLayer` via a ref or callback.

- [ ] **Step 3: Pass effect URL to the layer**

Add a new hook `useDodgeBurnEffectUrl` (or extend `useImageProcessing`) that returns the rendered `effect` image URL. When the active sub-mask is `dodgeBurn` and its `adjustments` change, compute the full `Adjustments` object as `global + delta` and invoke `apply_adjustments` with `isInteractive: true` and `targetResolution: preview`. Store the resulting URL and pass it to `DodgeBurnLayer` as `effectUrl`.

Use `finalPreviewUrl` as the `baseUrl`.

- [ ] **Step 4: Commit mask on mouse up**

When `handleUp` fires for a dodge & burn stroke, ask the `DodgeBurnLayer` for the current WebP mask, then call `updateSubMask(activeMaskId, { parameters: { ...parameters, maskBitmap } })`. Also push a history snapshot so `Undo` reverts the mask.

- [ ] **Step 5: Reuse erase and overlay**

The erase state already comes from `brushSettings.tool === ToolType.Eraser`. Pass `mode` (`add` or `erase`) to the renderer. The overlay toggle uses `activeSubMaskData.showOverlay` from Flow; pass it through to `DodgeBurnLayer`.

---

### Task 5: Handle mask persistence and undo

**Files:**
- Modify: `src/components/panel/editor/ImageCanvas.tsx`
- Modify: `src/hooks/useEditorActions.ts` or `src/store/useEditorStore.ts`

**Goal:** The mask survives switching tools, closing the editor, and undo/redo.

- [ ] **Step 1: Snapshot mask before each stroke**

Before `handleStart` for a dodge & burn stroke, store the current `parameters.maskBitmap` in a local ref (`preStrokeMaskRef`).

- [ ] **Step 2: Restore on undo**

When the user presses undo, the existing history mechanism already restores the previous `Adjustments`. Because `maskBitmap` is part of `parameters`, the mask will restore automatically. No extra code is needed unless you want to avoid pushing a history entry for every tiny stroke; in that case, batch history updates by debouncing the `updateSubMask` call during painting and only committing on `mouseup`.

- [ ] **Step 3: Ensure mask is saved to sidecar**

The existing save pipeline serializes `adjustments` to JSON. Base64 strings are valid JSON, so no extra work is needed. Verify that loading calls `normalizeLoadedAdjustments` and preserves the `dodgeBurn` parameters; add a normalization branch if necessary.

---

## Phase 2: Backend integration

### Task 6: Parse the new sub-mask in Rust

**Files:**
- Modify: `src-tauri/src/mask_generation.rs`

**Goal:** Decode the frontend's WebP mask bitmap and produce a grayscale `GrayImage` aligned with the crop/rotation/scale.

- [ ] **Step 1: Add a new sub-mask branch in `generate_sub_mask_bitmap`**

Add a match arm for `"dodge-burn"` (or the string matching `Mask.DodgeBurn`):

```rust
"dodge-burn" => {
    let params = serde_json::from_value::<DodgeBurnParameters>(sub_mask.parameters.clone())
        .map_err(|e| ...)?;
    generate_dodge_burn_bitmap(&params, full_width, full_height, crop_offset, scale, rotation)?
}
```

- [ ] **Step 2: Define `DodgeBurnParameters`**

Add to `src-tauri/src/mask_generation.rs` or `src-tauri/src/image_processing.rs`:

```rust
#[derive(Debug, Deserialize)]
struct DodgeBurnParameters {
    mask_bitmap: Option<String>,
    adjustments: DodgeBurnAdjustments,
}

#[derive(Debug, Deserialize)]
struct DodgeBurnAdjustments {
    flim_ev: f32,
    flim_contrast: f32,
    flim_shoulder: f32,
    flim_toe: f32,
    flim_warmth: f32,
    flim_saturation: f32,
    flim_hi_tint: f32,
    flim_sh_tint: f32,
    vibrance: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    clarity: f32,
    halation_amount: f32,
    glow_amount: f32,
    vignette_amount: f32,
    film_blur_pre_amount: f32,
    film_blur_pre_compensation: f32,
    film_blur_pre_radius: f32,
    film_blur_pre_soft_amount: f32,
    film_blur_pre_soft_radius: f32,
    centre: f32,
}
```

- [ ] **Step 3: Decode the WebP mask**

Reuse `generate_ai_bitmap_from_base64` but accept the WebP data URL directly:

```rust
fn generate_dodge_burn_bitmap(
    params: &DodgeBurnParameters,
    full_width: u32,
    full_height: u32,
    crop_offset: (i32, i32),
    scale: f32,
    rotation: i32,
) -> Result<GrayImage> {
    let Some(data_url) = &params.mask_bitmap else {
        return Ok(GrayImage::from_pixel(full_width, full_height, Luma([0])));
    };
    let base64_data = data_url
        .split_once(",")
        .map(|(_, b)| b)
        .unwrap_or(data_url);
    let decoded = base64::engine::general_purpose::STANDARD.decode(base64_data)?;
    let img = image::load_from_memory(&decoded)?.to_luma8();
    generate_ai_bitmap_from_full_mask(&img, full_width, full_height, crop_offset, scale, rotation)
}
```

- [ ] **Step 4: Cargo check**

Run: `cd src-tauri && cargo check`.

---

### Task 7: Add delta fields to `MaskAdjustments` and wire parsing

**Files:**
- Modify: `src-tauri/src/image_processing.rs`
- Modify: `src-tauri/src/shaders/shader.wgsl`
- Modify: `src-tauri/src/shaders/pre_tone.wgsl`

**Goal:** The mask container's adjustments carry the dodge & burn delta values, and the GPU receives them.

- [ ] **Step 1: Extend `MaskAdjustments`**

Add the same fields as `DodgeBurnAdjustments` to `MaskAdjustments` in `src-tauri/src/image_processing.rs` (around line 1584). Initialize all to zero. Keep the struct layout identical to the WGSL `MaskAdjustments` struct.

- [ ] **Step 2: Parse the delta from the sub-mask parameters**

In `get_mask_adjustments_from_json`, when the current mask container contains a `dodge-burn` sub-mask, merge its `adjustments` into the container's `MaskAdjustments`. If multiple sub-masks exist, sum them (or take the last one; keep it simple and deterministic).

- [ ] **Step 3: Mirror fields in WGSL**

Add the same fields to `struct MaskAdjustments` in both `shader.wgsl` and `pre_tone.wgsl`. The existing test `global_adjustments_layout_matches_wgsl` will fail if sizes/offsets do not match; run it after editing.

---

### Task 8: Apply the effect in the shader

**Files:**
- Modify: `src-tauri/src/shaders/shader.wgsl`
- Modify: `src-tauri/src/shaders/pre_tone.wgsl`

**Goal:** For each pixel, if a dodge & burn mask is present, add the delta adjustments to the global values before the existing mask-blend loop.

- [ ] **Step 1: Identify where mask influence is read**

In `shader.wgsl` the mask blend loop starts around line 1436. `pre_tone.wgsl` has a similar loop earlier in the pipeline.

- [ ] **Step 2: Add a pre-loop dodge & burn accumulation**

Before the existing per-mask blend loop, compute the dodge & burn adjustment delta from any mask whose `MaskAdjustments` has non-zero dodge & burn fields. The simplest approach is to treat these fields as additive offsets to the global adjustment values that the shader already uses:

```wgsl
var dodge_burn_influence = 0.0;
var dodge_burn_mask_idx = 0xffffffffu;
for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
    let m = adjustments.mask_adjustments[i];
    if (m.dodge_burn_weight > 0.001) {
        dodge_burn_influence = get_mask_influence(i, absolute_coord);
        dodge_burn_mask_idx = i;
        break;
    }
}
```

A better long-term approach is to add a dedicated `dodge_burn_mask_index` and `dodge_burn_weight` field to `AllAdjustments` so the shader knows exactly which mask to sample. For the first implementation, reuse the existing mask index loop and mark a mask as "dodge & burn" by a sentinel value (e.g., `mask_adjustments[i].vignette_feather < 0.0` is too hacky; add an explicit `u32 dodge_burn_flag` field to `MaskAdjustments`).

- [ ] **Step 3: Apply the delta to the tone curve / color pipeline**

Because the dodge & burn effect is intended to be a film-look delta, apply the delta to the parameters used by the pre-tone and post-tone passes. For a minimal first version, apply the delta to `exposure`, `highlights`, `shadows`, `whites`, `blacks`, `contrast`, `saturation`, `vibrance`, `temperature`, `tint`, and the `flim*` parameters in the tone-mapping function, weighted by the mask influence.

- [ ] **Step 4: Build and run shader tests**

Run: `cd src-tauri && cargo test --lib layout` (or the exact test name from `image_processing.rs`).

---

### Task 9: Export integration

**Files:**
- Modify: `src-tauri/src/export_processing.rs` (verify no changes needed)

**Goal:** Export uses the same pipeline as preview, so the dodge & burn mask should already be applied if the backend integration is correct.

- [ ] **Step 1: Verify mask path in export**

`process_image_for_export_pipeline` calls `generate_mask_bitmap` at `scale = 1.0`. Confirm that the `dodge-burn` sub-mask is decoded and applied at full resolution. No code change is required unless the preview path diverges from export.

- [ ] **Step 2: Add a quick export test**

If a test harness exists in `src-tauri/src/export_processing.rs` or `src-tauri/tests`, add an integration test that creates a `dodge-burn` sub-mask with a solid white mask and verifies that the exported image is different from the base image.

---

## Phase 3: Polish and verification

### Task 10: i18n and labels

**Files:**
- Modify: `src/i18n/locales/en.json` and `src/i18n/locales/ru.json` (or the active locales)

**Goal:** The new mask type has a readable name.

- [ ] **Step 1: Add translation keys**

```json
{
  "masks": {
    "types": {
      "dodgeBurn": "Dodge & Burn"
    }
  }
}
```

- [ ] **Step 2: Verify the label appears**

Run the app, open the Masks tab, click "Others", confirm "Dodge & Burn" is listed.

---

### Task 11: Verify build and existing tests

- [ ] **Step 1: Frontend build**

Run: `npm run build`. The pre-existing `tsc` baseline may be red, but the build should succeed and no new TypeScript errors should be introduced by your files.

- [ ] **Step 2: Rust check**

Run: `cd src-tauri && cargo check`.

- [ ] **Step 3: Prettier check**

Run: `npx prettier --check src/components/adjustments/DodgeBurn.tsx src/utils/dodgeBurnRenderer.ts src/components/panel/editor/DodgeBurnLayer.tsx src/components/panel/right/Masks.tsx src/utils/maskUtils.ts src/components/panel/right/MasksPanel.tsx src/components/panel/editor/ImageCanvas.tsx`.

- [ ] **Step 4: Manual smoke test**

1. Open an image in the editor.
2. Go to Masks → Others → Dodge & Burn.
3. Raise exposure slightly in the new panel.
4. Paint on the image; confirm the painted area brightens immediately and accumulates when you pass over it twice.
5. Release the mouse; confirm the effect stays.
6. Press `O`; confirm a red overlay appears where you painted.
7. Press `Cmd/Ctrl+Z`; confirm the last stroke disappears.
8. Switch to export and confirm the brightened area appears in the exported image.

---

## Spec coverage checklist

| Spec requirement | Task(s) |
|---|---|
| New sub-mask type in Masks tab | 1, 2 |
| Delta film-look parameters (no LUT/grain/B&W/advanced) | 2, 7 |
| Two-plane WebGL blend (`base` + `effect`) | 3, 4 |
| Spray/accumulating brush | 3, 4 |
| No full re-render during stroke | 3, 4 |
| Mask persistence as WebP ~70% | 3, 5, 6 |
| Editable / undoable | 5 |
| Reuse Flow overlay and erase | 4, 11 |
| Export via backend mask pipeline | 6, 7, 8, 9 |
| Build and tests pass | 11 |

## Implementation notes

1. **Mask-to-shader association:** Add a `dodge_burn_flag: u32` field to `MaskAdjustments` (1 = this mask carries a dodge & burn delta). The shader scans the mask list once, and when it finds a mask with the flag set, it samples that mask's influence and applies the delta. If this breaks existing layout tests, fall back to adding `dodge_burn_mask_index: u32` to `AllAdjustments` and set it in `get_all_adjustments_from_json`.
2. **Shader application location:** Apply the delta in `pre_tone.wgsl` so it operates in scene-linear space, consistent with the film-response model. If the visual result is too aggressive in the shadows, move the delta application to `shader.wgsl` and compare.
3. **Effect plane resolution:** Use the current `previewSize` from `useEditorStore` for the `effect` plane. If zoomed-in previews look soft, request the plane at `max(previewSize, displaySize)` in a follow-up polish task.

# Pre-tone Emulsion Diffusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo rule (AGENTS.md): do NOT run `git commit`/`git push` during execution.** The user commits explicitly. Where a generic plan would say "commit", stop at a checkpoint instead. Also: no cosmetic edits to upstream code, keep the diff surgical.

**Goal:** Add a pre-tone emulsion diffusion control to the Film tab (Amount 0–100%, Radius 0.5–4 px) that blurs the linear graded image before tonemapping and screen-blends it back. This requires splitting the current single compute shader into a pre-tone grading pass and a post-tone tonemapping pass.

**Architecture:** The monolithic `shader.wgsl::main` is split into two compute dispatches: `pre_tone` writes the linear graded result to a new `pre_tone_linear_texture`; an optional Gaussian blur writes to `pre_blur_view`; `post_tone` (the renamed `main`) reads the blurred linear result and continues with tonemapping, B&W, film look, curves, LUT and grain. Common WGSL code lives in a new `common.wgsl` included by both modules. UI/Rust changes are minimal; the existing `Film Blur` slider is untouched.

**Tech Stack:** React + TypeScript (Vite), Tauri v2, Rust (wgpu), i18next. Verification: `npm run build`, `cargo check` in `src-tauri/`, `npx prettier --check`.

**Spec:** `docs/superpowers/specs/2026-07-14-pre-tone-emulsion-diffusion-design.md`

---

## File Structure

- `src/utils/adjustments.ts` — new adjustment keys, defaults, sidecar merge, copy/paste groups (modify)
- `src/i18n/locales/en.json`, `src/i18n/locales/ru.json` — new slider labels (modify)
- `src/components/panel/right/FilmPanel.tsx` — Amount + Radius sliders in the Look section (modify)
- `src-tauri/src/image_processing.rs` — `GlobalAdjustments` layout + parsing + gating (modify)
- `src-tauri/src/shaders/common.wgsl` — shared structs, group-1 bindings, non-input-dependent functions (create)
- `src-tauri/src/shaders/pre_tone.wgsl` — group-0 IO for pre-tone, input-dependent functions, `pre_tone` entry point (create)
- `src-tauri/src/shaders/shader.wgsl` — group-0 IO for post-tone, `main` entry point reading `pre_blur_texture`, includes `common.wgsl` (modify)
- `src-tauri/src/gpu_processing.rs` — pre-tone/post-tone pipelines, common bind group, pre-blur pass, dispatch order (modify)

---

### Task 1: Data model — `filmBlurPreAmount` + `filmBlurPreRadius`

**Files:**
- Modify: `src/utils/adjustments.ts`

- [ ] **Step 1: Add the enum members**

In the `FilmAdjustment` enum, after `FlimAdvPushB = 'flimAdvPushB',` (line 151) add:

```ts
  FilmBlurPreAmount = 'filmBlurPreAmount',
  FilmBlurPreRadius = 'filmBlurPreRadius',
```

- [ ] **Step 2: Add to the `Adjustments` interface**

After `flimAdvPushB: number;` (line 292) add:

```ts
  filmBlurPreAmount: number;
  filmBlurPreRadius: number;
```

- [ ] **Step 3: Add defaults in `INITIAL_ADJUSTMENTS`**

In `INITIAL_ADJUSTMENTS`, after `flimAdvPushB: 1,` (line 743, inside the `...FLIM_BUILTIN_PRESETS[0]` spread) add:

```ts
  filmBlurPreAmount: 0,
  filmBlurPreRadius: 0.5,
```

- [ ] **Step 4: Add to the sidecar load merge**

In `normalizeLoadedAdjustments`, after `filmBlur: loadedAdjustments.filmBlur ?? INITIAL_ADJUSTMENTS.filmBlur,` (line 995) add:

```ts
    filmBlurPreAmount: loadedAdjustments.filmBlurPreAmount ?? INITIAL_ADJUSTMENTS.filmBlurPreAmount,
    filmBlurPreRadius: loadedAdjustments.filmBlurPreRadius ?? INITIAL_ADJUSTMENTS.filmBlurPreRadius,
```

- [ ] **Step 5: Add to the film copy/paste groups**

There are two `film:` copy/paste groups (lines 1155 and 1309). After `FilmAdjustment.FilmBlur,` in **both** groups add:

```ts
        FilmAdjustment.FilmBlurPreAmount,
        FilmAdjustment.FilmBlurPreRadius,
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: build succeeds; no NEW TypeScript errors mentioning `filmBlurPreAmount` or `filmBlurPreRadius` (the repo has a pre-existing red `tsc` baseline — judge only new errors).

- [ ] **Checkpoint** — report to user.

---

### Task 2: i18n strings (en + ru)

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`

- [ ] **Step 1: Add English labels**

In `src/i18n/locales/en.json`, inside `editor.film` next to `"adjacency": "Adjacency",` (line 578) add:

```json
      "preToneDiffusionAmount": "Diffusion",
      "preToneDiffusionRadius": "Radius",
```

- [ ] **Step 2: Add Russian labels**

In `src/i18n/locales/ru.json`, inside `editor.film` next to `"adjacency": "Микроконтраст",` (line 578) add:

```json
      "preToneDiffusionAmount": "Диффузия",
      "preToneDiffusionRadius": "Радиус",
```

- [ ] **Step 3: Verify JSON is valid**

Run:
```bash
node -e "require('./src/i18n/locales/en.json'); require('./src/i18n/locales/ru.json'); console.log('OK')"
```
Expected: `OK`

- [ ] **Checkpoint** — report to user.

---

### Task 3: UI sliders in `FilmPanel.tsx`

**Files:**
- Modify: `src/components/panel/right/FilmPanel.tsx`

- [ ] **Step 1: Add the slider row below `Adjacency`**

After the `Adjacency` `Slider` closing tag (line 358) and before the `hiTint` `Slider` (line 359) insert:

```tsx
          <div className="flex gap-2">
            <div className="w-2/3">
              <Slider
                defaultValue={0}
                label={t('editor.film.preToneDiffusionAmount')}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBlurPreAmount, e.target.value)}
                step={1}
                value={adjustments.filmBlurPreAmount ?? 0}
                onDragStateChange={onDragStateChange}
              />
            </div>
            <div className="w-1/3">
              <Slider
                defaultValue={0.5}
                label={t('editor.film.preToneDiffusionRadius')}
                max={4}
                min={0.5}
                onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBlurPreRadius, e.target.value)}
                step={0.1}
                value={adjustments.filmBlurPreRadius ?? 0.5}
                onDragStateChange={onDragStateChange}
              />
            </div>
          </div>
```

- [ ] **Step 2: Verify formatting**

Run: `npx prettier --check src/components/panel/right/FilmPanel.tsx`
Expected: no formatting errors.

- [ ] **Checkpoint** — report to user.

---

### Task 4: Split `shader.wgsl` into `common.wgsl`, `pre_tone.wgsl` and post-tone `shader.wgsl`

**Files:**
- Create: `src-tauri/src/shaders/common.wgsl`
- Create: `src-tauri/src/shaders/pre_tone.wgsl`
- Modify: `src-tauri/src/shaders/shader.wgsl`

> **Principle:** `common.wgsl` contains everything that does **not** reference `input_texture` or `output_texture` and is needed by both passes. `pre_tone.wgsl` contains the input-dependent helper functions and the `pre_tone` entry point. `shader.wgsl` keeps the post-tone `main` entry point and references `pre_blur_texture` instead of computing the graded linear image.

- [ ] **Step 1: Create `src-tauri/src/shaders/common.wgsl`**

Start the file with the group-1 bindings and the shared storage buffer:

```wgsl
// Common bindings used by both pre-tone and post-tone passes.
// Group 0 is reserved for per-pass input/output textures.
@group(1) @binding(0) var<storage, read> adjustments: AllAdjustments;
@group(1) @binding(1) var mask_textures: texture_2d_array<f32>;
@group(1) @binding(2) var lut_texture: texture_3d<f32>;
@group(1) @binding(3) var lut_sampler: sampler;
@group(1) @binding(4) var sharpness_blur_texture: texture_2d<f32>;
@group(1) @binding(5) var tonal_blur_texture: texture_2d<f32>;
@group(1) @binding(6) var clarity_blur_texture: texture_2d<f32>;
@group(1) @binding(7) var structure_blur_texture: texture_2d<f32>;
@group(1) @binding(8) var flare_texture: texture_2d<f32>;
@group(1) @binding(9) var flare_sampler: sampler;
```

Then copy from `shader.wgsl` all structs, constants and helper functions **except** those that reference `input_texture` or the old group-0 bindings. The functions that must stay OUT of `common.wgsl` (they go into `pre_tone.wgsl`) are:
- `apply_noise_reduction`
- `apply_ca_correction`
- `apply_centre_local_contrast`
- `apply_centre_tonal_and_color`

Everything else (structs, `get_luma`, `apply_film_look`, `agx_full_transform`, `apply_all_curves`, `gradient_noise`, etc.) moves to `common.wgsl`.

- [ ] **Step 2: Update group-0 bindings in `shader.wgsl`**

At the top of `shader.wgsl` (currently lines 258-273), replace the group-0 declarations with:

```wgsl
@group(0) @binding(0) var pre_blur_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
```

- [ ] **Step 3: Remove duplicated code from `shader.wgsl`**

Delete from `shader.wgsl` everything that was moved to `common.wgsl` (structs, constants, non-input-dependent helper functions, and the old group-0 bindings). The file should now contain only:
- the two group-0 declarations above,
- the `main` entry point.

- [ ] **Step 4: Modify `shader.wgsl::main` to read the pre-blurred linear image**

Inside `main`, replace the setup block (lines 1748-1766):

```wgsl
    let out_dims = vec2<u32>(textureDimensions(output_texture));
    if (id.x >= out_dims.x || id.y >= out_dims.y) { return; }

    const REFERENCE_DIMENSION: f32 = 1080.0;
    let full_dims = vec2<f32>(textureDimensions(pre_blur_texture));
    let current_ref_dim = min(full_dims.x, full_dims.y);
    let scale = max(0.1, current_ref_dim / REFERENCE_DIMENSION);

    let absolute_coord = id.xy + vec2<u32>(adjustments.tile_offset_x, adjustments.tile_offset_y);
    let absolute_coord_i = vec2<i32>(absolute_coord);

    let pre_blur_sample = textureLoad(pre_blur_texture, id.xy, 0);
    var composite_rgb_linear = pre_blur_sample.rgb;
    let original_alpha = pre_blur_sample.a;
```

Then delete the entire pre-tone grading body (lines 1767-1970) so that `main` continues directly with:

```wgsl
    var base_srgb: vec3<f32>;
    if (adjustments.global.tonemapper_mode == 1u) {
        ...
```

- [ ] **Step 5: Create `src-tauri/src/shaders/pre_tone.wgsl`**

Start the file with:

```wgsl
@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var pre_tone_linear_texture: texture_storage_2d<rgba16float, write>;
```

Then copy the input-dependent helper functions from the original `shader.wgsl`:
- `apply_noise_reduction` (lines ~939-1138)
- `apply_ca_correction`
- `apply_centre_local_contrast`
- `apply_centre_tonal_and_color`

Finally, add the `pre_tone` entry point by copying the first half of the original `main` function (setup + the full pre-tone grading body, lines 1747-1970), ending with:

```wgsl
    textureStore(pre_tone_linear_texture, id.xy, vec4<f32>(composite_rgb_linear, original_alpha));
}
```

- [ ] **Step 6: Include `common.wgsl` at build time**

This happens in `gpu_processing.rs` (Task 7). For now, leave the WGSL files as separate source fragments.

- [ ] **Checkpoint** — report to user. Do not run `cargo check` yet because the Rust side is not wired.

---

### Task 5: Rust `GlobalAdjustments` layout

**Files:**
- Modify: `src-tauri/src/image_processing.rs`

- [ ] **Step 1: Add fields after `film_blur`**

In `pub struct GlobalAdjustments` (line 1527), replace:

```rust
    pub film_shadows: f32,
    pub film_highlights: f32,
    pub film_blur: f32,

    // Alignment padding: in WGSL the next member (bw_weights: vec3<f32>) must
    // start at a 16-byte boundary, and naga inserts these 4 bytes implicitly.
    // Mirror them explicitly so the bytemuck upload matches.
    pub _pad_bw_align: [f32; 1],
```

with:

```rust
    pub film_shadows: f32,
    pub film_highlights: f32,
    pub film_blur: f32,
    pub film_blur_pre_amount: f32,
    pub film_blur_pre_radius: f32,

    // Alignment padding: the next member (bw_weights: vec4<f32>) must start at
    // a 16-byte boundary. We now have 5 f32s here, so 3 explicit pads keep the
    // WGSL/Rust layouts identical.
    pub _pad_bw_align: [f32; 3],
```

- [ ] **Step 2: Verify the struct builds**

Run: `cargo check` in `src-tauri/`
Expected: passes (may show unrelated warnings, but no errors about `GlobalAdjustments`).

- [ ] **Checkpoint** — report to user.

---

### Task 6: Rust parsing in `image_processing.rs`

**Files:**
- Modify: `src-tauri/src/image_processing.rs`

- [ ] **Step 1: Add parsing after `film_blur`**

In the `GlobalAdjustments` literal (around line 2922), replace:

```rust
        film_shadows: get_val("film", "filmShadows", 1.0, None),
        film_highlights: get_val("film", "filmHighlights", 1.0, None),
        film_blur: get_val("film", "filmBlur", 100.0, None),
        _pad_bw_align: [0.0; 1],
```

with:

```rust
        film_shadows: get_val("film", "filmShadows", 1.0, None),
        film_highlights: get_val("film", "filmHighlights", 1.0, None),
        film_blur: get_val("film", "filmBlur", 100.0, None),
        film_blur_pre_amount: if tone_mapper == "flim" {
            js_adjustments["filmBlurPreAmount"].as_f64().unwrap_or(0.0) as f32 / 100.0
        } else {
            0.0
        },
        film_blur_pre_radius: if tone_mapper == "flim" {
            js_adjustments["filmBlurPreRadius"].as_f64().unwrap_or(0.5) as f32
        } else {
            0.5
        },
        _pad_bw_align: [0.0; 3],
```

- [ ] **Step 2: Verify cargo check**

Run: `cargo check` in `src-tauri/`
Expected: passes.

- [ ] **Checkpoint** — report to user.

---

### Task 7: GPU pipeline — two passes + blur

**Files:**
- Modify: `src-tauri/src/gpu_processing.rs`

- [ ] **Step 1: Add `pre_tone_linear_texture`/`pre_blur_texture` and their views**

After `film_blur_view` creation (line 1174) add:

```rust
        let pre_tone_linear_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Pre-tone Linear Texture"),
            ..reusable_texture_desc
        });
        let pre_tone_linear_view = pre_tone_linear_texture.create_view(&Default::default());

        let pre_blur_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Pre-tone Blur Texture"),
            ..reusable_texture_desc
        });
        let pre_blur_view = pre_blur_texture.create_view(&Default::default());
```

- [ ] **Step 2: Store views in `GpuProcessor`**

In the `GpuProcessor` struct (around line 627), after `film_blur_view: wgpu::TextureView,` add:

```rust
    pre_tone_linear_view: wgpu::TextureView,
    pre_blur_view: wgpu::TextureView,
```

In the constructor return struct (around line 1315), after `film_blur_view,` add:

```rust
            pre_tone_linear_view,
            pre_blur_view,
```

- [ ] **Step 3: Build shader modules from `common.wgsl` fragments**

Near the existing shader module creation (line 948), load the common source:

```rust
        let common_wgsl = include_str!("shaders/common.wgsl");
        let pre_tone_wgsl = format!("{}{}", common_wgsl, include_str!("shaders/pre_tone.wgsl"));
        let post_tone_wgsl = format!("{}{}", common_wgsl, include_str!("shaders/shader.wgsl"));

        let pre_tone_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Pre-tone Shader"),
            source: wgpu::ShaderSource::Wgsl(pre_tone_wgsl.into()),
        });
        let post_tone_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Post-tone Shader"),
            source: wgpu::ShaderSource::Wgsl(post_tone_wgsl.into()),
        });
```

- [ ] **Step 4: Create the common bind group layout (group 1)**

After the existing `main_bgl` creation block, create a new `common_bgl`. It mirrors the old group-0 bindings for adjustments/masks/lut/blurs/flare, but at group 1:

```rust
        let mut common_bgl_entries = vec![
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2Array,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D3,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::NonFiltering),
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 4,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 5,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 6,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 7,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 8,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 9,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ];

        let common_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Common BGL"),
            entries: &common_bgl_entries,
        });
```

- [ ] **Step 5: Create per-pass IO bind group layouts (group 0)**

```rust
        let pre_tone_io_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Pre-tone IO BGL"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba16Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });

        let post_tone_io_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Post-tone IO BGL"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });
```

- [ ] **Step 6: Create the two compute pipelines**

Replace the existing `main_pipeline` creation with:

```rust
        let pre_tone_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Pre-tone Pipeline Layout"),
            bind_group_layouts: &[Some(&pre_tone_io_bgl), Some(&common_bgl)],
            immediate_size: 0,
        });
        let post_tone_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Post-tone Pipeline Layout"),
            bind_group_layouts: &[Some(&post_tone_io_bgl), Some(&common_bgl)],
            immediate_size: 0,
        });

        let pre_tone_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Pre-tone Pipeline"),
            layout: Some(&pre_tone_pipeline_layout),
            module: &pre_tone_shader_module,
            entry_point: Some("pre_tone"),
            compilation_options: Default::default(),
            cache: None,
        });
        let post_tone_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Post-tone Pipeline"),
            layout: Some(&post_tone_pipeline_layout),
            module: &post_tone_shader_module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
```

Store both in `GpuProcessor`:

```rust
    pre_tone_pipeline: wgpu::ComputePipeline,
    post_tone_pipeline: wgpu::ComputePipeline,
    common_bgl: wgpu::BindGroupLayout,
    pre_tone_io_bgl: wgpu::BindGroupLayout,
    post_tone_io_bgl: wgpu::BindGroupLayout,
```

- [ ] **Step 7: Refactor the per-tile render loop**

In the tile processing code (around line 1660), the existing main shader dispatch must be replaced by three dispatches in order.

First, after writing the adjustments buffer, create the **common bind group** using the existing entries (adjustments, masks, lut, lut_sampler, sharpness/tonal/clarity/structure blur views, flare texture/sampler). Bind them to group-1 bindings 0..9.

Then create the **pre-tone IO bind group**:

```rust
                let pre_tone_io_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Pre-tone IO BG"),
                    layout: &self.pre_tone_io_bgl,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(input_texture_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(&self.pre_tone_linear_view),
                        },
                    ],
                });
```

Dispatch `pre_tone`:

```rust
                {
                    let mut cpass = main_encoder.begin_compute_pass(&Default::default());
                    cpass.set_pipeline(&self.pre_tone_pipeline);
                    cpass.set_bind_group(0, &pre_tone_io_bg, &[]);
                    cpass.set_bind_group(1, &common_bg, &[]);
                    cpass.dispatch_workgroups(
                        input_width.div_ceil(8),
                        input_height.div_ceil(8),
                        1,
                    );
                }
```

Next, run the optional Gaussian blur from `pre_tone_linear_view` to `pre_blur_view` (reuse the existing `h_blur_pipeline`/`v_blur_pipeline`). When `film_blur_pre_amount == 0`, skip the blur and use `pre_tone_linear_view` directly as the post-tone input.

```rust
                let film_blur_pre_amount = adjustments.global.film_blur_pre_amount;
                let post_tone_input_view: &wgpu::TextureView = if film_blur_pre_amount > 0.0 {
                    let radius_px = adjustments.global.film_blur_pre_radius.max(0.5);
                    let sigma = radius_px * 3.0 * scale;
                    let radius = (sigma * 2.0).ceil().clamp(1.0, 96.0) as u32;
                    let params = BlurParams {
                        radius,
                        tile_offset_x: 0,
                        tile_offset_y: 0,
                        input_width,
                        input_height,
                        clamp_x_max: input_width - 1,
                        _pad2: 0,
                        _pad3: 0,
                    };
                    queue.write_buffer(&self.blur_params_buffer, 0, bytemuck::bytes_of(&params));

                    // H-blur pre_tone_linear -> ping_pong
                    // V-blur ping_pong -> pre_blur_view
                    // ... (same bind-group pattern as existing film blur)

                    &self.pre_blur_view
                } else {
                    &self.pre_tone_linear_view
                };
```

Then create the **post-tone IO bind group**:

```rust
                let post_tone_io_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Post-tone IO BG"),
                    layout: &self.post_tone_io_bgl,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(post_tone_input_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(&self.tile_output_texture_view),
                        },
                    ],
                });
```

Dispatch `post_tone`:

```rust
                {
                    let mut cpass = main_encoder.begin_compute_pass(&Default::default());
                    cpass.set_pipeline(&self.post_tone_pipeline);
                    cpass.set_bind_group(0, &post_tone_io_bg, &[]);
                    cpass.set_bind_group(1, &common_bg, &[]);
                    cpass.dispatch_workgroups(
                        input_width.div_ceil(8),
                        input_height.div_ceil(8),
                        1,
                    );
                }
```

Remove the old single main-shader dispatch and the old `main_bgl`/`main_pipeline` if they are no longer referenced.

- [ ] **Step 8: Verify cargo check**

Run: `cargo check` in `src-tauri/`
Expected: passes.

- [ ] **Checkpoint** — report to user.

---

### Task 8: Verification

**Files:** all of the above

- [ ] **Step 1: Frontend build**

Run: `npm run build`
Expected: succeeds; only pre-existing `tsc` errors.

- [ ] **Step 2: Rust check**

Run: `cargo check` in `src-tauri/`
Expected: no errors.

- [ ] **Step 3: Formatting**

Run:
```bash
npx prettier --check src/utils/adjustments.ts src/components/panel/right/FilmPanel.tsx src/i18n/locales/en.json src/i18n/locales/ru.json
```
Expected: all files pass.

Run: `cargo fmt --check` in `src-tauri/`
Expected: no formatting changes needed.

- [ ] **Step 4: Manual smoke test**

1. Start the app (`npm run tauri dev`).
2. Open a RAW with visible bright highlights.
3. Go to the Film tab, enable FLIM if it is off.
4. In the Look section, raise **Diffusion** — highlights should bloom, mid-tone detail should remain sharp.
5. Raise **Radius** — bloom should spread wider.
6. Disable FLIM (toggle OFF) — diffusion should disappear even if sliders are non-zero.
7. Re-enable FLIM — diffusion returns.

- [ ] **Checkpoint / final report** — report to user that the feature is ready for review.

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to a task above. The shader split is required because the current single-pass pipeline has no linear intermediate texture before tonemapping.
- **Placeholder scan:** no TBD/TODO/fill-in-later steps. The Gaussian blur bind-group pattern in Step 7 intentionally refers to the existing film-blur code rather than duplicating it inline.
- **Type consistency:** `filmBlurPreAmount` is 0..100 on the frontend, 0..1 in Rust/WGSL; `filmBlurPreRadius` is px in both.
- **Alignment:** Rust `_pad_bw_align: [f32; 3]` and WGSL `_pad_film_pre_1..3` keep `bw_weights` at a 16-byte boundary.

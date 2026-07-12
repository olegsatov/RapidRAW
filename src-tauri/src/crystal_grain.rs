//! Crystal grain synthesis — port of Aurélien Pierre's "Stochastic
//! photographic grain synthesis from crystallographic structure simulation"
//! (2023, https://eng.aurelienpierre.com/2023/07/stochastic-photographic-grain-synthesis-from-crystallographic-structure-simulation/).
//!
//! The model: a photographic emulsion is a stack of N elementary crystal
//! layers. Each layer gets one random crystal shape (a regular polyhedron
//! with a log-normal size, gaussian vertex count, uniform rotation). The
//! input image intensity I is split equally between layers (I/N); seeds are
//! planted per pixel by thresholding a gaussian random variable so that the
//! surface filling ratio matches a user parameter, then grown into crystals
//! by convolving the seed map with the (non-normalized) crystal kernel.
//! Overlaps are clipped to enforce energy conservation, layers are summed,
//! the global exposure is matched to the input, and a printing model hides
//! the grain in fully-white areas (opaque negative).
//!
//! Like the IPOL renderer (`film_grain.rs`) this is a CPU, non-realtime
//! render wired as an explicit "render and save" action. Unlike IPOL it is
//! deterministic, allocation-light and its parameters (filling ratio, grain
//! size, layer count, size spread) map to physical emulsion properties.
//!
//! Differences from the reference Python code:
//! - The reference drew all randomness from numpy's global RNG (non-
//!   reproducible). We draw from the xorshift PRNG in `film_grain.rs`,
//!   seeded deterministically per layer and per seed row, so renders are
//!   bit-exact across runs and the per-row seed planting parallelizes.
//! - The gaussian threshold is evaluated as g = n_a + sqrt(n_a)·z with
//!   z ~ N(0,1), algebraically identical to the reference.
//! - The seed ratio `value` is clamped to (0.001, 0.999) before erfinv
//!   (the reference relied on scipy returning ±inf outside the domain).

use crate::app_state::AppState;
use crate::film_grain::{Prng, load_processed_for_grain};
use base64::{Engine as _, engine::general_purpose};
use image::{DynamicImage, ImageFormat, Rgb, Rgb32FImage};
use rayon::prelude::*;
use serde::Deserialize;
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CrystalGrainOptions {
    /// Surface filling ratio with AgX crystals per layer (Ilford emulsions
    /// from the 1960s ≈ 0.15; plausible range 0.15–0.5).
    pub filling: f32,
    /// Average grain (crystal kernel) size, in pixels.
    pub size: f32,
    /// Number of crystal layers (non-tabular B&W emulsions: 20–30; more
    /// layers dilute and average the grain away).
    pub layers: u32,
    /// Standard deviation of the log-normal crystal size distribution
    /// (higher = flakier, cloudier texture).
    pub std: f32,
    /// Seed offset for the whole grain field.
    pub seed: u32,
    /// Render one shared emulsion stack from the luma (B&W film behaviour,
    /// 3× faster) instead of three decorrelated channel stacks.
    pub monochrome: bool,
}

impl Default for CrystalGrainOptions {
    fn default() -> Self {
        CrystalGrainOptions {
            filling: 0.25,
            size: 5.0,
            layers: 30,
            std: 0.5,
            seed: 1,
            monochrome: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/// Inverse error function — Giles' single-precision rational approximation
/// (Horner form), matching scipy.special.erfinv to ~1e-6.
fn erfinv(x: f32) -> f32 {
    let x = x.clamp(-0.99999, 0.99999);
    let mut w = -((1.0 - x) * (1.0 + x)).ln();
    let p = if w < 5.0 {
        w -= 2.5;
        let mut p = 2.810_226_36e-08f32;
        p = 3.432_739_39e-07 + p * w;
        p = -3.523_387_7e-06 + p * w;
        p = -4.391_506_54e-06 + p * w;
        p = 0.000_218_580_87 + p * w;
        p = -0.001_253_725_03 + p * w;
        p = -0.004_177_681_64 + p * w;
        p = 0.246_640_727 + p * w;
        p = 1.501_409_41 + p * w;
        p
    } else {
        w = w.sqrt() - 3.0;
        let mut p = -0.000_200_214_257f32;
        p = 0.000_100_950_558 + p * w;
        p = 0.001_349_343_22 + p * w;
        p = -0.003_673_428_44 + p * w;
        p = 0.005_739_507_73 + p * w;
        p = -0.007_622_461_3 + p * w;
        p = 0.009_438_870_47 + p * w;
        p = 1.001_674_06 + p * w;
        p = 2.832_976_82 + p * w;
        p
    };
    p * x
}

/// Empiric fitting mapping a surface filling ratio to the gaussian seed
/// ratio (Pierre's fitting on [0; 0.8]).
fn filling_to_rand_variable(x: f32) -> f32 {
    let x = x.clamp(0.01, 0.95);
    1.121_390_63 * x.powf(1.055_776_24) / (x - 1.0).abs().powf(0.344_432_35)
}

// ---------------------------------------------------------------------------
// Crystal kernels
// ---------------------------------------------------------------------------

/// Rasterize one regular-polyhedron crystal kernel (width × width, values
/// 0/1). Kernel math runs in f64 to match the numpy reference bit-for-bit.
/// `n` is the number of vertices (3 = triangle … 8 = octagon), `rotation`
/// the orientation angle in radians.
fn create_crystal(width: usize, n: f64, rotation: f64) -> Vec<f32> {
    let eps = 1.0 / width as f64;
    let radius = (((width as f64 - 1.0) / 2.0) as i64).max(1) as f64;
    let mut kernel = vec![0.0f32; width * width];
    for i in 0..width {
        for j in 0..width {
            // Normalized kernel coordinates from the center, in [-1; 1].
            let x = i as f64 / radius - 1.0;
            let y = j as f64 / radius - 1.0;
            let r = (x * x + y * y).sqrt();
            // Radial distance of the shape envelope at the current angle.
            let arg = (n * (y.atan2(x) + rotation)).cos().clamp(-1.0, 1.0);
            let m = (std::f64::consts::PI / n).cos()
                / ((2.0 * arg.asin() + std::f64::consts::PI) / (2.0 * n)).cos();
            kernel[i * width + j] = if m >= r - eps { 1.0 } else { 0.0 };
        }
    }
    kernel
}

/// Pick one crystal size, shape and orientation from the dice rolls,
/// retrying when a small kernel rasterizes to nothing (area == 0).
fn pick_crystal(size: f32, std: f32, rng: &mut Prng) -> (Vec<f32>, usize) {
    loop {
        let shape = (rng.gaussian_0_1() * 1.5 + 6.0).clamp(3.0, 10.0) as f64;
        let rotation = rng.uniform_0_1() as f64 * 2.0 * std::f64::consts::PI;
        let log_normal = (size.ln() + std * rng.gaussian_0_1()).exp();
        let mut sz = log_normal.clamp(1.0, 3.0 * size) as usize;
        if sz % 2 == 0 {
            sz += 1;
        }
        let kernel = create_crystal(sz, shape, rotation);
        let area: f32 = kernel.iter().sum();
        if area > 0.0 {
            return (kernel, sz);
        }
    }
}

// ---------------------------------------------------------------------------
// Convolution
// ---------------------------------------------------------------------------

/// scipy 'symm' boundary index: (d c b a | a b c d | d c b a).
#[inline]
fn mirror(i: isize, n: usize) -> usize {
    let period = 2 * n as isize;
    let mut m = i.rem_euclid(period);
    if m >= n as isize {
        m = period - 1 - m;
    }
    m as usize
}

/// 2D convolution ('same', 'symm' borders) — i.e. correlation with the
/// flipped kernel, exactly like scipy.signal.convolve2d. Kernels are always
/// odd-sized, so the 'same' centering is exact.
fn convolve_same_symm(seeds: &[f32], w: usize, h: usize, kernel: &[f32], k: usize) -> Vec<f32> {
    // Pre-flip the kernel: convolution == correlation with flipped kernel.
    let mut flipped = vec![0.0f32; k * k];
    for di in 0..k {
        for dj in 0..k {
            flipped[di * k + dj] = kernel[(k - 1 - di) * k + (k - 1 - dj)];
        }
    }
    let c = (k / 2) as isize;
    let mut out = vec![0.0f32; w * h];
    out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        for (x, px) in row.iter_mut().enumerate() {
            let mut acc = 0.0f32;
            for di in 0..k {
                let sy = mirror(y as isize + di as isize - c, h);
                let srow = sy * w;
                let frow = di * k;
                for dj in 0..k {
                    let sx = mirror(x as isize + dj as isize - c, w);
                    acc += seeds[srow + sx] * flipped[frow + dj];
                }
            }
            *px = acc;
        }
    });
    out
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/// Render one channel (values in [0,1], row-major) with crystal grain.
/// Emits "crystal-grain-progress" per layer if `progress` is provided
/// (counter/total count layers across all channels).
pub fn render_crystal_grain_channel(
    img: &[f32],
    width: usize,
    height: usize,
    opts: &CrystalGrainOptions,
    progress: Option<(&AppHandle, &AtomicUsize, usize)>,
) -> Vec<f32> {
    let n_layers = opts.layers.max(1) as usize;
    let filling = opts.filling.clamp(0.0, 1.0);
    let size = opts.size.max(1.0);
    let pixels = width * height;

    let mut result = vec![0.0f32; pixels];
    let layer_density: Vec<f32> = img.iter().map(|&v| v / n_layers as f32).collect();
    let sigma = filling_to_rand_variable(filling);

    for layer_idx in 0..n_layers {
        // One crystal shape/size/orientation per layer (intra-layer model).
        let mut crystal_rng = Prng::new(
            opts.seed
                .wrapping_mul(2_654_435_761)
                .wrapping_add(layer_idx as u32)
                .wrapping_add(0x9E37_79B9),
        );
        let (kernel, k) = pick_crystal(size, opts.std, &mut crystal_rng);
        let crystal_area: f32 = kernel.iter().sum();

        // Seed planting: threshold a per-pixel gaussian so the seed ratio
        // yields the target surface filling once seeds grow into crystals.
        let n_a = filling * pixels as f32 / crystal_area;
        let value = if crystal_area == 1.0 {
            filling
        } else {
            sigma / crystal_area
        };
        let bound =
            erfinv(2.0 * value.clamp(0.001, 0.999) - 1.0) * std::f32::consts::SQRT_2 * n_a.sqrt();
        let threshold = n_a + bound;
        let sqrt_na = n_a.sqrt();

        // Lightness available to this layer, clipped by remaining headroom.
        let layer: Vec<f32> = (0..pixels)
            .map(|i| {
                let headroom = img[i] - result[i];
                if headroom < 0.0 {
                    // numpy clip with a_min > a_max returns a_max.
                    headroom
                } else {
                    layer_density[i].clamp(0.0, headroom)
                }
            })
            .collect();

        // Plant seeds (parallel per row; deterministic per-(layer,row) PRNG).
        let mut seeds = vec![0.0f32; pixels];
        seeds.par_chunks_mut(width).enumerate().for_each(|(y, row)| {
            let mut rng = Prng::new(
                opts.seed
                    .wrapping_add((layer_idx as u32).wrapping_mul(1_664_525))
                    .wrapping_add((y as u32).wrapping_mul(1_013_904_223)),
            );
            let base = y * width;
            for (x, s) in row.iter_mut().enumerate() {
                let g = n_a + sqrt_na * rng.gaussian_0_1();
                if g < threshold {
                    *s = layer[base + x];
                }
            }
        });

        // Grow the crystals, then enforce energy conservation where
        // crystals overlap (the kernel is not normalized).
        let grains = convolve_same_symm(&seeds, width, height, &kernel, k);
        for i in 0..pixels {
            result[i] += grains[i].min(layer[i]);
        }

        if let Some((app, counter, total)) = progress {
            let done = counter.fetch_add(1, AtomicOrdering::Relaxed) + 1;
            let pct = (done as f32 / total as f32 * 100.0).min(100.0);
            let _ = app.emit(
                "crystal-grain-progress",
                format!("Rendering crystal grain: {pct:.0}%"),
            );
        }
    }

    // Exposure compensation: match the input's average brightness, then the
    // printing model — fully white areas are opaque on the negative and
    // must show no grain (alpha compositing with mask = 1 - I).
    let mean_img = img.iter().sum::<f32>() / pixels as f32;
    let mean_res = result.iter().sum::<f32>() / pixels as f32;
    let coef = if mean_res > 1e-8 { mean_img / mean_res } else { 1.0 };
    for i in 0..pixels {
        let grainy = (result[i] * coef).clamp(0.0, 1.0);
        let mask = 1.0 - img[i];
        result[i] = (mask * grainy + (1.0 - mask) * img[i]).clamp(0.0, 1.0);
    }
    result
}

/// Apply crystal grain to an RGB image, one independent grain field per
/// channel (each dye layer of real film has its own emulsion stack). In
/// monochrome mode a single stack is rendered from the luma and applied to
/// all channels (B&W film behaviour — 3× cheaper, right model for B&W).
pub fn apply_crystal_grain_rgb(
    img: &Rgb32FImage,
    opts: &CrystalGrainOptions,
    app: Option<&AppHandle>,
) -> Rgb32FImage {
    let (w, h) = img.dimensions();
    let (w, h) = (w as usize, h as usize);
    let size = w * h;

    if opts.monochrome {
        let luma = crate::film_grain::luma_plane(img);
        if let Some(app) = app {
            let _ = app.emit(
                "crystal-grain-progress",
                "Rendering crystal grain: monochrome field",
            );
        }
        let counter = AtomicUsize::new(0);
        let total = opts.layers.max(1) as usize;
        let grained =
            render_crystal_grain_channel(&luma, w, h, opts, app.map(|a| (a, &counter, total)));
        return crate::film_grain::apply_mono_grain(img, &luma, &grained);
    }

    let mut channels = [vec![0.0f32; size], vec![0.0f32; size], vec![0.0f32; size]];
    for (i, p) in img.pixels().enumerate() {
        channels[0][i] = p[0].clamp(0.0, 1.0);
        channels[1][i] = p[1].clamp(0.0, 1.0);
        channels[2][i] = p[2].clamp(0.0, 1.0);
    }

    let counter = AtomicUsize::new(0);
    let total = opts.layers.max(1) as usize * 3;
    let mut rendered: Vec<Vec<f32>> = Vec::with_capacity(3);
    for (ch_idx, channel) in channels.iter().enumerate() {
        if let Some(app) = app {
            let _ = app.emit(
                "crystal-grain-progress",
                format!("Rendering crystal grain: channel {}/3", ch_idx + 1),
            );
        }
        let mut ch_opts = *opts;
        // Decorrelate the three grain fields (three emulsion layers).
        ch_opts.seed = opts.seed.wrapping_add(7919 * ch_idx as u32 + 1);
        rendered.push(render_crystal_grain_channel(
            channel,
            w,
            h,
            &ch_opts,
            app.map(|a| (a, &counter, total)),
        ));
    }

    let mut out = Rgb32FImage::new(w as u32, h as u32);
    for (i, p) in out.pixels_mut().enumerate() {
        *p = Rgb([rendered[0][i], rendered[1][i], rendered[2][i]]);
    }
    out
}

// ---------------------------------------------------------------------------
// Tauri command: render the current (fully processed) image through the
// crystal grain model and save it as a new file next to the original.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn render_crystal_grain(
    path: String,
    adjustments: Option<serde_json::Value>,
    options: Option<CrystalGrainOptions>,
    preview: Option<bool>,
    app_handle: AppHandle,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let opts = options.unwrap_or_default();
        let (mut processed, source_path) =
            load_processed_for_grain(&path, adjustments, &app_handle, "crystal-grain-progress")?;

        if preview.unwrap_or(false) {
            // 1:1 center crop at native resolution — the only honest preview
            // for a pixel-scale texture like grain (downscaling would
            // misrepresent the grain-to-detail ratio).
            let (w, h) = (processed.width(), processed.height());
            let cw = w.min(1200);
            let ch = h.min(800);
            processed = processed.crop_imm((w - cw) / 2, (h - ch) / 2, cw, ch);

            let _ = app_handle.emit(
                "crystal-grain-progress",
                "Rendering crystal grain: channel 1/3",
            );
            let rgb = processed.to_rgb32f();
            let grained = apply_crystal_grain_rgb(&rgb, &opts, Some(&app_handle));

            let mut buf = Cursor::new(Vec::new());
            DynamicImage::ImageRgb32F(grained)
                .to_rgb8()
                .write_to(&mut buf, ImageFormat::Png)
                .map_err(|e| format!("Failed to encode preview: {e}"))?;
            let data_url = format!(
                "data:image/png;base64,{}",
                general_purpose::STANDARD.encode(buf.get_ref())
            );
            let _ = app_handle.emit("crystal-grain-preview", &data_url);
            let _ = app_handle.emit("crystal-grain-complete", "");
            return Ok(String::new());
        }

        let _ = app_handle.emit(
            "crystal-grain-progress",
            "Rendering crystal grain: channel 1/3",
        );
        let rgb = processed.to_rgb32f();
        let grained = apply_crystal_grain_rgb(&rgb, &opts, Some(&app_handle));

        let source_str = source_path.to_string_lossy().to_string();
        let parent_dir = source_path.parent().unwrap_or_else(|| std::path::Path::new(""));
        let stem = source_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let output_path = parent_dir.join(format!("{stem}_XtalGrain.png"));

        let _ = app_handle.emit("crystal-grain-progress", "Saving...");
        DynamicImage::ImageRgb16(DynamicImage::ImageRgb32F(grained).to_rgb16())
            .save(&output_path)
            .map_err(|e| format!("Failed to save image: {e}"))?;

        let _ = crate::exif_processing::write_rrexif_sidecar(&source_str, &output_path);
        crate::film_grain::reveal_in_file_manager(&output_path);

        let out_str = output_path.to_string_lossy().to_string();
        let _ = app_handle.emit("crystal-grain-complete", out_str.clone());
        Ok(out_str)
    })
    .await
    .map_err(|e| format!("Crystal grain task failed: {e}"))?
}

// ---------------------------------------------------------------------------
// Baked grain field for the realtime preview (variant "bake-and-sample"):
// the crystal-stack model is linear in the local intensity u over its whole
// working range (seed values, convolution and the overlap clip all scale
// with u), so result = u·D(x) where the coverage fraction D is independent
// of the image. Rendering a flat u=0.5 field and extracting
// G = (out − u²) / ((1−u)·u) = 4·out − 1 therefore yields a pure
// multiplicative grain texture; the film post-pass then evaluates the full
// model out = u² + (u − u²)·G per pixel in one texture fetch. The only
// approximation is the highlight headroom depletion, which the printing
// model hides anyway.
// ---------------------------------------------------------------------------

/// Baked field tile size (px). Sampled with mirrored wrap, so it tiles
/// seamlessly; must match `grain_tile` in the film post-pass params.
pub const GRAIN_FIELD_TILE: usize = 1024;

/// Bake the mean-normalized coverage field G into an RGBA16F buffer
/// (three decorrelated fields in RGB, alpha = 1). G is clamped to [0, 32]
/// (f16-friendly); each channel is normalized to mean exactly 1 before
/// clamping, so the preview preserves the average brightness.
pub fn bake_grain_field(opts: &CrystalGrainOptions, tile: usize) -> Vec<half::f16> {
    let mut flat = Rgb32FImage::new(tile as u32, tile as u32);
    for p in flat.pixels_mut() {
        *p = Rgb([0.5, 0.5, 0.5]);
    }
    let mut ch_opts = *opts;
    // Always bake three decorrelated fields; the shader picks R for mono.
    ch_opts.monochrome = false;
    let out = apply_crystal_grain_rgb(&flat, &ch_opts, None);

    let n = (tile * tile) as f32;
    let mut mean = [0.0f32; 3];
    for p in out.pixels() {
        for c in 0..3 {
            mean[c] += 4.0 * p[c] - 1.0;
        }
    }
    for m in &mut mean {
        *m = (*m / n).max(1e-6);
    }

    let mut buf = Vec::with_capacity(tile * tile * 4);
    for p in out.pixels() {
        for c in 0..3 {
            let g = ((4.0 * p[c] - 1.0) / mean[c]).clamp(0.0, 32.0);
            buf.push(half::f16::from_f32(g));
        }
        buf.push(half::f16::from_f32(1.0));
    }
    buf
}

/// Tauri command: bake the crystal grain field on the CPU and upload it as
/// an RGBA16F texture into the shared GPU context. Emits
/// "crystal-grain-baked" when the texture is live.
#[tauri::command]
pub async fn bake_crystal_grain_field(
    options: Option<CrystalGrainOptions>,
    app_handle: AppHandle,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let opts = options.unwrap_or_default();
        let tile = GRAIN_FIELD_TILE;
        let data = bake_grain_field(&opts, tile);

        let state = app_handle.state::<AppState>();
        // Make sure the GPU context exists before we lock it for the swap.
        let _ = crate::gpu_processing::get_or_init_gpu_context(&state, &app_handle)?;
        let mut lock = state.gpu_context.lock().map_err(|e| e.to_string())?;
        let ctx = lock.as_mut().ok_or("GPU context not initialized")?;

        let size = wgpu::Extent3d {
            width: tile as u32,
            height: tile as u32,
            depth_or_array_layers: 1,
        };
        let texture = ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Crystal Grain Field"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        ctx.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(&data),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some((tile * 4 * 2) as u32),
                rows_per_image: Some(tile as u32),
            },
            size,
        );
        ctx.crystal_grain_view = Some(texture.create_view(&Default::default()));
        drop(lock);

        let _ = app_handle.emit("crystal-grain-baked", "");
        Ok(())
    })
    .await
    .map_err(|e| format!("Crystal grain bake task failed: {e}"))?
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erfinv_known_answers() {
        assert!((erfinv(0.0)).abs() < 1e-7);
        assert!((erfinv(0.5) - 0.476_936_276_2).abs() < 1e-6);
        assert!((erfinv(0.9) - 1.163_087_153).abs() < 1e-5);
        assert!((erfinv(-0.5) + erfinv(0.5)).abs() < 1e-7);
        assert!((erfinv(-0.9) + erfinv(0.9)).abs() < 1e-6);
    }

    #[test]
    fn filling_mapping_is_sane() {
        // Values computed from the reference formula (see module docs).
        assert!((filling_to_rand_variable(0.25) - 0.286_516).abs() < 1e-4);
        assert!((filling_to_rand_variable(0.5) - 0.684_890).abs() < 1e-4);
        // Monotone increasing over the plausible range.
        let mut prev = 0.0;
        for i in 5..=80 {
            let v = filling_to_rand_variable(i as f32 / 100.0);
            assert!(v > prev, "not monotone at {i}");
            prev = v;
        }
    }

    /// The article gives the exact 11-tap kernel for n = 5, φ = 0 — use it
    /// as a known-answer test for the crystal rasterizer.
    #[test]
    fn create_crystal_matches_reference_bitmap() {
        let expected: [u8; 121] = [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //
            0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, //
            0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, //
            0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, //
            0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, //
            0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, //
            0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, //
            0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, //
            0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, //
            0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, //
            0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
        ];
        let kernel = create_crystal(11, 5.0, 0.0);
        for (i, (&got, &want)) in kernel.iter().zip(expected.iter()).enumerate() {
            assert_eq!(
                got, want as f32,
                "pixel ({}, {}) mismatch",
                i / 11,
                i % 11
            );
        }
    }

    #[test]
    fn mirror_index_matches_scipy_symm() {
        // (d c b a | a b c d | d c b a) for n = 4.
        assert_eq!(mirror(0, 4), 0);
        assert_eq!(mirror(3, 4), 3);
        assert_eq!(mirror(-1, 4), 0);
        assert_eq!(mirror(-2, 4), 1);
        assert_eq!(mirror(-4, 4), 3);
        assert_eq!(mirror(-5, 4), 3);
        assert_eq!(mirror(4, 4), 3);
        assert_eq!(mirror(5, 4), 2);
        assert_eq!(mirror(7, 4), 0);
        assert_eq!(mirror(8, 4), 0);
    }

    /// Convolution (not correlation): a single seed stamped with the kernel
    /// must reproduce the kernel flipped both ways.
    #[test]
    fn convolve_is_convolution_not_correlation() {
        let (w, h) = (5usize, 5usize);
        let mut seeds = vec![0.0f32; w * h];
        seeds[2 * w + 2] = 1.0;
        #[rustfmt::skip]
        let kernel = vec![
            1.0, 2.0, 3.0,
            4.0, 5.0, 6.0,
            7.0, 8.0, 9.0,
        ];
        let out = convolve_same_symm(&seeds, w, h, &kernel, 3);
        // out[y][x] = kernel[y-1][x-1] for y,x in 1..=3 (see derivation:
        // the double flip cancels around a point seed).
        assert_eq!(out[1 * w + 1], 1.0);
        assert_eq!(out[1 * w + 2], 2.0);
        assert_eq!(out[2 * w + 3], 6.0);
        assert_eq!(out[3 * w + 3], 9.0);
        assert_eq!(out[3 * w + 1], 7.0);
        assert_eq!(out[0], 0.0);
    }

    #[test]
    fn render_is_deterministic() {
        let (w, h) = (32usize, 32usize);
        let mut img = vec![0.0f32; w * h];
        for y in 0..h {
            for x in 0..w {
                img[y * w + x] = (x as f32 / w as f32) * 0.8;
            }
        }
        let opts = CrystalGrainOptions {
            layers: 5,
            ..Default::default()
        };
        let a = render_crystal_grain_channel(&img, w, h, &opts, None);
        let b = render_crystal_grain_channel(&img, w, h, &opts, None);
        assert_eq!(a, b);
    }

    /// The exposure compensation must preserve the average brightness of a
    /// constant image (the model decomposes I, it must not darken it).
    #[test]
    fn constant_image_mean_preserved() {
        let (w, h) = (48usize, 48usize);
        let opts = CrystalGrainOptions {
            layers: 10,
            size: 3.0,
            filling: 0.3,
            std: 0.5,
            seed: 7,
            ..Default::default()
        };
        for &u in &[0.3f32, 0.5] {
            let img = vec![u; w * h];
            let out = render_crystal_grain_channel(&img, w, h, &opts, None);
            let mean = out.iter().sum::<f32>() / out.len() as f32;
            assert!(
                (mean - u).abs() < 0.06,
                "u={u}: mean={mean} (expected within 0.06)"
            );
        }
    }

    /// Monochrome mode: one shared emulsion stack rendered from the luma and
    /// applied as a hue-preserving gain — a constant color image must keep
    /// its channel means.
    #[test]
    fn monochrome_constant_color_preserves_channels() {
        let (w, h) = (48usize, 48usize);
        let (r, g, b) = (0.3f32, 0.5f32, 0.7f32);
        let mut img = Rgb32FImage::new(w as u32, h as u32);
        for p in img.pixels_mut() {
            *p = Rgb([r, g, b]);
        }
        let opts = CrystalGrainOptions {
            layers: 10,
            size: 3.0,
            filling: 0.3,
            monochrome: true,
            seed: 7,
            ..Default::default()
        };
        let out = apply_crystal_grain_rgb(&img, &opts, None);
        let n = (w * h) as f32;
        let (mut mr, mut mg, mut mb) = (0.0f32, 0.0f32, 0.0f32);
        for p in out.pixels() {
            mr += p[0];
            mg += p[1];
            mb += p[2];
        }
        assert!((mr / n - r).abs() < 0.06, "R mean {}", mr / n);
        assert!((mg / n - g).abs() < 0.06, "G mean {}", mg / n);
        assert!((mb / n - b).abs() < 0.06, "B mean {}", mb / n);
    }

    /// The baked field must be mean-normalized per channel (brightness
    /// preserving), in range, and deterministic.
    #[test]
    fn bake_is_normalized_and_deterministic() {
        let opts = CrystalGrainOptions {
            layers: 5,
            size: 3.0,
            filling: 0.3,
            seed: 7,
            ..Default::default()
        };
        let tile = 64usize;
        let a = bake_grain_field(&opts, tile);
        let b = bake_grain_field(&opts, tile);
        assert_eq!(a.len(), tile * tile * 4);
        assert_eq!(a, b);

        let n = (tile * tile) as f32;
        for c in 0..3 {
            let mean: f32 = (0..tile * tile)
                .map(|i| a[i * 4 + c].to_f32())
                .sum::<f32>()
                / n;
            assert!(
                (mean - 1.0).abs() < 0.05,
                "channel {c}: mean {mean} (expected ~1)"
            );
        }
        for &v in &a {
            let f = v.to_f32();
            assert!((0.0..=32.0).contains(&f), "out of range: {f}");
        }
    }

    #[test]
    fn black_stays_black_and_white_stays_white() {
        let (w, h) = (16usize, 16usize);
        let opts = CrystalGrainOptions {
            layers: 5,
            ..Default::default()
        };
        let black = vec![0.0f32; w * h];
        let out = render_crystal_grain_channel(&black, w, h, &opts, None);
        assert!(out.iter().all(|&v| v == 0.0));

        let white = vec![1.0f32; w * h];
        let out = render_crystal_grain_channel(&white, w, h, &opts, None);
        assert!(out.iter().all(|&v| (v - 1.0).abs() < 1e-6));
    }
}

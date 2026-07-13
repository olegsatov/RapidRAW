//! Film grain rendering — port of Newson et al., "Realistic Film Grain
//! Rendering" (IPOL 2017, https://www.ipol.im/pub/art/2017/192/, GPL V3+).
//!
//! The model: film emulsion as a Boolean model from stochastic geometry.
//! Grain centres are thrown by a Poisson point process whose intensity
//! depends on the local image intensity (lambda(u)); grain radii are
//! constant or log-normal. Each output pixel is the Monte-Carlo estimate
//! of the probability that the (Gaussian-jittered) point is covered by a
//! grain. The result is NOT noise overlaid on the image — the image is
//! re-rendered *through* the emulsion, so coverage == intensity in
//! expectation (E[out] = u for a constant image u).
//!
//! This is a CPU, non-realtime renderer (~0.3 s per 0.2 MP at 100 MC on
//! modern many-core hardware; roughly a minute for 24 MP). It is wired as
//! an explicit "render and save" action, not as an adjustment.
//!
//! Deviations from the reference C++ implementation:
//! - The Monte-Carlo jitter vectors are drawn deterministically per pixel
//!   from the same xorshift PRNG (the C++ pixel-wise path used a global
//!   mt19937 seeded by random_device, making its output non-reproducible,
//!   and applied sigmaFilter twice). Ours: jitter ~ N(0, sigmaFilter^2),
//!   applied once — matching the grain-wise reference path.
//! - The grain-wise algorithm is not ported (slower for the small radii
//!   we use and memory-hungry); pixel-wise only.
//! - lambdaList in C++ was allocated 255 floats but filled 256
//!   (off-by-one heap overflow); we allocate 256 correctly.

use crate::app_state::AppState;
use crate::file_management::parse_virtual_path;
use crate::formats::is_raw_file;
use crate::image_loader::load_and_composite;
use base64::{Engine as _, engine::general_purpose};
use image::{DynamicImage, ImageFormat, Rgb, Rgb32FImage};
use rayon::prelude::*;
use serde::Deserialize;
use std::fs;
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use tauri::{AppHandle, Emitter, Manager};

const MAX_GREY_LEVEL: usize = 255;
const EPSILON_GREY_LEVEL: f32 = 0.1;
const PI: f32 = std::f32::consts::PI;

// ---------------------------------------------------------------------------
// PRNG — exact port of pseudo_random_number_generator.cpp
// (wang_hash seed scramble + Marsaglia xorshift + Box-Muller + inverse-
// transform Poisson). Verified bit-exact against the reference binary.
// ---------------------------------------------------------------------------

fn wang_hash(seed: u32) -> u32 {
    let mut s = seed;
    s = (s ^ 61) ^ (s >> 16);
    s = s.wrapping_mul(9);
    s ^= s >> 4;
    s = s.wrapping_mul(668_265_261);
    s ^= s >> 15;
    s
}

/// Unique seed for a grid cell. C++ took signed cell coords as `unsigned int`
/// (wrapping negatives); `as u32` reproduces that exactly.
fn cellseed(x: i32, y: i32, offset: u32) -> u32 {
    const PERIOD: u32 = 65536;
    let s = ((y as u32) % PERIOD)
        .wrapping_mul(PERIOD)
        .wrapping_add((x as u32) % PERIOD)
        .wrapping_add(offset);
    if s == 0 { 1 } else { s }
}

pub(crate) struct Prng {
    state: u32,
}

impl Prng {
    pub(crate) fn new(seed: u32) -> Self {
        Prng {
            state: wang_hash(seed),
        }
    }

    #[inline(always)]
    fn next_u32(&mut self) -> u32 {
        let mut s = self.state;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.state = s;
        s
    }

    #[inline(always)]
    pub(crate) fn uniform_0_1(&mut self) -> f32 {
        self.next_u32() as f32 / 4_294_967_295.0
    }

    /// Standard normal via Box-Muller (one variate, like the C++ version).
    #[inline(always)]
    pub(crate) fn gaussian_0_1(&mut self) -> f32 {
        let u = self.uniform_0_1();
        let v = self.uniform_0_1();
        (-2.0 * u.ln()).sqrt() * (2.0 * PI * v).cos()
    }

    /// Poisson(lambda) via inverse transform sampling. `exp_neg_lambda` is
    /// exp(-lambda), precomputed by the caller.
    fn poisson(&mut self, lambda: f32, exp_neg_lambda: f32) -> u32 {
        let u = self.uniform_0_1();
        let mut x = 0u32;
        let mut prod = if exp_neg_lambda <= 0.0 {
            (-lambda).exp()
        } else {
            exp_neg_lambda
        };
        let mut sum = prod;
        let cap = (10000.0 * lambda).floor() as u32;
        while u > sum && x < cap {
            x += 1;
            prod = prod * lambda / x as f32;
            sum += prod;
        }
        x
    }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FilmGrainOptions {
    /// Average grain radius, in input-image pixels (reference default 0.1).
    pub mu_r: f32,
    /// Std-dev of grain radii, as a fraction of mu_r (0 = constant radius).
    pub sigma_r: f32,
    /// Sigma of the Gaussian filter applied to the continuous model, px
    /// (reference default 0.8).
    pub sigma_filter: f32,
    /// Monte-Carlo iterations per pixel (reference default 800; 100 is a
    /// good quality/speed trade-off).
    pub n_monte_carlo: u32,
    /// Seed offset for the whole grain field.
    pub seed: u32,
    /// Render one shared grain field from the luma (B&W film behaviour,
    /// 3× faster) instead of three decorrelated channel fields.
    pub monochrome: bool,
}

impl Default for FilmGrainOptions {
    fn default() -> Self {
        FilmGrainOptions {
            mu_r: 0.1,
            sigma_r: 0.0,
            sigma_filter: 0.8,
            n_monte_carlo: 100,
            seed: 1,
            monochrome: false,
        }
    }
}

/// Render one output pixel: Monte-Carlo estimate of the coverage probability.
#[allow(clippy::too_many_arguments)]
#[inline]
fn render_pixel(
    img_in: &[f32],
    m_in: usize,
    n_in: usize,
    y_out: usize,
    x_out: usize,
    m_out: usize,
    n_out: usize,
    offset: u32,
    n_monte_carlo: u32,
    grain_radius: f32,
    sigma_r: f32,
    sigma_filter: f32,
    x_a: f32,
    y_a: f32,
    x_b: f32,
    y_b: f32,
    lambda_list: &[f32],
    exp_lambda_list: &[f32],
) -> f32 {
    let normal_quantile = 3.0902f32; // standard normal quantile for alpha=0.999
    let grain_radius_sq = grain_radius * grain_radius;
    let mut max_radius = grain_radius;
    let (mut mu, mut sigma) = (0.0f32, 0.0f32);

    let ag = 1.0 / (1.0 / grain_radius).ceil();
    let s_x = (n_out as f32 - 1.0) / (x_b - x_a);
    let s_y = (m_out as f32 - 1.0) / (y_b - y_a);

    let mut p_monte_carlo = Prng::new(2016u32.wrapping_mul(offset));

    let mut pix_out = 0.0f32;

    // Output grid -> input grid, sampling the middle of the output pixel.
    let x_in = x_a + (x_out as f32 + 0.5) * ((x_b - x_a) / n_out as f32);
    let y_in = y_a + (y_out as f32 + 0.5) * ((y_b - y_a) / m_out as f32);

    if sigma_r > 0.0 {
        sigma = ((sigma_r / grain_radius) * (sigma_r / grain_radius) + 1.0)
            .ln()
            .sqrt();
        let sigma_sq = sigma * sigma;
        mu = grain_radius.ln() - sigma_sq / 2.0;
        max_radius = (mu + sigma * normal_quantile).exp();
    }

    for _ in 0..n_monte_carlo {
        // Deterministic per-pixel jitter (see module notes).
        let x_gaussian = x_in + sigma_filter * p_monte_carlo.gaussian_0_1() / s_x;
        let y_gaussian = y_in + sigma_filter * p_monte_carlo.gaussian_0_1() / s_y;

        let min_x = ((x_gaussian - max_radius) / ag).floor() as i32;
        let max_x = ((x_gaussian + max_radius) / ag).floor() as i32;
        let min_y = ((y_gaussian - max_radius) / ag).floor() as i32;
        let max_y = ((y_gaussian + max_radius) / ag).floor() as i32;

        'cells: for ncx in min_x..=max_x {
            for ncy in min_y..=max_y {
                let cell_corner_x = ag * ncx as f32;
                let cell_corner_y = ag * ncy as f32;

                let seed = cellseed(ncx, ncy, offset);
                let mut p = Prng::new(seed);

                // Poisson intensity from the input grey level at the cell corner.
                let row = cell_corner_y
                    .floor()
                    .clamp(0.0, (m_in - 1) as f32) as usize;
                let col = cell_corner_x
                    .floor()
                    .clamp(0.0, (n_in - 1) as f32) as usize;
                let u = img_in[row * n_in + col];
                let u_ind = ((u * (MAX_GREY_LEVEL as f32 + EPSILON_GREY_LEVEL)).floor() as usize)
                    .min(MAX_GREY_LEVEL);
                let curr_lambda = lambda_list[u_ind];
                let curr_exp_lambda = exp_lambda_list[u_ind];

                let n_cell = p.poisson(curr_lambda, curr_exp_lambda);
                for _ in 0..n_cell {
                    let x_centre = cell_corner_x + ag * p.uniform_0_1();
                    let y_centre = cell_corner_y + ag * p.uniform_0_1();

                    let curr_grain_radius_sq = if sigma_r > 0.0 {
                        let r = (mu + sigma * p.gaussian_0_1()).exp().min(max_radius);
                        r * r
                    } else {
                        grain_radius_sq
                    };

                    let dx = x_centre - x_gaussian;
                    let dy = y_centre - y_gaussian;
                    if dx * dx + dy * dy < curr_grain_radius_sq {
                        pix_out += 1.0;
                        break 'cells;
                    }
                }
            }
        }
    }
    pix_out / n_monte_carlo as f32
}

/// Render one channel (values in [0,1], row-major) with film grain.
/// Emits "film-grain-progress" every ~5% if `progress` is provided.
pub fn render_film_grain_channel(
    img_in: &[f32],
    width: usize,
    height: usize,
    opts: &FilmGrainOptions,
    progress: Option<(&AppHandle, &AtomicUsize, usize)>,
) -> Vec<f32> {
    let ag = 1.0 / (1.0 / opts.mu_r).ceil();

    // Precompute lambda and exp(-lambda) for each possible grey level.
    let mut lambda_list = vec![0.0f32; MAX_GREY_LEVEL + 1];
    let mut exp_lambda_list = vec![0.0f32; MAX_GREY_LEVEL + 1];
    for i in 0..=MAX_GREY_LEVEL {
        let u = i as f32 / (MAX_GREY_LEVEL as f32 + EPSILON_GREY_LEVEL);
        let lambda = -(ag * ag / (PI * (opts.mu_r * opts.mu_r + opts.sigma_r * opts.sigma_r)))
            * (1.0 - u).ln();
        lambda_list[i] = lambda;
        exp_lambda_list[i] = (-lambda).exp();
    }

    let mut out = vec![0.0f32; width * height];
    out.par_chunks_mut(width).enumerate().for_each(|(y, row)| {
        for (x, px) in row.iter_mut().enumerate() {
            *px = render_pixel(
                img_in,
                height,
                width,
                y,
                x,
                height,
                width,
                opts.seed,
                opts.n_monte_carlo,
                opts.mu_r,
                opts.sigma_r,
                opts.sigma_filter,
                0.0,
                0.0,
                width as f32,
                height as f32,
                &lambda_list,
                &exp_lambda_list,
            );
        }
        if let Some((app, counter, total)) = progress {
            let done = counter.fetch_add(width, AtomicOrdering::Relaxed) + width;
            let step = (total / 20).max(1);
            if done % step < width {
                let pct = (done as f32 / total as f32 * 100.0).min(100.0);
                let _ = app.emit("film-grain-progress", format!("Rendering grain: {pct:.0}%"));
            }
        }
    });
    out
}

/// Rec.709 luma plane of an RGB image (row-major, values in [0,1]).
pub(crate) fn luma_plane(img: &Rgb32FImage) -> Vec<f32> {
    img.pixels()
        .map(|p| 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2])
        .collect()
}

/// Apply a monochrome grain field (rendered from the luma plane) to a color
/// image as a hue-preserving luminance gain: `out_ch = in_ch · L'/L`.
pub(crate) fn apply_mono_grain(
    img: &Rgb32FImage,
    luma: &[f32],
    grained: &[f32],
) -> Rgb32FImage {
    let (w, h) = img.dimensions();
    let mut out = Rgb32FImage::new(w, h);
    for (i, (src, dst)) in img.pixels().zip(out.pixels_mut()).enumerate() {
        let gain = grained[i] / luma[i].max(1e-6);
        *dst = Rgb([
            (src[0] * gain).clamp(0.0, 1.0),
            (src[1] * gain).clamp(0.0, 1.0),
            (src[2] * gain).clamp(0.0, 1.0),
        ]);
    }
    out
}

/// Apply film grain to an RGB image, one independent grain field per channel
/// (each dye layer of real film has its own grain). In monochrome mode a
/// single field is rendered from the luma and applied to all channels
/// (B&W film behaviour — 3× cheaper, and the right model for B&W images).
pub fn apply_film_grain_rgb(
    img: &Rgb32FImage,
    opts: &FilmGrainOptions,
    app: Option<&AppHandle>,
) -> Rgb32FImage {
    let (w, h) = img.dimensions();
    let (w, h) = (w as usize, h as usize);
    let size = w * h;

    if opts.monochrome {
        let luma = luma_plane(img);
        if let Some(app) = app {
            let _ = app.emit("film-grain-progress", "Rendering grain: monochrome field");
        }
        let counter = AtomicUsize::new(0);
        let grained = render_film_grain_channel(
            &luma,
            w,
            h,
            opts,
            app.map(|a| (a, &counter, size)),
        );
        return apply_mono_grain(img, &luma, &grained);
    }

    let mut channels = [vec![0.0f32; size], vec![0.0f32; size], vec![0.0f32; size]];
    for (i, p) in img.pixels().enumerate() {
        channels[0][i] = p[0];
        channels[1][i] = p[1];
        channels[2][i] = p[2];
    }

    let counter = AtomicUsize::new(0);
    let total = size * 3;
    let mut rendered: Vec<Vec<f32>> = Vec::with_capacity(3);
    for (ch_idx, channel) in channels.iter().enumerate() {
        if let Some(app) = app {
            let _ = app.emit(
                "film-grain-progress",
                format!("Rendering grain: channel {}/3", ch_idx + 1),
            );
        }
        let mut ch_opts = *opts;
        // Decorrelate the three grain fields (three emulsion layers).
        ch_opts.seed = opts.seed.wrapping_add(7919 * ch_idx as u32 + 1);
        rendered.push(render_film_grain_channel(
            channel,
            w,
            h,
            &ch_opts,
            app.map(|a| (a, &counter, total)),
        ));
    }

    let mut out = Rgb32FImage::new(w as u32, h as u32);
    for (i, p) in out.pixels_mut().enumerate() {
        *p = Rgb([
            rendered[0][i].clamp(0.0, 1.0),
            rendered[1][i].clamp(0.0, 1.0),
            rendered[2][i].clamp(0.0, 1.0),
        ]);
    }
    out
}

// ---------------------------------------------------------------------------
// Shared front half of the physical grain render commands.
// ---------------------------------------------------------------------------

/// Resolve the (possibly virtual) path, load the sidecar/hydrated adjustments
/// with both procedural grains disabled (the physical grain renders replace
/// them), and run the full processing pipeline. Returns the processed image
/// and the resolved source path (for naming the output file).
pub(crate) fn load_processed_for_grain(
    path: &str,
    adjustments: Option<serde_json::Value>,
    app_handle: &AppHandle,
    progress_event: &str,
) -> Result<(DynamicImage, std::path::PathBuf), String> {
    let state = app_handle.state::<AppState>();
    let (source_path, sidecar_path) = parse_virtual_path(path);
    let source_str = source_path.to_string_lossy().to_string();

    let _ = app_handle.emit(progress_event, "Loading image...");

    let mut js_adjustments = match adjustments {
        Some(a) => a,
        None => crate::exif_processing::load_sidecar(&sidecar_path).adjustments,
    };
    crate::adjustment_utils::hydrate_adjustments(&state, &mut js_adjustments);

    // The physical grain render replaces the procedural grain — disable the
    // native (Effects) grain for this pass.
    if let Some(obj) = js_adjustments.as_object_mut() {
        obj.insert("grainAmount".to_string(), serde_json::json!(0));
    }

    let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
    let bytes = fs::read(&source_str).map_err(|e| e.to_string())?;
    let base_image = load_and_composite(&bytes, &source_str, &js_adjustments, false, &settings, None)
        .map_err(|e| format!("Failed to load image: {e}"))?;

    let _ = app_handle.emit(progress_event, "Processing image...");
    let is_raw = is_raw_file(&source_str);
    let context = crate::gpu_processing::get_or_init_gpu_context(&state, &app_handle)?;
    let processed = crate::export_processing::process_image_for_export_pipeline(
        &source_str,
        &base_image,
        &js_adjustments,
        &context,
        &state,
        is_raw,
        "grain_render",
        app_handle,
    )?;
    Ok((processed, source_path))
}

/// Reveal a freshly saved file in the OS file manager (best-effort,
/// fire-and-forget). On macOS the file is selected in Finder (`open -R`).
pub(crate) fn reveal_in_file_manager(path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg("-R").arg(path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn();
    }
    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    {
        if let Some(parent) = path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        }
    }
    let _ = path;
}

// ---------------------------------------------------------------------------
// Tauri command: render the current (fully processed) image through the film
// grain model and save it as a new file next to the original.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn render_film_grain(
    path: String,
    adjustments: Option<serde_json::Value>,
    options: Option<FilmGrainOptions>,
    preview: Option<bool>,
    app_handle: AppHandle,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let opts = options.unwrap_or_default();
        let (mut processed, source_path) =
            load_processed_for_grain(&path, adjustments, &app_handle, "film-grain-progress")?;

        if preview.unwrap_or(false) {
            // 1:1 center crop at native resolution — the only honest preview
            // for a pixel-scale texture like grain (downscaling would
            // misrepresent the grain-to-detail ratio).
            let (w, h) = (processed.width(), processed.height());
            let cw = w.min(1200);
            let ch = h.min(800);
            processed = processed.crop_imm((w - cw) / 2, (h - ch) / 2, cw, ch);

            let _ = app_handle.emit("film-grain-progress", "Rendering grain: channel 1/3");
            let rgb = processed.to_rgb32f();
            let grained = apply_film_grain_rgb(&rgb, &opts, Some(&app_handle));

            let mut buf = Cursor::new(Vec::new());
            DynamicImage::ImageRgb32F(grained)
                .to_rgb8()
                .write_to(&mut buf, ImageFormat::Png)
                .map_err(|e| format!("Failed to encode preview: {e}"))?;
            let data_url = format!(
                "data:image/png;base64,{}",
                general_purpose::STANDARD.encode(buf.get_ref())
            );
            let _ = app_handle.emit("film-grain-preview", &data_url);
            let _ = app_handle.emit("film-grain-complete", "");
            return Ok(String::new());
        }

        let _ = app_handle.emit("film-grain-progress", "Rendering grain: channel 1/3");
        let rgb = processed.to_rgb32f();
        let grained = apply_film_grain_rgb(&rgb, &opts, Some(&app_handle));

        let source_str = source_path.to_string_lossy().to_string();
        let parent_dir = source_path.parent().unwrap_or_else(|| std::path::Path::new(""));
        let stem = source_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let output_path = parent_dir.join(format!("{stem}_Grain.png"));

        let _ = app_handle.emit("film-grain-progress", "Saving...");
        DynamicImage::ImageRgb16(DynamicImage::ImageRgb32F(grained).to_rgb16())
            .save(&output_path)
            .map_err(|e| format!("Failed to save image: {e}"))?;

        let _ = crate::exif_processing::write_rrexif_sidecar(&source_str, &output_path);
        reveal_in_file_manager(&output_path);

        let out_str = output_path.to_string_lossy().to_string();
        let _ = app_handle.emit("film-grain-complete", out_str.clone());
        Ok(out_str)
    })
    .await
    .map_err(|e| format!("Film grain task failed: {e}"))?
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prng_matches_reference_binary() {
        // Values produced by the reference C++ implementation
        // (scratch/ipol192, /tmp/prng_ref).
        assert_eq!(wang_hash(1), 663_891_101);
        assert_eq!(wang_hash(12345), 232_713_235);
        assert_eq!(cellseed(-3, 7, 2016), 526_301);

        let mut p = Prng::new(wang_hash(12345));
        let expected = [
            3_149_911_574u32,
            1_859_904_424,
            1_198_765_343,
            198_832_919,
            2_195_337_354,
        ];
        for e in expected {
            assert_eq!(p.next_u32(), e);
        }

        let mut q = Prng::new(999);
        assert!((q.uniform_0_1() - 0.872_797_966).abs() < 1e-6);
        assert!((q.gaussian_0_1() - 2.177_759_409).abs() < 1e-5);

        let mut r = Prng::new(42);
        assert_eq!(r.poisson(3.5, (-3.5f32).exp()), 3);
        assert_eq!(r.poisson(0.2, (-0.2f32).exp()), 0);
    }

    /// For a constant image u, the Boolean model's coverage probability is
    /// exactly u in expectation: lambda is built so that
    /// P(covered) = 1 - exp(-lambda * pi r^2 / ag^2) = u.
    /// This validates the whole lambda/Poisson/coverage chain end-to-end.
    #[test]
    fn constant_image_mean_equals_intensity() {
        let (w, h) = (48usize, 48usize);
        let opts = FilmGrainOptions {
            n_monte_carlo: 400,
            ..Default::default()
        };
        for &u in &[0.2f32, 0.5, 0.8] {
            let img = vec![u; w * h];
            let out = render_film_grain_channel(&img, w, h, &opts, None);
            let mean = out.iter().sum::<f32>() / out.len() as f32;
            assert!(
                (mean - u).abs() < 0.02,
                "u={u}: mean={mean} (expected within 0.02)"
            );
        }
    }

    /// Monochrome mode: one shared grain field rendered from the luma and
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
        let opts = FilmGrainOptions {
            n_monte_carlo: 400,
            monochrome: true,
            ..Default::default()
        };
        let out = apply_film_grain_rgb(&img, &opts, None);
        let n = (w * h) as f32;
        let (mut mr, mut mg, mut mb) = (0.0f32, 0.0f32, 0.0f32);
        for p in out.pixels() {
            mr += p[0];
            mg += p[1];
            mb += p[2];
        }
        assert!((mr / n - r).abs() < 0.05, "R mean {}", mr / n);
        assert!((mg / n - g).abs() < 0.05, "G mean {}", mg / n);
        assert!((mb / n - b).abs() < 0.05, "B mean {}", mb / n);
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
        let opts = FilmGrainOptions {
            n_monte_carlo: 50,
            sigma_r: 0.5,
            ..Default::default()
        };
        let a = render_film_grain_channel(&img, w, h, &opts, None);
        let b = render_film_grain_channel(&img, w, h, &opts, None);
        assert_eq!(a, b);
    }

    #[test]
    fn black_stays_black() {
        let (w, h) = (16usize, 16usize);
        let img = vec![0.0f32; w * h];
        let opts = FilmGrainOptions {
            n_monte_carlo: 50,
            ..Default::default()
        };
        let out = render_film_grain_channel(&img, w, h, &opts, None);
        assert!(out.iter().all(|&v| v == 0.0));
    }
}

//! Visual + numeric check for the crystal grain (Pierre) preview display
//! modes. Emulates on the CPU exactly what the film_post shader does with
//! the baked coverage field, for the old trilinear sampling and the three
//! nearest-based preview modes (accurate / balanced / crisp), and compares
//! them against the export ground truth (full CPU render, box-downscaled —
//! i.e. "the exported file viewed at the same size").
//!
//! Usage: cargo run --release --example grain_preview_modes -- [out_dir] [filling] [size] [layers] [std]
//! Writes PNGs and prints per-variant mean/std (std = perceived grain contrast).

use image::{Rgb, Rgb32FImage};
use rapidraw_lib::crystal_grain::{
    CrystalGrainOptions, apply_crystal_grain_rgb, bake_grain_field, mip_contrast_ratios,
};

// Test image: flat mid-gray at FULL resolution (the baked field is authored
// at full-res pixel scale; u = 0.5 makes the bake's linearization exact).
const FULL_W: usize = 1024;
const FULL_H: usize = 640;
const U: f32 = 0.5;

/// scipy 'symm' mirror (same wrap as the GPU sampler's MirrorRepeat).
fn mirror(i: isize, n: usize) -> usize {
    let period = 2 * n as isize;
    let mut m = i.rem_euclid(period);
    if m >= n as isize {
        m = period - 1 - m;
    }
    m as usize
}

/// Nearest texel at texel-space point (texel centers at i + 0.5).
fn nearest(mip: &[f32], dim: usize, tx: f32, ty: f32, c: usize) -> f32 {
    let x = mirror(tx.floor() as isize, dim);
    let y = mirror(ty.floor() as isize, dim);
    mip[(y * dim + x) * 4 + c]
}

/// Bilinear sample at texel-space point — the old (blurry) GPU behaviour.
fn bilinear(mip: &[f32], dim: usize, tx: f32, ty: f32, c: usize) -> f32 {
    let fx = tx - 0.5;
    let fy = ty - 0.5;
    let x0 = fx.floor() as isize;
    let y0 = fy.floor() as isize;
    let ax = (fx - x0 as f32) as f32;
    let ay = (fy - y0 as f32) as f32;
    let p = |dx: isize, dy: isize| mip[(mirror(y0 + dy, dim) * dim + mirror(x0 + dx, dim)) * 4 + c];
    (p(0, 0) * (1.0 - ax) + p(1, 0) * ax) * (1.0 - ay) + (p(0, 1) * (1.0 - ax) + p(1, 1) * ax) * ay
}

/// The shader's application model: out = u² + (u − u²)·G per channel.
fn apply_g(g: [f32; 3]) -> [u8; 3] {
    let mut out = [0u8; 3];
    for c in 0..3 {
        let v = (U * U + (U - U * U) * g[c]).clamp(0.0, 1.0);
        out[c] = (v * 255.0).round() as u8;
    }
    out
}

fn mean_std(img: &[u8]) -> (f64, f64) {
    // Green channel only (channels are decorrelated but identically distributed).
    let n = (img.len() / 3) as f64;
    let mean = (0..img.len() / 3)
        .map(|i| img[i * 3 + 1] as f64)
        .sum::<f64>()
        / n;
    let var = (0..img.len() / 3)
        .map(|i| (img[i * 3 + 1] as f64 - mean).powi(2))
        .sum::<f64>()
        / n;
    (mean, var.sqrt())
}

fn save(out_dir: &str, name: &str, w: usize, h: usize, rgb: &[u8]) {
    std::fs::create_dir_all(out_dir).expect("mkdir");
    let path = format!("{out_dir}/{name}.png");
    image::save_buffer(&path, rgb, w as u32, h as u32, image::ColorType::Rgb8).expect("save png");
    let (mean, std) = mean_std(rgb);
    println!("  {name:<28} mean {mean:6.2}  std {std:5.2}");
}

fn main() {
    let mut args = std::env::args().skip(1);
    let out_dir = args
        .next()
        .unwrap_or_else(|| "scratch/grain-modes".to_string());
    let filling: f32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(0.25);
    let size: f32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(5.0);
    let layers: u32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(30);
    let std_dev: f32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(0.5);
    let opts = CrystalGrainOptions {
        filling,
        size,
        layers,
        std: std_dev,
        seed: 1,
        monochrome: false,
        ..Default::default()
    };
    println!("bake: filling={filling} size={size} layers={layers} std={std_dev}");

    // Bake the coverage field (what bake_crystal_grain_field uploads).
    let t = std::time::Instant::now();
    let mips16 = bake_grain_field(&opts, FULL_W); // tile == FULL_W so no wrap
    let ratios = mip_contrast_ratios(&mips16);
    let mips: Vec<Vec<f32>> = mips16
        .iter()
        .map(|m| m.iter().map(|v| v.to_f32()).collect())
        .collect();
    println!("baked in {:?} ({} levels)", t.elapsed(), mips.len());
    println!(
        "measured contrast ratios: {}",
        ratios
            .iter()
            .map(|r| format!("{r:.2}"))
            .collect::<Vec<_>>()
            .join(" ")
    );

    // Export ground truth: full CPU render of the model on the flat field.
    let t = std::time::Instant::now();
    let mut flat = Rgb32FImage::new(FULL_W as u32, FULL_H as u32);
    for p in flat.pixels_mut() {
        *p = Rgb([U, U, U]);
    }
    let truth = apply_crystal_grain_rgb(&flat, &opts, None, None);
    let truth_px: Vec<[f32; 3]> = truth.pixels().map(|p| p.0).collect();
    println!("ground truth rendered in {:?}", t.elapsed());

    // Exact area-weighted average of the truth render over a fractional rect
    // — "the exported file viewed at the same size".
    let area_avg = |x0: f32, y0: f32, x1: f32, y1: f32, c: usize| -> f32 {
        let mut sum = 0.0f64;
        let ylo = y0.floor() as usize;
        let yhi = y1.ceil() as usize;
        let xlo = x0.floor() as usize;
        let xhi = x1.ceil() as usize;
        for iy in ylo..yhi.min(FULL_H) {
            let wy = (y1.min(iy as f32 + 1.0) - y0.max(iy as f32)).max(0.0) as f64;
            for ix in xlo..xhi.min(FULL_W) {
                let wx = (x1.min(ix as f32 + 1.0) - x0.max(ix as f32)).max(0.0) as f64;
                sum += wx * wy * truth_px[iy * FULL_W + ix][c] as f64;
            }
        }
        (sum / ((x1 - x0) * (y1 - y0)) as f64) as f32
    };

    // The app's real render chain: render = display·1.25 (sharpnessFactor),
    // so coord_scale = downscale/1.25 and mip-texel steps are fractional
    // (0.8 texel/px) — exactly the case where bilinear smears the field.
    // λ=0 stays 1:1 (the app clamps the render to the original size).
    for lambda in 0u32..=2 {
        let step = 1usize << lambda; // display downscale (2^λ full-res px per screen px)
        let oversample = if lambda == 0 { 1.0 } else { 1.25 };
        let coord_scale = step as f32 / oversample;
        let rw = (FULL_W as f32 / coord_scale).round() as usize;
        let rh = (FULL_H as f32 / coord_scale).round() as usize;
        let mdim = FULL_W / step; // mip level λ dimension
        let boost = ratios[lambda as usize]; // the shipped "balanced" formula
        println!("lambda={lambda}  render {rw}x{rh}  coord_scale={coord_scale}  boost={boost:.2}");

        let mut old_linear = vec![0u8; rw * rh * 3];
        let mut accurate = vec![0u8; rw * rh * 3];
        let mut balanced = vec![0u8; rw * rh * 3];
        let mut crisp = vec![0u8; rw * rh * 3];
        let mut export = vec![0u8; rw * rh * 3];

        let mip_l = &mips[lambda as usize];
        let mip_0 = &mips[0];
        for y in 0..rh {
            for x in 0..rw {
                let i = (y * rw + x) * 3;
                // Shader coords: (coord + 0.5)·coord_scale, in field texels;
                // mip-λ texel space divides by 2^λ (= step).
                let (tx, ty) = (
                    (x as f32 + 0.5) * coord_scale,
                    (y as f32 + 0.5) * coord_scale,
                );
                let (mx, my) = (tx / step as f32, ty / step as f32);

                let mut g_old = [0f32; 3];
                let mut g_acc = [0f32; 3];
                let mut g_bal = [0f32; 3];
                let mut g_cri = [0f32; 3];
                for c in 0..3 {
                    g_old[c] = bilinear(mip_l, mdim, mx, my, c);
                    g_acc[c] = nearest(mip_l, mdim, mx, my, c);
                    let g = nearest(mip_l, mdim, mx, my, c);
                    g_bal[c] = (1.0 + (g - 1.0) * boost).clamp(0.0, 32.0);
                    g_cri[c] = nearest(mip_0, FULL_W, tx, ty, c);
                }
                old_linear[i..i + 3].copy_from_slice(&apply_g(g_old));
                accurate[i..i + 3].copy_from_slice(&apply_g(g_acc));
                balanced[i..i + 3].copy_from_slice(&apply_g(g_bal));
                crisp[i..i + 3].copy_from_slice(&apply_g(g_cri));

                // Export viewed at this size: exact area average of the truth.
                for c in 0..3 {
                    let v = area_avg(
                        x as f32 * coord_scale,
                        y as f32 * coord_scale,
                        (x + 1) as f32 * coord_scale,
                        (y + 1) as f32 * coord_scale,
                        c,
                    );
                    export[i + c] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                }
            }
        }

        let dir = format!("{out_dir}/lambda{lambda}");
        save(&dir, "1_old_trilinear", rw, rh, &old_linear);
        save(&dir, "2_accurate_nearest_mip", rw, rh, &accurate);
        save(&dir, "3_balanced_nearest_boost", rw, rh, &balanced);
        save(&dir, "4_crisp_nearest_mip0", rw, rh, &crisp);
        save(&dir, "5_export_downscaled", rw, rh, &export);
    }
    println!("done -> {out_dir}");
}

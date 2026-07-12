//! Manual check for the Pierre crystal grain port.
//! Usage: cargo run --example crystal_grain_check -- <in.png> [out.png] [filling] [size] [layers] [std] [mono]
//! Renders a grayscale crystal-grain pass (or RGB with mono=1) and prints the elapsed time.

use rapidraw_lib::crystal_grain::{CrystalGrainOptions, apply_crystal_grain_rgb, render_crystal_grain_channel};

fn main() {
    let input = std::env::args()
        .nth(1)
        .expect("usage: crystal_grain_check <in.png> [out.png] [filling] [size] [layers] [std] [mono]");
    let output = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "crystal_grain_out.png".to_string());
    let filling: f32 = std::env::args().nth(3).and_then(|s| s.parse().ok()).unwrap_or(0.25);
    let size: f32 = std::env::args().nth(4).and_then(|s| s.parse().ok()).unwrap_or(5.0);
    let layers: u32 = std::env::args().nth(5).and_then(|s| s.parse().ok()).unwrap_or(30);
    let std_dev: f32 = std::env::args().nth(6).and_then(|s| s.parse().ok()).unwrap_or(0.5);
    let mono = std::env::args().nth(7).as_deref() == Some("1");

    let opts = CrystalGrainOptions {
        filling,
        size,
        layers,
        std: std_dev,
        seed: 1,
        monochrome: mono,
    };
    let t = std::time::Instant::now();

    if mono {
        let img = image::open(&input).expect("failed to open input").to_rgb32f();
        let grained = apply_crystal_grain_rgb(&img, &opts, None);
        println!(
            "mono render took {:?} ({}x{}, filling={filling}, size={size}, layers={layers}, std={std_dev})",
            t.elapsed(),
            img.width(),
            img.height()
        );
        image::DynamicImage::ImageRgb32F(grained)
            .to_rgb8()
            .save(&output)
            .expect("failed to save output");
    } else {
        let img = image::open(&input).expect("failed to open input").to_luma32f();
        let (w, h) = (img.width() as usize, img.height() as usize);
        let result = render_crystal_grain_channel(img.as_raw(), w, h, &opts, None);
        println!(
            "render took {:?} ({w}x{h}, filling={filling}, size={size}, layers={layers}, std={std_dev})",
            t.elapsed()
        );
        let buf: Vec<u8> = result
            .iter()
            .map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
            .collect();
        image::save_buffer(&output, &buf, w as u32, h as u32, image::ColorType::L8)
            .expect("failed to save output");
    }
    println!("saved {output}");
}

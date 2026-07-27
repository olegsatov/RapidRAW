//! Manual check for the IPOL 2017 film grain port.
//! Usage: cargo run --example film_grain_check --release -- <in.png> [out.png] [mu_r] [n_mc]
//! Renders a grayscale grain pass and prints the elapsed time, so the output
//! can be compared against the reference C++ binary in scratch/ipol192.

use rapidraw_lib::film_grain::{FilmGrainOptions, render_film_grain_channel};

fn main() {
    let input = std::env::args()
        .nth(1)
        .expect("usage: film_grain_check <in.png> [out.png] [mu_r] [n_mc]");
    let output = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "grain_check_out.png".to_string());
    let mu_r: f32 = std::env::args()
        .nth(3)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.1);
    let n_mc: u32 = std::env::args()
        .nth(4)
        .and_then(|s| s.parse().ok())
        .unwrap_or(100);

    let img = image::open(&input)
        .expect("failed to open input")
        .to_luma32f();
    let (w, h) = (img.width() as usize, img.height() as usize);

    let opts = FilmGrainOptions {
        mu_r,
        n_monte_carlo: n_mc,
        ..Default::default()
    };
    let t = std::time::Instant::now();
    let result = render_film_grain_channel(img.as_raw(), w, h, &opts, None, None);
    println!(
        "render took {:?} ({w}x{h}, mu_r={mu_r}, n_mc={n_mc})",
        t.elapsed()
    );

    let buf: Vec<u8> = result
        .iter()
        .map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect();
    image::save_buffer(&output, &buf, w as u32, h as u32, image::ColorType::L8)
        .expect("failed to save output");
    println!("saved {output}");
}

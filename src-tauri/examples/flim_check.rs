//! Headless check for the flim tonemapper port (github.com/bean-mhm/flim, AGPLv3).
//! Usage: cargo run --example flim_check --release -- <in> <out.png> <preset 0|1|2|agx> [ev] [strength] [contrast] [shoulder] [toe] [saturation] [warmth]
//! Renders the input through the full GPU pipeline with the flim tonemapper
//! (AgX for preset "agx") and saves an 8-bit sRGB PNG.

use rapidraw_lib::render_image_headless;

fn main() {
    let input = std::env::args()
        .nth(1)
        .expect("usage: flim_check <in> <out.png> <preset 0|1|2|agx> [ev] [strength]");
    let output = std::env::args()
        .nth(2)
        .expect("usage: flim_check <in> <out.png> <preset 0|1|2|agx> [ev] [strength]");
    let preset = std::env::args().nth(3).unwrap_or_else(|| "0".to_string());
    let ev: f32 = std::env::args().nth(4).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let strength: f32 = std::env::args().nth(5).and_then(|s| s.parse().ok()).unwrap_or(100.0);
    let argf = |n: usize, default: f32| {
        std::env::args().nth(n).and_then(|s| s.parse().ok()).unwrap_or(default)
    };
    let contrast = argf(6, 100.0);
    let shoulder = argf(7, 0.0);
    let toe = argf(8, 0.0);
    let saturation = argf(9, 100.0);
    let warmth = argf(10, 0.0);

    let is_agx = preset == "agx";
    let preset_idx: i64 = if is_agx {
        0
    } else {
        preset.parse().expect("preset must be 0, 1, 2 or agx")
    };
    let tone_mapper = if is_agx { "agx" } else { "flim" };

    // Minimal adjustments: parse defaults match INITIAL_ADJUSTMENTS for every
    // other key. Native grain, the old film module and emulsion blur are
    // explicitly zeroed (as the offline grain commands do) so the output is a
    // clean tonemapper-only render; sectionVisibility mirrors INITIAL
    // (blackAndWhite off — otherwise it defaults to visible).
    let adjustments = serde_json::json!({
        "toneMapper": tone_mapper,
        "flimPreset": preset_idx,
        "flimEv": ev,
        "flimStrength": strength,
        "flimContrast": contrast,
        "flimShoulder": shoulder,
        "flimToe": toe,
        "flimSaturation": saturation,
        "flimWarmth": warmth,
        "grainAmount": 0,
        "filmStrength": 0,
        "filmBlur": 0,
        "crystalGrainAmount": 0,
        "sectionVisibility": {
            "basic": true,
            "curves": true,
            "color": true,
            "details": true,
            "effects": true,
            "blackAndWhite": false,
            "film": true
        }
    });

    let t = std::time::Instant::now();
    // Cap the long side: A1 II raws are 50 MP and the loader has no preview
    // size option; the tonemapper is per-pixel, so 2400 px is representative.
    let img = render_image_headless(&input, &adjustments, Some(2400)).expect("render failed");
    println!(
        "render took {:?} ({}x{}, toneMapper={tone_mapper}, preset={preset_idx}, ev={ev}, strength={strength})",
        t.elapsed(),
        img.width(),
        img.height()
    );
    img.to_rgb8().save(&output).expect("failed to save output");
    println!("saved {output}");
}

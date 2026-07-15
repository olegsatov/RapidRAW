//! Headless check for the flim tonemapper port (github.com/bean-mhm/flim, AGPLv3).
//! Usage: cargo run --example flim_check --release -- <in> <out.png> <preset 0|1|2|agx> [ev] [strength] [contrast] [shoulder] [toe] [saturation] [warmth] [halation] [adjacency] [hiTint] [shTint] [adv 0|1|2] [advPrintDensity]
//! Renders the input through the full GPU pipeline with the flim tonemapper
//! (AgX for preset "agx") and saves an 8-bit sRGB PNG.
//!
//! With `adv`, the full flimAdv* mirror of the given builtin preset is emitted
//! (same numbers as FLIM_BUILTIN_PRESETS in src/utils/adjustments.ts), so the
//! render goes through the advanced-panel code path instead of the builtin
//! table; the renders must match. `advPrintDensity` overrides that one key to
//! prove the advanced keys actually drive the render.

use rapidraw_lib::render_image_headless;

fn adv_mirror(idx: usize) -> serde_json::Value {
    match idx {
        1 => serde_json::json!({
            "flimAdvPreExposure": 5.563035, "flimAdvNegExposure": 5.8,
            "flimAdvNegDensity": 5.0, "flimAdvPrintExposure": 6.0,
            "flimAdvPrintDensity": 40.0, "flimAdvLog2Max": 23.0,
            "flimAdvBacklightR": 0.99, "flimAdvBacklightG": 1.1, "flimAdvBacklightB": 1.035989,
            "flimAdvSaturation": 1.1, "flimAdvBlackAuto": 0, "flimAdvBlackPoint": -5.0,
            "flimAdvPreFilterHue": 0.0, "flimAdvPreFilterStrength": 0.0,
            "flimAdvPostFilterHue": 0.0, "flimAdvPostFilterStrength": 0.0,
            "flimAdvGamutExpand": 100.0, "flimAdvPaletteRotate": 0.0,
            "flimAdvPushR": 1.1, "flimAdvPushB": 1.2
        }),
        2 => serde_json::json!({
            "flimAdvPreExposure": 3.9, "flimAdvNegExposure": 4.7,
            "flimAdvNegDensity": 7.0, "flimAdvPrintExposure": 4.7,
            "flimAdvPrintDensity": 30.0, "flimAdvLog2Max": 22.0,
            "flimAdvBacklightR": 0.9992, "flimAdvBacklightG": 0.99, "flimAdvBacklightB": 1.0,
            "flimAdvSaturation": 1.0, "flimAdvBlackAuto": 0, "flimAdvBlackPoint": 0.5,
            "flimAdvPreFilterHue": 210.0, "flimAdvPreFilterStrength": 0.05,
            "flimAdvPostFilterHue": 60.0, "flimAdvPostFilterStrength": 0.04,
            "flimAdvGamutExpand": 100.0, "flimAdvPaletteRotate": 0.0,
            "flimAdvPushR": 1.0, "flimAdvPushB": 1.06
        }),
        _ => serde_json::json!({
            "flimAdvPreExposure": 4.3, "flimAdvNegExposure": 6.0,
            "flimAdvNegDensity": 5.0, "flimAdvPrintExposure": 6.0,
            "flimAdvPrintDensity": 27.5, "flimAdvLog2Max": 22.0,
            "flimAdvBacklightR": 1.0, "flimAdvBacklightG": 1.0, "flimAdvBacklightB": 1.0,
            "flimAdvSaturation": 1.02, "flimAdvBlackAuto": 1, "flimAdvBlackPoint": 0.0,
            "flimAdvPreFilterHue": 0.0, "flimAdvPreFilterStrength": 0.0,
            "flimAdvPostFilterHue": 0.0, "flimAdvPostFilterStrength": 0.0,
            "flimAdvGamutExpand": 100.0, "flimAdvPaletteRotate": 0.0,
            "flimAdvPushR": 1.0, "flimAdvPushB": 1.0
        }),
    }
}

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
    let halation = argf(11, 0.0);
    let adjacency = argf(12, 0.0);
    let hi_tint = argf(13, 0.0);
    let sh_tint = argf(14, 0.0);
    let adv_idx: Option<usize> = std::env::args().nth(15).and_then(|s| s.parse().ok());
    let adv_print_density: Option<f32> = std::env::args().nth(16).and_then(|s| s.parse().ok());

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
    let mut adjustments = serde_json::json!({
        "toneMapper": tone_mapper,
        "flimPreset": preset_idx,
        "flimEv": ev,
        "flimStrength": strength,
        "flimContrast": contrast,
        "flimShoulder": shoulder,
        "flimToe": toe,
        "flimSaturation": saturation,
        "flimWarmth": warmth,
        "halationAmount": halation,
        "flimAdjacency": adjacency,
        "flimHiTint": hi_tint,
        "flimShTint": sh_tint,
        "grainAmount": 0,
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

    if let Some(idx) = adv_idx {
        let mut adv = adv_mirror(idx);
        if let Some(pd) = adv_print_density {
            adv["flimAdvPrintDensity"] = serde_json::json!(pd);
        }
        let map = adjustments.as_object_mut().expect("adjustments is an object");
        for (k, v) in adv.as_object().expect("adv mirror is an object") {
            map.insert(k.clone(), v.clone());
        }
    }

    let t = std::time::Instant::now();
    // Cap the long side: A1 II raws are 50 MP and the loader has no preview
    // size option; the tonemapper is per-pixel, so 2400 px is representative.
    let img = render_image_headless(&input, &adjustments, Some(2400)).expect("render failed");
    println!(
        "render took {:?} ({}x{}, toneMapper={tone_mapper}, preset={preset_idx}, ev={ev}, strength={strength}, adv={adv_idx:?})",
        t.elapsed(),
        img.width(),
        img.height()
    );
    img.to_rgb8().save(&output).expect("failed to save output");
    println!("saved {output}");
}
